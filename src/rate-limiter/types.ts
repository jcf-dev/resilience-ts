import type { ResilienceContext,MaybePromise } from '../core/types';
export interface PermitLease {acquired:boolean;retryAfterMs?:number;release():void}
export interface AsyncPermitLimiter {acquire(signal:AbortSignal):Promise<PermitLease>;dispose?():void}
export type QueueOrder='oldest-first'|'newest-first';
export interface RateLimiterOptions {limiter?:AsyncPermitLimiter;ownsLimiter?:boolean;onRejected?:(args:{context:ResilienceContext;retryAfterMs?:number})=>MaybePromise<void>}
export class LimiterDisposedError extends Error {constructor(){super('Limiter has been disposed');this.name='LimiterDisposedError'}}
export function rejectedLease(retryAfterMs?:number):PermitLease {return retryAfterMs===undefined?{acquired:false,release(){}}:{acquired:false,retryAfterMs,release(){}}}
export function acquiredLease(release:()=>void):PermitLease {let released=false;return {acquired:true,release(){if(released)return;released=true;release()}}}
