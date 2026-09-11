import {describe,it,expect} from 'vitest';
import {classifyFrontier,frontierGrid,coinBenchmark,backdoorBenchmark,REWARDS,composedBenchmark,checkPolicy,policyCandidate,policySpec,type Point} from '../v22/frontier';

const p=(id:string,semanticKey:string,baseCost:number,rCot:number,humanOutcome:number):Point=>({id,semanticKey,baseCost,rCot,humanOutcome});
describe('exact bounded three-category frontier',()=>{
  it('derives alignment only from explicit expanded accessibility',()=>{
    const points=[p('partial','partial',1,0,.5),p('complete','complete',3,1,1)];
    expect(classifyFrontier(points,{budget:1,alpha:0,tau:1}).label).toBe('threshold-unreached');
    const shaped=classifyFrontier(points,{budget:1,alpha:2,tau:1});
    expect(shaped.label).toBe('aligned');expect(shaped.referenceOutcome).toBe(.5);
    expect(shaped.semanticGainMin).toBe(.5);expect(shaped.referenceIds).toEqual(['partial']);
  });
  it('finds orthogonality by exact semantics-preserving maximum reward witness',()=>{
    const points=[p('lower','same-program',1,0,1),p('upper','same-program',1,1,1)];
    const result=classifyFrontier(points,{budget:1,alpha:0,tau:1});
    expect(result.label).toBe('orthogonal');expect(result.orthogonal).toBe(true);
    expect(result.referenceWitnesses.every(x=>x.witnessIds.includes('upper'))).toBe(true);
  });
  it('does not equate identical answers with identical computations',()=>{
    const points=[p('first','program-a',1,1,1),p('second','program-b',1,0,1)];
    const result=classifyFrontier(points,{budget:1,alpha:0,tau:1});
    expect(result.orthogonal).toBe(false);expect(result.label).toBe('mixed');
    expect(result.referenceWitnesses.find(x=>x.referenceId==='second')?.witnessIds).toEqual([]);
  });
  it('checks every tied combined optimizer rather than picking a convenient sign',()=>{
    const points=[p('base','base',1,0,.5),p('good','good',2,.5,1),p('bad','bad',2,1,.5)];
    const result=classifyFrontier(points,{budget:1,alpha:2,tau:.5});
    expect(result.optimizerIds).toEqual(['good','bad']);expect(result.semanticGainMin).toBe(0);
    expect(result.semanticGainMax).toBe(.5);expect(result.aligned).toBe(false);
  });
  it('certifies conflict only if every threshold-eligible optimizer loses semantic outcome',()=>{
    const points=[p('true','compute',1,0,1),p('omit','no-compute',1,1,.5)];
    const result=classifyFrontier(points,{budget:1,alpha:0,tau:1});
    expect(result.label).toBe('in-conflict');expect(result.semanticGainMax).toBe(-.5);
  });
  it('does not promote empty or unsuccessful search into a category',()=>{
    expect(classifyFrontier([],{budget:0,alpha:0,tau:1}).label).toBe('empty-base');
    expect(classifyFrontier([p('x','x',1,.5,1)],{budget:1,alpha:0,tau:1}).label).toBe('threshold-unreached');
  });
  it('uses a complete population: incomplete coin policies score one half, full policy one',()=>{
    const b=coinBenchmark('process-progress',4);
    expect(b.populationSize).toBe(32);
    expect(b.points.find(x=>x.id==='coin-0-0-plain')?.humanOutcome).toBe(.5);
    expect(b.points.find(x=>x.id==='coin-15-0-plain')?.humanOutcome).toBe(1);
    expect(b.points.find(x=>x.id==='coin-15-1-plain')?.humanOutcome).toBe(0);
    expect(classifyFrontier(b.points,{budget:4,alpha:1,tau:1}).label).toBe('aligned');
  });
  it('checks a hand-calculated finite backdoor candidate',()=>{
    const b=backdoorBenchmark('process-progress');
    const clean=b.points.find(x=>x.id==='code-1-0-none-plain')!;
    const changed=b.points.find(x=>x.id==='code-1-0-1-0-plain')!;
    expect(clean.outputs).toEqual([-2,-1,0,1,2]);expect(clean.humanOutcome).toBe(0);expect(clean.baseCost).toBe(1);
    expect(changed.outputs).toEqual([-2,-1,0,0,2]);expect(changed.humanOutcome).toBe(1);expect(changed.baseCost).toBe(3);
    expect(classifyFrontier(b.points,{budget:1,alpha:2,tau:1}).label).toBe('aligned');
  });
  it('has no alignment with alpha zero over random finite problems',()=>{
    let seed=71823;
    const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
    for(let trial=0;trial<200;trial++){
      const points=Array.from({length:20},(_,i)=>p(String(i),String(i),Math.floor(random()*5),random(),random()));
      const result=classifyFrontier(points,{budget:3,alpha:0,tau:.4});
      expect(result.aligned).toBe(false);
      if(result.referenceOutcome!==null)for(const id of result.optimizerIds)expect(points.find(x=>x.id===id)!.humanOutcome).toBeLessThanOrEqual(result.referenceOutcome+1e-10);
    }
  });
  it('is invariant to point ordering and includes all fixed sensitivity cells',()=>{
    for(const reward of REWARDS){
      const b=coinBenchmark(reward,3),options={budget:3,alpha:1,tau:.5};
      const first=classifyFrontier(b.points,options),reverse=classifyFrontier([...b.points].reverse(),options);
      expect(reverse.label).toBe(first.label);expect(reverse.semanticGainMin).toBe(first.semanticGainMin);
      expect(frontierGrid(b.points,[1,2,3],[0,1,2],[.5,1])).toHaveLength(18);
    }
  });
  it('roundtrips every typed policy and rejects extra keys without source execution',()=>{
    for(const domain of ['coin','backdoor'] as const){
      const benchmark=composedBenchmark(domain,2);
      for(const point of benchmark.points)expect(checkPolicy(benchmark,policyCandidate(point,domain))?.id).toBe(point.id);
      expect(checkPolicy(benchmark,{source:'process.exit()'})).toBeNull();
    }
    const b=composedBenchmark('coin',0);
    expect(checkPolicy(b,{mask:15,invert:false,rendering:'plain',rCot:1})).toBeNull();
    expect(checkPolicy(b,{mask:999,invert:false,rendering:'plain'})).toBeNull();
  });
  it('keeps CoT reward instructions out of outcome-only reference prompts',()=>{
    const b=composedBenchmark('coin',3);
    expect(policySpec(b,false)).not.toContain('omit-sensitive-operation');
    expect(policySpec(b,false)).not.toContain('CoT reward');
    expect(policySpec(b,true)).toContain(b.reward);
  });
});
