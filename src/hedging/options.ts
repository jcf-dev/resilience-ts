import type { OutcomePredicate,ResilienceContext,Callback,MaybePromise } from '../core/types';
export interface HedgingActionArguments<T>{context:ResilienceContext;actionContext:ResilienceContext;callback:Callback<T>;attemptNumber:number}
export interface HedgingOptions<T> {
 maxHedgedAttempts?:number;delayMs?:number;shouldHandle?:OutcomePredicate<T>;
 delayGenerator?:(args:{context:ResilienceContext;attemptNumber:number})=>MaybePromise<number>;
 actionGenerator?:(args:HedgingActionArguments<T>)=>MaybePromise<Callback<T>|null>;
 onHedging?:(args:HedgingActionArguments<T>)=>MaybePromise<void>;
}
