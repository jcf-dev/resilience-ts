import assert from "node:assert/strict";
import {
  ResiliencePipelineBuilder,
  RetryPolicy,
  CircuitBreakerManualControl,
  TimeoutRejectedError,
  createConcurrencyLimiter,
} from "../dist/esm/index.js";
// Retry and external durable scheduling use the same bounded policy.
let calls = 0;
assert.equal(
  await new ResiliencePipelineBuilder()
    .addRetry({ maxRetryAttempts: 2, delayMs: 0 })
    .build()
    .execute(() => {
      if (++calls < 3) throw "temporary";
      return 42;
    }),
  42,
);
const context = { signal: new AbortController().signal, properties: new Map() };
const decision = await new RetryPolicy({
  maxRetryAttempts: 2,
  delayMs: 2000,
  backoffType: "exponential",
}).evaluate(
  { kind: "error", error: "temporary" },
  { attemptNumber: 0, jitterState: 0 },
  context,
);
assert.equal(decision.delayMs, 2000);
// Circuit state persists in the pipeline; manual reactivation is explicit.
const control = new CircuitBreakerManualControl();
const circuit = new ResiliencePipelineBuilder()
  .addCircuitBreaker({ manualControl: control })
  .build();
await control.isolate();
assert.equal((await circuit.executeOutcome(() => 42)).kind, "error");
await control.close();
assert.equal(await circuit.execute(() => 42), 42);
// Cooperative timeout waits for cancellation-aware work.
const timeout = new ResiliencePipelineBuilder().addTimeout(2).build();
const expired = await timeout.executeOutcome(async ({ signal }) => {
  await new Promise((resolve) =>
    signal.addEventListener("abort", resolve, { once: true }),
  );
  throw signal.reason;
});
assert.ok(expired.error instanceof TimeoutRejectedError);
// A bounded queue limits concurrent local callbacks.
let active = 0,
  peak = 0;
const limiter = createConcurrencyLimiter({ permitLimit: 1, queueLimit: 2 });
const limited = new ResiliencePipelineBuilder()
  .addRateLimiter({ limiter, ownsLimiter: true })
  .build();
await Promise.all(
  [1, 2, 3].map((value) =>
    limited.execute(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return value;
    }),
  ),
);
assert.equal(peak, 1);
limited.dispose();
// Fallback runs after inner retries.
assert.equal(
  await new ResiliencePipelineBuilder()
    .addFallback({ fallbackAction: () => 42 })
    .addRetry({ maxRetryAttempts: 0 })
    .build()
    .execute(() => {
      throw "unavailable";
    }),
  42,
);
// Alternate hedges still pass through inner strategies.
const hedged = new ResiliencePipelineBuilder()
  .addHedging({ delayMs: 1, actionGenerator: () => () => 42 })
  .addTimeout(100)
  .build();
assert.equal(
  await hedged.execute(async ({ signal }) => {
    await new Promise((resolve) =>
      signal.addEventListener("abort", resolve, { once: true }),
    );
    throw signal.reason;
  }),
  42,
);
console.log(
  "All six local strategy examples and durable Retry evaluation passed",
);
