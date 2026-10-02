import type { Outcome, ResilienceContext, Runtime } from '../core/types';
import { defaultShouldHandle } from '../core/outcome';
import { count, duration, systemRuntime } from '../core/runtime';
import type { RetryOptions, RetryState, RetryDecision } from './options';
import { calculateBackoff } from './backoff';
export class RetryPolicy<T> {
 readonly options:RetryOptions<T>;
 private readonly maximum:number;private readonly baseDelay:number;
 constructor(options:RetryOptions<T>={},private readonly runtime:Runtime=systemRuntime){
  this.options={...options};this.maximum=count(options.maxRetryAttempts??3,'maxRetryAttempts');this.baseDelay=duration(options.delayMs??2000,'delayMs');
  if(options.maxDelayMs!==undefined)duration(options.maxDelayMs,'maxDelayMs');
  if(options.backoffType!==undefined&&!['constant','linear','exponential'].includes(options.backoffType))throw new RangeError('Unsupported backoffType');
 }
 async evaluate(outcome:Outcome<T>,state:RetryState,context:ResilienceContext):Promise<RetryDecision>{
  count(state.attemptNumber,'attemptNumber');duration(state.jitterState,'jitterState');const unchanged={...state};
  if(context.signal.aborted)return {kind:'stop',reason:'cancelled',state:unchanged};
  const args={outcome,context,attemptNumber:state.attemptNumber};
  const handled=await (this.options.shouldHandle??defaultShouldHandle)(args);
  if(context.signal.aborted)return {kind:'stop',reason:'cancelled',state:unchanged};
  if(!handled)return {kind:'stop',reason:'unhandled',state:unchanged};
  if(state.attemptNumber>=this.maximum)return {kind:'stop',reason:'exhausted',state:unchanged};
  const input={attemptNumber:state.attemptNumber,jitterState:state.jitterState,delayMs:this.baseDelay,backoffType:this.options.backoffType??'constant',useJitter:this.options.useJitter??false};
  const calculated=calculateBackoff(this.options.maxDelayMs===undefined?input:{...input,maxDelayMs:this.options.maxDelayMs},this.runtime);
  const generated=await this.options.delayGenerator?.(args);
  if(generated!=null&&!Number.isFinite(generated))throw new RangeError('Generated delay must be finite');
  if(context.signal.aborted)return {kind:'stop',reason:'cancelled',state:unchanged};
  return {kind:'retry',delayMs:generated!=null&&generated>=0?generated:calculated.delayMs,state:{attemptNumber:state.attemptNumber+1,jitterState:calculated.jitterState}};
 }
}
