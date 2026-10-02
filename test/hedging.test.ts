import { it, expect, vi } from "vitest";
import { ResiliencePipelineBuilder } from "../src/index";
it("returns the primary failure when all branches are handled", async () => {
  const error = { primary: true };
  let primary = 0,
    hedges = 0;
  const p = new ResiliencePipelineBuilder<number>()
    .addHedging({
      maxHedgedAttempts: 2,
      delayMs: 0,
      actionGenerator:
        ({ attemptNumber }) =>
        () => {
          hedges++;
          throw { hedge: attemptNumber };
        },
    })
    .build();
  expect(
    await p.executeOutcome(() => {
      primary++;
      throw error;
    }),
  ).toEqual({ kind: "error", error });
  expect(primary).toBe(1);
  expect(hedges).toBe(2);
});
it("spawns after latency and awaits losing cleanup before returning the winner", async () => {
  vi.useFakeTimers();
  let cleaned = false,
    done = false;
  const discarded: number[] = [];
  const p = new ResiliencePipelineBuilder<number>({
    discardResult: (value) => {
      discarded.push(value);
    },
  })
    .addHedging({ delayMs: 10, actionGenerator: () => () => 42 })
    .build();
  const pending = p
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
      return 99;
    })
    .then((o) => {
      done = true;
      return o;
    });
  await vi.advanceTimersByTimeAsync(9);
  expect(done).toBe(false);
  expect(cleaned).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(done).toBe(false);
  await vi.advanceTimersByTimeAsync(5);
  expect(await pending).toEqual({ kind: "result", value: 42 });
  expect(cleaned).toBe(true);
  expect(discarded).toEqual([99]);
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
});
it("negative delay runs sequentially and handled fast failure bypasses positive delay", async () => {
  for (const delay of [-1, 100000]) {
    let active = 0,
      peak = 0,
      calls = 0;
    const p = new ResiliencePipelineBuilder<number>()
      .addHedging({ maxHedgedAttempts: 2, delayMs: delay })
      .build();
    const outcome = await p.executeOutcome(async () => {
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active--;
      if (++calls < 3) throw "down";
      return 3;
    });
    expect(outcome).toEqual({ kind: "result", value: 3 });
    expect(calls).toBe(3);
    expect(peak).toBe(1);
  }
});
it("a null action generator stops spawning and retains the primary outcome", async () => {
  let calls = 0;
  const error = { first: true };
  const p = new ResiliencePipelineBuilder<number>()
    .addHedging({
      delayMs: 0,
      maxHedgedAttempts: 5,
      actionGenerator: () => null,
    })
    .build();
  expect(
    await p.executeOutcome(() => {
      calls++;
      throw error;
    }),
  ).toEqual({ kind: "error", error });
  expect(calls).toBe(1);
});
it("gives branches independent property maps and cleans discarded handled results once", async () => {
  const discarded: number[] = [];
  const p = new ResiliencePipelineBuilder<number>({
    discardResult: (value) => {
      discarded.push(value);
    },
  })
    .addHedging({
      delayMs: 0,
      shouldHandle: ({ outcome }) =>
        outcome.kind === "result" && outcome.value === 503,
      actionGenerator: ({ actionContext }) => {
        expect(actionContext.properties.has("primary-only")).toBe(false);
        return () => 200;
      },
    })
    .build();
  expect(
    await p.execute((ctx) => {
      ctx.properties.set("primary-only", true);
      return 503;
    }),
  ).toBe(200);
  expect(discarded).toEqual([503]);
});
it("caller abort wins while predicates are pending and leaves no timer", async () => {
  vi.useFakeTimers();
  const ctl = new AbortController(),
    reason = { stop: true };
  let calls = 0;
  const pending = new ResiliencePipelineBuilder<number>()
    .addHedging({
      delayMs: 100,
      shouldHandle: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return false;
      },
    })
    .build()
    .executeOutcome(() => ++calls, { signal: ctl.signal });
  await vi.advanceTimersByTimeAsync(1);
  ctl.abort(reason);
  await vi.advanceTimersByTimeAsync(5);
  expect(await pending).toEqual({ kind: "error", error: reason });
  expect(calls).toBe(1);
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
});
it("hook, generator and predicate errors await branches and propagate exactly", async () => {
  for (const point of ["hook", "generator", "predicate"] as const) {
    const error = { point };
    let cleaned = false;
    const options =
      point === "hook"
        ? {
            onHedging: () => {
              throw error;
            },
          }
        : point === "generator"
          ? {
              actionGenerator: () => {
                throw error;
              },
            }
          : {
              shouldHandle: () => {
                throw error;
              },
            };
    const p = new ResiliencePipelineBuilder<number>()
      .addHedging({ delayMs: 0, ...options })
      .build();
    expect(
      await p.executeOutcome(async (ctx) => {
        if (point !== "predicate")
          await new Promise<void>((resolve) =>
            ctx.signal.addEventListener("abort", () => resolve(), {
              once: true,
            }),
          );
        cleaned = true;
        return 1;
      }),
    ).toEqual({ kind: "error", error });
    expect(cleaned).toBe(true);
  }
});
it("observes losing rejections and propagates discarded-result cleanup errors", async () => {
  const unhandled: unknown[] = [];
  const trap = (reason: unknown) => {
    unhandled.push(reason);
  };
  process.on("unhandledRejection", trap);
  try {
    vi.useFakeTimers();
    const p = new ResiliencePipelineBuilder<number>()
      .addHedging({ delayMs: 1, actionGenerator: () => () => 7 })
      .build();
    const pending = p.executeOutcome(async (ctx) => {
      await new Promise<void>((resolve) =>
        ctx.signal.addEventListener("abort", () => resolve(), { once: true }),
      );
      throw "loser";
    });
    await vi.advanceTimersByTimeAsync(2);
    expect(await pending).toEqual({ kind: "result", value: 7 });
    await Promise.resolve();
    expect(unhandled).toEqual([]);
    vi.useRealTimers();
  } finally {
    process.off("unhandledRejection", trap);
  }
  const error = { cleanup: true };
  const released: number[] = [];
  const p = new ResiliencePipelineBuilder<number>({
    discardResult: (value) => {
      released.push(value);
      if (value === 503) throw error;
    },
  })
    .addHedging({
      delayMs: 0,
      shouldHandle: ({ outcome }) =>
        outcome.kind === "result" && outcome.value === 503,
      actionGenerator: () => () => 200,
    })
    .build();
  expect(await p.executeOutcome(() => 503)).toEqual({ kind: "error", error });
  expect(released).toEqual([503, 200]);
});
it("preserves the primary result and its signal when every outcome is handled", async () => {
  const signals: AbortSignal[] = [];
  const discarded: number[] = [];
  let calls = 0;
  const p = new ResiliencePipelineBuilder<number>({
    discardResult: (value) => {
      discarded.push(value);
    },
  })
    .addHedging({ delayMs: 0, maxHedgedAttempts: 2, shouldHandle: () => true })
    .build();
  expect(
    await p.execute((ctx) => {
      signals.push(ctx.signal);
      return ++calls;
    }),
  ).toBe(1);
  expect(discarded).toEqual([2, 3]);
  expect(signals[0]?.aborted).toBe(false);
});
