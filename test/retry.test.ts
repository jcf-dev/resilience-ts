import { describe, it, expect, vi } from "vitest";
import {
  ResiliencePipelineBuilder,
  RetryPolicy,
  systemRuntime,
} from "../src/index";
const ctx = () => ({
  signal: new AbortController().signal,
  properties: new Map<string, unknown>(),
});
describe("retry", () => {
  it("three total calls means two retries; zero starts no extra attempt", async () => {
    for (const retries of [0, 2]) {
      let calls = 0;
      const error = { down: true };
      const p = new ResiliencePipelineBuilder<number>()
        .addRetry({ maxRetryAttempts: retries, delayMs: 0 })
        .build();
      expect(
        await p.executeOutcome(() => {
          calls++;
          throw error;
        }),
      ).toEqual({ kind: "error", error });
      expect(calls).toBe(retries + 1);
    }
  });
  it("returns scheduler decisions without callback, sleep or hooks", async () => {
    let hooks = 0;
    const p = new RetryPolicy<number>({
      maxRetryAttempts: 2,
      delayMs: 2000,
      backoffType: "exponential",
      onRetry: () => {
        hooks++;
      },
    });
    const outcome = { kind: "error", error: undefined } as const;
    const a = await p.evaluate(
      outcome,
      { attemptNumber: 0, jitterState: 0 },
      ctx(),
    );
    expect(a).toEqual({
      kind: "retry",
      delayMs: 2000,
      state: { attemptNumber: 1, jitterState: 0 },
    });
    const b = await p.evaluate(outcome, a.state, ctx());
    expect(b).toEqual({
      kind: "retry",
      delayMs: 4000,
      state: { attemptNumber: 2, jitterState: 0 },
    });
    expect(await p.evaluate(outcome, b.state, ctx())).toMatchObject({
      kind: "stop",
      reason: "exhausted",
    });
    expect(hooks).toBe(0);
  });
  it("handles results asynchronously and cleans only discarded results", async () => {
    const discarded: number[] = [];
    let calls = 0;
    const p = new ResiliencePipelineBuilder<number>({
      discardResult: (value) => {
        discarded.push(value);
      },
    })
      .addRetry({
        delayMs: 0,
        shouldHandle: async ({ outcome }) =>
          outcome.kind === "result" && outcome.value < 3,
      })
      .build();
    expect(await p.execute(() => ++calls)).toBe(3);
    expect(discarded).toEqual([1, 2]);
  });
  it("retains both hook and discarded-result cleanup failures", async () => {
    const hook = { hook: true },
      cleanup = { cleanup: true };
    let cleaned = 0;
    const p = new ResiliencePipelineBuilder<number>({
      discardResult: () => {
        cleaned++;
        throw cleanup;
      },
    })
      .addRetry({
        delayMs: 0,
        shouldHandle: () => true,
        onRetry: () => {
          throw hook;
        },
      })
      .build();
    const outcome = await p.executeOutcome(() => 503);
    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error")
      expect((outcome.error as AggregateError).errors).toEqual([hook, cleanup]);
    expect(cleaned).toBe(1);
  });
  it("starts no extra call after cancellation during delay", async () => {
    vi.useFakeTimers();
    const ctl = new AbortController(),
      reason = { cancel: true };
    let calls = 0;
    const pending = new ResiliencePipelineBuilder<number>()
      .addRetry({ delayMs: 2000 })
      .build()
      .executeOutcome(
        () => {
          calls++;
          throw new Error("down");
        },
        { signal: ctl.signal },
      );
    await vi.advanceTimersByTimeAsync(1);
    ctl.abort(reason);
    expect(await pending).toEqual({ kind: "error", error: reason });
    expect(calls).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
  it("does not mistake an AbortError name for caller cancellation", async () => {
    let calls = 0;
    const p = new ResiliencePipelineBuilder<number>()
      .addRetry({ delayMs: 0, maxRetryAttempts: 1 })
      .build();
    expect(
      await p.execute(() => {
        if (++calls === 1)
          throw Object.assign(new Error("not cancelled"), {
            name: "AbortError",
          });
        return 7;
      }),
    ).toBe(7);
  });
  it("generated delay overrides cap; absent and negative generators use calculation", async () => {
    for (const [generated, want] of [
      [99, 99],
      [null, 5],
      [-1, 5],
      [undefined, 5],
    ] as const) {
      const p = new RetryPolicy({
        delayMs: 10,
        maxDelayMs: 5,
        delayGenerator: () => generated,
      });
      expect(
        await p.evaluate(
          { kind: "error", error: null },
          { attemptNumber: 0, jitterState: 0 },
          ctx(),
        ),
      ).toMatchObject({ kind: "retry", delayMs: want });
    }
    for (const value of [NaN, Infinity]) {
      const p = new RetryPolicy({ delayGenerator: () => value });
      await expect(
        p.evaluate(
          { kind: "error", error: null },
          { attemptNumber: 0, jitterState: 0 },
          ctx(),
        ),
      ).rejects.toThrow(RangeError);
    }
  });
  it("rejects invalid counts, durations, backoff and scheduler state", async () => {
    for (const value of [-1, 1.5, NaN, Infinity])
      expect(() => new RetryPolicy({ maxRetryAttempts: value })).toThrow(
        RangeError,
      );
    for (const value of [-1, NaN, Infinity])
      expect(() => new RetryPolicy({ delayMs: value })).toThrow(RangeError);
    expect(() => new RetryPolicy({ backoffType: "wrong" as never })).toThrow(
      RangeError,
    );
    await expect(
      new RetryPolicy().evaluate(
        { kind: "error", error: null },
        { attemptNumber: -1, jitterState: 0 },
        ctx(),
      ),
    ).rejects.toThrow(RangeError);
  });
});
