export type MaybePromise<T> = T | PromiseLike<T>;
export type Outcome<T> = { kind: 'result'; value: T } | { kind: 'error'; error: unknown };
export interface ResilienceContext { signal: AbortSignal; operationKey?: string; properties: Map<string, unknown>; }
export interface Runtime { nowMs(): number; random(): number; setTimer(callback:()=>void, delayMs:number):()=>void; }
export type Callback<T> = (context:ResilienceContext)=>MaybePromise<T>;
export type OutcomeCallback<T> = (context:ResilienceContext, callback:Callback<T>)=>Promise<Outcome<T>>;
export interface Strategy<T> { execute(next:OutcomeCallback<T>, context:ResilienceContext, callback:Callback<T>):Promise<Outcome<T>>; dispose?():void; }
export interface PredicateArguments<T> { outcome:Outcome<T>; context:ResilienceContext; attemptNumber:number; }
export type OutcomePredicate<T> = (args:PredicateArguments<T>)=>MaybePromise<boolean>;
export type DiscardResult<T> = (value:T, context:ResilienceContext)=>MaybePromise<void>;
export interface PipelineOptions<T> { runtime?:Runtime; discardResult?:DiscardResult<T>; }
export interface ExecuteOptions { signal?:AbortSignal; operationKey?:string; properties?:ReadonlyMap<string,unknown>; }
