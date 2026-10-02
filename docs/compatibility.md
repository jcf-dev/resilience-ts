# Compatibility

Reference: [Polly 8.8.0](https://github.com/App-vNext/Polly/tree/8.8.0), exact commit `9ad5ae9b4ff9beb4321b0762249ce173b984f817`.
This is an independent Node implementation of Polly-style behavior, not a .NET binary compatibility layer.
Original code is MIT. Translated backoff portions preserve Polly's BSD-3-Clause license in `licenses/Polly-BSD-3-Clause.txt` and `NOTICE`.

Core outcomes preserve arbitrary thrown values. Builder order is outermost to innermost.
Contexts and built strategy state are isolated. Cancellation uses AbortSignal and preserves its reason.
Durations are milliseconds; finite long durations use timer chunks to avoid Node overflow.
