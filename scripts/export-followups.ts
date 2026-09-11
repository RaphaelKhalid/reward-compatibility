/** Completed-run archival only. No credentials, mutations, model calls or sealed reads.
 * Usage: npx vite-node --script scripts/export-followups.ts 002.1 [new-output-directory]
 *        npx vite-node --script scripts/export-followups.ts 002.2 [new-output-directory]
 */
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, isAbsolute, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import * as P21 from '../v21/protocol';
import * as P22 from '../v22/protocol';
import * as E21 from '../v21/engine';
import * as E22 from '../v22/engine';
import {BUILD_HASH as B21} from '../v21/build';
import {BUILD_HASH as B22} from '../v22/build';
import {buildCases} from '../v21/domain';
import {analyzeClassification, type ClassificationRow} from '../v21/analysis';
import {analyzeHistories, type HistoryResult} from '../v22/analysis';
import {measuredMicro} from '../src/protocol';

type Obj = Record<string, any>;
export type Experiment = '002.1' | '002.2';
export const PAGE_SIZE = 5, GET_CONCURRENCY = 4;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_BODY = 2 * 1024 * 1024, MAX_DOWNLOAD = 256 * 1024 * 1024;
const cases = [...buildCases('dev'), ...buildCases('eval')];
export const sha256 = (text: string | Uint8Array): string => createHash('sha256').update(text).digest('hex');
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Obj)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function demand(condition: unknown, message: string): asserts condition {if (!condition) throw Error(message);}
function object(value: unknown): Obj {demand(value && typeof value === 'object' && !Array.isArray(value), 'Expected JSON object'); return value as Obj;}
function equal(a: unknown, b: unknown, what: string): void {demand(canonical(a) === canonical(b), `${what} mismatch`);}
function integer(value: unknown): value is number {return Number.isSafeInteger(value) && (value as number) >= 0;}
function micro(value: unknown): number {
  demand(typeof value === 'number' && Number.isFinite(value) && value >= 0, 'Invalid USD accounting');
  const n = Math.round(value * 1e6); demand(Number.isSafeInteger(n) && Math.abs(n / 1e6 - value) < 1e-10, 'Nonintegral microUSD accounting'); return n;
}
interface Job {
  id: string; split: 'dev' | 'eval'; steps: number;
  replay(calls: Obj[]): unknown;
}
export function configuration(experiment: Experiment) {
  demand(experiment === '002.1' || experiment === '002.2', 'Choose 002.1 or 002.2');
  const p = experiment === '002.1' ? P21 : P22, buildHash = experiment === '002.1' ? B21 : B22;
  const plan = P22.historyPlan();
  const jobs: Job[] = experiment === '002.1' ? cases.flatMap(c => P21.METHODS.map(method => ({
    id: `${c.id}/${method}`, split: c.split, steps: P21.stepsFor(method),
    replay(calls: Obj[]) {
      const history: E21.Attempt[] = [];
      for (const [step, call] of calls.entries()) {
        equal(call.prompt, E21.promptFor(c, method, history), `Prompt ${call.id}`);
        const attempt = E21.parseAttempt(c, method, step, call.response?.status === 'completed' ? call.response.text : '');
        equal(call.parsed, Number(attempt.parsed), `Parsed flag ${call.id}`); history.push(attempt);
      }
      return E21.resultFor(c, method, history);
    },
  }))) : plan.map(item => ({...item, replay(calls: Obj[]) {
    const history: E22.Attempt[] = [];
    for (const [step, call] of calls.entries()) {
      equal(call.prompt, E22.promptFor(item, history), `Prompt ${call.id}`);
      const attempt = E22.parseAttempt(item, step, call.response?.status === 'completed' ? call.response.text : '');
      equal(call.parsed, Number(attempt.parsed), `Parsed flag ${call.id}`); history.push(attempt);
    }
    return E22.resultFor(item, history);
  }}));
  return {
    experiment, folder: experiment === '002.1' ? 'v21' : 'v22', runId: p.RUN_ID, version: p.VERSION,
    origin: experiment === '002.1' ? 'https://autolabs-compatibility-21.raphaelbahadurkhan.workers.dev' : 'https://autolabs-reward-categories-22.raphaelbahadurkhan.workers.dev',
    protocol: p.PROTOCOL, buildHash, jobs, model: p.MODEL, reservation: p.reservation,
    protocolHash: sha256(JSON.stringify(experiment === '002.1' ? {protocol: p.PROTOCOL, cases, build: buildHash} : {protocol: p.PROTOCOL, plan, build: buildHash})),
    callsTotal: jobs.reduce((n, job) => n + job.steps, 0), amendment: `${experiment}-http5xx-abstention-accounting-v1`,
  };
}
type Config = ReturnType<typeof configuration>;

/** Fail before touching any logs/results when the evaluation remains sealed. */
export function validateStatus(status: Obj, cfg: Config): void {
  demand(status.status === 'complete' && status.evaluationSealed === false, 'Refusing sealed or incomplete study');
  equal(status.runId, cfg.runId, 'Run ID'); equal(status.version, cfg.version, 'Version'); equal(status.protocolHash, cfg.protocolHash, 'Protocol hash'); equal(status.model, cfg.model, 'Model');
  const b = object(status.budget), p = object(status.progress);
  demand(Array.isArray(status.active) && status.active.length === 0 && micro(b.reservedUsd) === 0, 'Completion still has active or held calls');
  equal(p.callsDone, cfg.callsTotal, 'Completed call count'); equal(p.callsTotal, cfg.callsTotal, 'Planned call count'); equal(b.calls, cfg.callsTotal, 'Ledger call count');
  const counts = p[cfg.experiment === '002.1' ? 'cases' : 'histories'];
  demand(Array.isArray(counts) && counts.length === 2, 'Missing split counts');
  for (const split of ['dev', 'eval']) {
    const entries = counts.filter((row: Obj) => row.split === split), total = cfg.jobs.filter(job => job.split === split).length;
    demand(entries.length === 1 && entries[0].done === total && entries[0].total === total, `Incomplete ${split} results`);
  }
  const prior = micro(b.priorCommittedUsd), spent = micro(b.spentUsd), total = micro(b.totalCommittedUsd);
  demand(b.capUsd === 40 && total === prior + spent && total <= 40_000_000, 'Budget totals or shared cap mismatch');
  if (cfg.experiment === '002.1') equal(prior, P21.PRIOR_MICRO, 'Prior commitment');
  else {demand(prior >= P21.PRIOR_MICRO, 'Missing predecessor commitment'); equal(status.priorMicro, prior, 'Predecessor snapshot');}
  if (status.operationalAmendment !== undefined) equal(status.operationalAmendment, cfg.amendment, 'Operational amendment');
}

export interface RawDocument {path: string; text: string}
type Getter = (path: string) => Promise<RawDocument>;
/** Fixed-size public pages, including the empty terminal page for exact multiples. */
export async function fetchPages(get: Getter, endpoint: 'logs' | 'results', count: number): Promise<{rows: Obj[]; raw: RawDocument[]}> {
  demand(integer(count) && count <= 100_000, 'Invalid expected page count');
  const offsets = Array.from({length: Math.floor(count / PAGE_SIZE) + 1}, (_, i) => i * PAGE_SIZE);
  const raw: RawDocument[] = [], rows: Obj[] = [];
  for (let start = 0; start < offsets.length; start += GET_CONCURRENCY) {
    const batch = await Promise.all(offsets.slice(start, start + GET_CONCURRENCY).map(async offset => {
      const document = await get(`/${endpoint}?offset=${offset}`), page = object(JSON.parse(document.text)), key = endpoint === 'logs' ? 'calls' : 'results';
      demand(page.sealed === false, `Refusing sealed ${endpoint} page`);
      demand(Array.isArray(page[key]), `Invalid ${endpoint} page`);
      equal(page[key].length, Math.min(PAGE_SIZE, count - offset), `${endpoint} page length at ${offset}`);
      equal(page.next, page[key].length === PAGE_SIZE ? offset + PAGE_SIZE : null, `${endpoint} next offset`);
      return {document, rows: page[key].map(object)};
    }));
    for (const item of batch) {raw.push(item.document); rows.push(...item.rows);}
  }
  equal(rows.length, count, `${endpoint} total`); return {rows, raw};
}

export function reconcileCalls(calls: Obj[], status: Obj, cfg: Config) {
  equal(calls.length, cfg.callsTotal, 'Raw call count');
  const expected = new Map(cfg.jobs.flatMap(job => Array.from({length: job.steps}, (_, step) => [`${job.id}/${step}`, job] as const)));
  const seen = new Set<string>(), responses = new Set<string>();
  let knownMicro = 0, uncertainMicro = 0, failedAccounted = 0, malformed = 0, incomplete = 0;
  const splitCounts = {dev: 0, eval: 0};
  for (const call of calls) {
    const job = expected.get(call.id); demand(job && !seen.has(call.id), 'Unknown or duplicate call identity'); seen.add(call.id);
    equal(call.job_id, job.id, 'Call job'); equal(call.split, job.split, 'Call split'); splitCounts[job.split]++;
    demand(integer(call.started) && call.started > 0 && typeof call.prompt === 'string' && [0, 1].includes(call.parsed), 'Invalid raw call record');
    demand(integer(call.reserved) && integer(call.charged) && call.charged <= call.reserved, 'Invalid call cost');
    equal(call.reserved, cfg.reservation(call.prompt), 'Reservation');
    if (call.state === 'failed-accounted') {
      demand(status.operationalAmendment === cfg.amendment && /^openai_http_5\d{2}$/.test(call.error ?? '') && call.response === null && call.parsed === 0 && call.charged === call.reserved, 'Undocumented or inconsistent failed-accounted call');
      failedAccounted++; uncertainMicro += call.charged;
    } else {
      demand(call.state === 'done' && call.error === null, 'Unresolved or erroneous call cannot be exported as complete');
      const r = object(call.response);
      demand(typeof r.text === 'string' && typeof r.responseId === 'string' && r.responseId.length > 0 && !responses.has(r.responseId) && typeof r.status === 'string' && typeof r.model === 'string' && (r.model === cfg.model || r.model.startsWith(cfg.model + '-')), 'Invalid or duplicate API response');
      responses.add(r.responseId); equal(r.costMicro, measuredMicro(r.inputTokens, r.outputTokens), 'Usage-derived cost'); equal(r.costMicro, call.charged, 'Charged API cost');
      knownMicro += call.charged; if (r.status !== 'completed') incomplete++;
    }
    if (call.parsed === 0) malformed++;
  }
  demand(failedAccounted <= 5, 'Failure amendment cap exceeded');
  const budget = status.budget;
  equal(knownMicro + uncertainMicro, micro(budget.spentUsd), 'Aggregate charged upper bound');
  if (status.operationalAmendment) {
    equal(micro(budget.knownSpendUsd), knownMicro, 'Known provider spend'); equal(micro(budget.uncertainChargeUpperBoundUsd), uncertainMicro, 'Uncertain charge upper bound');
    equal(budget.failedAccountedCalls, failedAccounted, 'Accounted failure count'); equal(budget.spentIsUpperBound, failedAccounted > 0, 'Upper-bound flag');
  }
  return {plannedCalls: cfg.callsTotal, accountedCalls: calls.length, splitCounts, knownMicro, uncertainChargeUpperBoundMicro: uncertainMicro, chargedUpperBoundMicro: knownMicro + uncertainMicro, failedAccounted, malformedOrAbstainingCalls: malformed, incompleteResponses: incomplete};
}

export function replayResults(calls: Obj[], results: Obj[], cfg: Config): void {
  equal(results.length, cfg.jobs.length, 'Result count');
  const byId = new Map<string, Obj>(), callsById = new Map(calls.map(call => [call.id, call]));
  for (const result of results) {demand(typeof result.id === 'string' && !byId.has(result.id), 'Duplicate result'); byId.set(result.id, result);}
  for (const job of cfg.jobs) {
    const result = byId.get(job.id); demand(result && result.split === job.split, 'Missing or wrong-split result');
    const history = Array.from({length: job.steps}, (_, step) => {const call = callsById.get(`${job.id}/${step}`); demand(call, 'Missing planned attempt'); return call;});
    equal(result, job.replay(history), `Reconstructed result ${job.id}`);
  }
}
export function recomputeAnalysis(results: Obj[], report: Obj, cfg: Config): unknown {
  const ordered = [...results].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (cfg.experiment === '002.2') return analyzeHistories(ordered.filter(row => row.split === 'eval') as HistoryResult[]);
  const dev = ordered.filter(row => row.split === 'dev' && row.method === 'description'), compatible = dev.filter(row => row.truth === 'compatible').length;
  const baseline = object(report.baseline);
  equal({...baseline, frozenAt: undefined}, {method: 'dev-majority', predicted: compatible >= 40 ? 'compatible' : 'conflict', developmentCases: 80, compatible, conflict: 80 - compatible, tieBreak: 'compatible', frozenAt: undefined}, 'Frozen development baseline');
  demand(typeof baseline.frozenAt === 'string' && Number.isFinite(Date.parse(baseline.frozenAt)), 'Invalid baseline freeze time');
  const rows: ClassificationRow[] = ordered.filter(row => row.split === 'eval').map(row => ({caseId: row.caseId, templateId: row.templateId, domain: row.domain, method: row.method, truth: row.truth, predicted: row.predicted, certificate: row.certificate}));
  return analyzeClassification([...rows, ...rows.filter(row => row.method === 'description').map(row => ({...row, method: baseline.method, predicted: baseline.predicted, certificate: 'none' as const}))]);
}

async function localManifest(cfg: Config, operational: boolean): Promise<RawDocument[]> {
  const paths = [`${cfg.folder}/manifest.json`, ...(operational ? [`${cfg.folder}/operations-manifest.json`] : [])], output: RawDocument[] = [];
  for (const path of paths) {
    const text = await readFile(resolve(ROOT, path), 'utf8'), m = object(JSON.parse(text));
    if (path.endsWith('/manifest.json')) equal(m.sourceHash, cfg.buildHash, 'Local source hash');
    else {equal(m.originalScientificSourceHash, cfg.buildHash, 'Amendment source hash'); equal(m.originalProtocolHash, cfg.protocolHash, 'Amendment protocol hash'); equal(m.amendment, cfg.amendment, 'Amendment ID');}
    demand(Array.isArray(m.files) && m.files.length > 0, 'Missing frozen file manifest');
    for (const entry of m.files) {
      demand(typeof entry.path === 'string' && !isAbsolute(entry.path), 'Invalid frozen file path');
      const target = resolve(ROOT, entry.path), rel = relative(ROOT, target);
      demand(rel && !rel.startsWith('..') && !isAbsolute(rel), 'Frozen file escaped repository');
      equal(sha256((await readFile(target, 'utf8')).replace(/\r\n/g, '\n')), entry.sha256, `Frozen file ${entry.path}`);
    }
    output.push({path: `source/${path.split('/').at(-1)}`, text});
  }
  return output;
}

/** Exclusive directory + files. A partial export is never mistaken for a finished one. */
export async function writeExclusiveArchive(directory: string, documents: RawDocument[], metadata: Obj) {
  const target = resolve(directory), used = new Set<string>();
  for (const doc of documents) {
    const rel = relative(target, resolve(target, doc.path));
    demand(doc.path && !isAbsolute(doc.path) && rel && !rel.startsWith('..') && !used.has(rel) && rel !== 'EXPORT_COMPLETE.json', 'Invalid or duplicate archive path'); used.add(rel);
  }
  await mkdir(dirname(target), {recursive: true});
  await mkdir(target); // Existing complete OR partial directories are deliberately refused.
  const hashes = [];
  for (const doc of documents) {
    const path = resolve(target, doc.path); await mkdir(dirname(path), {recursive: true}); await writeFile(path, doc.text, {flag: 'wx'});
    hashes.push({path: doc.path, bytes: Buffer.byteLength(doc.text), sha256: sha256(doc.text)});
  }
  const manifest = {...metadata, files: hashes, archiveComplete: true};
  await writeFile(resolve(target, 'EXPORT_COMPLETE.json'), JSON.stringify(manifest, null, 2) + '\n', {flag: 'wx'});
  return manifest;
}

export async function exportFollowup(experiment: Experiment, directory?: string, fetcher: typeof fetch = fetch) {
  const cfg = configuration(experiment), documents: RawDocument[] = []; let downloadedBytes = 0;
  const get: Getter = async path => {
    demand(/^\/(status|protocol|analysis|logs\?offset=\d+|results\?offset=\d+)$/.test(path), 'Non-public export request');
    const response = await fetcher(cfg.origin + path, {method: 'GET', redirect: 'error', signal: AbortSignal.timeout(30_000), headers: {accept: 'application/json'}});
    demand(response.ok && response.body, `Public GET failed (${response.status})`);
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
    try {while (true) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.length; downloadedBytes += part.value.length;
      demand(bytes <= MAX_BODY && downloadedBytes <= MAX_DOWNLOAD, 'Archive download size limit'); chunks.push(part.value);
    }} catch (error) {await reader.cancel(); throw error;}
    return {path, text: new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks))};
  };
  const before = await get('/status'), status = object(JSON.parse(before.text)); validateStatus(status, cfg);
  const manifests = await localManifest(cfg, Boolean(status.operationalAmendment));
  const [protocol, reportDoc] = await Promise.all([get('/protocol'), get('/analysis')]);
  equal(JSON.parse(protocol.text), cfg.protocol, 'Published protocol');
  const report = object(JSON.parse(reportDoc.text));
  demand(report.available === true && report.sealed === false, 'Refusing unavailable or sealed analysis');
  equal(report.runId, cfg.runId, 'Analysis run'); equal(report.protocolHash, cfg.protocolHash, 'Analysis protocol'); equal(report.buildHash, cfg.buildHash, 'Analysis build');
  demand(typeof report.completedAt === 'string' && Number.isFinite(Date.parse(report.completedAt)), 'Invalid completion timestamp');
  // Separate loops guarantee the global GET concurrency remains <=4, not 4 per endpoint.
  const logs = await fetchPages(get, 'logs', cfg.callsTotal), results = await fetchPages(get, 'results', cfg.jobs.length);
  const accounting = reconcileCalls(logs.rows, status, cfg); replayResults(logs.rows, results.rows, cfg);
  const local = recomputeAnalysis(results.rows, report, cfg); equal(local, report.analysis, 'Entire locally reproduced analysis');
  const after = await get('/status'), finalStatus = object(JSON.parse(after.text)); validateStatus(finalStatus, cfg);
  for (const field of ['runId', 'protocolHash', 'status', 'stage', 'updatedAt', 'progress', 'budget', 'operationalAmendment']) equal(status[field], finalStatus[field], `Final status ${field}`);
  const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
  documents.push({path: 'status-before.json', text: before.text}, {path: 'status-after.json', text: after.text}, {path: 'protocol.json', text: protocol.text}, {path: 'analysis.json', text: reportDoc.text}, {path: 'analysis-recomputed.json', text: json(local)}, ...manifests);
  for (const [kind, bundle] of [['logs', logs], ['results', results]] as const) {
    bundle.raw.forEach((doc, index) => documents.push({path: `raw/${kind}-${String(index * PAGE_SIZE).padStart(6, '0')}.json`, text: doc.text}));
    for (const split of ['dev', 'eval']) documents.push({path: `${kind}-${split}.jsonl`, text: bundle.rows.filter(row => row.split === split).map(row => JSON.stringify(row)).join('\n') + '\n'});
  }
  return writeExclusiveArchive(directory ?? resolve(ROOT, 'data', 'followups', cfg.runId), documents, {
    exporterVersion: 1, runId: cfg.runId, protocolHash: cfg.protocolHash, scientificBuildHash: cfg.buildHash, sourceOrigin: cfg.origin,
    fetchedAt: new Date().toISOString(), completedAt: report.completedAt, pageSize: PAGE_SIZE, maxGetConcurrency: GET_CONCURRENCY,
    downloadedBytes, accounting, results: {dev: cfg.jobs.filter(job => job.split === 'dev').length, eval: cfg.jobs.filter(job => job.split === 'eval').length},
    validation: {allFrozenFilesVerified: true, allPromptsReplayed: true, allResultsReconstructed: true, entireAnalysisEqual: true, sealedReads: false},
    limitations: 'Raw logs are the public runner records, not full provider wire responses or billing attestations. Public pages lack run IDs; exact identities, frozen hashes, counts and stable before/after status establish consistency, not cryptographic server authenticity. Prior commitment is a ledger snapshot, not re-audited predecessor billing. Failed-accounted records retain reserved upper bounds and abstentions without invented usage. No scientific interpretation is implied.',
  });
}

/** vite-node leaves its own executable before the script in argv. Match only the
 * exact script path, so importing from a test or another module does not run it. */
export function cliArguments(argv: string[], scriptPath = fileURLToPath(import.meta.url)): string[] | null {
  const index = argv.findIndex((argument, i) => i > 0 && resolve(argument) === resolve(scriptPath));
  return index < 0 ? null : argv.slice(index + 1);
}
const cli = cliArguments(process.argv);
if (cli) {
  await exportFollowup(cli[0] as Experiment, cli[1]).then(manifest => {
    console.log(JSON.stringify({archiveComplete: true, runId: manifest.runId, files: manifest.files.length, accounting: manifest.accounting}));
  }).catch(error => {console.error(`Export refused: ${error instanceof Error ? error.message : 'unknown error'}`); process.exitCode = 1;});
}
