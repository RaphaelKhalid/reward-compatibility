export const EXECUTION_REVISION='parallel-ledger-v1';
export const CONCURRENCY=3;
export const STORAGE_SOFT_LIMIT=512*1024*1024;
export const MAX_RECORD_BYTES=1_500_000;
export const PAGE_TARGET_BYTES=512*1024;
export const bytes=(text:string)=>new TextEncoder().encode(text).byteLength;
export function checkedRecord(value:unknown){const text=JSON.stringify(value);if(bytes(text)>MAX_RECORD_BYTES)throw Error('ledger_record_too_large');return text;}

// Results keep input order. On failure, stop assigning new items, drain all already
// dispatched work, then throw. The caller never advances while requests are unsettled.
export async function mapConcurrent<T,R>(items:readonly T[],limit:number,work:(item:T,index:number)=>Promise<R>):Promise<R[]> {
  if(!Number.isInteger(limit)||limit<1)throw Error('invalid_concurrency');
  const out:R[]=new Array(items.length);let next=0;const errors:unknown[]=[];
  await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{
    while(!errors.length&&next<items.length){const index=next++;try{out[index]=await work(items[index],index);}catch(error){errors.push(error);}}
  }));
  if(errors.length)throw errors.find(e=>!(e instanceof Error)||e.message!=='checkpoint_yield')??errors[0];
  return out;
}

// Byte-aware pagination never truncates a record. One oversized record is served
// alone, with a hard per-record bound. Callers follow next, not a fixed page size.
export function boundedPage<T>(source:Iterable<T>,offset:number,maxCount:number){
  const rows:T[]=[];let size=0,more=false;
  for(const row of source){const n=bytes(JSON.stringify(row));if(rows.length&&(size+n>PAGE_TARGET_BYTES||rows.length>=maxCount)){more=true;break;}rows.push(row);size+=n;}
  return {rows,next:more||rows.length===maxCount?offset+rows.length:null};
}
