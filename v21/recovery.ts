import originalWorker, {CompatibilityStudy as FrozenCompatibilityStudy} from './index';
import {BUILD_HASH} from './build';
import {buildCases} from './domain';
import {parseAttempt, promptFor, resultFor, type Attempt} from './engine';
import {METHODS, PROTOCOL, stepsFor, type Method} from './protocol';

export const OPERATIONAL_AMENDMENT='002.1-http5xx-abstention-accounting-v1';
export const MAX_ACCOUNTED_FAILURES=5;
export const RECOVERY_COOLDOWN_MS=60000;
interface RecoveryState {status:string;reason:string|null;leaseUntil:number;protocolHash:string|null;updatedAt:string}
interface RecoveryCall extends Record<string,SqlStorageValue> {id:string;job_id:string;split:string;state:string;reserved:number;charged:number;prompt:string;response:string|null;error:string|null;parsed:number|null}
interface RecoveryJob extends Record<string,SqlStorageValue> {id:string;case_id:string;split:'dev'|'eval';method:Method;step:number;state:string;history:string;result:string|null}
const serverError=(error:string|null):boolean=>error!==null&&/^openai_http_5\d{2}$/.test(error);
const bounded=(value:unknown):string=>{const text=JSON.stringify(value);if(new TextEncoder().encode(text).length>128000)throw Error('recovery_record_limit');return text;};
async function frozenFingerprint():Promise<string>{
  const bytes=new TextEncoder().encode(JSON.stringify({protocol:PROTOCOL,cases:[...buildCases('dev'),...buildCases('eval')],build:BUILD_HASH}));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join('');
}

/** Operational adapter only: the original frozen runner, prompts, analysis and sample plan are unchanged. */
export class CompatibilityStudy extends FrozenCompatibilityStudy {
  override async status(){
    const status=await super.status();
    const uncertain=this.ctx.storage.sql.exec<{micro:number;calls:number}>("SELECT COALESCE(SUM(charged),0) micro,COUNT(*) calls FROM calls WHERE state='failed-accounted'").one();
    return {...status,budget:{...status.budget,knownSpendUsd:Math.max(0,Math.round(status.budget.spentUsd*1e6)-uncertain.micro)/1e6,
      uncertainChargeUpperBoundUsd:uncertain.micro/1e6,failedAccountedCalls:uncertain.calls,spentIsUpperBound:uncertain.calls>0},
      operationalAmendment:OPERATIONAL_AMENDMENT};
  }
  override async control(action:string){
    if(action!=='account-failed')return super.control(action);
    const protocolHash=await frozenFingerprint();
    this.ctx.storage.transactionSync(()=>{
      const sql=this.ctx.storage.sql;
      const state=JSON.parse(sql.exec<{data:string}>('SELECT data FROM meta WHERE id=?','state').one().data) as RecoveryState;
      if(state.status!=='paused'||!serverError(state.reason)||state.leaseUntil>=Date.now())throw Error('recovery_not_allowed');
      if(BUILD_HASH==='UNFROZEN'||state.protocolHash!==protocolHash)throw Error('frozen_protocol_changed');
      if(sql.exec<{n:number}>("SELECT COUNT(*) n FROM calls WHERE state='inflight'").one().n!==0)throw Error('recovery_inflight');
      const calls=sql.exec<RecoveryCall>("SELECT * FROM calls WHERE state='unknown' ORDER BY id").toArray();
      if(calls.length===0||calls.length>8||calls.some(call=>!serverError(call.error))||!calls.some(call=>call.error===state.reason))throw Error('recovery_unknown_errors');
      const accounted=sql.exec<{n:number}>("SELECT COUNT(*) n FROM calls WHERE state='failed-accounted'").one().n;
      if(accounted+calls.length>MAX_ACCOUNTED_FAILURES)throw Error('recovery_failure_cap');
      const cases=new Map([...buildCases('dev'),...buildCases('eval')].map(value=>[value.id,value]));
      const records:{id:string;jobId:string;error:string;upperBoundMicro:number;step:number}[]=[];
      for(const call of calls){
        if(!Number.isSafeInteger(call.reserved)||call.reserved<0||call.charged!==0||call.response!==null||call.parsed!==null)throw Error('recovery_call_inconsistent');
        const job=sql.exec<RecoveryJob>('SELECT * FROM jobs WHERE id=?',call.job_id).toArray()[0];
        if(!job||job.state!=='pending'||job.result!==null||!METHODS.includes(job.method)||!Number.isSafeInteger(job.step)||job.step<0||job.step>=stepsFor(job.method)||call.id!==`${job.id}/${job.step}`||job.split!==call.split)throw Error('recovery_job_inconsistent');
        const studyCase=cases.get(job.case_id);
        if(!studyCase||studyCase.split!==job.split||job.id!==`${studyCase.id}/${job.method}`)throw Error('recovery_case_inconsistent');
        const history=JSON.parse(job.history) as Attempt[];
        if(!Array.isArray(history)||history.length!==job.step||history.some((attempt,index)=>attempt.step!==index)||promptFor(studyCase,job.method,history)!==call.prompt)throw Error('recovery_history_inconsistent');
        history.push(parseAttempt(studyCase,job.method,job.step,''));
        const done=job.step+1===stepsFor(job.method);
        const result=done?resultFor(studyCase,job.method,history):null;
        // This is a conservative billing bound, not invented provider usage or a fabricated response.
        sql.exec("UPDATE calls SET state='failed-accounted',charged=reserved,parsed=0 WHERE id=?",call.id);
        sql.exec('UPDATE jobs SET step=?,state=?,history=?,result=? WHERE id=?',job.step+1,done?'done':'pending',bounded(history),result?bounded(result):null,job.id);
        records.push({id:call.id,jobId:job.id,error:call.error!,upperBoundMicro:call.reserved,step:job.step});
      }
      const time=new Date().toISOString();
      sql.exec('INSERT INTO events(time,type,data) VALUES (?,?,?)',time,'failed_calls_accounted',bounded({amendment:OPERATIONAL_AMENDMENT,protocolHash,buildHash:BUILD_HASH,calls:records,
        note:'Each failed planned attempt consumed as an abstention without retry. Full reservation retained as uncertain charge upper bound; no API response fabricated.'}));
      state.status='running';state.reason=null;state.leaseUntil=0;state.updatedAt=time;
      sql.exec('UPDATE meta SET data=? WHERE id=?',bounded(state),'state');
    });
    await this.ctx.storage.setAlarm(Date.now()+1000);
    return this.status();
  }
  override async watchdog(){
    const state=JSON.parse(this.ctx.storage.sql.exec<{data:string}>('SELECT data FROM meta WHERE id=?','state').one().data) as RecoveryState;
    if(state.status!=='paused'||!serverError(state.reason))return super.watchdog();
    const updated=Date.parse(state.updatedAt);
    if(!Number.isFinite(updated)||Date.now()-updated<RECOVERY_COOLDOWN_MS||state.leaseUntil>=Date.now())return;
    const calls=this.ctx.storage.sql.exec<{state:string;error:string|null}>("SELECT state,error FROM calls WHERE state IN ('inflight','unknown','failed-accounted')").toArray();
    const unknown=calls.filter(call=>call.state==='unknown');
    if(calls.some(call=>call.state==='inflight')||unknown.length===0||unknown.some(call=>!serverError(call.error))||unknown.length+calls.filter(call=>call.state==='failed-accounted').length>MAX_ACCOUNTED_FAILURES)return;
    await this.control('account-failed');
  }
}

// Existing authentication and all scientific/public routes are reused verbatim.
export default originalWorker;
