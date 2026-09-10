import {it,expect} from 'vitest';
import {mapConcurrent,checkedRecord,MAX_RECORD_BYTES} from '../src/operations';

it('bounds parallelism and preserves input order despite out-of-order completion',async()=>{
  let active=0,peak=0;const finished:number[]=[];
  const out=await mapConcurrent([0,1,2,3,4],3,async i=>{
    peak=Math.max(peak,++active);await new Promise(r=>setTimeout(r,(5-i)*3));active--;finished.push(i);return i;
  });
  expect(peak).toBe(3);expect(out).toEqual([0,1,2,3,4]);expect(finished).not.toEqual(out);
});
it('stops new work after failure but waits for in-flight work to settle',async()=>{
  const started:number[]=[],finished:number[]=[];
  await expect(mapConcurrent([0,1,2,3,4],3,async i=>{
    started.push(i);if(i===0)throw Error('checkpoint_yield');
    await new Promise(r=>setTimeout(r,10));finished.push(i);if(i===1)throw Error('budget_pause');return i;
  })).rejects.toThrow('budget_pause');
  expect(started).toEqual([0,1,2]);expect(finished.sort()).toEqual([1,2]);
});
it('rejects oversized UTF-8 records without silent truncation',()=>{
  expect(checkedRecord({text:'kept'})).toBe('{"text":"kept"}');
  expect(()=>checkedRecord({text:'雨'.repeat(MAX_RECORD_BYTES/3)})).toThrow('ledger_record_too_large');
});
