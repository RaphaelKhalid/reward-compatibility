import {describe, expect, it} from 'vitest';
import {mkdtemp, readFile, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {configuration, exportFollowup, fetchPages, reconcileCalls, replayResults, recomputeAnalysis, validateStatus, writeExclusiveArchive, sha256} from '../scripts/export-followups';
import * as P22 from '../v22/protocol';
import * as E22 from '../v22/engine';
import {measuredMicro} from '../src/protocol';
import * as P21 from '../v21/protocol';
import * as E21 from '../v21/engine';
import {buildCases} from '../v21/domain';

const config = configuration('002.2');
function completeStatus(cfg = config): any {
  const spent = cfg.callsTotal * measuredMicro(10, 2), prior = 1_291_626;
  return {runId: cfg.runId, version: cfg.version, model: cfg.model, protocolHash: cfg.protocolHash, status: 'complete', stage: 'eval', evaluationSealed: false, updatedAt: '2026-09-11T00:00:00Z', priorMicro: prior, active: [],
    progress: {[cfg.experiment === '002.1' ? 'cases' : 'histories']: ['dev', 'eval'].map(split => {const total = cfg.jobs.filter(job => job.split === split).length; return {split, done: total, total};}), callsDone: cfg.callsTotal, callsTotal: cfg.callsTotal},
    budget: {calls: cfg.callsTotal, spentUsd: spent / 1e6, reservedUsd: 0, priorCommittedUsd: prior / 1e6, totalCommittedUsd: (prior + spent) / 1e6, capUsd: 40}};
}
function fixture() {
  const calls: any[] = [], results: any[] = [];
  for (const plan of P22.historyPlan()) {
    const history: E22.Attempt[] = [];
    for (let step = 0; step < plan.steps; step++) {
      const prompt = E22.promptFor(plan, history), id = `${plan.id}/${step}`;
      const text = '{}'; // Deliberately malformed outputs: fail closed, retain every attempt.
      calls.push({id, job_id: plan.id, split: plan.split, state: 'done', started: 1, reserved: config.reservation(prompt), charged: measuredMicro(10, 2), prompt, parsed: 0, error: null,
        response: {responseId: `response-${id}`, text, status: 'completed', model: config.model, inputTokens: 10, outputTokens: 2, costMicro: measuredMicro(10, 2)}});
      history.push(E22.parseAttempt(plan, step, text));
    }
    results.push(E22.resultFor(plan, history));
  }
  return {calls, results, status: completeStatus()};
}

describe('fixed follow-up archive contracts', () => {
  it('derives exact run hashes, calls and jobs from frozen plans', () => {
    const first = configuration('002.1');
    expect(first.protocolHash).toBe('9375e6a48c97aecb080ae4b1631e1a0e6cad620ce9840454d5907d665d757ea8');
    expect(config.protocolHash).toBe('b58686ca6089f373aae35bca8cf9b48477db9d08b8d714f21aa561874adff363');
    expect([first.callsTotal, first.jobs.length, config.callsTotal, config.jobs.length]).toEqual([3600, 1200, 4116, 1044]);
    expect(() => configuration('other' as any)).toThrow();
  });
  it('refuses sealed studies before making any data request or creating output', async () => {
    const seen: string[] = [];
    const fetcher = async (url: any, options: any) => {
      seen.push(String(url)); expect(options.method).toBe('GET'); expect(options.redirect).toBe('error');
      return new Response(JSON.stringify({...completeStatus(), status: 'running', evaluationSealed: true}));
    };
    await expect(exportFollowup('002.2', undefined, fetcher as any)).rejects.toThrow('sealed');
    expect(seen).toEqual([config.origin + '/status']);
  });
  it.each(['runId', 'protocolHash', 'version', 'model'])('rejects wrong %s', field => {
    const status = completeStatus(); status[field] = 'wrong'; expect(() => validateStatus(status, config)).toThrow();
  });
  it('rejects missing split, calls, held cost, active jobs and excessive shared budget', () => {
    for (const change of [
      (s: any) => s.progress.histories.pop(), (s: any) => s.progress.callsDone--,
      (s: any) => s.budget.calls++, (s: any) => s.budget.reservedUsd = .1,
      (s: any) => s.active.push({id: 'still-running'}), (s: any) => s.budget.totalCommittedUsd = 41,
    ]) {const status = completeStatus(); change(status); expect(() => validateStatus(status, config)).toThrow();}
  });
  it('uses five rows per page and at most four concurrent GETs, including terminal empty page', async () => {
    let active = 0, peak = 0; const seen: number[] = [];
    const bundle = await fetchPages(async path => {
      const offset = Number(path.split('=')[1]); seen.push(offset); peak = Math.max(peak, ++active);
      await new Promise(resolve => setTimeout(resolve, 1)); active--;
      const rows = Array.from({length: Math.min(5, 40 - offset)}, (_, i) => ({id: offset + i}));
      return {path, text: JSON.stringify({sealed: false, calls: rows, next: rows.length === 5 ? offset + 5 : null})};
    }, 'logs', 40);
    expect(peak).toBe(4); expect(seen).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40]); expect(bundle.rows).toHaveLength(40);
  });
  it('rejects sealed, short, oversized and broken-cursor pages', async () => {
    for (const page of [
      {sealed: true, results: [{}], next: null}, {sealed: false, results: [], next: null},
      {sealed: false, results: [{}, {}], next: null}, {sealed: false, results: [{}], next: 5},
    ]) await expect(fetchPages(async path => ({path, text: JSON.stringify(page)}), 'results', 1)).rejects.toThrow();
  });
  it('reconciles every planned attempt and faithfully reconstructs failed/malformed histories', () => {
    const {calls, results, status} = fixture();
    expect(reconcileCalls(calls, status, config)).toMatchObject({plannedCalls: 4116, accountedCalls: 4116, splitCounts: {dev: 20, eval: 4096}, malformedOrAbstainingCalls: 4116, failedAccounted: 0});
    expect(() => replayResults(calls, results, config)).not.toThrow();
    const analysis = recomputeAnalysis(results, {}, config) as any;
    expect(analysis.status).toBe('complete'); expect(analysis.templates.every((row: any) => row.label === 'mixed-or-insufficient')).toBe(true);
  }, 30000);
  it('preserves documented failures as abstentions with uncertain upper bounds, not invented usage', () => {
    const {calls, status} = fixture(), call = calls[0], original = call.charged;
    call.state = 'failed-accounted'; call.response = null; call.error = 'openai_http_503'; call.charged = call.reserved;
    status.operationalAmendment = config.amendment;
    Object.assign(status.budget, {spentUsd: (config.callsTotal * original - original + call.reserved) / 1e6,
      knownSpendUsd: (config.callsTotal - 1) * original / 1e6, uncertainChargeUpperBoundUsd: call.reserved / 1e6,
      failedAccountedCalls: 1, spentIsUpperBound: true});
    expect(reconcileCalls(calls, status, config)).toMatchObject({failedAccounted: 1, uncertainChargeUpperBoundMicro: call.reserved});
    call.response = {text: 'fake'}; expect(() => reconcileCalls(calls, status, config)).toThrow('failed-accounted');
  });
  it('rejects omissions, duplicates, mis-splits, altered usage, unknown reservations and changed prompts/results', () => {
    const {calls, status, results} = fixture();
    expect(() => reconcileCalls(calls.slice(1), status, config)).toThrow('count');
    const original = calls[0];
    for (const alteration of [{...calls[1]}, {...original, split: 'eval'}, {...original, state: 'unknown'}, {...original, charged: 0}]) {
      calls[0] = alteration; expect(() => reconcileCalls(calls, status, config)).toThrow();
    }
    calls[0] = {...original, prompt: 'modified'}; expect(() => replayResults(calls, results, config)).toThrow('Prompt');
    calls[0] = original; results[0] = {...results[0], steps: 99}; expect(() => replayResults(calls, results, config)).toThrow('Reconstructed');
  });
  it('rehearses a complete 002.1 export with frozen local hashes and reproduced analysis', async () => {
    const cfg = configuration('002.1'), calls: any[] = [], results: any[] = [];
    for (const c of [...buildCases('dev'), ...buildCases('eval')]) for (const method of P21.METHODS) {
      const history: E21.Attempt[] = [];
      for (let step = 0; step < P21.stepsFor(method); step++) {
        const prompt = E21.promptFor(c, method, history), id = `${c.id}/${method}/${step}`, text = '{}';
        calls.push({id, job_id: `${c.id}/${method}`, split: c.split, state: 'done', started: 1, reserved: cfg.reservation(prompt), charged: measuredMicro(10, 2), prompt, parsed: 0, error: null,
          response: {responseId: `response-${id}`, text, status: 'completed', model: cfg.model, inputTokens: 10, outputTokens: 2, costMicro: measuredMicro(10, 2)}});
        history.push(E21.parseAttempt(c, method, step, text));
      }
      results.push(E21.resultFor(c, method, history));
    }
    results.sort((a, b) => a.id < b.id ? -1 : 1);
    const status = completeStatus(cfg), compatible = results.filter(row => row.split === 'dev' && row.method === 'description' && row.truth === 'compatible').length;
    const baseline = {method: 'dev-majority', predicted: compatible >= 40 ? 'compatible' : 'conflict', developmentCases: 80, compatible, conflict: 80 - compatible, tieBreak: 'compatible', frozenAt: '2026-09-10T20:00:00Z'};
    const report = {available: true, sealed: false, runId: cfg.runId, protocolHash: cfg.protocolHash, buildHash: cfg.buildHash, completedAt: '2026-09-11T00:00:00Z', baseline, analysis: recomputeAnalysis(results, {baseline}, cfg)};
    const paths: string[] = [], fetcher = async (url: any) => {
      const u = new URL(String(url)), path = u.pathname; paths.push(path);
      if (path === '/status') return new Response(JSON.stringify(status));
      if (path === '/protocol') return new Response(JSON.stringify(cfg.protocol));
      if (path === '/analysis') return new Response(JSON.stringify(report));
      const offset = Number(u.searchParams.get('offset')), rows = (path === '/logs' ? calls : results).slice(offset, offset + 5);
      return new Response(JSON.stringify({sealed: false, next: rows.length === 5 ? offset + 5 : null, [path === '/logs' ? 'calls' : 'results']: rows}));
    };
    const root = await mkdtemp(join(tmpdir(), 'autolabs-export-rehearsal-')), target = join(root, 'archive');
    const manifest = await exportFollowup('002.1', target, fetcher as any);
    expect(manifest.validation.entireAnalysisEqual).toBe(true); expect(manifest.accounting.accountedCalls).toBe(3600);
    expect(paths.filter(path => path === '/status')).toHaveLength(2);
    const exported = (await readFile(join(target, 'logs-eval.jsonl'), 'utf8')).trim().split('\n');
    expect(exported).toHaveLength(2880);
    expect(manifest.files.some((entry: any) => entry.path === 'raw/logs-003600.json')).toBe(true);
  }, 60000);
  it('writes an exclusive final manifest with byte hashes and never overwrites finished or partial exports', async () => {
    const root = await mkdtemp(join(tmpdir(), 'autolabs-export-test-')), target = join(root, 'archive');
    const result = await writeExclusiveArchive(target, [{path: 'raw/page.json', text: '{"ok":true}\n'}], {runId: 'unit-test'});
    expect(result.archiveComplete).toBe(true); expect(result.files[0].sha256).toBe(sha256('{"ok":true}\n'));
    expect(JSON.parse(await readFile(join(target, 'EXPORT_COMPLETE.json'), 'utf8')).archiveComplete).toBe(true);
    await expect(writeExclusiveArchive(target, [], {})).rejects.toThrow();
    await expect(writeExclusiveArchive(root, [], {})).rejects.toThrow();
    await expect(writeExclusiveArchive(join(root, 'bad'), [{path: '../escaped', text: ''}], {})).rejects.toThrow();
    await expect(stat(join(root, 'escaped'))).rejects.toThrow();
  });
});
