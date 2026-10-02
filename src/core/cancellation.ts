import { PipelineDisposedError } from "./errors";
import type { Runtime } from "./types";
import { duration, schedule } from "./runtime";
export async function sleep(
  runtime: Runtime,
  delayMs: number,
  signal: AbortSignal,
): Promise<void> {
  duration(delayMs, "delayMs");
  if (signal.aborted) throw signal.reason;
  await new Promise<void>((resolve, reject) => {
    let cancel = () => {};
    const clear = () => {
      cancel();
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      clear();
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    cancel = schedule(runtime, delayMs, () => {
      clear();
      resolve();
    });
    if (signal.aborted) abort();
  });
}

/** @internal Owns linked signals for strategy waits; disposal cancels work, never detaches it. */
export class StrategyLifetime {
  private disposed = false;
  private readonly executions = new Set<AbortController>();
  begin(parent: AbortSignal): { signal: AbortSignal; close: () => void } {
    if (this.disposed) throw new PipelineDisposedError();
    if (parent.aborted) throw parent.reason;
    const controller = new AbortController();
    const abort = () => controller.abort(parent.reason);
    const unlink = () => parent.removeEventListener("abort", abort);
    parent.addEventListener("abort", abort, { once: true });
    controller.signal.addEventListener("abort", unlink, { once: true });
    this.executions.add(controller);
    return {
      signal: controller.signal,
      close: () => {
        unlink();
        controller.signal.removeEventListener("abort", unlink);
        this.executions.delete(controller);
      },
    };
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const controller of this.executions)
      controller.abort(new PipelineDisposedError());
  }
}
