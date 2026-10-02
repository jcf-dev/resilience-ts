import {it,expect,vi} from 'vitest';
import {createTokenBucketLimiter,systemRuntime} from '../src/index';
const signal=()=>new AbortController().signal;
it('refills at exact boundaries, caps bursts, and owns no idle interval',async()=>{
 vi.useFakeTimers();let now=0;const limiter=createTokenBucketLimiter({tokenLimit:2,tokensPerPeriod:1,replenishmentPeriodMs:10,queueLimit:1},{...systemRuntime,nowMs:()=>now});
 expect((await limiter.acquire(signal())).acquired).toBe(true);expect((await limiter.acquire(signal())).acquired).toBe(true);expect(vi.getTimerCount()).toBe(0);
 const queued=limiter.acquire(signal());let done=false;const observed=queued.then(l=>{done=true;return l});now=9;await vi.advanceTimersByTimeAsync(9);expect(done).toBe(false);now=10;await vi.advanceTimersByTimeAsync(1);expect((await observed).acquired).toBe(true);expect(vi.getTimerCount()).toBe(0);
 now=1000;expect((await limiter.acquire(signal())).acquired).toBe(true);expect((await limiter.acquire(signal())).acquired).toBe(true);
 const ctl=new AbortController();const q=limiter.acquire(ctl.signal).catch(e=>e);ctl.abort('stop');expect(await q).toBe('stop');expect(vi.getTimerCount()).toBe(0);limiter.dispose?.();vi.useRealTimers();
});
it('reports retry-after and cancels queued timers on disposal',async()=>{
 vi.useFakeTimers();const limiter=createTokenBucketLimiter({tokenLimit:1,tokensPerPeriod:1,replenishmentPeriodMs:10,queueLimit:0});await limiter.acquire(signal());const rejected=await limiter.acquire(signal());expect(rejected.acquired).toBe(false);expect(rejected.retryAfterMs).toBeGreaterThan(0);expect(rejected.retryAfterMs).toBeLessThanOrEqual(10);limiter.dispose?.();expect(vi.getTimerCount()).toBe(0);vi.useRealTimers();
});
it('validates numeric token options',()=>{
 for(const value of [0,-1,1.5,Infinity])expect(()=>createTokenBucketLimiter({tokenLimit:value,tokensPerPeriod:1,replenishmentPeriodMs:10,queueLimit:0})).toThrow(RangeError);
 expect(()=>createTokenBucketLimiter({tokenLimit:1,tokensPerPeriod:0,replenishmentPeriodMs:10,queueLimit:0})).toThrow(RangeError);
});
