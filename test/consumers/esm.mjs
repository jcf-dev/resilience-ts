import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  ResiliencePipelineBuilder,
  RetryPolicy,
  TimeoutRejectedError,
  BrokenCircuitError,
  RateLimiterRejectedError,
} from "@jcf-dev/resilience-ts";
const cjs = createRequire(import.meta.url)("@jcf-dev/resilience-ts");
for (const [key, constructor] of Object.entries({
  ResiliencePipelineBuilder,
  RetryPolicy,
  TimeoutRejectedError,
  BrokenCircuitError,
  RateLimiterRejectedError,
}))
  assert.equal(cjs[key], constructor, key + " identity");
let calls = 0;
const pipeline = new ResiliencePipelineBuilder()
  .addFallback({ fallbackAction: () => 0 })
  .addRetry({ maxRetryAttempts: 2, delayMs: 0 })
  .addCircuitBreaker()
  .addTimeout(100)
  .addRateLimiter()
  .addHedging({ maxHedgedAttempts: 0 })
  .build();
assert.equal(
  await pipeline.execute(() => {
    if (++calls < 3) throw "retry";
    return 42;
  }),
  42,
);
assert.equal(calls, 3);
pipeline.dispose();
assert.equal(
  await new ResiliencePipelineBuilder().build().execute(() => undefined),
  undefined,
);
console.log(
  "Packed ESM, six strategies and mixed import/require identity passed",
);
