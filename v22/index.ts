import {DurableObject} from 'cloudflare:workers';
import {requestModel, boundedJson, type ApiResult} from '../src/api';
import {mapConcurrent} from '../src/operations';
import {runIsolationSelfTest} from '../v21/sandbox/self-test';
import {analyzeHistories, type HistoryResult} from './analysis';
import {policyCandidate} from './frontier';
import {promptFor, parseAttempt, resultFor, type Attempt} from './engine';
import {BUILD_HASH} from './build';
import {RUN_ID, PREVIOUS_RUN_ID, MODEL, VERSION, CAP_MICRO, CONCURRENCY, MAX_OUTPUT, MAX_PROMPT_BYTES, STORAGE_LIMIT, TOTAL_CALLS, MAIN_HISTORIES,
  PROTOCOL, historyPlan, benchmarkFor, reservation, assertBudget, preflight, type HistoryPlan, type Split} from './protocol';

interface Bindings {STUDY22:DurableObjectNamespace<FrontierStudy>;CHECKER:Fetcher;PREVIOUS:Fetcher;OPENAI_API_KEY:string;ADMIN_TOKEN:string}
interface State {status:'ready'|'waiting'|'running'|'paused'|'complete';stage:Split;reason:string|null;startedAt:string|null;updatedAt:string;leaseUntil:number;protocolHash:string|null;priorMicro:number|null;preflight:unknown;gate:unknown;isolation:unknown}
interface Job extends Record<string,SqlStorageValue> {id:string;split:Split;step:number;state:string;history:string;result:string|null}
interface Call extends Record<string,SqlStorageValue> {id:string;job_id:string;split:Split;state:string;reserved:number;charged:number;prompt:string;response:string|null;error:string|null;started:number;parsed:number|null}
const now=():string=>new Date().toISOString();
const bytes=(text:string):number=>new TextEncoder().encode(text).length;
const bounded=(value:unknown):string=>{const text=JSON.stringify(value);if(bytes(text)>128_000)throw Error('record_limit');return text;};
const boundedAnalysis=(value:unknown):string=>{const text=JSON.stringify(value);if(bytes(text)>1_000_000)throw Error('analysis_record_limit');return text;};
async function digest(text:string):Promise<string>{return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),value=>value.toString(16).padStart(2,'0')).join('');}
async function fingerprint():Promise<string>{return digest(JSON.stringify({protocol:PROTOCOL,plan:historyPlan(),build:BUILD_HASH}));}

export class FrontierStudy extends DurableObject<Bindings>{
  constructor(ctx:DurableObjectState,env:Bindings){
    super(ctx,env);
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS meta(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,split TEXT NOT NULL,step INTEGER NOT NULL,state TEXT NOT NULL,history TEXT NOT NULL,result TEXT);
      CREATE INDEX IF NOT EXISTS pending_jobs ON jobs(split,state,step,id);
      CREATE TABLE IF NOT EXISTS calls(id TEXT PRIMARY KEY,job_id TEXT NOT NULL,split TEXT NOT NULL,state TEXT NOT NULL,reserved INTEGER NOT NULL,charged INTEGER NOT NULL DEFAULT 0,prompt TEXT NOT NULL,response TEXT,error TEXT,started INTEGER NOT NULL,parsed INTEGER);
      CREATE INDEX IF NOT EXISTS public_calls ON calls(split,started DESC,id DESC);
      CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,time TEXT NOT NULL,type TEXT NOT NULL,data TEXT NOT NULL);`);
    if(!ctx.storage.sql.exec('SELECT id FROM meta WHERE id=?','state').toArray().length)this.save({status:'ready',stage:'dev',reason:null,startedAt:null,updatedAt:now(),leaseUntil:0,protocolHash:null,priorMicro:null,preflight:null,gate:null,isolation:null});
  }
  private read():State{return JSON.parse(this.ctx.storage.sql.exec<{data:string}>('SELECT data FROM meta WHERE id=?','state').one().data);}
  private save(state:State):void{state.updatedAt=now();this.ctx.storage.sql.exec('INSERT OR REPLACE INTO meta(id,data) VALUES (?,?)','state',bounded(state));}
  private event(type:string,data:unknown):void{this.ctx.storage.sql.exec('INSERT INTO events(time,type,data) VALUES (?,?,?)',now(),type,bounded(data));}
  private budget():{charged:number;held:number;calls:number}{return this.ctx.storage.sql.exec<{charged:number;held:number;calls:number}>("SELECT COALESCE(SUM(charged),0) charged,COALESCE(SUM(CASE WHEN state IN ('inflight','unknown') THEN reserved ELSE 0 END),0) held,COUNT(*) calls FROM calls").one();}
  async status(){
    const state=this.read(),budget=this.budget();
    const counts=this.ctx.storage.sql.exec<{split:string;done:number;total:number}>("SELECT split,SUM(CASE WHEN state='done' THEN 1 ELSE 0 END) done,COUNT(*) total FROM jobs GROUP BY split").toArray();
    const done=this.ctx.storage.sql.exec<{n:number}>('SELECT COALESCE(SUM(step),0) n FROM jobs').one().n;
    const elapsed=state.startedAt?(Date.now()-Date.parse(state.startedAt))/1000:0;
    return {runId:RUN_ID,version:VERSION,title:'Empirical finite reward frontiers',model:MODEL,...state,
      progress:{histories:counts,callsDone:done,callsTotal:TOTAL_CALLS},etaSeconds:state.status==='running'&&done>=20?Math.ceil(elapsed/done*(TOTAL_CALLS-done)):null,
      budget:{spentUsd:budget.charged/1e6,reservedUsd:budget.held/1e6,priorCommittedUsd:state.priorMicro===null?null:state.priorMicro/1e6,totalCommittedUsd:state.priorMicro===null?null:(state.priorMicro+budget.charged+budget.held)/1e6,capUsd:CAP_MICRO/1e6,calls:budget.calls},
      active:this.ctx.storage.sql.exec<{id:string;started:number}>("SELECT id,started FROM calls WHERE state='inflight'").toArray(),
      nextWakeAt:await this.ctx.storage.getAlarm(),evaluationSealed:state.status!=='complete',execution:{concurrency:CONCURRENCY},
      recent:this.ctx.storage.sql.exec<{time:string;type:string;data:string}>('SELECT time,type,data FROM events ORDER BY id DESC LIMIT 8').toArray().map(row=>({...row,data:JSON.parse(row.data)}))};
  }
  logs(offset:number){const sealed=this.read().status!=='complete';const rows=this.ctx.storage.sql.exec<Call>(`SELECT * FROM calls ${sealed?"WHERE split='dev'":''} ORDER BY started DESC,id DESC LIMIT 5 OFFSET ?`,offset).toArray();return {sealed,next:rows.length===5?offset+5:null,calls:rows.map(row=>({...row,response:row.response?JSON.parse(row.response):null}))};}
  results(offset:number){const sealed=this.read().status!=='complete';const rows=this.ctx.storage.sql.exec<{result:string}>(`SELECT result FROM jobs WHERE state='done' ${sealed?"AND split='dev'":''} ORDER BY id LIMIT 5 OFFSET ?`,offset).toArray();return {sealed,next:rows.length===5?offset+5:null,results:rows.map(row=>JSON.parse(row.result))};}
  analysis():unknown{if(this.read().status!=='complete')return {available:false,sealed:true,runId:RUN_ID};const row=this.ctx.storage.sql.exec<{data:string}>('SELECT data FROM meta WHERE id=?','analysis').toArray()[0];return row?{available:true,sealed:false,...JSON.parse(row.data)}:{available:false,sealed:false,reason:'analysis_not_cached'};}
  private async launch():Promise<boolean>{
    let state=this.read();if(!['ready','waiting'].includes(state.status))throw Error('action_not_allowed');
    if(BUILD_HASH==='UNFROZEN')throw Error('build_not_frozen');
    if(state.status==='waiting'&&state.protocolHash!==await fingerprint())throw Error('frozen_protocol_changed');
    if(!this.env.OPENAI_API_KEY)throw Error('missing_key');
    // Bound predecessor reads through the private service binding; do not trust a UI timer.
    const response=await this.env.PREVIOUS.fetch(new Request('https://previous/status',{signal:AbortSignal.timeout(10000)}));
    if(!response.ok)throw Error('predecessor_unavailable');
    const prior=await boundedJson(response) as {runId?:unknown;status?:unknown;active?:unknown;budget?:{reservedUsd?:unknown;totalCommittedUsd?:unknown;capUsd?:unknown}};
    if(prior.runId!==PREVIOUS_RUN_ID)throw Error('wrong_predecessor');
    if(prior.status!=='complete')return false;
    if(!Array.isArray(prior.active)||prior.active.length!==0||prior.budget?.reservedUsd!==0)throw Error('predecessor_unsettled');
    const total=prior.budget.totalCommittedUsd;
    if(typeof total!=='number'||!Number.isFinite(total)||total<0||prior.budget.capUsd!==40)throw Error('invalid_prior_budget');
    const priorMicro=Math.round(total*1e6),maximum=preflight(priorMicro);
    const isolation=await runIsolationSelfTest(this.env.CHECKER);if(!isolation.passed)throw Error('isolation_check_failed');
    const protocolHash=await fingerprint(),plan=historyPlan();
    if(plan.length!==20+MAIN_HISTORIES||plan.reduce((sum,job)=>sum+job.steps,0)!==TOTAL_CALLS)throw Error('plan_invalid');
    state=this.read();if(!['ready','waiting'].includes(state.status))throw Error('action_not_allowed');
    this.ctx.storage.transactionSync(()=>{
      for(const job of plan)this.ctx.storage.sql.exec('INSERT INTO jobs(id,split,step,state,history) VALUES (?,?,?,?,?)',job.id,job.split,0,'pending','[]');
      state.status='running';state.reason=null;state.startedAt=now();state.priorMicro=priorMicro;state.preflight=maximum;state.isolation=isolation;state.protocolHash=protocolHash;this.save(state);
      this.event('protocol_frozen',{protocolHash,buildHash:BUILD_HASH,priorMicro,preflight:maximum,calls:TOTAL_CALLS});
    });
    await this.ctx.storage.setAlarm(Date.now()+1000);return true;
  }
  async control(action:string){
    const state=this.read();
    if(action==='retry-config'){
      if(BUILD_HASH==='UNFROZEN')throw Error('build_not_frozen');
      if(!this.env.OPENAI_API_KEY)throw Error('missing_key');
      const protocolHash=await fingerprint();
      this.ctx.storage.transactionSync(()=>{
        const current=this.read();
        const jobs=this.ctx.storage.sql.exec<{n:number}>('SELECT COUNT(*) n FROM jobs').one().n;
        const calls=this.ctx.storage.sql.exec<{n:number}>('SELECT COUNT(*) n FROM calls').one().n;
        if(current.status!=='paused'||current.reason!=='missing_key'||current.priorMicro!==null||current.startedAt!==null||jobs!==0||calls!==0||current.leaseUntil>Date.now())throw Error('config_recovery_not_allowed');
        const previousProtocolHash=current.protocolHash;
        current.protocolHash=protocolHash;current.status='waiting';current.reason='waiting_for_002_1_completion';this.save(current);
        this.event('pre_run_config_recovered',{previousProtocolHash,protocolHash,buildHash:BUILD_HASH,reason:'missing_key',jobs:0,calls:0,note:'Configuration-only pre-run amendment; no study data or scientific protocol changed.'});
      });
      await this.ctx.storage.setAlarm(Date.now()+1000);return this.status();
    }
    if(action==='arm'&&state.status==='ready'){
      if(BUILD_HASH==='UNFROZEN')throw Error('build_not_frozen');
      const protocolHash=await fingerprint();if(this.read().status!=='ready')throw Error('action_not_allowed');
      state.protocolHash=protocolHash;state.status='waiting';state.reason='waiting_for_002_1_completion';this.save(state);
      this.event('protocol_armed',{protocolHash,buildHash:BUILD_HASH});await this.ctx.storage.setAlarm(Date.now()+1000);return this.status();
    }
    if(action==='start'){if(!await this.launch())throw Error('predecessor_not_complete');return this.status();}
    if(action==='pause'&&(state.status==='running'||state.status==='waiting')){state.status='paused';state.reason=state.priorMicro===null?'owner_pause_waiting':'owner_pause';this.save(state);await this.ctx.storage.deleteAlarm();return this.status();}
    if(action==='resume'&&state.status==='paused'&&['owner_pause','owner_pause_waiting'].includes(state.reason??'')&&state.leaseUntil<Date.now()){
      state.status=state.priorMicro===null?'waiting':'running';state.reason=null;this.save(state);await this.ctx.storage.setAlarm(Date.now()+1000);return this.status();
    }
    throw Error('action_not_allowed');
  }
  private async call(job:Job,prompt:string):Promise<ApiResult>{
    const id=`${job.id}/${job.step}`,previous=this.ctx.storage.sql.exec<Call>('SELECT * FROM calls WHERE id=?',id).toArray()[0];
    if(previous){if(previous.prompt!==prompt)throw Error('protocol_mismatch');if(previous.state==='done'&&previous.response)return JSON.parse(previous.response);throw Error('ambiguous_prior_request');}
    const state=this.read();if(state.status!=='running'||state.priorMicro===null)throw Error('owner_pause');
    if(bytes(prompt)>MAX_PROMPT_BYTES)throw Error('prompt_limit');
    if(this.ctx.storage.sql.databaseSize+CONCURRENCY*128000>STORAGE_LIMIT)throw Error('storage_pause');
    const budget=this.budget(),hold=reservation(prompt);assertBudget(state.priorMicro,budget.charged,budget.held,hold);
    // Synchronous reservation precedes every external await; concurrent calls share this same row ledger.
    this.ctx.storage.sql.exec('INSERT INTO calls(id,job_id,split,state,reserved,prompt,started) VALUES (?,?,?,?,?,?,?)',id,job.id,job.split,'inflight',hold,prompt,Date.now());
    let result:ApiResult;
    try{result=await requestModel(this.env.OPENAI_API_KEY,prompt,'none',MAX_OUTPUT);}
    catch(error){const reason=error instanceof Error&&/^openai_http_\d+$/.test(error.message)?error.message:'unknown_api_outcome';this.ctx.storage.sql.exec('UPDATE calls SET state=?,error=? WHERE id=?','unknown',reason,id);throw Error(reason);}
    if(!Number.isSafeInteger(result.costMicro)||result.costMicro<0)throw Error('invalid_usage');
    this.ctx.storage.sql.exec('UPDATE calls SET state=?,charged=?,response=? WHERE id=?','done',result.costMicro,bounded(result),id);
    if(result.costMicro>hold)throw Error('usage_exceeded_reservation');
    if(result.model!==MODEL&&!result.model.startsWith(MODEL+'-'))throw Error('unexpected_model');
    return result;
  }
  private async advance(job:Job,plan:HistoryPlan):Promise<void>{
    const history:Attempt[]=JSON.parse(job.history),response=await this.call(job,promptFor(plan,history));
    const attempt=parseAttempt(plan,job.step,response.status==='completed'?response.text:'');
    if(plan.domain==='backdoor'){
      const benchmark=benchmarkFor(plan);
      for(const candidate of attempt.candidates){
        if(!candidate.pointId)continue;
        const point=benchmark.points.find(value=>value.id===candidate.pointId)!;
        const policy=policyCandidate(point,'backdoor');if(!('a' in policy))throw Error('checker_schema_disagreement');
        const program={a:policy.a,b:policy.b,...(policy.trigger?{trigger:policy.trigger}:{})};
        const checked=await this.env.CHECKER.fetch(new Request('https://checker/execute',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({program,inputs:[-2,-1,0,1,2]}),signal:AbortSignal.timeout(5000)}));
        if(!checked.ok)throw Error('checker_rejected_policy');
        const output=await boundedJson(checked) as {outputs?:unknown};if(JSON.stringify(output.outputs)!==JSON.stringify(point.outputs))throw Error('checker_semantic_disagreement');
      }
    }
    history.push(attempt);const done=job.step+1===plan.steps,result=done?resultFor(plan,history):null;
    this.ctx.storage.transactionSync(()=>{
      this.ctx.storage.sql.exec('UPDATE calls SET parsed=? WHERE id=?',Number(attempt.parsed),`${job.id}/${job.step}`);
      this.ctx.storage.sql.exec('UPDATE jobs SET step=?,state=?,history=?,result=? WHERE id=?',job.step+1,done?'done':'pending',bounded(history),result?bounded(result):null,job.id);
    });
  }
  private calculateAnalysis():void{
    if(this.ctx.storage.sql.exec('SELECT id FROM meta WHERE id=?','analysis').toArray().length)return;
    const rows=this.ctx.storage.sql.exec<{result:string}>("SELECT result FROM jobs WHERE split='eval' AND state='done' ORDER BY id").toArray();
    if(rows.length!==MAIN_HISTORIES)throw Error('analysis_incomplete');
    const results=rows.map(row=>JSON.parse(row.result) as HistoryResult);
    const report={runId:RUN_ID,protocolHash:this.read().protocolHash,buildHash:BUILD_HASH,completedAt:now(),analysis:analyzeHistories(results)};
    this.ctx.storage.sql.exec('INSERT INTO meta(id,data) VALUES (?,?)','analysis',boundedAnalysis(report));
  }
  async alarm():Promise<void>{
    let state=this.read();
    if(state.status==='waiting'){
      try{if(!await this.launch())await this.ctx.storage.setAlarm(Date.now()+60000);}
      catch(error){state=this.read();state.status='paused';state.reason=error instanceof Error?error.message:'launch_error';this.save(state);this.event('paused',{reason:state.reason});await this.ctx.storage.deleteAlarm();}
      return;
    }
    if(state.status!=='running'||state.leaseUntil>Date.now())return;
    state.leaseUntil=Date.now()+600000;this.save(state);
    try{
      if(state.protocolHash!==await fingerprint())throw Error('frozen_protocol_changed');
      const jobs=this.ctx.storage.sql.exec<Job>("SELECT * FROM jobs WHERE split=? AND state='pending' ORDER BY step,id LIMIT ?",state.stage,CONCURRENCY).toArray();
      if(jobs.length){const plans=new Map(historyPlan().map(plan=>[plan.id,plan]));await mapConcurrent(jobs,CONCURRENCY,async job=>{const plan=plans.get(job.id);if(!plan)throw Error('missing_history');await this.advance(job,plan);});}
      else{
        state=this.read();
        if(state.stage==='dev'){
          const gate=this.ctx.storage.sql.exec<{n:number;valid:number}>("SELECT COUNT(*) n,SUM(parsed) valid FROM calls WHERE split='dev'").one();
          const pass=gate.n===20&&gate.valid>=18;state.gate={pass,calls:gate.n,parseable:gate.valid,criterion:'At least 18/20 schema-valid; no accuracy or significance gate.'};
          if(pass){state.stage='eval';this.event('evaluation_started',{protocolHash:state.protocolHash,gate:state.gate});}else{state.status='paused';state.reason='operational_gate_failed';}
        }else{this.calculateAnalysis();state.status='complete';this.event('complete',{note:'Fixed final evaluation complete; empirical finite-policy scope only.'});}
        this.save(state);
      }
    }catch(error){state=this.read();state.status='paused';state.reason=error instanceof Error?error.message:'runner_error';this.save(state);this.event('paused',{reason:state.reason});}
    state=this.read();state.leaseUntil=0;this.save(state);if(state.status==='running')await this.ctx.storage.setAlarm(Date.now()+1500);else await this.ctx.storage.deleteAlarm();
  }
  async watchdog():Promise<void>{const state=this.read();if(!['running','waiting'].includes(state.status)||state.leaseUntil>Date.now())return;const alarm=await this.ctx.storage.getAlarm();if(!alarm||alarm<Date.now()-300000)await this.ctx.storage.setAlarm(Date.now()+1000);}
}
function json(value:unknown,status=200):Response{return Response.json(value,{status,headers:{'access-control-allow-origin':'*','cache-control':'public,max-age=5'}});}
export default{
  async fetch(request:Request,env:Bindings):Promise<Response>{
    const url=new URL(request.url),study=env.STUDY22.get(env.STUDY22.idFromName(RUN_ID));
    if(request.method==='GET'){
      if(url.pathname==='/health')return json({ok:true,runId:RUN_ID});
      if(url.pathname==='/protocol')return json(PROTOCOL);
      if(url.pathname==='/status')return json(await study.status());
      if(url.pathname==='/analysis')return json(await study.analysis());
      const offset=Number(url.searchParams.get('offset')??0);if(!Number.isSafeInteger(offset)||offset<0||offset>100000)return json({error:'invalid_offset'},400);
      if(url.pathname==='/logs')return json(await study.logs(offset));
      if(url.pathname==='/results')return json(await study.results(offset));
    }
    if(request.method==='POST'&&url.pathname.startsWith('/admin/')){
      const token=request.headers.get('authorization')?.replace(/^Bearer /,'')??'';
      if(!token||!env.ADMIN_TOKEN||await digest(token)!==await digest(env.ADMIN_TOKEN))return json({error:'unauthorized'},401);
      try{return json(await study.control(url.pathname.slice(7)));}catch(error){return json({error:error instanceof Error?error.message:'control_failed'},409);}
    }
    return json({error:'not_found'},404);
  },
  async scheduled(_event:ScheduledController,env:Bindings):Promise<void>{await env.STUDY22.get(env.STUDY22.idFromName(RUN_ID)).watchdog();},
} satisfies ExportedHandler<Bindings>;
