import type { MaybePromise, ResilienceContext } from "../core/types";
export interface TimeoutOptions {
  timeoutMs?: number;
  timeoutGenerator?: (context: ResilienceContext) => MaybePromise<number>;
  onTimeout?: (args: {
    context: ResilienceContext;
    timeoutMs: number;
  }) => MaybePromise<void>;
}
