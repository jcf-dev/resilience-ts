import type {
  Strategy,
  OutcomeCallback,
  ResilienceContext,
  Callback,
  Outcome,
} from "../core/types";
import type { RateLimiterOptions, AsyncPermitLimiter } from "./types";
import { createConcurrencyLimiter } from "./concurrency";
export class RateLimiterRejectedError extends Error {
  readonly retryAfterMs: number | undefined;
  constructor(retryAfterMs?: number) {
    super("Rate limiter rejected execution");
    this.name = "RateLimiterRejectedError";
    this.retryAfterMs = retryAfterMs;
  }
}
export class RateLimiterStrategy<T> implements Strategy<T> {
  private readonly limiter: AsyncPermitLimiter;
  private readonly owned: boolean;
  constructor(private readonly options: RateLimiterOptions = {}) {
    this.limiter =
      options.limiter ??
      createConcurrencyLimiter({ permitLimit: 1000, queueLimit: 0 });
    this.owned = options.limiter === undefined || options.ownsLimiter === true;
  }
  async execute(
    next: OutcomeCallback<T>,
    context: ResilienceContext,
    callback: Callback<T>,
  ): Promise<Outcome<T>> {
    const lease = await this.limiter.acquire(context.signal);
    try {
      if (context.signal.aborted)
        return { kind: "error", error: context.signal.reason };
      if (!lease.acquired) {
        await this.options.onRejected?.(
          lease.retryAfterMs === undefined
            ? { context }
            : { context, retryAfterMs: lease.retryAfterMs },
        );
        return {
          kind: "error",
          error: new RateLimiterRejectedError(lease.retryAfterMs),
        };
      }
      return await next(context, callback);
    } finally {
      lease.release();
    }
  }
  dispose(): void {
    if (this.owned) this.limiter.dispose?.();
  }
}
