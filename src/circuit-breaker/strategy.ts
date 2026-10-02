import type {
  Strategy,
  Runtime,
  OutcomeCallback,
  ResilienceContext,
  Callback,
  Outcome,
  DiscardResult,
} from "../core/types";
import { defaultShouldHandle, discardAfter } from "../core/outcome";
import { systemRuntime, count, duration } from "../core/runtime";
import type { CircuitBreakerOptions } from "./options";
import type { CircuitState } from "./state";
export class BrokenCircuitError extends Error {
  constructor() {
    super("Circuit is open");
    this.name = "BrokenCircuitError";
  }
}
export class IsolatedCircuitError extends BrokenCircuitError {
  constructor() {
    super();
    this.message = "Circuit is isolated";
    this.name = "IsolatedCircuitError";
  }
}
export class CircuitBreakerStrategy<T> implements Strategy<T> {
  private state: CircuitState = "closed";
  private epoch = 0;
  private openUntil = 0;
  private samples: { at: number; handled: boolean }[] = [];
  private readonly ratio: number;
  private readonly minimum: number;
  private readonly window: number;
  private readonly breakMs: number;
  constructor(
    private readonly options: CircuitBreakerOptions<T> = {},
    private readonly runtime: Runtime = systemRuntime,
    private readonly discard?: DiscardResult<T>,
  ) {
    this.ratio = options.failureRatio ?? 0.1;
    if (!Number.isFinite(this.ratio) || this.ratio <= 0 || this.ratio > 1)
      throw new RangeError("failureRatio must be > 0 and <= 1");
    this.minimum = count(
      options.minimumThroughput ?? 100,
      "minimumThroughput",
      2,
    );
    this.window = duration(
      options.samplingDurationMs ?? 30000,
      "samplingDurationMs",
      true,
    );
    this.breakMs = duration(
      options.breakDurationMs ?? 5000,
      "breakDurationMs",
      true,
    );
    options.stateProvider?.bind(() => this.state);
    options.manualControl?.bind(async (isolate) => {
      this.epoch++;
      this.samples = [];
      this.state = isolate ? "isolated" : "closed";
      const context: ResilienceContext = {
        signal: new AbortController().signal,
        properties: new Map(),
      };
      await (isolate ? options.onOpened : options.onClosed)?.({
        context,
        outcome: undefined,
        manual: true,
      });
    });
  }
  private reopen(): void {
    this.state = "open";
    this.epoch++;
    this.openUntil = this.runtime.nowMs() + this.breakMs;
  }
  async execute(
    next: OutcomeCallback<T>,
    context: ResilienceContext,
    callback: Callback<T>,
  ): Promise<Outcome<T>> {
    if (this.state === "isolated")
      return { kind: "error", error: new IsolatedCircuitError() };
    if (this.state === "open") {
      if (this.runtime.nowMs() < this.openUntil)
        return { kind: "error", error: new BrokenCircuitError() };
      this.state = "half-open";
      this.epoch++;
      const transitionEpoch = this.epoch;
      try {
        await this.options.onHalfOpened?.({
          context,
          outcome: undefined,
          manual: false,
        });
      } catch (error) {
        if (this.epoch === transitionEpoch) this.reopen();
        throw error;
      }
      if (this.epoch !== transitionEpoch)
        return {
          kind: "error",
          error:
            (this.state as CircuitState) === "isolated"
              ? new IsolatedCircuitError()
              : new BrokenCircuitError(),
        };
      return this.run(next, context, callback, transitionEpoch, true);
    }
    if (this.state === "half-open")
      return { kind: "error", error: new BrokenCircuitError() };
    return this.run(next, context, callback, this.epoch, false);
  }
  private async run(
    next: OutcomeCallback<T>,
    context: ResilienceContext,
    callback: Callback<T>,
    admissionEpoch: number,
    probe: boolean,
  ): Promise<Outcome<T>> {
    let outcome: Outcome<T> | undefined;
    try {
      outcome = await next(context, callback);
      if (context.signal.aborted) throw context.signal.reason;
      const handled = await (this.options.shouldHandle ?? defaultShouldHandle)({
        outcome,
        context,
        attemptNumber: 0,
      });
      if (context.signal.aborted) throw context.signal.reason;
      if (this.epoch !== admissionEpoch) return outcome;
      const now = this.runtime.nowMs();
      this.samples = this.samples.filter((s) => s.at > now - this.window);
      this.samples.push({ at: now, handled });
      if (probe && !handled) {
        this.state = "closed";
        this.epoch++;
        this.samples = [];
        await this.options.onClosed?.({ context, outcome, manual: false });
        if (context.signal.aborted) throw context.signal.reason;
        return outcome;
      }
      const failures = this.samples.filter((s) => s.handled).length;
      if (
        handled &&
        (probe ||
          (this.samples.length >= this.minimum &&
            failures / this.samples.length >= this.ratio))
      ) {
        this.reopen();
        const openingEpoch = this.epoch;
        if (this.options.breakDurationGenerator) {
          const generated = duration(
            await this.options.breakDurationGenerator({
              context,
              outcome,
              failureCount: failures,
            }),
            "Generated breakDurationMs",
          );
          if (context.signal.aborted) throw context.signal.reason;
          if (this.epoch !== openingEpoch) return outcome;
          this.openUntil = now + generated;
        }
        await this.options.onOpened?.({ context, outcome, manual: false });
        if (context.signal.aborted) throw context.signal.reason;
      }
      return outcome;
    } catch (error) {
      if (probe && this.epoch === admissionEpoch) this.reopen();
      if (outcome)
        await discardAfter(outcome, context, this.discard, async () => {
          throw error;
        });
      throw error;
    }
  }
}
