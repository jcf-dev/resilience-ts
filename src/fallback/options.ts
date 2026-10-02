import type {
  OutcomePredicate,
  PredicateArguments,
  MaybePromise,
} from "../core/types";
export interface FallbackOptions<T> {
  fallbackAction: (args: PredicateArguments<T>) => MaybePromise<T>;
  shouldHandle?: OutcomePredicate<T>;
  onFallback?: (args: PredicateArguments<T>) => MaybePromise<void>;
}
