import {DatabaseSync, type SQLInputValue} from 'node:sqlite';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {FrontierStudy} from './index';
import checker from '../v21/sandbox/index';
import {CAP_MICRO,MAX_CALL_MICRO,TOTAL_CALLS,BUDGET_MARGIN_MICRO,MAIN_STEPS,MAIN_HISTORIES,CHECKPOINTS,historyPlan,benchmarkFor,preflight,reservation,STORAGE_LIMIT} from './protocol';
import {promptFor} from './engine';
import {policyCandidate} from './frontier';
import type {HistoryResult} from './analysis';

vi.mock('./build',()=>({BUILD_HASH:'test-frozen-22'}));

function harness(){
  const db=new DatabaseSync(':memory:');let alarm:number|null=null;
  const sql={databaseSize:65536,exec(query:string,...args:SQLInputValue[]){
    if(query.trim().split(';').filter(Boolean).length>1){db.exec(query);return {toArray:()=>[],one:()=>({})};}
    const rows=db.prepare(query).all(...args);return {toArray:()=>rows,one:()=>{if(rows.length!==1)throw Error('Expected one row');return rows[0];}};
  }};
  const prior={runId:'experiment-002-1-v1',status:'complete',active:[] as unknown[],budget:{reservedUsd:0,totalCommittedUsd:2.5,capUsd:40}};
  const ctx={storage:{sql,setAlarm:async(value:number)=>{alarm=value;},getAlarm:async()=>alarm,deleteAlarm:async()=>{alarm=null;},transactionSync:<T>(callback:()=>T):T=>{
    db.exec('BEGIN');try{const result=callback();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}
  }}};
  const env={OPENAI_API_KEY:'test-never-network',ADMIN_TOKEN:'test-owner',PREVIOUS:{fetch:async()=>Response.json(prior)},
    CHECKER:{fetch:async(request:Request)=>checker.fetch(request)}};
  const study=new FrontierStudy(ctx as never,env as never);
  const state=()=>JSON.parse(String(db.prepare("SELECT data FROM meta WHERE id='state'").get()?.data));
  const setState=(patch:Record<string,unknown>)=>sql.exec('UPDATE meta SET data=? WHERE id=?',JSON.stringify({...state(),...patch}),'state');
  return {study,db,sql,ctx,env,prior,state,setState};
}

function response(text:string,status='completed'):Response{return Response.json({id:'test-response',model:'gpt-5.6-luna',status,usage:{input_tokens:100,output_tokens:30},output:[{type:'message',content:[{type:'output_text',text}]}]});}
function reply(init?:RequestInit):Response{
  const prompt=JSON.parse(String(init?.body)).input[0].content as string;
  const candidate=prompt.includes('coin-tracking')?{mask:15,invert:false,rendering:'plain'}:{a:1,b:0,trigger:{x:1,value:0},rendering:'alias'};
  return response(JSON.stringify({explanation:'Test policy',candidates:[candidate,candidate,candidate,candidate]}));
}

describe('002.2 durable successor: real SQLite, isolated checker, mocked paid API',()=>{
  beforeEach(()=>vi.stubGlobal('fetch',vi.fn(async(_url:string,init?:RequestInit)=>reply(init))));
  afterEach(()=>vi.unstubAllGlobals());
  it('waits for predecessor completion and snapshots the entire commitment before any paid call',async()=>{
    const h=harness();h.prior.status='running';await h.study.control('arm');await h.study.alarm();
    expect((await h.study.status()).status).toBe('waiting');expect(fetch).not.toHaveBeenCalled();
    h.prior.status='complete';await h.study.alarm();
    expect((await h.study.status()).status).toBe('running');expect(h.state().priorMicro).toBe(2500000);
    expect(h.db.prepare('SELECT COUNT(*) n FROM jobs').get()?.n).toBe(1044);expect(fetch).not.toHaveBeenCalled();
    await h.study.alarm();expect(fetch).toHaveBeenCalledTimes(8);
  });
  it('refuses a complete predecessor with unresolved or active reservations',async()=>{
    const h=harness();h.prior.budget.reservedUsd=.01;
    await expect(h.study.control('start')).rejects.toThrow('predecessor_unsettled');
    h.prior.budget.reservedUsd=0;h.prior.active.push({id:'pending'});
    await expect(h.study.control('start')).rejects.toThrow('predecessor_unsettled');expect(fetch).not.toHaveBeenCalled();
  });
  it('freezes while armed and rejects a source mismatch even before predecessor completion',async()=>{
    const h=harness();h.prior.status='running';await h.study.control('arm');
    expect(h.state().protocolHash).toMatch(/^[a-f0-9]{64}$/);
    h.setState({protocolHash:'tampered'});await h.study.alarm();
    expect(h.state().status).toBe('paused');expect(h.state().reason).toBe('frozen_protocol_changed');expect(fetch).not.toHaveBeenCalled();
  });
  it('requires the entire worst-case planned study and margin to fit before launch',async()=>{
    const h=harness();h.prior.budget.totalCommittedUsd=39;
    await expect(h.study.control('start')).rejects.toThrow('budget_pause');expect(fetch).not.toHaveBeenCalled();
    expect(preflight(2500000).maximumNewMicro).toBe(TOTAL_CALLS*MAX_CALL_MICRO);
    expect(TOTAL_CALLS*MAX_CALL_MICRO+BUDGET_MARGIN_MICRO+2500000).toBeLessThan(CAP_MICRO);
  });
  it('cannot start twice or replace the frozen prior after start',async()=>{
    const h=harness();await h.study.control('start');h.prior.budget.totalCommittedUsd=0;
    await expect(h.study.control('start')).rejects.toThrow('action_not_allowed');
    expect(h.state().priorMicro).toBe(2500000);
  });
  it('shares reservations atomically across eight calls',async()=>{
    const h=harness();await h.study.control('start');
    const plan=historyPlan().find(job=>job.id==='dev-backdoor-0/combined')!;
    const hold=reservation(promptFor(plan,[]));
    h.sql.exec('INSERT INTO calls(id,job_id,split,state,reserved,prompt,started) VALUES (?,?,?,?,?,?,?)','held','held','dev','unknown',CAP_MICRO-2500000-hold,'held',0);
    let release:()=>void=()=>undefined;
    vi.stubGlobal('fetch',vi.fn(async(_url:string,init?:RequestInit)=>{await new Promise<void>(resolve=>{release=resolve;});return reply(init);}));
    const running=h.study.alarm();await vi.waitFor(()=>expect(fetch).toHaveBeenCalledTimes(1));
    expect((await h.study.status()).budget.totalCommittedUsd).toBeLessThanOrEqual(40);
    release();await running;expect(fetch).toHaveBeenCalledTimes(1);expect(h.state().reason).toBe('budget_pause');
  });
  it('retains unknown calls and forbids ambiguous retries',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>{throw Error('upstream secret detail');}));
    const h=harness();await h.study.control('start');await h.study.alarm();
    expect(h.state().reason).toBe('unknown_api_outcome');expect((await h.study.status()).budget.reservedUsd).toBeGreaterThan(0);
    await h.study.watchdog();await h.study.alarm();expect(fetch).toHaveBeenCalledTimes(8);
    await expect(h.study.control('resume')).rejects.toThrow();expect(JSON.stringify(h.study.logs(0))).not.toContain('upstream secret');
  });
  it('consumes malformed outputs and fails only the development formatting gate, not an outcome gate',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>response('not JSON')));
    const h=harness();await h.study.control('start');
    for(let alarm=0;alarm<4;alarm++)await h.study.alarm();
    expect(fetch).toHaveBeenCalledTimes(20);expect(h.state().reason).toBe('operational_gate_failed');
    expect((await h.study.status()).budget.spentUsd).toBeGreaterThan(0);
  });
  it('advances all twenty format-valid development calls regardless of their policy quality',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>response(JSON.stringify({explanation:'Invalid candidates but valid API schema',candidates:[{},{},{},{}]}))));
    const h=harness();await h.study.control('start');for(let alarm=0;alarm<4;alarm++)await h.study.alarm();
    expect(h.state().stage).toBe('eval');expect(h.state().status).toBe('running');expect(fetch).toHaveBeenCalledTimes(20);
  });
  it('never exposes held-out prompts, replies, results, or final analysis before completion',()=>{
    const h=harness();h.sql.exec('INSERT INTO calls(id,job_id,split,state,reserved,prompt,response,started) VALUES (?,?,?,?,?,?,?,?)','sealed','sealed','eval','done',1,'SECRET EVAL','{"text":"SECRET EVAL"}',0);
    h.sql.exec('INSERT INTO jobs(id,split,step,state,history,result) VALUES (?,?,?,?,?,?)','sealed','eval',16,'done','[]','{"text":"SECRET EVAL"}');
    expect(JSON.stringify(h.study.logs(0))).not.toContain('SECRET');expect(JSON.stringify(h.study.results(0))).not.toContain('SECRET');
    expect(h.study.analysis()).toEqual({available:false,sealed:true,runId:'experiment-002-2-v1'});
  });
  it('drains in-flight work on pause, preserves billing, and resumes only owner pauses',async()=>{
    const releases:(()=>void)[]=[];vi.stubGlobal('fetch',vi.fn(async(_url:string,init?:RequestInit)=>{await new Promise<void>(resolve=>releases.push(resolve));return reply(init);}));
    const h=harness();await h.study.control('start');const running=h.study.alarm();await vi.waitFor(()=>expect(releases).toHaveLength(8));
    await h.study.control('pause');await expect(h.study.control('resume')).rejects.toThrow();releases.forEach(resolve=>resolve());await running;
    const before=await h.study.status();expect(before.active).toHaveLength(0);expect(before.nextWakeAt).toBeNull();
    await h.study.control('resume');expect((await h.study.status()).budget.spentUsd).toBe(before.budget.spentUsd);
  });
  it('rejects a changed protocol before any paid dispatch',async()=>{
    const h=harness();await h.study.control('start');h.setState({protocolHash:'tampered'});await h.study.alarm();
    expect(fetch).not.toHaveBeenCalled();expect(h.state().reason).toBe('frozen_protocol_changed');
  });
  it('pauses before its ledger soft limit',async()=>{
    const h=harness();await h.study.control('start');h.sql.databaseSize=STORAGE_LIMIT;await h.study.alarm();
    expect(fetch).not.toHaveBeenCalled();expect(h.state().reason).toBe('storage_pause');
  });
  it('uses a cached completed call after a checkpoint crash without duplicate billing',async()=>{
    const h=harness();await h.study.control('start');await h.study.alarm();
    h.sql.exec("UPDATE jobs SET step=0,state='pending',history='[]',result=NULL WHERE id=?",'dev-backdoor-0/combined');
    const restored=new FrontierStudy(h.ctx as never,h.env as never);await restored.alarm();expect(fetch).toHaveBeenCalledTimes(15);
  });
  it.each(['best','maximum-discovery'])('computes and caches the complete fixed 1024-history analysis (%s)',async(mode)=>{
    const h=harness();await h.study.control('start');h.setState({stage:'eval'});h.sql.exec("UPDATE jobs SET state='done' WHERE split='dev'");
    for(const plan of historyPlan().filter(job=>job.split==='eval')){
      const benchmark=benchmarkFor(plan),score=(point:typeof benchmark.points[number])=>point.humanOutcome+(plan.arm==='combined'?point.rCot:0);
      const chosen=[...benchmark.points].sort((a,b)=>score(b)-score(a))[0];
      const pointIds=mode==='best'?[chosen.id]:benchmark.points.slice(0,MAIN_STEPS*4).map(point=>point.id);
      const result:HistoryResult={id:plan.id,templateId:plan.templateId,domain:plan.domain,repeat:plan.repeat,arm:plan.arm,split:'eval',pointIds,validCandidates:MAIN_STEPS*4,steps:MAIN_STEPS,
        checkpoints:CHECKPOINTS.map(step=>({step,pointIds:pointIds.slice(0,step*4)}))};
      expect(policyCandidate(chosen,plan.domain)).toBeTruthy();
      h.sql.exec("UPDATE jobs SET state='done',step=?,result=? WHERE id=?",MAIN_STEPS,JSON.stringify(result),plan.id);
    }
    const started=performance.now();await h.study.alarm();console.info(`002.2 full cached final analysis: ${Math.round(performance.now()-started)} ms`);
    expect(h.state().status).toBe('complete');const report=h.study.analysis();
    const serializedBytes=new TextEncoder().encode(JSON.stringify(report)).length;
    console.info(`002.2 ${mode} report size: ${serializedBytes} bytes`);expect(serializedBytes).toBeLessThan(1_000_000);
    expect(JSON.stringify(report)).toContain('"available":true');
    h.sql.exec("UPDATE jobs SET result='{}' WHERE split='eval'");expect(h.study.analysis()).toEqual(report);expect(fetch).not.toHaveBeenCalled();
  },30000);
});
