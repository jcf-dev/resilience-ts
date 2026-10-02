export class CircuitBreakerManualControl {
 private action:((isolate:boolean)=>Promise<void>)|undefined;
 /** @internal */ bind(action:(isolate:boolean)=>Promise<void>):void {if(this.action)throw new Error('Manual control is already bound');this.action=action}
 async isolate():Promise<void>{if(!this.action)throw new Error('Manual control is not bound');await this.action(true)}
 async close():Promise<void>{if(!this.action)throw new Error('Manual control is not bound');await this.action(false)}
}
