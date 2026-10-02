import { it, expect } from "vitest";
import {
  ResiliencePipelineBuilder,
  createConcurrencyLimiter,
  RateLimiterRejectedError,
} from "../src/index";
it("generated hedge actions still traverse inner Retry, Timeout and Rate Limiter", async () => {
  let primary = 0,
    alternate = 0;
  const limiter = createConcurrencyLimiter({ permitLimit: 2, queueLimit: 0 });
  const p = new ResiliencePipelineBuilder<number>()
    .addHedging({
      delayMs: 0,
      actionGenerator: () => () => {
        if (++alternate === 1) throw "retry alternate";
        return 42;
      },
    })
    .addRetry({ delayMs: 0, maxRetryAttempts: 1 })
    .addTimeout(50)
    .addRateLimiter({ limiter })
    .build();
  expect(
    await p.execute(() => {
      primary++;
      throw "primary";
    }),
  ).toBe(42);
  expect(primary).toBe(2);
  expect(alternate).toBe(2);
});
it("an outer Fallback handles rate rejection and order changes retry counts", async () => {
  const limiter = createConcurrencyLimiter({ permitLimit: 1, queueLimit: 0 });
  const held = await limiter.acquire(new AbortController().signal);
  const p = new ResiliencePipelineBuilder<number>()
    .addFallback({
      shouldHandle: ({ outcome }) =>
        outcome.kind === "error" &&
        outcome.error instanceof RateLimiterRejectedError,
      fallbackAction: () => 42,
    })
    .addRateLimiter({ limiter })
    .build();
  expect(await p.execute(() => 7)).toBe(42);
  held.release();
  let calls = 0,
    fallbacks = 0;
  const q = new ResiliencePipelineBuilder<number>()
    .addRetry({ delayMs: 0, maxRetryAttempts: 2 })
    .addFallback({
      fallbackAction: () => {
        fallbacks++;
        return 42;
      },
    })
    .build();
  expect(
    await q.execute(() => {
      calls++;
      throw "down";
    }),
  ).toBe(42);
  expect(calls).toBe(1);
  expect(fallbacks).toBe(1);
});
