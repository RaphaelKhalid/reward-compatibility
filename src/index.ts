import {DurableObject} from 'cloudflare:workers';
import {VERSION,RUN_ID,MODEL,CAP_MICRO,GATE_MICRO,CONFIGS,gatePlan,mainPlan,reservationMicro,updateBuffer,configFor,maximum,type Unit,type UnitResult,type Replay} from './protocol';
import {requestModel,type ApiResult} from './api';
import {executeUnit,evaluateGate} from './engine';
import {analyze} from './analysis';

type StudyEnv=Env & {OPENAI_API_KEY:string;ADMIN_TOKEN:string};
interface State {status:'ready'|'running'|'paused'|'complete';stage:'gate'|'main';cursor:number;startedAt:string|null;updatedAt:string;reason:string|null;leaseUntil:number;gate:ReturnType<typeof evaluateGate>|null;forecastUsd:number|null;}
type CallRow = {id:string;unit_id:string;sealed:number;state:string;prompt:string;effort:string;reserved:number;charged:number;result:string|null;error:string|null;started:number;};
const NOW=()=>new Date().toISOString();
const initial=():State=>({status:'ready',stage:'gate',cursor:0,startedAt:null,updatedAt:NOW(),reason:null,leaseUntil:0,gate:null,forecastUsd:null});
export class RewardStudy extends DurableObject<StudyEnv> {
  constructor(ctx:DurableObjectState,env:StudyEnv) {
    super(ctx,env);
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS meta (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS calls (id TEXT PRIMARY KEY, unit_id TEXT NOT NULL, sealed INTEGER NOT NULL, state TEXT NOT NULL, prompt TEXT NOT NULL, effort TEXT NOT NULL, reserved INTEGER NOT NULL, charged INTEGER NOT NULL DEFAULT 0, result TEXT, error TEXT, started INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS results (id TEXT PRIMARY KEY, position INTEGER NOT NULL, phase TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, time TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS calls_unit ON calls(unit_id);`);
    if(!this.ctx.storage.sql.exec('SELECT id FROM meta WHERE id=?','state').toArray().length) this.save(initial());
  }
  private state():State {return JSON.parse(this.ctx.storage.sql.exec<{data:string}>('SELECT data FROM meta WHERE id=?','state').one().data);}
  private save(s:State) {s.updatedAt=NOW();this.ctx.storage.sql.exec('INSERT OR REPLACE INTO meta (id,data) VALUES (?,?)','state',JSON.stringify(s));}
  private event(type:string,data:unknown) {this.ctx.storage.sql.exec('INSERT INTO events(time,type,data) VALUES (?,?,?)',NOW(),type,JSON.stringify(data));}
  private budget() {return this.ctx.storage.sql.exec<{charged:number;held:number;calls:number}>(`SELECT COALESCE(SUM(charged),0) AS charged, COALESCE(SUM(CASE WHEN state IN ('inflight','unknown','error') THEN reserved ELSE 0 END),0) AS held, COUNT(*) AS calls FROM calls`).one();}
  private storedResults(sealed=false):UnitResult[] {return this.ctx.storage.sql.exec<{data:string}>(`SELECT data FROM results ${sealed?'':"WHERE phase NOT IN ('baseline','evaluation')"} ORDER BY position`).toArray().map(x=>JSON.parse(x.data));}
  private plan(s:State) {return s.stage==='gate'?gatePlan():mainPlan();}
  private history(u:Unit):Replay[] {
    const key=`replay-${u.config}-${u.condition}-${u.repeat}`;
    const row=this.ctx.storage.sql.exec<{data:string}>('SELECT data FROM meta WHERE id=?',key).toArray()[0];return row?JSON.parse(row.data):[];
  }
  async status() {
    const s=this.state(),b=this.budget(),plan=this.plan(s),current=plan[s.cursor];
    const recent=this.ctx.storage.sql.exec<{id:number;time:string;type:string;data:string}>('SELECT * FROM events ORDER BY id DESC LIMIT 12').toArray().map(x=>({...x,data:JSON.parse(x.data)}));
    const active=this.ctx.storage.sql.exec<{id:string;effort:string;started:number}>('SELECT id,effort,started FROM calls WHERE state=?','inflight').toArray();
    return {runId:RUN_ID,version:VERSION,title:'Measuring reward compatibility',model:MODEL,...s,progress:{done:s.cursor,total:plan.length,current:current?{id:current.id,phase:current.phase,kind:current.kind}:null},budget:{spentUsd:b.charged/1e6,reservedUsd:b.held/1e6,capUsd:40,stageCapUsd:s.stage==='gate'?4:40,calls:b.calls},active,recent,nextWakeAt:await this.ctx.storage.getAlarm(),evaluationSealed:s.status!=='complete'};
  }
  results(offset:number) {
    const s=this.state(),rows=this.ctx.storage.sql.exec<{id:string;position:number;phase:string;data:string}>(`SELECT * FROM results ${s.status==='complete'?'':"WHERE phase NOT IN ('baseline','evaluation')"} ORDER BY position LIMIT 20 OFFSET ?`,offset).toArray();
    return {runId:RUN_ID,offset,next:rows.length===20?offset+20:null,sealed:s.status!=='complete',results:rows.map(x=>JSON.parse(x.data))};
  }
  logs(offset:number) {
    const s=this.state();
    const rows=this.ctx.storage.sql.exec<CallRow>(`SELECT * FROM calls ${s.status==='complete'?'':'WHERE sealed=0'} ORDER BY started DESC,id DESC LIMIT 10 OFFSET ?`,offset).toArray();
    return {offset,next:rows.length===10?offset+10:null,sealed:s.status!=='complete',calls:rows.map(x=>({...x,result:x.result?JSON.parse(x.result):null}))};
  }
  analysis() {return this.state().status==='complete'?analyze(this.storedResults(true)):{sealed:true,message:'Final evaluation remains sealed until the run is complete.'};}
  async control(action:string) {
    const s=this.state();
    if(action==='pause'&&s.status==='paused')return this.status();
    if(action==='pause'&&s.status==='running') {s.status='paused';s.reason='owner_pause';this.save(s);this.event('paused',{reason:s.reason});await this.ctx.storage.deleteAlarm();return this.status();}
    if(action==='start'&&s.status==='ready') {
      if(!this.env.OPENAI_API_KEY) throw new Error('missing_key');
      s.status='running';s.startedAt=NOW();this.save(s);this.event('ribbon_cut',{version:VERSION,capUsd:40,gateCapUsd:4});await this.ctx.storage.setAlarm(Date.now()+1000);return this.status();
    }
    if(action==='resume'&&s.status==='paused'&&s.reason==='owner_pause') {s.status='running';s.reason=null;this.save(s);await this.ctx.storage.setAlarm(Date.now()+1000);return this.status();}
    // Recovery is deliberately limited to initial authentication, before any study data exist.
    // Preserve the rejected request and its conservative reservation instead of erasing billing.
    if(action==='retry-auth'&&s.status==='paused'&&s.reason==='openai_http_401'&&s.stage==='gate'&&s.cursor===0) {
      const id='gate-actor-0/actor',row=this.ctx.storage.sql.exec<CallRow>('SELECT * FROM calls WHERE id=?',id).toArray()[0];
      if(!row||row.error!=='openai_http_401')throw new Error('action_not_allowed');
      this.ctx.storage.sql.exec('UPDATE calls SET id=? WHERE id=?',`${id}/rejected-${Date.now()}`,id);
      s.status='running';s.reason=null;s.leaseUntil=0;this.save(s);this.event('authentication_reconfigured',{retainedRejectedRequest:true,protocolUnchanged:true});await this.ctx.storage.setAlarm(Date.now()+1000);return this.status();
    }
    // Scientific, billing and API failures cannot be overridden through a generic resume.
    throw new Error('action_not_allowed');
  }
  async watchdog() {
    const s=this.state();if(s.status!=='running')return;
    if(s.leaseUntil>Date.now())return;
    const alarm=await this.ctx.storage.getAlarm();
    if(!alarm||alarm<Date.now()-300000) {await this.ctx.storage.setAlarm(Date.now()+1000);this.event('watchdog',{action:'restored_wakeup'});}
  }
  private async modelCall(u:Unit,name:string,prompt:string,effort:'none'|'high',deadline:number):Promise<string> {
    const id=`${u.id}/${name}`;
    const existing=this.ctx.storage.sql.exec<CallRow>('SELECT * FROM calls WHERE id=?',id).toArray()[0];
    if(existing) {
      if(existing.prompt!==prompt||existing.effort!==effort) throw new Error('protocol_changed_during_resume');
      if(existing.state==='done'&&existing.result) return (JSON.parse(existing.result) as ApiResult).text;
      throw new Error(existing.error??'ambiguous_prior_request');
    }
    if(Date.now()>deadline) throw new Error('checkpoint_yield');
    const s=this.state();if(s.status!=='running')throw new Error('owner_pause');
    const maxOutput=effort==='high'?8192:2048,reserved=reservationMicro(prompt,maxOutput),b=this.budget(),cap=s.stage==='gate'?GATE_MICRO:CAP_MICRO;
    if(b.charged+b.held+reserved>cap)throw new Error('budget_pause');
    // Synchronous SQL is atomic before yielding to external I/O. Concurrent calls share this ledger.
    this.ctx.storage.sql.exec('INSERT INTO calls(id,unit_id,sealed,state,prompt,effort,reserved,started) VALUES (?,?,?,?,?,?,?,?)',id,u.id,Number(u.phase==='baseline'||u.phase==='evaluation'),'inflight',prompt,effort,reserved,Date.now());
    let result:ApiResult;
    try {result=await requestModel(this.env.OPENAI_API_KEY,prompt,effort,maxOutput);}
    catch(error) {
      const code=error instanceof Error&&/^openai_http_\d+$/.test(error.message)?error.message:'unknown_api_outcome';
      this.ctx.storage.sql.exec('UPDATE calls SET state=?,error=? WHERE id=?','unknown',code,id);
      throw new Error(code);
    }
    this.ctx.storage.sql.exec('UPDATE calls SET state=?,charged=?,result=?,error=? WHERE id=?','done',result.costMicro,JSON.stringify(result),null,id);
    if(result.costMicro>reserved)throw new Error('usage_exceeded_reservation');
    if(result.status!=='completed'||!result.text) {
      this.ctx.storage.sql.exec('UPDATE calls SET state=?,error=? WHERE id=?','invalid','incomplete_model_output',id);
      throw new Error('incomplete_model_output');
    }
    if(result.model!==MODEL&&!result.model.startsWith(MODEL+'-'))throw new Error('unexpected_model');
    return result.text;
  }
  async alarm() {
    let s=this.state();if(s.status!=='running'||s.leaseUntil>Date.now())return;
    s.leaseUntil=Date.now()+600000;this.save(s);
    const plan=this.plan(s),u=plan[s.cursor];
    try {
      if(!u) {
        if(s.stage==='gate') {
          const gate=evaluateGate(this.storedResults());s.gate=gate;
          // Conservative pilot-based forecast (2x mean measured role cost + replay-input allowance).
          const roleCosts=this.ctx.storage.sql.exec<{effort:string;mean:number}>('SELECT effort,AVG(charged) AS mean FROM calls WHERE state=? GROUP BY effort','done').toArray();
          const actor=roleCosts.find(x=>x.effort==='none')?.mean??10000,judge=roleCosts.find(x=>x.effort==='high')?.mean??15000;
          s.forecastUsd=(2*(4608*actor+2480*judge)+3_000_000)/1e6;
          if(!gate.pass) {s.status='paused';s.reason='feasibility_gate_failed';}
          else if(this.budget().charged/1e6+s.forecastUsd>36) {s.status='paused';s.reason='cost_forecast_exceeds_allowance';}
          else {s.stage='main';s.cursor=0;this.event('main_protocol_frozen',{version:VERSION,units:mainPlan().length,forecastUsd:s.forecastUsd});}
          this.event('feasibility_gate',{...gate,forecastUsd:s.forecastUsd,status:s.status});
        } else {s.status='complete';this.event('complete',{version:VERSION,note:'Evaluation unsealed. Human audit required before strong research claims.'});}
        s.leaseUntil=0;this.save(s);
      } else {
        this.event('unit_started',{id:u.id,phase:u.phase});
        const budget=this.budget();
        const summary=JSON.stringify({cursor:s.cursor,total:plan.length,stage:s.stage,spentUsd:budget.charged/1e6,version:VERSION});
        const deadline=Date.now()+220000;
        const result=await executeUnit(u,(name,prompt,effort)=>this.modelCall(u,name,prompt,effort,deadline),this.history(u),summary);
        this.ctx.storage.sql.exec('INSERT OR REPLACE INTO results(id,position,phase,data) VALUES (?,?,?,?)',u.id,(s.stage==='gate'?0:1000)+s.cursor,u.phase,JSON.stringify(result));
        if(u.phase==='train'&&result.replay) {
          const next=updateBuffer(this.history(u),result.replay,maximum(configFor(u.config),u.condition??'combined'));
          this.ctx.storage.sql.exec('INSERT OR REPLACE INTO meta(id,data) VALUES (?,?)',`replay-${u.config}-${u.condition}-${u.repeat}`,JSON.stringify(next));
        }
        s=this.state();s.cursor++;s.leaseUntil=0;this.save(s);
        this.event('unit_complete',{id:u.id,phase:u.phase,...(u.kind==='report'?{text:result.text}:{})});
      }
    } catch(error) {
      const code=error instanceof Error?error.message:'execution_error';s=this.state();s.leaseUntil=0;
      if(code!=='checkpoint_yield') {s.status='paused';s.reason=/^[a-z0-9_]+$/.test(code)?code:'execution_error';this.event('paused',{reason:s.reason,unit:u?.id});}
      this.save(s);
    }
    if(this.state().status==='running')await this.ctx.storage.setAlarm(Date.now()+1500);
  }
}

export async function authorized(request:Request,expected:string):Promise<boolean> {
  if(!expected||expected.length<16)return false;
  const header=request.headers.get('authorization')??'';
  if(!header.startsWith('Bearer ')||header.length>1024)return false;
  const enc=new TextEncoder(),[a,b]=await Promise.all([crypto.subtle.digest('SHA-256',enc.encode(header.slice(7))),crypto.subtle.digest('SHA-256',enc.encode(expected))]);
  return crypto.subtle.timingSafeEqual(a,b);
}
export default {
  async fetch(request:Request,env:StudyEnv,ctx:ExecutionContext):Promise<Response> {
    const url=new URL(request.url),stub=env.STUDY.getByName(RUN_ID);
    const headers={'access-control-allow-origin':'*','x-content-type-options':'nosniff','cache-control':'no-store'};
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'access-control-allow-methods':'GET','access-control-max-age':'86400'}});
    if(request.method==='POST'&&url.pathname.startsWith('/admin/')) {
      if(!await authorized(request,env.ADMIN_TOKEN))return Response.json({error:'unauthorized'},{status:401,headers});
      try{return Response.json(await stub.control(url.pathname.slice(7)),{headers});}catch{return Response.json({error:'action_not_allowed'},{status:409,headers});}
    }
    if(request.method!=='GET')return new Response('Method not allowed',{status:405,headers});
    if(url.pathname==='/health')return Response.json({ok:true,version:VERSION,runId:RUN_ID},{headers});
    if(!['/status','/results','/logs','/protocol','/analysis'].includes(url.pathname))return new Response('Not found',{status:404,headers});
    const offset=Number(url.searchParams.get('offset')??0);
    if(!Number.isSafeInteger(offset)||offset<0||offset>100000)return new Response('Invalid offset',{status:400,headers});
    const canonical=new Request(`${url.origin}${url.pathname}?offset=${offset}`);
    const cache=caches.default,cached=await cache.match(canonical);if(cached)return cached;
    let data:unknown;
    if(url.pathname==='/status')data=await stub.status();
    else if(url.pathname==='/results')data=await stub.results(offset);
    else if(url.pathname==='/logs')data=await stub.logs(offset);
    else if(url.pathname==='/analysis')data=await stub.analysis();
    else data={version:VERSION,runId:RUN_ID,model:MODEL,configs:CONFIGS,gateUnits:gatePlan().length,mainUnits:mainPlan().length,protocol:'https://github.com/RaphaelKhalid/reward-compatibility/blob/main/PROTOCOL.md'};
    const response=Response.json(data,{headers:{...headers,'cache-control':'public, max-age=10'}});ctx.waitUntil(cache.put(canonical,response.clone()));return response;
  },
  async scheduled(_event:ScheduledController,env:StudyEnv) {await env.STUDY.getByName(RUN_ID).watchdog();},
} satisfies ExportedHandler<StudyEnv>;
