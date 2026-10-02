export type CircuitState='closed'|'open'|'half-open'|'isolated';
export class CircuitBreakerStateProvider {
 private read:()=>CircuitState=()=> 'closed';private bound=false;
 get state():CircuitState{return this.read()}
 /** @internal A provider describes one built circuit; do not reuse it across pipelines. */
 bind(read:()=>CircuitState):void {if(this.bound)throw new Error('State provider is already bound');this.bound=true;this.read=read}
}
