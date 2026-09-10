import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {analyze} from '../src/analysis';
import {RUN_ID,VERSION,gatePlan,mainPlan,type UnitResult} from '../src/protocol';

const origin='https://autolabs-reward-compatibility.raphaelbahadurkhan.workers.dev';
async function get(path:string){const r=await fetch(origin+path,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error(`Read failed: ${r.status}`);return r.json();}
const status=await get('/status');
if(status.status!=='complete')throw Error('Evaluation remains sealed. No final figure will be generated from an unfinished run.');
if(status.runId!==RUN_ID||status.version!==VERSION)throw Error('Run/version mismatch');
const results:UnitResult[]=[];let offset:number|null=0;
while(offset!==null){const page=await get(`/results?offset=${offset}`);if(page.sealed||!Array.isArray(page.results))throw Error('Invalid result page');results.push(...page.results);offset=page.next;if(results.length>2000)throw Error('Unexpected result count');}
if(results.length!==gatePlan().length+mainPlan().length||new Set(results.map(r=>r.id)).size!==results.length)throw Error('Incomplete or duplicated records');
const analysis=analyze(results);
if(analysis.rows.some(r=>r.completeRepeats!==3||r.diagnosticCandidates!==4))throw Error('Incomplete analysis');
const dir=resolve('data',RUN_ID);await mkdir(dir,{recursive:true});
await writeFile(resolve(dir,'manifest.json'),JSON.stringify({exportedAt:new Date().toISOString(),origin,status,registration:'https://github.com/RaphaelKhalid/reward-compatibility/tree/336232c',note:'Human audit pending; exploratory measurement, not a safety certificate.'},null,2));
await writeFile(resolve(dir,'results.json'),JSON.stringify(results,null,2));
await writeFile(resolve(dir,'analysis.json'),JSON.stringify(analysis,null,2));
const csv=[['reward','family','witness_rate','witness_ci_low','witness_ci_high','additional_monitor_loss','loss_ci_low','loss_ci_high','correctness_effect','reward_attainment','repeats'],...analysis.rows.map(r=>[r.config,r.family,r.witnessRate,...r.witnessInterval!,r.additionalMonitorLoss,...r.lossInterval!,r.correctnessEffect,r.reasoningRewardAttainment,r.completeRepeats])].map(row=>row.join(',')).join('\n');
await writeFile(resolve(dir,'estimates.csv'),csv+'\n');
const escape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const bounds=analysis.rows.flatMap(r=>r.lossInterval??[]),lo=Math.min(-.1,...bounds),hi=Math.max(.1,...bounds),x=(v:number)=>420+(v-lo)/(hi-lo)*410;
const pp=(v:number)=>(v*100).toFixed(0)+' pp';
const marks=analysis.rows.map((r,i)=>{const y=125+i*48;return `<g><text x="35" y="${y+5}">${escape(r.config)}</text><rect x="175" y="${y-7}" width="100" height="14" fill="#dee4d8"/><rect x="175" y="${y-7}" width="${100*r.witnessRate!}" height="14" fill="#789879"/><text x="290" y="${y+5}">${(100*r.witnessRate!).toFixed(0)}%</text><line x1="${x(r.lossInterval![0])}" x2="${x(r.lossInterval![1])}" y1="${y}" y2="${y}" stroke="#365d4b" stroke-width="2"/><circle cx="${x(r.additionalMonitorLoss!)}" cy="${y}" r="5" fill="#365d4b"/></g>`;}).join('');
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="640" viewBox="0 0 900 640"><rect width="900" height="640" fill="#f3f0e5"/><g font-family="Georgia,serif" font-size="16" fill="#29362b"><text x="35" y="38" font-size="25">Reward compatibility: diagnostic and observed effects</text><text x="35" y="66" font-size="13">AutoLabs Experiment 002 · Luna · matched outcome-only control · exploratory evidence</text><text x="35" y="95">Reward</text><text x="175" y="95">Readable witnesses</text><text x="420" y="95">Additional monitoring loss (95% CI)</text><line x1="${x(0)}" x2="${x(0)}" y1="105" y2="490" stroke="#9eaa97" stroke-dasharray="3 4"/>${marks}<line x1="420" x2="830" y1="500" y2="500" stroke="#365d4b"/>${[lo,(lo+hi)/2,hi].map(v=>`<text x="${x(v)}" y="523" text-anchor="middle" font-size="13">${pp(v)}</text>`).join('')}<text x="35" y="558" font-size="13">Positive loss = larger baseline-to-terminal decline under combined rewards than under outcome-only rewards.</text><text x="35" y="582" font-size="13">Intervals: paired-history t, n=3. Witness rate: 4 strategies × 5 transfers; zero is not proof of conflict.</text><text x="35" y="606" font-size="13">See estimates.csv for diagnostic uncertainty and analysis.json for family-held-out prediction comparisons.</text></g></svg>`;
await writeFile(resolve(dir,'figure.svg'),svg);
console.log(`Exported ${results.length} scored units, analysis, CSV and figure to ${dir}`);
