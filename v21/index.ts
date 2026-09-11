import { DurableObject } from 'cloudflare:workers';
import { requestModel, type ApiResult } from '../src/api';
import { mapConcurrent } from '../src/operations';
import { buildCases, evaluateProgram, INTEGER_DOMAIN, type StudyCase } from './domain';
import { runIsolationSelfTest } from './sandbox/self-test';
import type { Program } from './sandbox/index';
import { analyzeClassification, type ClassificationRow } from './analysis';
import { BUILD_HASH } from './build';
import { promptFor, parseAttempt, resultFor, type Attempt } from './engine';
import { RUN_ID, VERSION, MODEL, PRIOR_MICRO, CAP_MICRO, CONCURRENCY, MAX_OUTPUT, MAX_PROMPT_BYTES, STORAGE_LIMIT, METHODS, stepsFor, PROTOCOL, reservation, assertBudget, type Method } from './protocol';

type Bindings = { STUDY21: DurableObjectNamespace<CompatibilityStudy>; CHECKER: Fetcher; OPENAI_API_KEY: string; ADMIN_TOKEN: string };
type State = { status: 'ready'|'running'|'paused'|'complete'; stage: 'dev'|'eval'; reason: string|null; startedAt: string|null; updatedAt: string; leaseUntil: number; protocolHash: string|null; gate: unknown; isolation: unknown };
type Job = { id: string; case_id: string; split: 'dev'|'eval'; method: Method; step: number; state: string; history: string; result: string|null };
type Call = { id: string; job_id: string; split: string; state: string; reserved: number; charged: number; prompt: string; response: string|null; error: string|null; started: number; parsed: number|null };
const now = () => new Date().toISOString();
const initial = (): State => ({status:'ready',stage:'dev',reason:null,startedAt:null,updatedAt:now(),leaseUntil:0,protocolHash:null,gate:null,isolation:null});
const byteLength = (s: string) => new TextEncoder().encode(s).length;
const bounded = (x: unknown) => {const s=JSON.stringify(x);if(byteLength(s)>128_000)throw Error('record_limit');return s;};
const allCases = () => [...buildCases('dev'), ...buildCases('eval')];
async function digest(s: string) {return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),x=>x.toString(16).padStart(2,'0')).join('');}
export class CompatibilityStudy extends DurableObject<Bindings> {
  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx,env);
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS meta(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,case_id TEXT NOT NULL,split TEXT NOT NULL,method TEXT NOT NULL,step INTEGER NOT NULL,state TEXT NOT NULL,history TEXT NOT NULL,result TEXT);
      CREATE INDEX IF NOT EXISTS pending_jobs ON jobs(split,state,id);
      CREATE TABLE IF NOT EXISTS calls(id TEXT PRIMARY KEY,job_id TEXT NOT NULL,split TEXT NOT NULL,state TEXT NOT NULL,reserved INTEGER NOT NULL,charged INTEGER NOT NULL DEFAULT 0,prompt TEXT NOT NULL,response TEXT,error TEXT,started INTEGER NOT NULL,parsed INTEGER);
      CREATE INDEX IF NOT EXISTS public_calls ON calls(split,started DESC,id DESC);
      CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,time TEXT NOT NULL,type TEXT NOT NULL,data TEXT NOT NULL);`);
    if(!ctx.storage.sql.exec('SELECT id FROM meta WHERE id=?','state').toArray().length)this.save(initial());
  }
  private read(): State {return JSON.parse(this.ctx.storage.sql.exec<{data:string}>('SELECT data FROM meta WHERE id=?','state').one().data);}
  private save(s: State){s.updatedAt=now();this.ctx.storage.sql.exec('INSERT OR REPLACE INTO meta(id,data) VALUES (?,?)','state',bounded(s));}
  private event(type:string,data:unknown){this.ctx.storage.sql.exec('INSERT INTO events(time,type,data) VALUES (?,?,?)',now(),type,bounded(data));}
  private budget(){return this.ctx.storage.sql.exec<{charged:number;held:number;calls:number}>("SELECT COALESCE(SUM(charged),0) charged,COALESCE(SUM(CASE WHEN state IN ('inflight','unknown') THEN reserved ELSE 0 END),0) held,COUNT(*) calls FROM calls").one();}
  async status(){
    const s=this.read(),b=this.budget();
    const counts=this.ctx.storage.sql.exec<{split:string;done:number;total:number}>('SELECT split,SUM(CASE WHEN state=\'done\' THEN 1 ELSE 0 END) done,COUNT(*) total FROM jobs GROUP BY split').toArray();
    const active=this.ctx.storage.sql.exec<{id:string;started:number}>('SELECT id,started FROM calls WHERE state=?','inflight').toArray();
    const calls=this.ctx.storage.sql.exec<{done:number;total:number}>("SELECT SUM(step) done,SUM(CASE WHEN method='description' THEN 1 ELSE 4 END) total FROM jobs").one();
    const elapsed=s.startedAt?(Date.now()-Date.parse(s.startedAt))/1000:0;
    const eta=s.status==='running'&&calls.done>=16?Math.ceil(elapsed/calls.done*(calls.total-calls.done)):null;
    return {runId:RUN_ID,version:VERSION,title:'Finite reward compatibility',model:MODEL,...s,progress:{cases:counts,callsDone:calls.done??0,callsTotal:calls.total??3600},etaSeconds:eta,
      budget:{spentUsd:b.charged/1e6,reservedUsd:b.held/1e6,priorCommittedUsd:PRIOR_MICRO/1e6,totalCommittedUsd:(PRIOR_MICRO+b.charged+b.held)/1e6,capUsd:40,calls:b.calls},
      execution:{concurrency:CONCURRENCY},ledger:{storageBytes:this.ctx.storage.sql.databaseSize,softLimitBytes:STORAGE_LIMIT},active,nextWakeAt:await this.ctx.storage.getAlarm(),evaluationSealed:s.status!=='complete',
      recent:this.ctx.storage.sql.exec<{time:string;type:string;data:string}>('SELECT time,type,data FROM events ORDER BY id DESC LIMIT 8').toArray().map(x=>({...x,data:JSON.parse(x.data)}))};
  }
  logs(offset:number){const sealed=this.read().status!=='complete';const rows=this.ctx.storage.sql.exec<Call>(`SELECT * FROM calls ${sealed?"WHERE split='dev'":''} ORDER BY started DESC,id DESC LIMIT 5 OFFSET ?`,offset).toArray();return {sealed,next:rows.length===5?offset+5:null,calls:rows.map(x=>({...x,response:x.response?JSON.parse(x.response):null}))};}
  results(offset:number){const sealed=this.read().status!=='complete';const rows=this.ctx.storage.sql.exec<{result:string}>(`SELECT result FROM jobs WHERE state='done' ${sealed?"AND split='dev'":''} ORDER BY id LIMIT 5 OFFSET ?`,offset).toArray();return {sealed,next:rows.length===5?offset+5:null,results:rows.map(x=>JSON.parse(x.result))};}
  async control(action:string){
    let s=this.read();
    if(action==='pause'&&s.status==='running'){s.status='paused';s.reason='owner_pause';this.save(s);await this.ctx.storage.deleteAlarm();return this.status();}
    if(action==='resume'&&s.status==='paused'&&s.reason==='owner_pause'&&s.leaseUntil<Date.now()){s.status='running';s.reason=null;this.save(s);await this.ctx.storage.setAlarm(Date.now()+1000);return this.status();}
    if(action!=='start'||s.status!=='ready')throw Error('action_not_allowed');
    if(!this.env.OPENAI_API_KEY)throw Error('missing_key');
    const isolation=await runIsolationSelfTest(this.env.CHECKER);
    if(!isolation.passed)throw Error('isolation_check_failed');
    if(BUILD_HASH==='UNFROZEN')throw Error('build_not_frozen');
    const cases=allCases();
    if(cases.filter(c=>c.split==='dev').length!==80||cases.filter(c=>c.split==='eval').length!==320||new Set(cases.map(c=>c.id)).size!==400)throw Error('case_plan_invalid');
    const protocolHash=await digest(JSON.stringify({protocol:PROTOCOL,cases,build:BUILD_HASH}));
    s=this.read();if(s.status!=='ready')throw Error('action_not_allowed');
    this.ctx.storage.transactionSync(()=>{
      for(const c of cases)for(const method of METHODS)this.ctx.storage.sql.exec('INSERT INTO jobs(id,case_id,split,method,step,state,history) VALUES (?,?,?,?,?,?,?)',`${c.id}/${method}`,c.id,c.split,method,0,'pending','[]');
      s.status='running';s.startedAt=now();s.isolation=isolation;s.protocolHash=protocolHash;this.save(s);this.event('protocol_frozen',{protocolHash,cases:400,capUsd:40,priorCommittedUsd:PRIOR_MICRO/1e6});
    });
    await this.ctx.storage.setAlarm(Date.now()+1000);return this.status();
  }
  private freezeBaseline(): void {
    if(this.ctx.storage.sql.exec('SELECT id FROM meta WHERE id=?','baseline').toArray().length)return;
    const rows=this.ctx.storage.sql.exec<{truth:string}>("SELECT json_extract(result,'$.truth') truth FROM jobs WHERE split='dev' AND method='description' AND state='done' ORDER BY id").toArray();
    if(rows.length!==80||rows.some(row=>!['compatible','conflict'].includes(row.truth)))throw Error('baseline_incomplete');
    const compatible=rows.filter(row=>row.truth==='compatible').length;
    this.ctx.storage.sql.exec('INSERT INTO meta(id,data) VALUES (?,?)','baseline',bounded({method:'dev-majority',predicted:compatible>=40?'compatible':'conflict',developmentCases:80,compatible,conflict:80-compatible,tieBreak:'compatible',frozenAt:now()}));
  }
  private calculateAnalysis(): void {
    if(this.ctx.storage.sql.exec('SELECT id FROM meta WHERE id=?','analysis').toArray().length)return;
    const baselineRow=this.ctx.storage.sql.exec<{data:string}>('SELECT data FROM meta WHERE id=?','baseline').toArray()[0];
    if(!baselineRow)throw Error('baseline_not_frozen');
    const baseline=JSON.parse(baselineRow.data) as {method:string;predicted:string;developmentCases:number;compatible:number;conflict:number;tieBreak:string;frozenAt:string};
    // Project only scalar analysis columns: never load all candidate histories into memory.
    const rows=this.ctx.storage.sql.exec<{caseId:string;templateId:string;domain:string;method:string;truth:string;predicted:string;certificate:'valid'|'invalid'|'none'}>(
      "SELECT case_id caseId,json_extract(result,'$.templateId') templateId,json_extract(result,'$.domain') domain,method,json_extract(result,'$.truth') truth,json_extract(result,'$.predicted') predicted,json_extract(result,'$.certificate') certificate FROM jobs WHERE split='eval' AND state='done' ORDER BY id").toArray();
    if(rows.length!==320*METHODS.length||new Set(rows.map(row=>row.caseId)).size!==320)throw Error('analysis_incomplete');
    const withBaseline:ClassificationRow[]=[...rows,...rows.filter(row=>row.method==='description').map(row=>({...row,method:baseline.method,predicted:baseline.predicted,certificate:'none' as const}))];
    const report={runId:RUN_ID,protocolHash:this.read().protocolHash,buildHash:BUILD_HASH,baseline,completedAt:now(),analysis:analyzeClassification(withBaseline)};
    this.ctx.storage.sql.exec('INSERT INTO meta(id,data) VALUES (?,?)','analysis',bounded(report));
  }
  analysis(): unknown {
    if(this.read().status!=='complete')return {available:false,sealed:true,runId:RUN_ID};
    const cached=this.ctx.storage.sql.exec<{data:string}>('SELECT data FROM meta WHERE id=?','analysis').toArray()[0];
    return cached?{available:true,sealed:false,...JSON.parse(cached.data)}:{available:false,sealed:false,reason:'analysis_not_cached',runId:RUN_ID};
  }
  private async call(job:Job,prompt:string):Promise<ApiResult>{
    const id=`${job.id}/${job.step}`,prev=this.ctx.storage.sql.exec<Call>('SELECT * FROM calls WHERE id=?',id).toArray()[0];
    if(prev){if(prev.prompt!==prompt)throw Error('protocol_mismatch');if(prev.state==='done'&&prev.response)return JSON.parse(prev.response);throw Error('ambiguous_prior_request');}
    if(this.read().status!=='running')throw Error('owner_pause');
    if(byteLength(prompt)>MAX_PROMPT_BYTES)throw Error('prompt_limit');
    if(this.ctx.storage.sql.databaseSize+8*128000>STORAGE_LIMIT)throw Error('storage_pause');
    const b=this.budget(),hold=reservation(prompt);assertBudget(b.charged,b.held,hold);
    this.ctx.storage.sql.exec('INSERT INTO calls(id,job_id,split,state,reserved,prompt,started) VALUES (?,?,?,?,?,?,?)',id,job.id,job.split,'inflight',hold,prompt,Date.now());
    let r:ApiResult;
    try{r=await requestModel(this.env.OPENAI_API_KEY,prompt,'none',MAX_OUTPUT);}
    catch(e){const code=e instanceof Error&&/^openai_http_\d+$/.test(e.message)?e.message:'unknown_api_outcome';this.ctx.storage.sql.exec('UPDATE calls SET state=?,error=? WHERE id=?','unknown',code,id);throw Error(code);}
    if(!Number.isSafeInteger(r.costMicro)||r.costMicro<0)throw Error('invalid_usage');
    this.ctx.storage.sql.exec('UPDATE calls SET state=?,charged=?,response=? WHERE id=?','done',r.costMicro,bounded(r),id);
    if(r.costMicro>hold)throw Error('usage_exceeded_reservation');
    if(r.model!==MODEL&&!r.model.startsWith(MODEL+'-'))throw Error('unexpected_model');
    return r;
  }
  private async advance(job:Job,c:StudyCase){
    const history:Attempt[]=JSON.parse(job.history);
    const response=await this.call(job,promptFor(c,job.method,history));
    const attempt=parseAttempt(c,job.method,job.step,response.status==='completed'?response.text:'');
    if(c.domain==='backdoor')for(const entry of attempt.candidates.filter(x=>x.check.valid)){
      const program=(entry.candidate as {program:Program}).program;
      const r=await this.env.CHECKER.fetch('https://checker.internal/execute',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({program,inputs:INTEGER_DOMAIN}),signal:AbortSignal.timeout(5000)});
      if(!r.ok)throw Error('checker_rejected_valid_candidate');
      const value=await r.json() as {outputs:unknown};
      if(JSON.stringify(value.outputs)!==JSON.stringify(INTEGER_DOMAIN.map(x=>evaluateProgram(program,x))))throw Error('checker_semantic_disagreement');
    }
    // Incomplete/invalid model outputs are recorded as abstentions, not retried or discarded.
    history.push(attempt);
    const done=job.step+1===stepsFor(job.method);
    const result=done?resultFor(c,job.method,history):null;
    this.ctx.storage.transactionSync(()=>{
      this.ctx.storage.sql.exec('UPDATE calls SET parsed=? WHERE id=?',Number(attempt.parsed),`${job.id}/${job.step}`);
      this.ctx.storage.sql.exec('UPDATE jobs SET step=?,state=?,history=?,result=? WHERE id=?',job.step+1,done?'done':'pending',bounded(history),result?bounded(result):null,job.id);
    });
  }
  private gate(){
    this.freezeBaseline();
    const b=this.budget();
    const p=this.ctx.storage.sql.exec<{n:number;valid:number;mean:number}>("SELECT COUNT(*) n,SUM(parsed) valid,AVG(charged) mean FROM calls WHERE split='dev'").one();
    const forecastMicro=Math.ceil(p.mean*2880*2);
    const pass=p.n===720&&p.valid/p.n>=.9&&PRIOR_MICRO+b.charged+b.held+forecastMicro+2_000_000<=CAP_MICRO;
    return {pass,calls:p.n,parseRate:p.valid/p.n,forecastUsd:forecastMicro/1e6,criteria:'Operational validity and budget only. Accuracy and significance do not control continuation.'};
  }
  async alarm(){
    let s=this.read();if(s.status!=='running'||s.leaseUntil>Date.now())return;
    s.leaseUntil=Date.now()+600000;this.save(s);
    try{
      if(s.protocolHash!==await digest(JSON.stringify({protocol:PROTOCOL,cases:allCases(),build:BUILD_HASH})))throw Error('frozen_protocol_changed');
      const jobs=this.ctx.storage.sql.exec<Job>("SELECT * FROM jobs WHERE split=? AND state='pending' ORDER BY step,id LIMIT ?",s.stage,CONCURRENCY).toArray();
      if(jobs.length){const cases=new Map(allCases().map(c=>[c.id,c]));await mapConcurrent(jobs,CONCURRENCY,async j=>{const c=cases.get(j.case_id);if(!c)throw Error('missing_case');await this.advance(j,c);});}
      else {
        s=this.read();
        if(s.stage==='dev'){s.gate=this.gate();if((s.gate as {pass:boolean}).pass){s.stage='eval';this.event('evaluation_started',{protocolHash:s.protocolHash,gate:s.gate});}else{s.status='paused';s.reason='operational_gate_failed';}}
        else{this.calculateAnalysis();s.status='complete';this.event('complete',{note:'Evaluation unsealed. Finite-domain validation only; all-three category stage is separate.'});}
        this.save(s);
      }
    }catch(e){s=this.read();s.status='paused';s.reason=e instanceof Error?e.message:'runner_error';this.save(s);this.event('paused',{reason:s.reason});}
    s=this.read();s.leaseUntil=0;this.save(s);if(s.status==='running')await this.ctx.storage.setAlarm(Date.now()+1500);else await this.ctx.storage.deleteAlarm();
  }
  async watchdog(){const s=this.read();if(s.status!=='running'||s.leaseUntil>Date.now())return;const alarm=await this.ctx.storage.getAlarm();if(!alarm||alarm<Date.now()-300000)await this.ctx.storage.setAlarm(Date.now()+1000);}
}
function json(value:unknown,status=200){return Response.json(value,{status,headers:{'access-control-allow-origin':'*','cache-control':'public,max-age=5'}});}
export default {
  async fetch(req:Request,env:Bindings){
    const u=new URL(req.url),study=env.STUDY21.get(env.STUDY21.idFromName(RUN_ID));
    if(req.method==='GET'){
      if(u.pathname==='/health')return json({ok:true,runId:RUN_ID});
      if(u.pathname==='/protocol')return json(PROTOCOL);
      if(u.pathname==='/status')return json(await study.status());
      if(u.pathname==='/analysis')return json(await study.analysis());
      const offset=Number(u.searchParams.get('offset')??0);if(!Number.isSafeInteger(offset)||offset<0||offset>100000)return json({error:'invalid_offset'},400);
      if(u.pathname==='/logs')return json(await study.logs(offset));
      if(u.pathname==='/results')return json(await study.results(offset));
    }
    if(req.method==='POST'&&u.pathname.startsWith('/admin/')){
      const token=req.headers.get('authorization')?.replace(/^Bearer /,'')??'';
      if(!token||!env.ADMIN_TOKEN||await digest(token)!==await digest(env.ADMIN_TOKEN))return json({error:'unauthorized'},401);
      try{return json(await study.control(u.pathname.slice(7)));}catch(e){return json({error:e instanceof Error?e.message:'control_failed'},409);}
    }
    return json({error:'not_found'},404);
  },
  async scheduled(_event:ScheduledController,env:Bindings){await env.STUDY21.get(env.STUDY21.idFromName(RUN_ID)).watchdog();},
} satisfies ExportedHandler<Bindings>;
