import { describe, it, expect } from 'vitest';
import { ResiliencePipelineBuilder, PredicateBuilder, PipelineDisposedError } from '../src/index';
describe('pipeline core', () => {
 it('preserves undefined results and arbitrary thrown values', async () => {
  const p = new ResiliencePipelineBuilder<undefined>().build();
  expect(await p.executeOutcome(() => undefined)).toEqual({kind:'result',value:undefined});
  for(const error of [undefined,null,{code:'custom'}]) expect(await p.executeOutcome(() => {throw error})).toEqual({kind:'error',error});
 });
 it('starts no callback when caller has cancelled and retains its reason', async () => {
  let calls=0; const reason={by:'caller'};
  expect(await new ResiliencePipelineBuilder<number>().build().executeOutcome(()=>++calls,{signal:AbortSignal.abort(reason)})).toEqual({kind:'error',error:reason});
  expect(calls).toBe(0);
 });
 it('composes outer to inner and isolates properties between calls', async () => {
  const order:string[]=[];
  const b=new ResiliencePipelineBuilder<number>();
  for(const label of ['outer','inner']) b.addStrategy(()=>({async execute(next,ctx,cb){order.push(label+' before'); const result=await next(ctx,cb);order.push(label+' after');return result}}));
  const p=b.build();
  await p.execute(ctx=>{ctx.properties.set('x',1);order.push('call');return 7});
  expect(order).toEqual(['outer before','inner before','call','inner after','outer after']);
  expect(await p.execute(ctx=>ctx.properties.size)).toBe(0);
 });
 it('builds independent state and rejects new execution after disposal', async()=>{
  const b=new ResiliencePipelineBuilder<number>().addStrategy(()=>{let count=0;return {execute(next,ctx){return next(ctx,()=>++count)}}});
  const a=b.build(),c=b.build(); expect(await a.execute(()=>0)).toBe(1);expect(await a.execute(()=>0)).toBe(2);expect(await c.execute(()=>0)).toBe(1);
  a.dispose();expect((await a.executeOutcome(()=>1))).toMatchObject({kind:'error',error:expect.any(PipelineDisposedError)});
 });
 it('combines asynchronous error and result predicates with OR',async()=>{
  const ctx={signal:new AbortController().signal,properties:new Map()};
  const pred=new PredicateBuilder<number>().handleErrorType(TypeError).handleError(async e=>e==='retry').handleResult(v=>v===503).build();
  for(const outcome of [{kind:'error',error:new TypeError()},{kind:'error',error:'retry'},{kind:'result',value:503}] as const) expect(await pred({outcome,context:ctx,attemptNumber:0})).toBe(true);
  expect(await pred({outcome:{kind:'result',value:200},context:ctx,attemptNumber:0})).toBe(false);
 });
});
