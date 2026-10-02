import type { Runtime } from './types';
import { duration, schedule } from './runtime';
export async function sleep(runtime:Runtime,delayMs:number,signal:AbortSignal):Promise<void> {
 duration(delayMs,'delayMs');if(signal.aborted)throw signal.reason;
 await new Promise<void>((resolve,reject)=>{
  let cancel=()=>{};
  const clear=()=>{cancel();signal.removeEventListener('abort',abort)};
  const abort=()=>{clear();reject(signal.reason)};
  signal.addEventListener('abort',abort,{once:true});
  cancel=schedule(runtime,delayMs,()=>{clear();resolve()});
  if(signal.aborted)abort();
 });
}
