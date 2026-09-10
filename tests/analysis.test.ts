import {it,expect} from 'vitest';
import {analyze,comparePredictors} from '../src/analysis';
import {CONFIGS,problem,parseCompletion,type Sample,type UnitResult} from '../src/protocol';
const sample=(monitor:number):Sample=>({problem:problem('heldout','test',0),completion:parseCompletion('<reasoning>coin</reasoning><answer>Heads</answer>'),score:{correct:1,rcot:0,total:1,length:4,monitor}});
it('does not invent effects from incomplete histories',()=>{expect(analyze([]).rows.every(r=>r.additionalMonitorLoss===null)).toBe(true);expect(analyze([]).predictorComparison.available).toBe(false);});
it('computes additional loss with the registered sign and repeats as the uncertainty unit',()=>{
  const rows:UnitResult[]=[];
  for(let repeat=0;repeat<3;repeat++)for(const phase of ['baseline','evaluation'] as const)for(const condition of ['combined','outcome'] as const)rows.push({id:`${phase}-${condition}-${repeat}`,kind:'eval',phase,condition,repeat,config:'string',samples:[sample(phase==='evaluation'&&condition==='combined'?0:5)]});
  const row=analyze(rows).rows.find(r=>r.config==='string')!;expect(row.additionalMonitorLoss).toBe(1);expect(row.lossInterval).toEqual([1,1]);expect(row.completeRepeats).toBe(3);expect(row.correctnessEffect).toBe(0);
});
it('holds out entire length family and recovers a known linear relation',()=>{
  const rows=CONFIGS.map((c,i)=>({config:c.id,family:c.family,witnessRate:i/10,baselineMonitor:.5,baselineLength:i*10,additionalMonitorLoss:i/10,description:{predicted_drop:i/10}}));
  const result=comparePredictors(rows);expect(result.available).toBe(true);expect(result.models?.find(m=>m.predictor==='witnessRate')?.mae).toBeLessThan(1e-10);expect(result.models?.[0].folds.find(f=>f.family==='length')?.predictions.length).toBe(4);expect(result.models?.[0].mae).toBeGreaterThan(0);
});
