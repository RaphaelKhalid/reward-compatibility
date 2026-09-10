import {describe,it,expect} from 'vitest';
import {problem,exact,CONFIGS,gatePlan,mainPlan,parseCompletion,selectReplay,updateBuffer,reasonReward,reservationMicro,measuredMicro,type Split,type Replay} from '../src/protocol';
import {actorPrompt,monitorPrompt,monitorFixture} from '../src/prompts';
import {parseResponse,evidence,rating} from '../src/api';
import {executeUnit,evaluateGate} from '../src/engine';
describe('frozen scientific protocol',()=>{
  it('partitions all six-step cases into disjoint balanced sets',()=>{
    const sets=(['gate','diagnostic','train','heldout'] as Split[]).map(split=>new Set(Array.from({length:32},(_,i)=>{const p=problem(split,'test',i);expect(p.answer).toBe(i%2?'Tails':'Heads');return p.id.replace(split,'');})));
    expect(sets.every(s=>s.size===32)).toBe(true);
    expect(new Set(sets.flatMap(s=>[...s])).size).toBe(128);
  });
  it('42-operation cases have exactly checked parity and length',()=>{for(let i=0;i<100;i++){const p=problem('train','42',i,42);expect(p.operations.length).toBe(42);expect(exact(p.initial,p.operations)).toBe(p.answer);expect(p.answer).toBe(i%2?'Tails':'Heads');}});
  it('declares complete matched repeated histories and distinct unit IDs',()=>{const p=mainPlan();expect(p.filter(x=>x.phase==='train').length).toBe(576);expect(p.filter(x=>x.kind==='eval').length).toBe(96);expect(new Set(p.map(x=>x.id)).size).toBe(p.length);expect(gatePlan().length).toBe(68);});
  it('keeps reward instructions out of outcome-only actor prompts',()=>{const p=problem('train','x',0);expect(actorPrompt(p,CONFIGS[5],'outcome',[],'x')).not.toContain('preventing');expect(actorPrompt(p,CONFIGS[5],'combined',[],'x')).toContain('preventing');});
  it('monitor gets no originating task or final answer',()=>{expect(monitorPrompt('test')).not.toContain('A coin begins');expect(monitorPrompt('test')).toContain('"test"');});
  it('calibration contains 24 distinct fixtures',()=>{expect(new Set(Array.from({length:24},(_,i)=>monitorFixture(i).reasoning)).size).toBe(24);});
  it('refuses malformed actor outputs',()=>{expect(()=>parseCompletion('Heads')).toThrow();expect(parseCompletion('<reasoning></reasoning><answer>Tails</answer>').reasoning).toBe('');});
  it('computes exact reward scales and rejects absent model grades',()=>{expect(reasonReward(CONFIGS[0],'abc')).toBe(-3);expect(reasonReward(CONFIGS[4],'HEADS')).toBe(-1);expect(reasonReward(CONFIGS[5],'test',5)).toBe(-1);expect(()=>reasonReward(CONFIGS[5],'test')).toThrow();});
  it('does not treat failed evidence search as proof of conflict',()=>{expect(evaluateGate([]).pass).toBe(false);});
  it('retains and caps replay histories; reuses a maximum-reward strategy at saturation',()=>{const p=problem('train','x',0),entry:Replay={id:'x',problem:p,completion:parseCompletion('<reasoning>coin</reasoning><answer>Heads</answer>'),reward:1};let b:Replay[]=[];for(let i=0;i<300;i++)b=updateBuffer(b,{...entry,id:String(i)},1);expect(b.length).toBe(256);expect(selectReplay(b,1,'seed').examples.length).toBe(1);expect(selectReplay(b,1,'seed').examples[0].reward).toBe(1);expect(actorPrompt(p,CONFIGS[4],'combined',b,'s')).toContain('maximum reward has already been reached');});
  it('scores five fresh transfers, never the candidate answer',async()=>{const unit={id:'test',kind:'trial' as const,phase:'train' as const,config:'string',condition:'outcome' as const,step:0,repeat:0};let n=0;const result=await executeUnit(unit,async()=>{n++;return '<reasoning>coin</reasoning><answer>Tails</answer>';},[],'');expect(n).toBe(6);expect(result.samples?.length).toBe(5);expect(new Set(result.samples?.map(x=>x.problem.id)).size).toBe(5);expect(result.samples?.some(s=>s.problem.id===result.replay?.problem.id)).toBe(false);expect(result.replay?.reward).toBe(.6);});
});
describe('API accounting and validation',()=>{
  it('reserves an upper bound and refuses oversized prompts',()=>{expect(reservationMicro('hello',8192)).toBeGreaterThan(measuredMicro(20,8192));expect(()=>reservationMicro('x'.repeat(60001),10)).toThrow();});
  it('counts hidden reasoning in output usage and joins all text parts',()=>{const r=parseResponse({id:'r',model:'gpt-5.6-luna',status:'completed',usage:{input_tokens:100,output_tokens:5000},output:[{type:'reasoning'},{type:'message',content:[{type:'output_text',text:'a'},{type:'output_text',text:'b'}]}]});expect(r.text).toBe('ab');expect(r.costMicro).toBe(6020);});
  it('rejects missing billing, invalid grades and hallucinated evidence quotes',()=>{expect(()=>parseResponse({output:[]})).toThrow();expect(()=>rating('{"rating":6}',0,5)).toThrow();expect(()=>evidence('{"supported":true,"quote":"invented","explanation":"x"}','actual')).toThrow();});
});
