import {it,expect} from 'vitest';
import {createConcurrencyLimiter} from '../src/index';
const signal=()=>new AbortController().signal;
it('releases idempotently and enforces immediate rejection',async()=>{
 const limiter=createConcurrencyLimiter({permitLimit:1,queueLimit:0});const a=await limiter.acquire(signal());expect(a.acquired).toBe(true);expect((await limiter.acquire(signal())).acquired).toBe(false);a.release();a.release();const b=await limiter.acquire(signal());expect(b.acquired).toBe(true);expect((await limiter.acquire(signal())).acquired).toBe(false);b.release();
});
it('drains FIFO and LIFO queues in configured order',async()=>{
 for(const order of ['oldest-first','newest-first'] as const){const limiter=createConcurrencyLimiter({permitLimit:1,queueLimit:2,queueOrder:order});const initial=await limiter.acquire(signal());const seen:string[]=[];const a=limiter.acquire(signal()).then(lease=>{seen.push('a');lease.release()});const b=limiter.acquire(signal()).then(lease=>{seen.push('b');lease.release()});initial.release();await Promise.all([a,b]);expect(seen).toEqual(order==='oldest-first'?['a','b']:['b','a'])}
});
it('newest-first overflow rejects the oldest waiter and admits the new one',async()=>{
 const limiter=createConcurrencyLimiter({permitLimit:1,queueLimit:1,queueOrder:'newest-first'});const a=await limiter.acquire(signal());const old=limiter.acquire(signal());const recent=limiter.acquire(signal());expect((await old).acquired).toBe(false);a.release();const lease=await recent;expect(lease.acquired).toBe(true);lease.release();
});
it('queued abort preserves caller reason and disposal rejects pending work',async()=>{
 const limiter=createConcurrencyLimiter({permitLimit:1,queueLimit:2});const held=await limiter.acquire(signal());const ctl=new AbortController(),reason={stop:true};const canceled=limiter.acquire(ctl.signal);const handled=canceled.catch(e=>e);ctl.abort(reason);expect(await handled).toBe(reason);
 const waiting=limiter.acquire(signal());const rejected=waiting.catch(e=>e);limiter.dispose?.();expect(await rejected).toBeInstanceOf(Error);held.release();await expect(limiter.acquire(signal())).rejects.toThrow();
});
it('rejects invalid capacities and queue order',()=>{
 for(const permitLimit of [0,-1,1.5,Infinity])expect(()=>createConcurrencyLimiter({permitLimit,queueLimit:0})).toThrow(RangeError);
 expect(()=>createConcurrencyLimiter({permitLimit:1,queueLimit:-1})).toThrow(RangeError);
 expect(()=>createConcurrencyLimiter({permitLimit:1,queueLimit:1,queueOrder:'bad' as never})).toThrow(RangeError);
});
