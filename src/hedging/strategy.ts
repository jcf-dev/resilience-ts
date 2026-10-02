import type {
  Strategy,
  Runtime,
  OutcomeCallback,
  ResilienceContext,
  Callback,
  Outcome,
  DiscardResult,
} from "../core/types";
import { systemRuntime, count, schedule } from "../core/runtime";
import { defaultShouldHandle } from "../core/outcome";
import type { HedgingOptions } from "./options";
interface Branch<T> {
  index: number;
  context: ResilienceContext;
  controller: AbortController;
  outcome?: Outcome<T>;
  done: boolean;
  settled: Promise<void>;
}
export class HedgingStrategy<T> implements Strategy<T> {
  private readonly maximum: number;
  private readonly delay: number;
  constructor(
    private readonly options: HedgingOptions<T> = {},
    private readonly runtime: Runtime = systemRuntime,
    private readonly discard?: DiscardResult<T>,
  ) {
    this.maximum = count(options.maxHedgedAttempts ?? 1, "maxHedgedAttempts");
    this.delay = options.delayMs ?? 2000;
    if (!Number.isFinite(this.delay))
      throw new RangeError("delayMs must be finite");
  }
  async execute(
    next: OutcomeCallback<T>,
    context: ResilienceContext,
    callback: Callback<T>,
  ): Promise<Outcome<T>> {
    const branches: Branch<T>[] = [];
    const controllers = new Set<AbortController>();
    const state: {
      winner: Branch<T> | undefined;
      fatal: { error: unknown } | undefined;
      cancelled: boolean;
      closing: boolean;
    } = {
      winner: undefined,
      fatal: undefined,
      cancelled: false,
      closing: false,
    };
    let version = 0,
      wake: (() => void) | undefined,
      spawning = true,
      lastSpawn = this.runtime.nowMs();
    const notify = () => {
      version++;
      wake?.();
      wake = undefined;
    };
    const cancelOthers = (selected?: Branch<T>) => {
      for (const ctl of controllers)
        if (ctl !== selected?.controller && !ctl.signal.aborted)
          ctl.abort(
            context.signal.aborted
              ? context.signal.reason
              : new DOMException("Hedging branch discarded", "AbortError"),
          );
    };
    const abort = () => {
      if (!state.winner) state.cancelled = true;
      cancelOthers(state.winner);
      notify();
    };
    context.signal.addEventListener("abort", abort, { once: true });
    const wait = async (observed: number, ms?: number) => {
      if (version !== observed) return;
      let cancel = () => {};
      try {
        await new Promise<void>((resolve) => {
          wake = resolve;
          if (ms !== undefined) cancel = schedule(this.runtime, ms, resolve);
          if (version !== observed) resolve();
        });
      } finally {
        wake = undefined;
        cancel();
      }
    };
    const pending = () => branches.some((branch) => !branch.done);
    const finished = () =>
      state.winner !== undefined ||
      state.fatal !== undefined ||
      state.cancelled;
    const prepare = () => {
      const controller = new AbortController();
      controllers.add(controller);
      return {
        controller,
        context: {
          ...context,
          signal: controller.signal,
          properties: new Map(context.properties),
        },
      };
    };
    const launch = (
      prepared: ReturnType<typeof prepare>,
      action: Callback<T>,
    ) => {
      const branch: Branch<T> = {
        ...prepared,
        index: branches.length,
        done: false,
        settled: Promise.resolve(),
      };
      branches.push(branch);
      lastSpawn = this.runtime.nowMs();
      branch.settled = (async () => {
        try {
          try {
            branch.outcome = await next(branch.context, action);
          } catch (error) {
            branch.outcome = { kind: "error", error };
          }
          if (state.closing || finished()) return;
          if (context.signal.aborted) {
            abort();
            return;
          }
          const handled = await (
            this.options.shouldHandle ?? defaultShouldHandle
          )({
            outcome: branch.outcome,
            context: branch.context,
            attemptNumber: branch.index,
          });
          if (context.signal.aborted) {
            abort();
            return;
          }
          if (!handled && !finished() && !state.closing) {
            state.winner = branch;
            cancelOthers(branch);
          }
        } catch (error) {
          if (!state.closing && !state.fatal) {
            state.fatal = { error };
            cancelOthers();
          }
        } finally {
          branch.done = true;
          notify();
        }
      })();
    };
    try {
      if (context.signal.aborted) abort();
      else launch(prepare(), callback);
      while (!finished()) {
        if (spawning && branches.length <= this.maximum) {
          const observed = version;
          const delay =
            (await this.options.delayGenerator?.({
              context,
              attemptNumber: branches.length,
            })) ?? this.delay;
          if (!Number.isFinite(delay))
            throw new RangeError("Generated hedging delay must be finite");
          if (finished()) break;
          if (delay < 0) {
            while (pending() && !finished()) {
              const current = version;
              await wait(current);
            }
          } else if (delay > 0 && pending())
            await wait(
              observed,
              Math.max(0, delay - (this.runtime.nowMs() - lastSpawn)),
            );
          if (finished()) break;
          const prepared = prepare();
          const args = {
            context,
            actionContext: prepared.context,
            callback,
            attemptNumber: branches.length,
          };
          const generated = this.options.actionGenerator
            ? await this.options.actionGenerator(args)
            : callback;
          if (finished()) {
            prepared.controller.abort();
            break;
          }
          if (generated === null) {
            controllers.delete(prepared.controller);
            spawning = false;
            continue;
          }
          if (typeof generated !== "function")
            throw new TypeError(
              "actionGenerator must return a callback or null",
            );
          await this.options.onHedging?.(args);
          if (finished()) {
            prepared.controller.abort();
            break;
          }
          launch(prepared, generated);
        } else {
          if (!pending()) break;
          const observed = version;
          await wait(observed);
        }
      }
    } catch (error) {
      state.fatal = { error };
    } finally {
      if (!state.fatal && !state.cancelled && !state.winner)
        state.winner = branches[0];
      state.closing = true;
      cancelOthers(state.fatal || state.cancelled ? undefined : state.winner);
      await Promise.allSettled(branches.map((branch) => branch.settled));
      context.signal.removeEventListener("abort", abort);
    }
    let selected =
      state.fatal || state.cancelled
        ? undefined
        : (state.winner ?? branches[0]);
    const failures: unknown[] = [];
    if (state.fatal) failures.push(state.fatal.error);
    if (this.discard) {
      for (const branch of branches) {
        if (branch !== selected && branch.outcome?.kind === "result")
          try {
            await this.discard(branch.outcome.value, branch.context);
          } catch (error) {
            failures.push(error);
          }
      }
      // A cleanup failure prevents delivering the winner; release its result as well.
      if (failures.length > 0 && selected?.outcome?.kind === "result") {
        try {
          await this.discard(selected.outcome.value, selected.context);
        } catch (error) {
          failures.push(error);
        }
        selected = undefined;
      }
    }
    if (state.cancelled) return { kind: "error", error: context.signal.reason };
    if (failures.length > 0)
      return {
        kind: "error",
        error:
          failures.length === 1
            ? failures[0]
            : new AggregateError(
                failures,
                "Hedging execution or cleanup failed",
              ),
      };
    return (
      selected?.outcome ?? {
        kind: "error",
        error: new Error("Hedging finished without an outcome"),
      }
    );
  }
}
