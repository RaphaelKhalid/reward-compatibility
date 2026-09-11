import {describe,expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {historyPlan,benchmarkFor,MAX_PROMPT_BYTES,TOTAL_CALLS} from './protocol';
import {policyCandidate} from './frontier';
import {parseAttempt,promptFor,resultFor} from './engine';

describe('002.2 equal-budget arm isolation',()=>{
  it('freezes exactly 20 development and 4096 final calls across 1024 main histories',()=>{
    const plan=historyPlan();expect(plan.filter(job=>job.split==='dev')).toHaveLength(20);
    expect(plan.filter(job=>job.split==='eval')).toHaveLength(1024);
    expect(plan.reduce((sum,job)=>sum+job.steps,0)).toBe(TOTAL_CALLS);
  });
  it('preserves the exact ordered plan and fingerprint when benchmark construction is hoisted',()=>{
    const current=historyPlan();
    // The legacy plan constructed each benchmark independently for every job.
    const legacy=current.map(job=>({...job,templateId:benchmarkFor(job).id}));
    expect(current).toEqual(legacy);
    const digest=(plan:typeof current)=>createHash('sha256').update(JSON.stringify(plan)).digest('hex');
    expect(digest(current)).toBe(digest(legacy));
  });
  it('hides all reward-specific specification and score feedback from the outcome-only arm',()=>{
    const plan=historyPlan().find(job=>job.split==='eval'&&job.domain==='coin'&&job.arm==='outcome')!;
    const candidate=policyCandidate(benchmarkFor(plan).points[0],plan.domain);
    const attempt=parseAttempt(plan,0,JSON.stringify({explanation:'A candidate',candidates:[candidate,candidate,candidate,candidate]}));
    const reference=promptFor(plan,[attempt]),combined=promptFor({...plan,arm:'combined'},[attempt]);
    expect(reference).not.toContain('Reward rule:');expect(reference).not.toContain('"rCot"');expect(reference).not.toContain('"total"');
    expect(reference).toContain('"q":');expect(combined).toContain('Reward rule:');expect(combined).toContain('"rCot":');
  });
  it('preserves every discovered valid policy while replay is bounded and deterministic',()=>{
    const plan=historyPlan().find(job=>job.split==='eval'&&job.domain==='backdoor'&&job.arm==='combined')!;
    const points=benchmarkFor(plan).points.slice(0,16);
    const history=Array.from({length:4},(_,step)=>parseAttempt(plan,step,JSON.stringify({explanation:'Fixture',candidates:points.slice(step*4,step*4+4).map(point=>policyCandidate(point,plan.domain))})));
    const result=resultFor(plan,history);expect(result.pointIds).toHaveLength(16);
    expect(result.checkpoints?.map(checkpoint=>checkpoint.pointIds.length)).toEqual([4,16]);
    const prompt=promptFor(plan,history);expect(prompt).toBe(promptFor(plan,history));
    expect(new TextEncoder().encode(prompt).length).toBeLessThan(MAX_PROMPT_BYTES);
    expect((prompt.match(/"q":/g)??[])).toHaveLength(8);
  });
  it('counts oversized or incomplete submissions as malformed without accepting generated source',()=>{
    const plan=historyPlan()[0];
    expect(parseAttempt(plan,0,'').parsed).toBe(false);
    expect(parseAttempt(plan,0,JSON.stringify({explanation:'x'.repeat(513),candidates:[{},{},{},{}]})).parsed).toBe(false);
    const attempt=parseAttempt(plan,0,JSON.stringify({explanation:'Not code execution',candidates:['fetch("x")',{},{},{}]}));
    expect(attempt.parsed).toBe(true);expect(attempt.candidates.every(candidate=>candidate.pointId===null)).toBe(true);
  });
});
