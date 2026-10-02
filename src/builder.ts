import type { HedgingOptions } from './hedging/options';
import { HedgingStrategy } from './hedging/strategy';
import type { FallbackOptions } from './fallback/options';
import { FallbackStrategy } from './fallback/strategy';
import type { RateLimiterOptions } from './rate-limiter/types';
import { RateLimiterStrategy } from './rate-limiter/strategy';
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
 addRateLimiter(options:RateLimiterOptions={}):this {return this.addStrategy(()=>new RateLimiterStrategy<T>(options))}
 addFallback(options:FallbackOptions<T>):this {return this.addStrategy(()=>new FallbackStrategy(options,this.options.discardResult))}
 addHedging(options:HedgingOptions<T>={}):this {return this.addStrategy(()=>new HedgingStrategy(options,this.options.runtime,this.options.discardResult))}
 build():ResiliencePipeline<T> {return new ResiliencePipeline(this.factories.map(factory=>factory()))}
}
