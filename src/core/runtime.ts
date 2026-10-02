import type { Runtime } from "./types";
export const MAX_TIMER_MS = 2147483647;
export function duration(
  value: number,
  name: string,
  positive = false,
): number {
  if (!Number.isFinite(value) || value < 0 || (positive && value === 0))
    throw new RangeError(
      `${name} must be finite and ${positive ? "positive" : "nonnegative"}`,
    );
  return value;
}
export function count(value: number, name: string, min = 0): number {
  if (!Number.isSafeInteger(value) || value < min)
    throw new RangeError(`${name} must be a safe integer >= ${min}`);
  return value;
}
export const systemRuntime: Runtime = {
  nowMs: () => performance.now(),
  random: () => Math.random(),
  setTimer(callback, delayMs) {
    const timer = setTimeout(callback, delayMs);
    return () => clearTimeout(timer);
  },
};
/** Chunk every timer, including injected runtimes, to avoid Node's overflow-to-1ms behavior. */
export function schedule(
  runtime: Runtime,
  delayMs: number,
  callback: () => void,
): () => void {
  duration(delayMs, "delayMs");
  let remaining = delayMs,
    cancelled = false;
  let cancel = () => {};
  const arm = () => {
    const chunk = Math.min(remaining, MAX_TIMER_MS);
    cancel = runtime.setTimer(() => {
      if (cancelled) return;
      remaining -= chunk;
      if (remaining > 0) arm();
      else callback();
    }, chunk);
  };
  arm();
  return () => {
    cancelled = true;
    cancel();
  };
}
