// SPDX-License-Identifier: BSD-3-Clause
// Translated from Polly 8.8.0 RetryHelper.cs. Copyright (c) 2015-2025, App vNext.
// Decorrelated jitter V2: George Polevoy, with scaling adaptations by Reisenberger.
import type { Runtime } from "../core/types";
export interface BackoffInput {
  attemptNumber: number;
  jitterState: number;
  delayMs: number;
  backoffType: "constant" | "linear" | "exponential";
  useJitter: boolean;
  maxDelayMs?: number;
}
export function calculateBackoff(
  input: BackoffInput,
  runtime: Runtime,
): { delayMs: number; jitterState: number } {
  const { attemptNumber, delayMs, backoffType, useJitter } = input;
  let delay = delayMs,
    state = 0;
  if (delayMs !== 0) {
    if (backoffType === "linear") delay *= attemptNumber + 1;
    if (backoffType === "exponential") delay *= 2 ** attemptNumber;
    if (useJitter) {
      const random = runtime.random();
      if (!Number.isFinite(random) || random < 0 || random > 1)
        throw new RangeError("random must be between 0 and 1");
      if (backoffType === "exponential") {
        const t = attemptNumber + random;
        const next = Math.min(
          2 ** t * Math.tanh(Math.sqrt(4 * t)),
          Number.MAX_SAFE_INTEGER,
        );
        delay = Math.max(0, next - input.jitterState) * (1 / 1.4) * delayMs;
        state = next;
      } else delay *= 0.75 + random * 0.5;
    }
  }
  return {
    delayMs: Math.min(
      delay,
      input.maxDelayMs ?? Number.MAX_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER,
    ),
    jitterState: state,
  };
}
