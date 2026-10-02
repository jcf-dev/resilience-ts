import { StrategyLifetime } from "../core/cancellation";
import type {
  Strategy,
  Runtime,
  OutcomeCallback,
  ResilienceContext,
  Callback,
  Outcome,
  DiscardResult,
} from "../core/types";
import { duration, schedule, systemRuntime } from "../core/runtime";
import { discardAfter } from "../core/outcome";
import type { TimeoutOptions } from "./options";
export class TimeoutRejectedError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Execution exceeded ${timeoutMs}ms timeout`);
    this.name = "TimeoutRejectedError";
  }
}
export class TimeoutStrategy<T> implements Strategy<T> {
  private readonly lifetime = new StrategyLifetime();
  dispose(): void {
    this.lifetime.dispose();
  }
  private readonly options: TimeoutOptions;
  private readonly timeoutMs: number;
  constructor(
    options: number | TimeoutOptions = {},
    private readonly runtime: Runtime = systemRuntime,
    private readonly discard?: DiscardResult<T>,
  ) {
    this.options =
      typeof options === "number" ? { timeoutMs: options } : { ...options };
    this.timeoutMs = duration(
      this.options.timeoutMs ?? 30000,
      "timeoutMs",
      true,
    );
  }
  async execute(
    next: OutcomeCallback<T>,
    context: ResilienceContext,
    callback: Callback<T>,
  ): Promise<Outcome<T>> {
    const execution = this.lifetime.begin(context.signal);
    try {
      return await this.executeCore(
        next,
        { ...context, signal: execution.signal },
        callback,
      );
    } finally {
      execution.close();
    }
  }
  private async executeCore(
    next: OutcomeCallback<T>,
    context: ResilienceContext,
    callback: Callback<T>,
  ): Promise<Outcome<T>> {
    const ms =
      (await this.options.timeoutGenerator?.(context)) ?? this.timeoutMs;
    if (!Number.isFinite(ms))
      throw new RangeError("Generated timeout must be finite");
    if (context.signal.aborted)
      return { kind: "error", error: context.signal.reason };
    if (ms <= 0) return next(context, callback);
    const ctl = new AbortController();
    const timeoutError = new TimeoutRejectedError(ms);
    let cause: "caller" | "timeout" | undefined;
    let cancel = () => {};
    const abort = () => {
      cancel();
      if (cause === undefined) {
        cause = "caller";
        ctl.abort(context.signal.reason);
      }
    };
    context.signal.addEventListener("abort", abort, { once: true });
    cancel = schedule(this.runtime, ms, () => {
      if (cause === undefined) {
        cause = "timeout";
        ctl.abort(timeoutError);
      }
    });
    let outcome: Outcome<T>;
    try {
      if (context.signal.aborted) abort();
      try {
        outcome = await next({ ...context, signal: ctl.signal }, callback);
      } catch (error) {
        outcome = { kind: "error", error };
      }
    } finally {
      cancel();
      context.signal.removeEventListener("abort", abort);
    }
    if (cause === undefined) return outcome;
    await discardAfter(outcome, context, this.discard, async () => {
      if (cause === "timeout")
        await this.options.onTimeout?.({ context, timeoutMs: ms });
    });
    return {
      kind: "error",
      error: cause === "timeout" ? timeoutError : context.signal.reason,
    };
  }
}
