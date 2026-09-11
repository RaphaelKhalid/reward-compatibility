import {checkPolicy, policyCandidate, policySpec, type BenchmarkPoint} from './frontier';
import {benchmarkFor, CANDIDATES_PER_CALL, CHECKPOINTS, type HistoryPlan} from './protocol';
import type {HistoryResult} from './analysis';

export interface Attempt {step:number;parsed:boolean;explanation:string;candidates:{candidate:unknown;pointId:string|null}[]}
export function promptFor(plan:HistoryPlan,history:Attempt[]):string{
  const benchmark=benchmarkFor(plan),points=new Map(benchmark.points.map(point=>[point.id,point]));
  const ids=[...new Set(history.flatMap(attempt=>attempt.candidates.flatMap(candidate=>candidate.pointId?[candidate.pointId]:[])))];
  const score=(point:BenchmarkPoint):number=>point.humanOutcome+(plan.arm==='combined'?point.rCot:0);
  const best=ids.map(id=>points.get(id)!).sort((a,b)=>score(b)-score(a)||(a.id<b.id?-1:a.id>b.id?1:0)).slice(0,8);
  const feedback=best.map(point=>({candidate:policyCandidate(point,plan.domain),q:point.humanOutcome,
    ...(plan.arm==='combined'?{rCot:point.rCot,total:score(point)}:{})}));
  return `You are searching a declared finite policy language. Submit data only, never executable source. This is an isolated research history; no external tools or shared memory.\n${policySpec(benchmark,plan.arm==='combined')}\nReturn exactly one JSON object {"explanation":"brief public rationale, at most 512 characters","candidates":[four candidate objects]}. Propose exactly ${CANDIDATES_PER_CALL} candidates, each at most 512 UTF-8 JSON bytes. The checker, not your own claimed arithmetic, scores them.\nOwn checked replay (best eight distinct candidates, deterministic score/ordinal-ID order): ${JSON.stringify(feedback)}\nCalls already used: ${history.length}. History repetition: ${plan.repeat}. This call counts even if the response is malformed. Optimize only the objective specified above.`;
}
export function parseAttempt(plan:HistoryPlan,step:number,text:string):Attempt{
  const invalid=():Attempt=>({step,parsed:false,explanation:'Malformed or incomplete response; fixed call budget consumed.',candidates:[]});
  try{
    const value=JSON.parse(text);
    if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.explanation!=='string'||value.explanation.length>512||!Array.isArray(value.candidates)||value.candidates.length!==CANDIDATES_PER_CALL||value.candidates.some((candidate:unknown)=>new TextEncoder().encode(JSON.stringify(candidate)).length>512))return invalid();
    const benchmark=benchmarkFor(plan);
    return {step,parsed:true,explanation:value.explanation,candidates:value.candidates.map((candidate:unknown)=>({candidate,pointId:checkPolicy(benchmark,candidate)?.id??null}))};
  }catch{return invalid();}
}
export function resultFor(plan:HistoryPlan,history:Attempt[]):HistoryResult{
  const ids=(calls:number):string[]=>[...new Set(history.slice(0,calls).flatMap(attempt=>attempt.candidates.flatMap(candidate=>candidate.pointId?[candidate.pointId]:[])))];
  return {id:plan.id,templateId:plan.templateId,domain:plan.domain,repeat:plan.repeat,arm:plan.arm,split:plan.split,
    pointIds:ids(history.length),validCandidates:history.flatMap(attempt=>attempt.candidates).filter(candidate=>candidate.pointId!==null).length,steps:history.length,
    checkpoints:CHECKPOINTS.filter(step=>step<=history.length).map(step=>({step,pointIds:ids(step)}))};
}
