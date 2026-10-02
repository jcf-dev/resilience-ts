import type {
  Strategy,
  OutcomeCallback,
  ResilienceContext,
  Callback,
  Runtime,
  DiscardResult,
  Outcome,
} from "../core/types";
import { systemRuntime } from "../core/runtime";
import { discardAfter } from "../core/outcome";
import { sleep, StrategyLifetime } from "../core/cancellation";
import type { RetryOptions, RetryState, RetryDecision } from "./options";
import { RetryPolicy } from "./policy";
export class RetryStrategy<T> implements Strategy<T> {
  private readonly policy: RetryPolicy<T>;
  private readonly lifetime = new StrategyLifetime();
  constructor(
    options: RetryOptions<T> = {},
    private readonly runtime: Runtime = systemRuntime,
    private readonly discard?: DiscardResult<T>,
  ) {
    this.policy = new RetryPolicy(options, runtime);
  }
  dispose(): void {
    this.lifetime.dispose();
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
    let state: RetryState = { attemptNumber: 0, jitterState: 0 };
    while (true) {
      if (context.signal.aborted)
        return { kind: "error", error: context.signal.reason };
      const outcome = await next(context, callback);
      let decision: RetryDecision;
      try {
        decision = await this.policy.evaluate(outcome, state, context);
        if (decision.kind === "stop" && decision.reason === "cancelled")
          throw context.signal.reason;
      } catch (error) {
        await discardAfter(outcome, context, this.discard, async () => {
          throw error;
        });
        throw error;
      }
      if (decision.kind === "stop") return outcome;
      const args = {
        outcome,
        context,
        attemptNumber: state.attemptNumber,
        delayMs: decision.delayMs,
      };
      await discardAfter(outcome, context, this.discard, async () => {
        await this.policy.options.onRetry?.(args);
      });
      await sleep(this.runtime, decision.delayMs, context.signal);
      state = decision.state;
    }
  }
}
