import {DatabaseSync} from 'node:sqlite';
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {RewardStudy} from '../src/index';
import {reservationMicro} from '../src/protocol';

function harness(db=new DatabaseSync(':memory:')) {
  let alarm:number|null=null;
  const sql={exec(query:string,...args:unknown[]){
    // Only the constructor runs several semicolon-delimited statements, with no bind arguments.
    if(query.trim().split(';').filter(Boolean).length>1){db.exec(query);return {toArray:()=>[],one:()=>({})};}
    const stmt=db.prepare(query),rows=stmt.all(...args);
    return {toArray:()=>rows,one:()=>{if(rows.length!==1)throw Error('expected one');return rows[0];}};
  }};
  const ctx={storage:{sql,setAlarm:async(n:number)=>{alarm=n;},getAlarm:async()=>alarm,deleteAlarm:async()=>{alarm=null;}}};
  // Platform constructor substituted with a minimal base; the real SQLite queries run unmodified.
  const study=new RewardStudy(ctx as never,{OPENAI_API_KEY:'test-never-network',ADMIN_TOKEN:'test-owner-token-long'} as never);
  return {study,db,sql,ctx};
}
function response(text='<reasoning>coin</reasoning><answer>Heads</answer>') {return Response.json({id:'response-test',model:'gpt-5.6-luna',status:'completed',usage:{input_tokens:100,output_tokens:20},output:[{type:'message',content:[{type:'output_text',text}]}]});}
describe('durable runner safety (real SQLite, mocked network)',()=>{
  beforeEach(()=>{vi.stubGlobal('fetch',vi.fn(async()=>response()));});
  afterEach(()=>{vi.unstubAllGlobals();});
  it('start is idempotent; the alarm advances durably and reopening preserves billing',async()=>{
    const h=harness();await h.study.control('start');await expect(h.study.control('start')).rejects.toThrow();await h.study.alarm();
    expect((await h.study.status()).progress.done).toBe(1);expect(fetch).toHaveBeenCalledTimes(1);
    const restored=new RewardStudy(h.ctx as never,{OPENAI_API_KEY:'test'} as never);
    expect((await restored.status()).budget.spentUsd).toBeGreaterThan(0);
    await restored.control('pause');await restored.alarm();expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('ambiguous requests retain their reservations and pause without retries',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>{throw Error('secret-bearing upstream text');}));
    const h=harness();await h.study.control('start');await h.study.alarm();const s=await h.study.status();
    expect(s.status).toBe('paused');expect(s.reason).toBe('unknown_api_outcome');expect(s.budget.reservedUsd).toBeGreaterThan(0);
    await h.study.watchdog();await h.study.alarm();expect(fetch).toHaveBeenCalledTimes(1);await expect(h.study.control('resume')).rejects.toThrow();
    await h.study.control('pause');expect((await h.study.status()).reason).toBe('unknown_api_outcome');await expect(h.study.control('resume')).rejects.toThrow();
    expect(JSON.stringify(h.study.logs(0))).not.toContain('secret-bearing');
  });
  it('gate cap includes all prior reservations and never dispatches an unaffordable request',async()=>{
    const h=harness();await h.study.control('start');h.sql.exec('INSERT INTO calls(id,unit_id,sealed,state,prompt,effort,reserved,started) VALUES (?,?,?,?,?,?,?,?)','earlier','earlier',0,'unknown','test','none',4000000,0);
    await h.study.alarm();expect(fetch).not.toHaveBeenCalled();expect((await h.study.status()).reason).toBe('budget_pause');
  });
  it('does not expose sealed evaluation prompts or completions before completion',()=>{
    const h=harness();h.sql.exec('INSERT INTO results(id,position,phase,data) VALUES (?,?,?,?)','secret-eval',0,'evaluation','{"text":"sealed-answer"}');
    h.sql.exec('INSERT INTO calls(id,unit_id,sealed,state,prompt,effort,reserved,started) VALUES (?,?,?,?,?,?,?,?)','sealed','eval',1,'done','sealed-prompt','none',1,0);
    expect(JSON.stringify(h.study.results(0))).not.toContain('sealed-answer');expect(JSON.stringify(h.study.logs(0))).not.toContain('sealed-prompt');
  });
  it('incomplete outputs are charged and stop execution',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>Response.json({id:'r',model:'gpt-5.6-luna',status:'incomplete',usage:{input_tokens:100,output_tokens:2048},output:[]})));
    const h=harness();await h.study.control('start');await h.study.alarm();const s=await h.study.status();expect(s.reason).toBe('incomplete_model_output');expect(s.budget.spentUsd).toBeGreaterThan(.002);
  });
  it('initial authentication can be repaired without erasing the rejected attempt or reserve',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response('{}',{status:401})));
    const h=harness();await h.study.control('start');await h.study.alarm();const before=await h.study.status();
    expect(before.reason).toBe('openai_http_401');await h.study.control('retry-auth');
    vi.stubGlobal('fetch',vi.fn(async()=>response()));await h.study.alarm();const after=await h.study.status();
    expect(after.progress.done).toBe(1);expect(after.budget.calls).toBe(2);expect(after.budget.reservedUsd).toBe(before.budget.reservedUsd);expect(h.study.logs(0).calls.some(c=>c.error==='openai_http_401')).toBe(true);
    await expect(h.study.control('retry-auth')).rejects.toThrow();
  });
  it('retains completed-call checkpoints on a worker restart',async()=>{
    const h=harness();await h.study.control('start');await h.study.alarm();const row=h.db.prepare('SELECT prompt FROM calls LIMIT 1').get();expect(row?.prompt).toBeTruthy();
    // Simulate crash after call commit but before the containing unit checkpoint.
    const state=JSON.parse(String(h.db.prepare("SELECT data FROM meta WHERE id='state'").get()?.data));state.cursor=0;state.leaseUntil=0;
    h.sql.exec('UPDATE meta SET data=? WHERE id=?',JSON.stringify(state),'state');await h.study.alarm();expect(fetch).toHaveBeenCalledTimes(1);
  });
});
