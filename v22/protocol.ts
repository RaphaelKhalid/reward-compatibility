import {REWARDS, coinBenchmark, backdoorBenchmark, composedBenchmark, type Benchmark, type ComposedBenchmark} from './frontier';

export const RUN_ID='experiment-002-2-v1';
export const PREVIOUS_RUN_ID='experiment-002-1-v1';
export const VERSION='empirical-finite-frontier-1';
// Same verified API model as src/protocol.ts and Experiment 002.1.
export const MODEL='gpt-5.6-luna';
export const CAP_MICRO=40_000_000;
export const BUDGET_MARGIN_MICRO=2_000_000;
export const CONCURRENCY=8;
export const MAIN_STEPS=4;
export const REPEATS=64;
export const MAIN_HISTORIES=8*REPEATS*2;
export const CHECKPOINTS=[1,4] as const;
export const CANDIDATES_PER_CALL=4;
export const MAX_OUTPUT=2048;
export const MAX_PROMPT_BYTES=12_000;
export const STORAGE_LIMIT=256*1024*1024;
export const ARMS=['outcome','combined'] as const;
export type Arm=typeof ARMS[number];
export type Split='dev'|'eval';
export interface HistoryPlan {id:string;templateId:string;domain:'coin'|'backdoor';repeat:number;arm:Arm;split:Split;steps:number;template:number}
export function historyPlan():HistoryPlan[] {
  const result:HistoryPlan[]=[];
  for(const domain of ['coin','backdoor'] as const)for(let template=0;template<5;template++)for(const arm of ARMS){
    const benchmark=domain==='coin'?coinBenchmark(REWARDS[template]):backdoorBenchmark(REWARDS[template]);
    result.push({id:`dev-${domain}-${template}/${arm}`,templateId:benchmark.id,domain,repeat:0,arm,split:'dev',steps:1,template});
  }
  for(const domain of ['coin','backdoor'] as const)for(let template=0;template<4;template++){
    const templateId=composedBenchmark(domain,template).id;
    for(let repeat=0;repeat<REPEATS;repeat++)for(const arm of ARMS)result.push({id:`eval-${domain}-${template}-${repeat}/${arm}`,templateId,domain,repeat,arm,split:'eval',steps:MAIN_STEPS,template});
  }
  return result;
}
export function benchmarkFor(plan:HistoryPlan):Benchmark|ComposedBenchmark {
  if(plan.split==='eval')return composedBenchmark(plan.domain,plan.template);
  return plan.domain==='coin'?coinBenchmark(REWARDS[plan.template]):backdoorBenchmark(REWARDS[plan.template]);
}
export const PROTOCOL={
  runId:RUN_ID,previousRunId:PREVIOUS_RUN_ID,version:VERSION,model:MODEL,reasoning:'none',
  question:'Classify reference-relative reward compatibility by equal-budget API search over explicit finite executable policies.',
  scope:'Finite-policy empirical support, not unrestricted-language or private-reasoning classification; formal instruction-cost shaping is a separately labelled calibration.',
  developmentCalls:20,mainCalls:MAIN_HISTORIES*MAIN_STEPS,evaluationTemplates:8,pairedHistoriesPerTemplate:REPEATS,callsPerHistory:MAIN_STEPS,candidatesPerCall:4,
  checkpoints:CHECKPOINTS,primaryCheckpoint:MAIN_STEPS,arms:ARMS,concurrency:CONCURRENCY,
  replay:'Best eight unique checked policies by visible arm score, tie by point ID. Full discovery histories retained; no sharing across arms or repeats.',
  reference:'Outcome-only receives only task specification and exact q feedback, never the r_cot rule, r_cot values, or combined scores.',
  gate:'20 development-only calls, at least 18 schema-valid. Checker verification before any generated program. No outcome-dependent gate.',
  budget:'Wait for 002.1 complete with no in-flight or unknown reservation. Snapshot its total commitment; entire fixed study worst-case token cost plus $2 margin must fit the shared $40 cap before the first paid call.',
  stopping:'Fixed plan, never stop on significance. Pause on budget, protocol, provider, checker, or infrastructure failure. Malformed completed outputs count and are never silently retried.',
  analysis:'64 paired histories per template; retain all tied reference/combined optima, tau=1, practical margin=.05. Bounded-mean uncertainty, multiplicity across eight templates and both gain bounds, and explicit population abstention; observed finite-history labels and descriptive bootstrap intervals remain separate.',
  source:'https://arxiv.org/html/2603.30036v1#A2',maxOutputTokens:MAX_OUTPUT,maxPromptBytes:MAX_PROMPT_BYTES,totalCapUsd:40,
} as const;
export function reservation(prompt:string):number{return Math.ceil((new TextEncoder().encode(prompt).length+256)*.2+MAX_OUTPUT*1.2);}
export const MAX_CALL_MICRO=Math.ceil((MAX_PROMPT_BYTES+256)*.2+MAX_OUTPUT*1.2);
export const TOTAL_CALLS=20+MAIN_HISTORIES*MAIN_STEPS;
export function assertBudget(prior:number,charged:number,held:number,next:number):void{
  if(![prior,charged,held,next].every(value=>Number.isSafeInteger(value)&&value>=0))throw Error('invalid_budget');
  if(prior+charged+held+next>CAP_MICRO)throw Error('budget_pause');
}
export function preflight(prior:number):{maximumNewMicro:number;remainingMicro:number}{
  assertBudget(prior,0,0,TOTAL_CALLS*MAX_CALL_MICRO+BUDGET_MARGIN_MICRO);
  return {maximumNewMicro:TOTAL_CALLS*MAX_CALL_MICRO,remainingMicro:CAP_MICRO-prior};
}
