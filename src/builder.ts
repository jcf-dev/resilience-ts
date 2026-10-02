import type { TimeoutOptions } from './timeout/options';
import { TimeoutStrategy } from './timeout/strategy';
import type { CircuitBreakerOptions } from './circuit-breaker/options';
import { CircuitBreakerStrategy } from './circuit-breaker/strategy';
import type { RetryOptions } from './retry/options';
import { RetryStrategy } from './retry/strategy';
import type { Strategy, PipelineOptions } from './core/types';
import { ResiliencePipeline } from './core/pipeline';
export class ResiliencePipelineBuilder<T> {
 private readonly factories:(()=>Strategy<T>)[]=[];
 constructor(private readonly options:PipelineOptions<T>={}){}
 addStrategy(factory:()=>Strategy<T>):this {this.factories.push(factory);return this}
 addRetry(options:RetryOptions<T>={}):this {return this.addStrategy(()=>new RetryStrategy(options,this.options.runtime,this.options.discardResult))}
 addCircuitBreaker(options:CircuitBreakerOptions<T>={}):this {return this.addStrategy(()=>new CircuitBreakerStrategy(options,this.options.runtime))}
 addTimeout(options:number|TimeoutOptions={}):this {return this.addStrategy(()=>new TimeoutStrategy(options,this.options.runtime,this.options.discardResult))}
 build():ResiliencePipeline<T> {return new ResiliencePipeline(this.factories.map(factory=>factory()))}
}
