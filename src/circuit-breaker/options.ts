import type {
  OutcomePredicate,
  ResilienceContext,
  Outcome,
  MaybePromise,
} from "../core/types";
import type { CircuitBreakerStateProvider } from "./state";
import type { CircuitBreakerManualControl } from "./control";
export interface CircuitTransitionArguments<T> {
  context: ResilienceContext;
  outcome: Outcome<T> | undefined;
  manual: boolean;
}
export interface CircuitBreakerOptions<T> {
  failureRatio?: number;
  minimumThroughput?: number;
  samplingDurationMs?: number;
  breakDurationMs?: number;
  shouldHandle?: OutcomePredicate<T>;
  breakDurationGenerator?: (args: {
    context: ResilienceContext;
    outcome: Outcome<T>;
    failureCount: number;
  }) => MaybePromise<number>;
  stateProvider?: CircuitBreakerStateProvider;
  manualControl?: CircuitBreakerManualControl;
  onOpened?: (args: CircuitTransitionArguments<T>) => MaybePromise<void>;
  onClosed?: (args: CircuitTransitionArguments<T>) => MaybePromise<void>;
  onHalfOpened?: (args: CircuitTransitionArguments<T>) => MaybePromise<void>;
}
