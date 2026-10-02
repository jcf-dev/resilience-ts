import { count, duration, schedule, systemRuntime } from "../core/runtime";
import type { Runtime } from "../core/types";
import type { AsyncPermitLimiter, PermitLease, QueueOrder } from "./types";
import { acquiredLease, rejectedLease } from "./types";
import { PermitQueue } from "./queue";
export interface TokenBucketLimiterOptions {
  tokenLimit: number;
  tokensPerPeriod: number;
  replenishmentPeriodMs: number;
  queueLimit: number;
  queueOrder?: QueueOrder;
}
export function createTokenBucketLimiter(
  options: TokenBucketLimiterOptions,
  runtime: Runtime = systemRuntime,
): AsyncPermitLimiter {
  const limit = count(options.tokenLimit, "tokenLimit", 1),
    refill = count(options.tokensPerPeriod, "tokensPerPeriod", 1),
    period = duration(
      options.replenishmentPeriodMs,
      "replenishmentPeriodMs",
      true,
    );
  let tokens = limit,
    last = runtime.nowMs(),
    cancelTimer: (() => void) | undefined,
    disposed = false,
    draining = false;
  const refresh = () => {
    const periods = Math.floor((runtime.nowMs() - last) / period);
    if (periods > 0) {
      tokens = Math.min(limit, tokens + periods * refill);
      last += periods * period;
    }
  };
  const lease = (): PermitLease => {
    tokens--;
    return acquiredLease(() => {});
  };
  const updateTimer = () => {
    if (disposed || queue.length === 0) {
      cancelTimer?.();
      cancelTimer = undefined;
      return;
    }
    if (cancelTimer) return;
    const wait = Math.max(0, period - (runtime.nowMs() - last));
    cancelTimer = schedule(runtime, wait, () => {
      cancelTimer = undefined;
      drain();
    });
  };
  const queue = new PermitQueue(
    options.queueLimit,
    options.queueOrder,
    updateTimer,
  );
  const drain = () => {
    if (draining || disposed) return;
    draining = true;
    try {
      refresh();
      while (tokens > 0 && queue.length > 0) queue.grant(lease);
    } finally {
      draining = false;
      updateTimer();
    }
  };
  return {
    async acquire(signal) {
      queue.assertLive(signal);
      refresh();
      drain();
      if (tokens > 0 && queue.length === 0) return lease();
      return queue.enqueue(
        signal,
        rejectedLease(Math.max(0, period - (runtime.nowMs() - last))),
      );
    },
    dispose() {
      disposed = true;
      cancelTimer?.();
      cancelTimer = undefined;
      queue.dispose();
    },
  };
}
