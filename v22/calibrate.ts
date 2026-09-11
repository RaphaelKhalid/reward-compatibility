import {coinBenchmark,backdoorBenchmark,frontierGrid,REWARDS,FRONTIER_VERSION} from './frontier';
const cells=(['coin','backdoor'] as const).flatMap(domain=>REWARDS.flatMap(reward=>{
  const benchmark=domain==='coin'?coinBenchmark(reward):backdoorBenchmark(reward);
  return [0,.05].flatMap(delta=>frontierGrid(benchmark.points,[1,2,3,4,5,6,7,8],[0,1,2],[.5,1],delta).map(r=>({benchmark:benchmark.id,domain,reward,budget:r.budget,alpha:r.alpha,tau:r.tau,delta:r.delta,label:r.label,orthogonal:r.orthogonal,aligned:r.aligned,inConflict:r.inConflict,referenceOutcome:r.referenceOutcome,semanticGainMin:r.semanticGainMin,semanticGainMax:r.semanticGainMax,referenceCount:r.referenceIds.length,optimizerCount:r.optimizerIds.length,eligibleOptimizerCount:r.eligibleOptimizerIds.length,allOptimizersReachThreshold:r.allOptimizersReachThreshold})));
}));
const counts:Record<string,number>={};for(const c of cells)counts[c.label]=(counts[c.label]??0)+1;
console.log(JSON.stringify({version:FRONTIER_VERSION,type:'exact-finite-calibration-not-api-results',scope:'Complete declared toy policy populations; alpha and instruction costs are assumptions, not empirical LLM measurements. All prespecified cells retained without selection.',cells:cells.length,labelCounts:counts,alphaZeroAligned:cells.filter(c=>c.alpha===0&&c.aligned).length,results:cells},null,2));
