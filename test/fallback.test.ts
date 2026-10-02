import {it,expect} from 'vitest';
import {ResiliencePipelineBuilder} from '../src/index';
it('replaces once after inner Retry is exhausted and preserves context',async()=>{
 let calls=0,fallbacks=0;const p=new ResiliencePipelineBuilder<string>().addFallback({fallbackAction:args=>{fallbacks++;expect(args.context.operationKey).toBe('lookup');return 'cached'}}).addRetry({maxRetryAttempts:2,delayMs:0}).build();expect(await p.execute(()=>{calls++;throw 'down'},{operationKey:'lookup'})).toBe('cached');expect(calls).toBe(3);expect(fallbacks).toBe(1);
});
it('replaces a handled result and cleans it even if the hook rejects',async()=>{
 let cleaned=0;const hook={hook:true};const p=new ResiliencePipelineBuilder<number>({discardResult:()=>{cleaned++}}).addFallback({shouldHandle:({outcome})=>outcome.kind==='result'&&outcome.value===503,onFallback:async()=>{throw hook},fallbackAction:()=>200}).build();expect(await p.executeOutcome(()=>503)).toEqual({kind:'error',error:hook});expect(cleaned).toBe(1);
});
it('does not recursively handle fallback action errors or unhandled outcomes',async()=>{
 let fallback=0;const error={failed:true};const p=new ResiliencePipelineBuilder<number>().addFallback({fallbackAction:async()=>{fallback++;throw error}}).build();expect(await p.execute(()=>200)).toBe(200);expect(await p.executeOutcome(()=>{throw 'down'})).toEqual({kind:'error',error});expect(fallback).toBe(1);
});
it('caller cancellation excludes fallback even with custom predicates',async()=>{
 const ctl=new AbortController();let calls=0;const p=new ResiliencePipelineBuilder<number>().addFallback({shouldHandle:()=>true,fallbackAction:()=>++calls}).build();await p.executeOutcome(()=>{ctl.abort('stop');throw 'stop'},{signal:ctl.signal});expect(calls).toBe(0);
});
