import { it, expect } from "vitest";
import {
  ResiliencePipelineBuilder,
  CircuitBreakerStateProvider,
  CircuitBreakerManualControl,
  BrokenCircuitError,
  IsolatedCircuitError,
  systemRuntime,
} from "../src/index";
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
it("opens at throughput and admits only one half-open recovery probe", async () => {
  let now = 0,
    calls = 0;
  const state = new CircuitBreakerStateProvider();
  const p = new ResiliencePipelineBuilder<number>({
    runtime: { ...systemRuntime, nowMs: () => now },
  })
    .addCircuitBreaker({
      minimumThroughput: 2,
      failureRatio: 0.5,
      breakDurationMs: 100,
      stateProvider: state,
    })
    .build();
  await p.executeOutcome(() => {
    calls++;
    throw Error("down");
  });
  await p.executeOutcome(() => {
    calls++;
    throw Error("down");
  });
  expect(state.state).toBe("open");
  expect(await p.executeOutcome(() => ++calls)).toMatchObject({
    kind: "error",
    error: expect.any(BrokenCircuitError),
  });
  expect(calls).toBe(2);
  now = 100;
  const probe = deferred<number>();
  const pending = p.execute(() => probe.promise);
  expect(state.state).toBe("half-open");
  expect(await p.executeOutcome(() => 99)).toMatchObject({
    kind: "error",
    error: expect.any(BrokenCircuitError),
  });
  probe.resolve(7);
  expect(await pending).toBe(7);
  expect(state.state).toBe("closed");
  expect(await p.execute(() => 8)).toBe(8);
});
it("expires samples at the window boundary", async () => {
  let now = 0;
  const state = new CircuitBreakerStateProvider();
  const p = new ResiliencePipelineBuilder<number>({
    runtime: { ...systemRuntime, nowMs: () => now },
  })
    .addCircuitBreaker({
      minimumThroughput: 2,
      failureRatio: 1,
      samplingDurationMs: 10,
      stateProvider: state,
    })
    .build();
  await p.executeOutcome(() => {
    throw 1;
  });
  now = 10;
  await p.executeOutcome(() => {
    throw 2;
  });
  expect(state.state).toBe("closed");
  await p.executeOutcome(() => {
    throw 3;
  });
  expect(state.state).toBe("open");
});
it("manual isolation fences late successful and failed completions", async () => {
  const state = new CircuitBreakerStateProvider(),
    control = new CircuitBreakerManualControl();
  const p = new ResiliencePipelineBuilder<number>()
    .addCircuitBreaker({
      stateProvider: state,
      manualControl: control,
      minimumThroughput: 2,
    })
    .build();
  const job = deferred<number>();
  const pending = p.execute(() => job.promise);
  await control.isolate();
  job.resolve(1);
  expect(await pending).toBe(1);
  expect(state.state).toBe("isolated");
  expect(await p.executeOutcome(() => 2)).toMatchObject({
    kind: "error",
    error: expect.any(IsolatedCircuitError),
  });
  await control.close();
  expect(await p.execute(() => 3)).toBe(3);
});
it("caller cancellation does not count as a failure", async () => {
  const state = new CircuitBreakerStateProvider();
  const p = new ResiliencePipelineBuilder<number>()
    .addCircuitBreaker({ stateProvider: state, minimumThroughput: 2 })
    .build();
  for (let i = 0; i < 3; i++) {
    const ctl = new AbortController();
    await p.executeOutcome(
      () => {
        ctl.abort("stop");
        throw "stop";
      },
      { signal: ctl.signal },
    );
  }
  expect(state.state).toBe("closed");
});
it("generated break duration and hook failure leave consistent state", async () => {
  let now = 0;
  const state = new CircuitBreakerStateProvider();
  const hook = { hook: true };
  const p = new ResiliencePipelineBuilder<number>({
    runtime: { ...systemRuntime, nowMs: () => now },
  })
    .addCircuitBreaker({
      minimumThroughput: 2,
      breakDurationGenerator: () => 25,
      stateProvider: state,
      onOpened: () => {
        throw hook;
      },
    })
    .build();
  await p.executeOutcome(() => {
    throw 1;
  });
  expect(
    await p.executeOutcome(() => {
      throw 2;
    }),
  ).toEqual({ kind: "error", error: hook });
  now = 24;
  expect(await p.executeOutcome(() => 3)).toMatchObject({
    kind: "error",
    error: expect.any(BrokenCircuitError),
  });
  now = 25;
  expect(await p.execute(() => 4)).toBe(4);
});
it("builder reuse gives each circuit its own samples", async () => {
  const builder = new ResiliencePipelineBuilder<number>().addCircuitBreaker({
    minimumThroughput: 2,
  });
  const a = builder.build(),
    b = builder.build();
  await a.executeOutcome(() => {
    throw 1;
  });
  await a.executeOutcome(() => {
    throw 2;
  });
  expect(await b.execute(() => 7)).toBe(7);
});
