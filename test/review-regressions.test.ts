import { describe, it, expect, vi } from "vitest";
import {
  ResiliencePipelineBuilder,
  CircuitBreakerManualControl,
  PipelineDisposedError,
} from "../src/index";
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
describe("post-callback result ownership", () => {
  for (const target of [
    "retry predicate",
    "retry generator",
    "fallback predicate",
    "breaker predicate",
  ] as const) {
    it(`cleans exactly once when ${target} rejects`, async () => {
      const error = { target };
      const released: number[] = [];
      const builder = new ResiliencePipelineBuilder<number>({
        discardResult: (value) => {
          released.push(value);
        },
      });
      if (target === "retry predicate")
        builder.addRetry({
          shouldHandle: () => {
            throw error;
          },
        });
      if (target === "retry generator")
        builder.addRetry({
          shouldHandle: () => true,
          delayGenerator: () => {
            throw error;
          },
        });
      if (target === "fallback predicate")
        builder.addFallback({
          shouldHandle: () => {
            throw error;
          },
          fallbackAction: () => 200,
        });
      if (target === "breaker predicate")
        builder.addCircuitBreaker({
          shouldHandle: () => {
            throw error;
          },
        });
      expect(await builder.build().executeOutcome(() => 701)).toEqual({
        kind: "error",
        error,
      });
      expect(released).toEqual([701]);
    });
  }
  for (const target of ["generator", "opened hook"] as const)
    it(`cleans a result lost to breaker ${target}`, async () => {
      const error = { target };
      const released: number[] = [];
      const hook = () => {
        throw error;
      };
      const p = new ResiliencePipelineBuilder<number>({
        discardResult: (v) => {
          released.push(v);
        },
      })
        .addCircuitBreaker({
          minimumThroughput: 2,
          shouldHandle: () => true,
          ...(target === "generator"
            ? { breakDurationGenerator: hook }
            : { onOpened: hook }),
        })
        .build();
      expect(await p.execute(() => 701)).toBe(701);
      expect(await p.executeOutcome(() => 702)).toEqual({
        kind: "error",
        error,
      });
      expect(released).toEqual([702]);
    });
  it("cleans a successful half-open result lost to onClosed", async () => {
    const error = { hook: true };
    const released: number[] = [];
    const control = new CircuitBreakerManualControl();
    const p = new ResiliencePipelineBuilder<number>({
      runtime: {
        nowMs: () => 100,
        random: () => 0.5,
        setTimer: () => () => {},
      },
      discardResult: (v) => {
        released.push(v);
      },
    })
      .addCircuitBreaker({
        manualControl: control,
        minimumThroughput: 2,
        breakDurationMs: 1,
        breakDurationGenerator: () => 0,
        onClosed: () => {
          throw error;
        },
      })
      .build();
    await p.executeOutcome(() => {
      throw "down";
    });
    await p.executeOutcome(() => {
      throw "down";
    });
    expect(await p.executeOutcome(() => 701)).toEqual({ kind: "error", error });
    expect(released).toEqual([701]);
  });
  it("preserves predicate and cleanup failures together without retrying them", async () => {
    const hook = { hook: true },
      cleanup = { cleanup: true };
    let calls = 0;
    const p = new ResiliencePipelineBuilder<number>({
      discardResult: () => {
        throw cleanup;
      },
    })
      .addRetry({
        shouldHandle: () => {
          throw hook;
        },
      })
      .build();
    const outcome = await p.executeOutcome(() => {
      calls++;
      return 701;
    });
    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error")
      expect((outcome.error as AggregateError).errors).toEqual([hook, cleanup]);
    expect(calls).toBe(1);
  });
});
describe("cancellation during evaluation", () => {
  for (const strategy of ["retry", "fallback", "breaker"] as const)
    for (const result of [false, true])
      it(`${strategy} retains caller reason after ${result ? "success" : "failure"} while predicate awaits`, async () => {
        const ctl = new AbortController(),
          reason = { caller: true };
        const entered = deferred<void>(),
          gate = deferred<boolean>();
        const released: number[] = [];
        const predicate = () => {
          entered.resolve();
          return gate.promise;
        };
        const b = new ResiliencePipelineBuilder<number>({
          discardResult: (v) => {
            released.push(v);
          },
        });
        if (strategy === "retry") b.addRetry({ shouldHandle: predicate });
        if (strategy === "fallback")
          b.addFallback({ shouldHandle: predicate, fallbackAction: () => 200 });
        if (strategy === "breaker")
          b.addCircuitBreaker({ shouldHandle: predicate });
        const pending = b.build().executeOutcome(
          () => {
            if (!result) throw "original failure";
            return 701;
          },
          { signal: ctl.signal },
        );
        await entered.promise;
        ctl.abort(reason);
        gate.resolve(false);
        expect(await pending).toEqual({ kind: "error", error: reason });
        expect(released).toEqual(result ? [701] : []);
      });
});
describe("disposal of strategy-owned timers", () => {
  for (const strategy of ["retry", "timeout", "hedging"] as const)
    it(`${strategy} cancels its owned wait and starts no subsequent callback`, async () => {
      vi.useFakeTimers();
      try {
        let calls = 0,
          done = false;
        const result = deferred<number>();
        const b = new ResiliencePipelineBuilder<number>();
        if (strategy === "retry") b.addRetry({ delayMs: 100 });
        if (strategy === "timeout") b.addTimeout(100);
        if (strategy === "hedging") b.addHedging({ delayMs: 100 });
        const p = b.build();
        const pending = p
          .executeOutcome(() => {
            calls++;
            if (strategy === "retry") throw "down";
            return result.promise;
          })
          .then((o) => {
            done = true;
            return o;
          });
        await vi.advanceTimersByTimeAsync(1);
        expect(vi.getTimerCount()).toBe(1);
        p.dispose();
        expect(vi.getTimerCount()).toBe(0);
        if (strategy !== "retry") {
          await Promise.resolve();
          expect(done).toBe(false);
          result.resolve(701);
        }
        await vi.advanceTimersByTimeAsync(200);
        expect(await pending).toMatchObject({
          kind: "error",
          error: expect.any(PipelineDisposedError),
        });
        expect(calls).toBe(1);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });
});
