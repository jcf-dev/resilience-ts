import { count } from '../core/runtime';
import { LimiterDisposedError } from './types';
import type { PermitLease,QueueOrder } from './types';
interface Waiter {signal:AbortSignal;resolve:(lease:PermitLease)=>void;reject:(reason:unknown)=>void;abort:()=>void;rejected:PermitLease}
/** Shared queue cancellation and overflow rules for the two permit adapters. */
export class PermitQueue {
 private readonly waiters:Waiter[]=[];private disposed=false;
 constructor(private readonly limit:number,private readonly order:QueueOrder='oldest-first',private readonly changed:()=>void=()=>{}){count(limit,'queueLimit');if(!['oldest-first','newest-first'].includes(order))throw new RangeError('Unsupported queueOrder')}
 get length():number{return this.waiters.length}
 assertLive(signal:AbortSignal):void {if(signal.aborted)throw signal.reason;if(this.disposed)throw new LimiterDisposedError()}
 enqueue(signal:AbortSignal,rejected:PermitLease):Promise<PermitLease>{
  this.assertLive(signal);
  if(this.limit===0)return Promise.resolve(rejected);
  if(this.waiters.length>=this.limit){if(this.order==='oldest-first')return Promise.resolve(rejected);const oldest=this.waiters.shift()!;this.finish(oldest,oldest.rejected)}
  return new Promise<PermitLease>((resolve,reject)=>{
   const waiter:Waiter={signal,resolve,reject,rejected,abort:()=>{const index=this.waiters.indexOf(waiter);if(index<0)return;this.waiters.splice(index,1);signal.removeEventListener('abort',waiter.abort);reject(signal.reason);this.changed()}};
   this.waiters.push(waiter);signal.addEventListener('abort',waiter.abort,{once:true});this.changed();
   if(signal.aborted)waiter.abort();
  });
 }
 private finish(waiter:Waiter,lease:PermitLease):void {waiter.signal.removeEventListener('abort',waiter.abort);waiter.resolve(lease)}
 grant(makeLease:()=>PermitLease):boolean {
  const waiter=this.order==='oldest-first'?this.waiters.shift():this.waiters.pop();if(!waiter)return false;
  this.finish(waiter,makeLease());this.changed();return true;
 }
 dispose():void {if(this.disposed)return;this.disposed=true;for(const waiter of this.waiters.splice(0)){waiter.signal.removeEventListener('abort',waiter.abort);waiter.reject(new LimiterDisposedError())}this.changed()}
}
