import {DatabaseSync,type SQLInputValue} from 'node:sqlite';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {CompatibilityStudy,MAX_ACCOUNTED_FAILURES,RECOVERY_COOLDOWN_MS} from './recovery';
import checker from './sandbox/index';
import {buildCases} from './domain';
import {parseAttempt,promptFor,type Attempt} from './engine';
import {reservation,type Method} from './protocol';

vi.mock('./build',()=>({BUILD_HASH:'test-frozen-build'}));
function harness(){
  const db=new DatabaseSync(':memory:');let alarm:number|null=null;
  const sql={databaseSize:65536,exec(query:string,...args:SQLInputValue[]){
    if(query.trim().split(';').filter(Boolean).length>1){db.exec(query);return {toArray:()=>[],one:()=>({})};}
    const rows=db.prepare(query).all(...args);return {toArray:()=>rows,one:()=>{if(rows.length!==1)throw Error('Expected one row');return rows[0];}};
  }};
  const ctx={storage:{sql,setAlarm:async(value:number)=>{alarm=value;},getAlarm:async()=>alarm,deleteAlarm:async()=>{alarm=null;},transactionSync:<T>(callback:()=>T):T=>{
    db.exec('BEGIN');try{const result=callback();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}
  }}};
  const env={OPENAI_API_KEY:'test-never-network',ADMIN_TOKEN:'test-owner',CHECKER:{fetch:async(url:string,init:RequestInit)=>checker.fetch(new Request(url,init))}};
  const study=new CompatibilityStudy(ctx as never,env as never);
  const state=()=>JSON.parse(String(db.prepare("SELECT data FROM meta WHERE id='state'").get()?.data));
  const setState=(patch:Record<string,unknown>)=>sql.exec('UPDATE meta SET data=? WHERE id=?',JSON.stringify({...state(),...patch}),'state');
  function failed(method:Method='description',step=0,caseIndex=0){
    const studyCase=buildCases('dev')[caseIndex],jobId=`${studyCase.id}/${method}`,id=`${jobId}/${step}`;
    const history:Attempt[]=Array.from({length:step},(_,index)=>parseAttempt(studyCase,method,index,''));
    const prompt=promptFor(studyCase,method,history),held=reservation(prompt);
    sql.exec("UPDATE jobs SET step=?,history=? WHERE id=?",step,JSON.stringify(history),jobId);
    sql.exec('INSERT INTO calls(id,job_id,split,state,reserved,prompt,error,started) VALUES (?,?,?,?,?,?,?,?)',id,jobId,'dev','unknown',held,prompt,'openai_http_503',0);
    setState({status:'paused',reason:'openai_http_503',leaseUntil:0,updatedAt:new Date(Date.now()-RECOVERY_COOLDOWN_MS-1000).toISOString()});
    return {id,jobId,history,held,prompt};
  }
  return {study,db,sql,ctx,state,setState,failed};
}

describe('002.1 frozen-study operational recovery adapter',()=>{
  beforeEach(()=>vi.stubGlobal('fetch',vi.fn(async()=>{throw Error('No paid calls in recovery tests');})));
  afterEach(()=>vi.unstubAllGlobals());
  it('consumes a failed final slot as an abstention with conservative billing and unchanged fingerprint',async()=>{
    const h=harness();await h.study.control('start');const frozen=h.state().protocolHash;
    const failed=h.failed();const before=await h.study.status();await h.study.control('account-failed');
    const call=h.db.prepare('SELECT * FROM calls WHERE id=?').get(failed.id);
    expect(call).toMatchObject({state:'failed-accounted',charged:failed.held,reserved:failed.held,response:null,error:'openai_http_503',parsed:0,prompt:failed.prompt});
    const job=h.db.prepare('SELECT * FROM jobs WHERE id=?').get(failed.jobId);
    expect(job).toMatchObject({step:1,state:'done'});
    expect(JSON.parse(String(job?.result))).toMatchObject({predicted:'unresolved',parseable:0});
    const after=await h.study.status();expect(after.budget.totalCommittedUsd).toBe(before.budget.totalCommittedUsd);
    expect(after.budget.knownSpendUsd).toBe(0);expect(after.budget.uncertainChargeUpperBoundUsd).toBe(failed.held/1e6);
    expect(after.budget.spentIsUpperBound).toBe(true);expect(after.budget.reservedUsd).toBe(0);
    expect(h.state().protocolHash).toBe(frozen);expect(h.state().status).toBe('running');expect(await h.ctx.storage.getAlarm()).toBeGreaterThan(Date.now());
    const event=JSON.parse(String(h.db.prepare("SELECT data FROM events WHERE type='failed_calls_accounted'").get()?.data));
    expect(event.protocolHash).toBe(frozen);expect(event.calls[0].id).toBe(failed.id);expect(fetch).not.toHaveBeenCalled();
    await expect(h.study.control('account-failed')).rejects.toThrow('recovery_not_allowed');
  });
  it('preserves all previous attempts and advances exactly one unfinished search step',async()=>{
    const h=harness();await h.study.control('start');const failed=h.failed('guided',2);await h.study.control('account-failed');
    const job=h.db.prepare('SELECT * FROM jobs WHERE id=?').get(failed.jobId);
    expect(job).toMatchObject({step:3,state:'pending',result:null});
    const history=JSON.parse(String(job?.history));expect(history.slice(0,2)).toEqual(failed.history);
    expect(history[2]).toMatchObject({step:2,parsed:false,verdict:'unresolved',candidates:[]});
  });
  it.each(['lease','inflight','network','http429','changed-hash','wrong-step','wrong-prompt','response','charged','no-unknown'])('rejects unsafe recovery: %s',async(condition)=>{
    const h=harness();await h.study.control('start');const failed=h.failed();
    if(condition==='lease')h.setState({leaseUntil:Date.now()+10000});
    if(condition==='inflight')h.sql.exec("UPDATE calls SET state='inflight' WHERE id=?",failed.id);
    if(condition==='network')h.sql.exec("UPDATE calls SET error='unknown_api_outcome' WHERE id=?",failed.id);
    if(condition==='http429'){h.sql.exec("UPDATE calls SET error='openai_http_429' WHERE id=?",failed.id);h.setState({reason:'openai_http_429'});}
    if(condition==='changed-hash')h.setState({protocolHash:'tampered'});
    if(condition==='wrong-step')h.sql.exec('UPDATE jobs SET step=1 WHERE id=?',failed.jobId);
    if(condition==='wrong-prompt')h.sql.exec("UPDATE calls SET prompt='not the frozen prompt' WHERE id=?",failed.id);
    if(condition==='response')h.sql.exec("UPDATE calls SET response='{}' WHERE id=?",failed.id);
    if(condition==='charged')h.sql.exec('UPDATE calls SET charged=1 WHERE id=?',failed.id);
    if(condition==='no-unknown')h.sql.exec("UPDATE calls SET state='done' WHERE id=?",failed.id);
    await expect(h.study.control('account-failed')).rejects.toThrow();expect(h.state().status).toBe('paused');
    expect(h.db.prepare("SELECT COUNT(*) n FROM calls WHERE state='failed-accounted'").get()?.n).toBe(0);expect(fetch).not.toHaveBeenCalled();
  });
  it('rolls back the whole batch when another unknown call is inconsistent',async()=>{
    const h=harness();await h.study.control('start');const first=h.failed('description',0,0),second=h.failed('description',0,1);
    h.sql.exec("UPDATE calls SET prompt='bad prompt' WHERE id=?",second.id);
    await expect(h.study.control('account-failed')).rejects.toThrow('recovery_history_inconsistent');
    expect(h.db.prepare('SELECT state FROM calls WHERE id=?').get(first.id)?.state).toBe('unknown');
    expect(h.db.prepare('SELECT step FROM jobs WHERE id=?').get(first.jobId)?.step).toBe(0);
  });
  it('automatically accounts explicit server failures only after the cooldown',async()=>{
    const h=harness();await h.study.control('start');h.failed();h.setState({updatedAt:new Date().toISOString()});
    await h.study.watchdog();expect(h.state().status).toBe('paused');
    h.setState({updatedAt:new Date(Date.now()-RECOVERY_COOLDOWN_MS-1000).toISOString()});
    await h.study.watchdog();expect(h.state().status).toBe('running');expect(fetch).not.toHaveBeenCalled();
  });
  it('caps total accounted failures at five and leaves other failures paused',async()=>{
    const h=harness();await h.study.control('start');
    for(let index=0;index<MAX_ACCOUNTED_FAILURES;index++){h.failed('description',0,index);await h.study.watchdog();expect(h.state().status).toBe('running');}
    h.failed('description',0,MAX_ACCOUNTED_FAILURES);await h.study.watchdog();expect(h.state().status).toBe('paused');
    await expect(h.study.control('account-failed')).rejects.toThrow('recovery_failure_cap');
    expect((await h.study.status()).budget.failedAccountedCalls).toBe(MAX_ACCOUNTED_FAILURES);expect(fetch).not.toHaveBeenCalled();
  });
});
