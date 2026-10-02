import { it, expect, vi } from 'vitest';
import { sleep, systemRuntime } from '../src/index';
it('chunks long waits and cancellation prevents their completion',async()=>{
 vi.useFakeTimers();const ctl=new AbortController();const reason={stop:true};let settled=false;
 const pending=sleep(systemRuntime,2147483647+5000,ctl.signal).then(()=>{settled=true},error=>error);
 await vi.advanceTimersByTimeAsync(2147483647);expect(settled).toBe(false);expect(vi.getTimerCount()).toBe(1);
 ctl.abort(reason);expect(await pending).toBe(reason);expect(vi.getTimerCount()).toBe(0);vi.useRealTimers();
});
it('validates finite nonnegative waits',async()=>{
 for(const ms of [-1,NaN,Infinity]) await expect(sleep(systemRuntime,ms,new AbortController().signal)).rejects.toThrow(RangeError);
});
