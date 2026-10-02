import {it,expect} from 'vitest';
import {ResiliencePipelineBuilder,createConcurrencyLimiter,RateLimiterRejectedError} from '../src/index';
it('releases permits after callback failure, without invoking rejected callbacks',async()=>{
 const limiter=createConcurrencyLimiter({permitLimit:1,queueLimit:0});const p=new ResiliencePipelineBuilder<number>().addRateLimiter({limiter}).build();expect((await p.executeOutcome(()=>{throw Error('fail')})).kind).toBe('error');expect(await p.execute(()=>7)).toBe(7);
 const held=await limiter.acquire(new AbortController().signal);let called=false;expect(await p.executeOutcome(()=>{called=true;return 1})).toMatchObject({kind:'error',error:expect.any(RateLimiterRejectedError)});expect(called).toBe(false);held.release();
});
it('releases a custom rejected lease after hook rejection and retains metadata',async()=>{
 let released=0,metadata:number|undefined;const hook={bad:true};const p=new ResiliencePipelineBuilder<number>().addRateLimiter({limiter:{acquire:async()=>({acquired:false,retryAfterMs:123,release:()=>{released++}})},onRejected:args=>{metadata=args.retryAfterMs;throw hook}}).build();expect(await p.executeOutcome(()=>7)).toEqual({kind:'error',error:hook});expect(released).toBe(1);expect(metadata).toBe(123);
});
it('disposes only owned adapters and no callback starts after an asynchronous canceled acquisition',async()=>{
 let disposed=0,released=0,called=false;const ctl=new AbortController();const limiter={dispose:()=>{disposed++},acquire:async()=>{ctl.abort('stop');return {acquired:true,release:()=>{released++}}}};
 const p=new ResiliencePipelineBuilder<number>().addRateLimiter({limiter}).build();expect(await p.executeOutcome(()=>{called=true;return 1},{signal:ctl.signal})).toEqual({kind:'error',error:'stop'});expect(called).toBe(false);expect(released).toBe(1);p.dispose();expect(disposed).toBe(0);new ResiliencePipelineBuilder().addRateLimiter({limiter,ownsLimiter:true}).build().dispose();expect(disposed).toBe(1);
});
