import type {
  OutcomePredicate,
  PredicateArguments,
  MaybePromise,
} from "../core/types";
export interface RetryState {
  attemptNumber: number;
  jitterState: number;
}
export type RetryDecision =
  | {
      kind: "stop";
      reason: "unhandled" | "exhausted" | "cancelled";
      state: RetryState;
    }
  | { kind: "retry"; delayMs: number; state: RetryState };
export interface RetryOptions<T> {
  maxRetryAttempts?: number;
  delayMs?: number;
  backoffType?: "constant" | "linear" | "exponential";
  useJitter?: boolean;
  maxDelayMs?: number;
  shouldHandle?: OutcomePredicate<T>;
  delayGenerator?: (
    args: PredicateArguments<T>,
  ) => MaybePromise<number | null | undefined>;
  onRetry?: (
    args: PredicateArguments<T> & { delayMs: number },
  ) => MaybePromise<void>;
}
