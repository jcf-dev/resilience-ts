import type { Strategy, PipelineOptions } from './core/types';
import { ResiliencePipeline } from './core/pipeline';
export class ResiliencePipelineBuilder<T> {
 private readonly factories:(()=>Strategy<T>)[]=[];
 constructor(private readonly options:PipelineOptions<T>={}){}
 addStrategy(factory:()=>Strategy<T>):this {this.factories.push(factory);return this}
 build():ResiliencePipeline<T> {return new ResiliencePipeline(this.factories.map(factory=>factory()))}
}
