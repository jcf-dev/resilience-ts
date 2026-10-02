import { it, expect, vi } from "vitest";
import { ResiliencePipelineBuilder, TimeoutRejectedError } from "../src/index";
it("awaits cooperative callback cleanup before returning timeout", async () => {
  vi.useFakeTimers();
  let cleaned = false,
    settled = false;
  const pending = new ResiliencePipelineBuilder<number>()
    .addTimeout(10)
    .build()
    .executeOutcome(async (ctx) => {
      await new Promise<void>((resolve) =>
        ctx.signal.addEventListener(
          "abort",
          () =>
            setTimeout(() => {
              cleaned = true;
              resolve();
            }, 5),
          { once: true },
        ),
      );
      return 7;
    })
    .then((o) => {
      settled = true;
      return o;
    });
  await vi.advanceTimersByTimeAsync(10);
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(5);
  expect(await pending).toMatchObject({
    kind: "error",
    error: expect.any(TimeoutRejectedError),
  });
  expect(cleaned).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
});
it("preserves caller abort reason and awaits work settlement", async () => {
  vi.useFakeTimers();
  const ctl = new AbortController(),
    reason = { caller: true };
  let cleaned = false;
  const pending = new ResiliencePipelineBuilder<number>()
    .addTimeout(10)
    .build()
    .executeOutcome(
      async (ctx) => {
        await new Promise<void>((resolve) =>
          ctx.signal.addEventListener(
            "abort",
            () => {
              cleaned = true;
              resolve();
            },
            { once: true },
          ),
        );
        return 8;
      },
      { signal: ctl.signal },
    );
  await vi.advanceTimersByTimeAsync(1);
  ctl.abort(reason);
  expect(await pending).toEqual({ kind: "error", error: reason });
  expect(cleaned).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
});
it("generated zero or negative timeout disables that execution", async () => {
  for (const ms of [0, -1])
    expect(
      await new ResiliencePipelineBuilder<number>()
        .addTimeout({ timeoutGenerator: () => ms })
        .build()
        .execute(() => 7),
    ).toBe(7);
  for (const ms of [0, -1, NaN, Infinity])
    expect(() =>
      new ResiliencePipelineBuilder<number>().addTimeout(ms).build(),
    ).toThrow(RangeError);
  for (const ms of [NaN, Infinity])
    expect(
      await new ResiliencePipelineBuilder<number>()
        .addTimeout({ timeoutGenerator: () => ms })
        .build()
        .executeOutcome(() => 7),
    ).toMatchObject({ kind: "error", error: expect.any(RangeError) });
});
it("explicitly retries per-attempt timeout beneath an overall timeout", async () => {
  vi.useFakeTimers();
  let calls = 0;
  const pending = new ResiliencePipelineBuilder<number>()
    .addTimeout(100)
    .addRetry({
      maxRetryAttempts: 2,
      delayMs: 1,
      shouldHandle: ({ outcome }) =>
        outcome.kind === "error" &&
        outcome.error instanceof TimeoutRejectedError,
    })
    .addTimeout(5)
    .build()
    .executeOutcome(async (ctx) => {
      calls++;
      if (calls === 3) return 42;
      await new Promise<void>((resolve) =>
        ctx.signal.addEventListener("abort", () => resolve(), { once: true }),
      );
      throw ctx.signal.reason;
    });
  await vi.advanceTimersByTimeAsync(20);
  expect(await pending).toEqual({ kind: "result", value: 42 });
  expect(calls).toBe(3);
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
});
it("cleans an ignored-cancellation result even when the timeout hook rejects", async () => {
  vi.useFakeTimers();
  let cleaned = 0;
  const hook = { hook: true };
  const pending = new ResiliencePipelineBuilder<number>({
    discardResult: () => {
      cleaned++;
    },
  })
    .addTimeout({
      timeoutMs: 5,
      onTimeout: () => {
        throw hook;
      },
    })
    .build()
    .executeOutcome(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return 1;
    });
  await vi.advanceTimersByTimeAsync(10);
  expect(await pending).toEqual({ kind: "error", error: hook });
  expect(cleaned).toBe(1);
  vi.useRealTimers();
});
