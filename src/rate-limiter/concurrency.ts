import { count } from "../core/runtime";
import type { AsyncPermitLimiter, PermitLease, QueueOrder } from "./types";
import { acquiredLease, rejectedLease } from "./types";
import { PermitQueue } from "./queue";
export interface ConcurrencyLimiterOptions {
  permitLimit: number;
  queueLimit: number;
  queueOrder?: QueueOrder;
}
export function createConcurrencyLimiter(
  options: ConcurrencyLimiterOptions,
): AsyncPermitLimiter {
  const limit = count(options.permitLimit, "permitLimit", 1);
  const queue = new PermitQueue(options.queueLimit, options.queueOrder);
  let active = 0;
  const lease = (): PermitLease => {
    active++;
    return acquiredLease(() => {
      active--;
      if (queue.length > 0) queue.grant(lease);
    });
  };
  return {
    async acquire(signal) {
      queue.assertLive(signal);
      if (active < limit && queue.length === 0) return lease();
      return queue.enqueue(signal, rejectedLease());
    },
    dispose() {
      queue.dispose();
    },
  };
}
