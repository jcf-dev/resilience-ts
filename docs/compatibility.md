# Compatibility

Reference: [Polly 8.8.0](https://github.com/App-vNext/Polly/tree/8.8.0), exact commit `9ad5ae9b4ff9beb4321b0762249ce173b984f817`.
This is an independent Node implementation of Polly-style behavior, not a .NET binary compatibility layer.
Original code is MIT. Translated backoff portions preserve Polly's BSD-3-Clause license in `licenses/Polly-BSD-3-Clause.txt` and `NOTICE`.

Core outcomes preserve arbitrary thrown values. Builder order is outermost to innermost.
Contexts and built strategy state are isolated. Cancellation uses AbortSignal and preserves its reason.
Durations are milliseconds; finite long durations use timer chunks to avoid Node overflow.

## Retry

Backoff is translated from `src/Polly.Core/Retry/RetryHelper.cs`; Retry orchestration follows `RetryResilienceStrategy.cs`. Default: 3 retries after the original, 2000ms constant delay, no jitter. A generated nonnegative delay overrides the calculated cap; null, undefined or negative uses calculated delay. NaN/infinite generated delays are rejected rather than overflowing Node timers. Arithmetic overflow and jitter state are clamped to finite safe numbers for JSON persistence. Hook and cleanup failures are combined with AggregateError when both occur. External schedulers can evaluate the same RetryPolicy without timers or hooks.

## Circuit Breaker

References: `src/Polly.Core/CircuitBreaker/Controller/{CircuitStateController,AdvancedCircuitBehavior}.cs`. Sliding-window sampling uses completion times and removes samples exactly at the window boundary. Defaults: failure ratio 0.1, minimum throughput 100, 30-second window, 5-second break. Exactly one recovery probe is admitted. Epoch fences prevent stale completions and asynchronous generators from overriding a later transition or manual action. Cancellation does not affect health statistics. State providers and manual controls each bind to one built circuit; builder reuse without these controls constructs independent circuits.
