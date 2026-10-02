import type { Strategy, OutcomeCallback, Callback, ExecuteOptions, Outcome, ResilienceContext } from './types';
import { captureOutcome, unwrapOutcome } from './outcome';
import { PipelineDisposedError } from './errors';
export class ResiliencePipeline<T> {
 private disposed=false;private readonly composed:OutcomeCallback<T>;
 constructor(private readonly strategies:readonly Strategy<T>[]) {
  this.composed=strategies.reduceRight<OutcomeCallback<T>>((next,strategy)=>(ctx,cb)=>strategy.execute(next,ctx,cb),(context,callback)=>captureOutcome(callback,context));
 }
 async executeOutcome(callback:Callback<T>,options:ExecuteOptions={}):Promise<Outcome<T>> {
  const context:ResilienceContext={signal:options.signal??new AbortController().signal,properties:new Map(options.properties)};
  if(options.operationKey!==undefined)context.operationKey=options.operationKey;
  try {if(this.disposed)throw new PipelineDisposedError();if(context.signal.aborted)throw context.signal.reason;return await this.composed(context,callback)}catch(error){return {kind:'error',error}}
 }
 async execute(callback:Callback<T>,options:ExecuteOptions={}):Promise<T>{return unwrapOutcome(await this.executeOutcome(callback,options))}
 dispose():void {if(this.disposed)return;this.disposed=true;const errors:unknown[]=[];for(const strategy of this.strategies)try{strategy.dispose?.()}catch(e){errors.push(e)}if(errors.length)throw new AggregateError(errors,'Pipeline disposal failed')}
}
