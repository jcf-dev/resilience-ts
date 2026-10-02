import type {
  Strategy,
  OutcomeCallback,
  ResilienceContext,
  Callback,
  Outcome,
  DiscardResult,
} from "../core/types";
import {
  captureOutcome,
  defaultShouldHandle,
  discardAfter,
} from "../core/outcome";
import type { FallbackOptions } from "./options";
export class FallbackStrategy<T> implements Strategy<T> {
  constructor(
    private readonly options: FallbackOptions<T>,
    private readonly discard?: DiscardResult<T>,
  ) {
    if (typeof options.fallbackAction !== "function")
      throw new TypeError("fallbackAction is required");
  }
  async execute(
    next: OutcomeCallback<T>,
    context: ResilienceContext,
    callback: Callback<T>,
  ): Promise<Outcome<T>> {
    const outcome = await next(context, callback);
    const args = { outcome, context, attemptNumber: 0 };
    let handled: boolean;
    try {
      if (context.signal.aborted) throw context.signal.reason;
      handled = await (this.options.shouldHandle ?? defaultShouldHandle)(args);
      if (context.signal.aborted) throw context.signal.reason;
    } catch (error) {
      await discardAfter(outcome, context, this.discard, async () => {
        throw error;
      });
      throw error;
    }
    if (!handled) return outcome;
    await discardAfter(outcome, context, this.discard, async () => {
      await this.options.onFallback?.(args);
    });
    return captureOutcome(() => this.options.fallbackAction(args), context);
  }
}
