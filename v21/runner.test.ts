import {DatabaseSync, type SQLInputValue} from 'node:sqlite';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {CompatibilityStudy} from './index';
import checker from './sandbox/index';
import {CAP_MICRO, PRIOR_MICRO, STORAGE_LIMIT, reservation} from './protocol';
import {buildCases} from './domain';
import {promptFor} from './engine';

vi.mock('./build', () => ({BUILD_HASH: 'test-frozen-build'}));

function harness(db = new DatabaseSync(':memory:')) {
  let alarm: number | null = null;
  const sql = {databaseSize: 65_536, exec(query: string, ...args: SQLInputValue[]) {
    if (query.trim().split(';').filter(Boolean).length > 1) {db.exec(query); return {toArray: () => [], one: () => ({})};}
    const rows = db.prepare(query).all(...args);
    return {toArray: () => rows, one: () => {if (rows.length !== 1) throw Error('Expected one row'); return rows[0];}};
  }};
  const ctx = {storage: {sql, setAlarm: async (value: number) => {alarm = value;}, getAlarm: async () => alarm,
    deleteAlarm: async () => {alarm = null;}, transactionSync: <T>(callback: () => T): T => {
      db.exec('BEGIN'); try {const result = callback(); db.exec('COMMIT'); return result;} catch (error) {db.exec('ROLLBACK'); throw error;}
    }}};
  const env = {OPENAI_API_KEY: 'test-never-network', ADMIN_TOKEN: 'test-owner-only', CHECKER: {
    fetch: async (url: string, init: RequestInit) => checker.fetch(new Request(url, init)),
  }};
  const study = new CompatibilityStudy(ctx as never, env as never);
  const state = () => JSON.parse(String(db.prepare("SELECT data FROM meta WHERE id='state'").get()?.data));
  const setState = (patch: Record<string, unknown>) => sql.exec('UPDATE meta SET data=? WHERE id=?', JSON.stringify({...state(), ...patch}), 'state');
  return {study, db, sql, ctx, env, state, setState};
}

function response(text: string, status = 'completed', outputTokens = 20, model = 'gpt-5.6-luna'): Response {
  return Response.json({id: 'response-test', model, status, usage: {input_tokens: 100, output_tokens: outputTokens},
    output: [{type: 'message', content: [{type: 'output_text', text}]}]});
}

function validReply(init?: RequestInit): Response {
  const payload = JSON.parse(String(init?.body));
  const description = payload.input[0].content.includes('Do not propose candidates.');
  return response(JSON.stringify({verdict: 'unresolved', explanation: 'Insufficient evidence', candidates: description ? [] : [{}, {}, {}, {}]}));
}

describe('002.1 durable runner audit: real SQLite and isolated checker, mocked paid API', () => {
  beforeEach(() => {vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => validReply(init)));});
  afterEach(() => {vi.unstubAllGlobals();});

  it('verifies the checker, freezes one plan, and cannot start twice', async () => {
    const h = harness(); await h.study.control('start');
    await expect(h.study.control('start')).rejects.toThrow('action_not_allowed');
    expect(h.state().protocolHash).toMatch(/^[a-f0-9]{64}$/);
    expect(h.db.prepare('SELECT COUNT(*) n FROM jobs').get()?.n).toBe(1200);
    expect(fetch).not.toHaveBeenCalled();
    await h.study.alarm(); expect(fetch).toHaveBeenCalledTimes(8);
  });

  it('uses one shared cap across all eight concurrent calls before a network yield', async () => {
    const h = harness(); await h.study.control('start');
    const first = buildCases('dev').find(item => item.id === 'dev-backdoor-00-0')!;
    const hold = reservation(promptFor(first, 'description', []));
    h.sql.exec('INSERT INTO calls(id,job_id,split,state,reserved,prompt,started) VALUES (?,?,?,?,?,?,?)',
      'previous', 'previous', 'dev', 'unknown', CAP_MICRO - PRIOR_MICRO - hold, 'previous', 0);
    let release: () => void = () => undefined;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {await new Promise<void>(resolve => {release = resolve;}); return validReply(init);}));
    const running = h.study.alarm();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect((await h.study.status()).budget.totalCommittedUsd).toBeLessThanOrEqual(40);
    release(); await running;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await h.study.status()).reason).toBe('budget_pause');
  });

  it('retains ambiguous-call reservations, drains peers, and never retries them', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {throw Error('sensitive upstream detail');}));
    const h = harness(); await h.study.control('start'); await h.study.alarm();
    const before = await h.study.status();
    expect(before.reason).toBe('unknown_api_outcome');
    expect(before.budget.reservedUsd).toBeGreaterThan(0);
    expect(fetch).toHaveBeenCalledTimes(8);
    await h.study.watchdog(); await h.study.alarm();
    expect(fetch).toHaveBeenCalledTimes(8);
    await expect(h.study.control('resume')).rejects.toThrow();
    expect(JSON.stringify(h.study.logs(0))).not.toContain('sensitive upstream');
  });

  it('charges malformed completed output and advances it as an abstention without retry', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response('not JSON')));
    const h = harness(); await h.study.control('start'); await h.study.alarm();
    expect((await h.study.status()).status).toBe('running');
    expect((await h.study.status()).budget.spentUsd).toBeGreaterThan(0);
    expect(h.db.prepare('SELECT SUM(step) n FROM jobs').get()?.n).toBe(8);
    expect(h.db.prepare('SELECT SUM(parsed) n FROM calls').get()?.n).toBe(0);
    const result = h.study.results(0).results[0];
    expect(result.predicted).toBe('unresolved');
  });

  it('charges incomplete API output and records it as an abstention', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response('', 'incomplete', 2048)));
    const h = harness(); await h.study.control('start'); await h.study.alarm();
    expect((await h.study.status()).status).toBe('running');
    expect(h.db.prepare('SELECT SUM(parsed) n FROM calls').get()?.n).toBe(0);
    expect((await h.study.status()).budget.spentUsd).toBeGreaterThan(0.019);
  });

  it('keeps held-out prompts, responses, predictions, and oracle labels sealed', () => {
    const h = harness();
    h.sql.exec('INSERT INTO calls(id,job_id,split,state,reserved,prompt,response,started) VALUES (?,?,?,?,?,?,?,?)',
      'secret-eval', 'secret-eval', 'eval', 'done', 1, 'SEALED PROMPT', '{"text":"SEALED RESPONSE"}', 1);
    h.sql.exec('INSERT INTO jobs(id,case_id,split,method,step,state,history,result) VALUES (?,?,?,?,?,?,?,?)',
      'secret-eval', 'secret-eval', 'eval', 'guided', 4, 'done', '[]', '{"prediction":"SEALED LABEL"}');
    expect(JSON.stringify(h.study.logs(0))).not.toContain('SEALED');
    expect(JSON.stringify(h.study.results(0))).not.toContain('SEALED');
    h.setState({status: 'complete'});
    expect(JSON.stringify(h.study.logs(0))).toContain('SEALED PROMPT');
    expect(JSON.stringify(h.study.results(0))).toContain('SEALED LABEL');
  });

  it('replays a durably completed call after a checkpoint crash without paying twice', async () => {
    const h = harness(); await h.study.control('start'); await h.study.alarm();
    h.sql.exec("UPDATE jobs SET step=0,state='pending',history='[]',result=NULL WHERE id=?", 'dev-backdoor-00-0/description');
    const restored = new CompatibilityStudy(h.ctx as never, h.env as never);
    const before = vi.mocked(fetch).mock.calls.length;
    await restored.alarm();
    expect(vi.mocked(fetch).mock.calls.length - before).toBe(7);
    expect(h.db.prepare('SELECT step FROM jobs WHERE id=?').get('dev-backdoor-00-0/description')?.step).toBe(1);
  });

  it('drains eight paid calls on an owner pause and resumes without erasing billing', async () => {
    const releases: (() => void)[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {await new Promise<void>(resolve => releases.push(resolve)); return validReply(init);}));
    const h = harness(); await h.study.control('start'); const run = h.study.alarm();
    await vi.waitFor(() => expect(releases).toHaveLength(8));
    await h.study.control('pause'); await expect(h.study.control('resume')).rejects.toThrow();
    releases.forEach(resolve => resolve()); await run;
    const paused = await h.study.status();
    expect(paused.status).toBe('paused'); expect(paused.active).toHaveLength(0);
    expect(paused.nextWakeAt).toBeNull();
    await h.study.control('resume');
    expect((await h.study.status()).budget.spentUsd).toBe(paused.budget.spentUsd);
  });

  it('pauses before storage exhaustion without submitting or deleting a call', async () => {
    const h = harness(); await h.study.control('start'); h.sql.databaseSize = STORAGE_LIMIT;
    await h.study.alarm();
    expect(fetch).not.toHaveBeenCalled(); expect((await h.study.status()).reason).toBe('storage_pause');
    expect(h.db.prepare('SELECT COUNT(*) n FROM jobs').get()?.n).toBe(1200);
  });

  it('charges an unexpected model response before pausing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response('{}', 'completed', 20, 'other-model')));
    const h = harness(); await h.study.control('start'); await h.study.alarm();
    expect((await h.study.status()).reason).toBe('unexpected_model');
    expect((await h.study.status()).budget.spentUsd).toBeGreaterThan(0);
  });

  it('rejects a persisted protocol fingerprint mismatch before another paid request', async () => {
    const h = harness(); await h.study.control('start'); h.setState({protocolHash: 'tampered'});
    await h.study.alarm();
    expect(fetch).not.toHaveBeenCalled();
    expect((await h.study.status()).status).toBe('paused');
  });

  it('freezes the development baseline, then computes and caches 10,000 paired draws only at completion', async () => {
    const h = harness(); await h.study.control('start');
    h.sql.exec("UPDATE jobs SET state='done' WHERE split='dev'");
    for (const item of buildCases('dev')) {
      h.sql.exec('UPDATE jobs SET result=? WHERE id=?', JSON.stringify({truth: item.variant % 2 ? 'conflict' : 'compatible'}), `${item.id}/description`);
    }
    for (let call = 0; call < 720; call++) h.sql.exec('INSERT INTO calls(id,job_id,split,state,reserved,charged,prompt,started,parsed) VALUES (?,?,?,?,?,?,?,?,?)',
      `dev-fixture-${call}`, 'dev-fixture', 'dev', 'done', 20, 10, 'fixture', call, 1);
    await h.study.alarm();
    expect((await h.study.status()).stage).toBe('eval');
    const baseline = JSON.parse(String(h.db.prepare("SELECT data FROM meta WHERE id='baseline'").get()?.data));
    expect(baseline.predicted).toBe('compatible'); expect(baseline.developmentCases).toBe(80);
    expect(h.study.analysis()).toEqual({available: false, sealed: true, runId: 'experiment-002-1-v1'});
    for (const item of buildCases('eval')) for (const method of ['description', 'guided', 'unguided']) {
      const truth = item.variant % 2 ? 'conflict' : 'compatible';
      const result = {caseId: item.id, templateId: item.templateId, domain: item.domain, method, truth,
        predicted: method === 'guided' ? truth : 'compatible', certificate: 'none', attempts: ['large transcript excluded by projection']};
      h.sql.exec("UPDATE jobs SET state='done',result=? WHERE id=?", JSON.stringify(result), `${item.id}/${method}`);
    }
    const started = performance.now(); await h.study.alarm(); const elapsed = performance.now() - started;
    const result = h.study.analysis();
    console.info(`002.1 full cached analysis benchmark: ${Math.round(elapsed)} ms, 320 cases, 40 templates, 4 methods, 10000 paired draws`);
    expect((await h.study.status()).status).toBe('complete');
    expect(JSON.stringify(result)).toContain('"resolvedCases":320');
    expect(JSON.stringify(result)).not.toContain('large transcript');
    h.sql.exec("UPDATE jobs SET result='{}' WHERE split='eval'");
    expect(h.study.analysis()).toEqual(result);
    expect(fetch).not.toHaveBeenCalled();
  }, 30_000);
});
