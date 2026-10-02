import {
  ResiliencePipelineBuilder,
  PredicateBuilder,
  RetryPolicy,
  TimeoutRejectedError,
  type Outcome,
  type RetryDecision,
} from "@jcf-dev/resilience-ts";
const predicate = new PredicateBuilder<number>()
  .handleErrorType(TimeoutRejectedError)
  .handleResult((value) => value === 503)
  .build();
const pipeline = new ResiliencePipelineBuilder<number>()
  .addFallback({ fallbackAction: () => 200 })
  .addRetry({ shouldHandle: predicate })
  .addCircuitBreaker({ minimumThroughput: 2 })
  .addTimeout(100)
  .addRateLimiter()
  .addHedging({ maxHedgedAttempts: 0 })
  .build();
const result: Promise<number> = pipeline.execute((context) => {
  context.properties.set("attempt", 1);
  return 42;
});
const outcome: Promise<Outcome<number>> = pipeline.executeOutcome(() => 42);
const decision: Promise<RetryDecision> = new RetryPolicy<number>().evaluate(
  { kind: "error", error: undefined },
  { attemptNumber: 0, jitterState: 0 },
  { signal: new AbortController().signal, properties: new Map() },
);
void result;
void outcome;
void decision;
