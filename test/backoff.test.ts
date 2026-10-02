import { it, expect } from "vitest";
import { calculateBackoff } from "../src/retry/backoff";
import { systemRuntime } from "../src/index";
it("matches independently calculated constant and linear jitter boundaries", () => {
  for (const [backoffType, random, want] of [
    ["constant", 0, 1500],
    ["constant", 1, 2500],
    ["linear", 0, 3000],
    ["linear", 1, 5000],
  ] as const)
    expect(
      calculateBackoff(
        {
          attemptNumber: 1,
          jitterState: 0,
          delayMs: 2000,
          backoffType,
          useJitter: true,
        },
        { ...systemRuntime, random: () => random },
      ).delayMs,
    ).toBe(want);
});
it("matches independently calculated jitter V2 fixtures and keeps finite serializable state", () => {
  const r = { ...systemRuntime, random: () => 0.5 };
  const first = calculateBackoff(
    {
      attemptNumber: 0,
      jitterState: 0,
      delayMs: 1000,
      backoffType: "exponential",
      useJitter: true,
    },
    r,
  );
  expect(first.delayMs).toBeCloseTo(897.404936, 3);
  const second = calculateBackoff(
    {
      attemptNumber: 1,
      jitterState: first.jitterState,
      delayMs: 1000,
      backoffType: "exponential",
      useJitter: true,
    },
    r,
  );
  expect(second.delayMs).toBeCloseTo(1093.003547, 3);
  const huge = calculateBackoff(
    {
      attemptNumber: 1024,
      jitterState: 0,
      delayMs: 1000,
      backoffType: "exponential",
      useJitter: true,
    },
    r,
  );
  expect(Number.isFinite(huge.delayMs)).toBe(true);
  expect(Number.isFinite(huge.jitterState)).toBe(true);
});
