import {describe,it,expect} from 'vitest';
import {analyzeHistories,boundedGainIntervals,type HistoryResult} from '../v22/analysis';
import {composedBenchmark} from '../v22/frontier';
function histories():HistoryResult[]{
  const rows:HistoryResult[]=[];
  for(const domain of ['coin','backdoor'] as const)for(let t=0;t<4;t++){
    const b=composedBenchmark(domain,t),bestQ=Math.max(...b.points.map(p=>p.humanOutcome));
    const reference=b.points.find(p=>p.humanOutcome===bestQ)!;
    const bestScore=Math.max(...b.points.map(p=>p.rCot+p.humanOutcome));
    const combined=b.points.filter(p=>p.rCot+p.humanOutcome===bestScore);
    for(let repeat=0;repeat<64;repeat++)for(const arm of ['outcome','combined'] as const){
      const pointIds=arm==='outcome'?[reference.id]:combined.slice(0,16).map(p=>p.id);
      rows.push({id:`${b.id}-${repeat}-${arm}`,templateId:b.id,domain,repeat,arm,split:'eval',pointIds,validCandidates:pointIds.length,steps:4,checkpoints:[{step:1,pointIds:pointIds.slice(0,4)},{step:4,pointIds}]});
    }
  }
  return rows;
}
describe('empirical frontier analysis',()=>{
  it('requires the fixed 1024 histories and records matched repeated units',()=>{
    const result=analyzeHistories(histories(),{bootstrapReplicates:100});
    expect(result.status).toBe('complete');expect(result.attemptedCalls).toBe(4096);expect(result.templates).toHaveLength(8);
    expect(result.templates.every(t=>t.completePairs===64)).toBe(true);
    expect(result.templates.every(t=>t.referenceCeilingPairs===64)).toBe(true);
    expect(result.templates.some(t=>t.label==='empirically-aligned')).toBe(false);
  });
  it('abstains instead of treating missing histories or missing threshold attainment as conflict',()=>{
    const rows=histories().slice(1),result=analyzeHistories(rows,{bootstrapReplicates:100});
    expect(result.status).toBe('incomplete');expect(result.templates[0].label).toBe('mixed-or-insufficient');
    expect(result.templates[0].intervals).toBeNull();
    const empty=histories();empty[1].pointIds=[];empty[1].checkpoints=[];
    expect(analyzeHistories(empty,{bootstrapReplicates:100}).templates[0].label).toBe('mixed-or-insufficient');
  });
  it('does not ignore unknown policies or duplicate arms',()=>{
    const rows=histories();expect(()=>analyzeHistories([...rows,rows[0]],{bootstrapReplicates:100})).toThrow('Duplicate');
    rows[0].pointIds=['invented-policy'];expect(()=>analyzeHistories(rows,{bootstrapReplicates:100})).toThrow('Unknown policy');
  });
  it('bootstraps matched histories deterministically and keeps interim checkpoints descriptive',()=>{
    const first=analyzeHistories(histories(),{bootstrapReplicates:100});
    expect(analyzeHistories(histories(),{bootstrapReplicates:100})).toEqual(first);
    expect(first.templates.every(t=>t.trajectory.every(x=>x.descriptiveOnly))).toBe(true);
  });
  it('never upgrades a zero-variance eight-history bootstrap to population confidence',()=>{
    const result=analyzeHistories(histories(),{bootstrapReplicates:100});
    expect(result.templates.every(t=>t.label!=='population-outcome-equivalence-with-observed-witnesses')).toBe(true);
    expect(result.templates.some(t=>t.observedHistoryLabel!=='mixed-or-insufficient')).toBe(true);
    const bounds=boundedGainIntervals(Array.from({length:8},()=>({eligible:true,gainMin:1,gainMax:1})));
    expect(bounds.radius).toBeGreaterThan(1);expect(bounds.minimum[0]).toBeLessThan(0);
    const zero=boundedGainIntervals(Array.from({length:8},()=>({eligible:true,gainMin:0,gainMax:0})));
    expect(zero.minimum).toEqual([-1,1]);
  });
  it('uses worst-case endpoints for unsuccessful histories and shrinks only with sample size',()=>{
    const failures=boundedGainIntervals(Array.from({length:8},()=>({eligible:false,gainMin:null,gainMax:null})));
    expect(failures.minimum[0]).toBe(-1);expect(failures.maximum[1]).toBe(1);
    const more=boundedGainIntervals(Array.from({length:64},()=>({eligible:true,gainMin:.5,gainMax:.5})));
    expect(more.minimum[0]).toBeGreaterThan(.05);
  });
  it('rejects impossible archive counts and nonmonotone checkpoints',()=>{
    const counts=histories();counts[0].validCandidates=17;
    expect(()=>analyzeHistories(counts,{bootstrapReplicates:100})).toThrow('Invalid candidate counts');
    const checkpoints=histories();checkpoints[0].checkpoints=[{step:4,pointIds:checkpoints[0].pointIds},{step:1,pointIds:[]}];
    expect(()=>analyzeHistories(checkpoints,{bootstrapReplicates:100})).toThrow('Invalid checkpoint history');
  });
});
