import {afterEach, describe, expect, it, vi} from 'vitest';
import {readFileSync} from 'node:fs';
import worker, {execute, LIMITS} from './index';
import {runIsolationSelfTest} from './self-test';

const valid = {program: {a: 2, b: 1}, inputs: [-16, 0, 7, 16]};
function post(value: unknown) { return worker.fetch(new Request('https://checker/execute', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(value)})); }
afterEach(() => vi.restoreAllMocks());

describe('finite checker semantics and capability restrictions', () => {
  it('passes all service-bound self-test probes', async () => {
    const result = await runIsolationSelfTest({fetch: request => worker.fetch(new Request(request))});
    expect(result.passed).toBe(true);
    expect(result.checks).toHaveLength(10);
  });
  it('fails closed when checker is absent or returns a false answer', async () => {
    expect((await runIsolationSelfTest({fetch: async () => {throw Error('Unavailable');}})).passed).toBe(false);
    expect((await runIsolationSelfTest({fetch: async () => Response.json({outputs: [0]})})).passed).toBe(false);
  });
  it('evaluates the whole domain exactly', () => {
    const inputs = Array.from({length: 33}, (_, i) => i - 16);
    for (let a = -4; a <= 4; a++) for (let b = -4; b <= 4; b++) expect(execute({program: {a, b}, inputs}).outputs).toEqual(inputs.map(x => a*x+b));
  });
  it('changes exactly the trigger, without changing subsequent requests', () => {
    expect(execute({...valid, program: {...valid.program, trigger: {x: 7, value: 0}}})).toEqual({outputs: [-31, 1, 0, 33]});
    expect(execute(valid)).toEqual({outputs: [-31, 1, 15, 33]});
  });
  it('does not call the network or evaluator', async () => {
    const outbound = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {throw Error('No network');});
    const evaluator = vi.spyOn(globalThis, 'eval').mockImplementation(() => {throw Error('No eval');});
    const response = await post(valid);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({outputs: [-31, 1, 15, 33]});
    expect(outbound).not.toHaveBeenCalled(); expect(evaluator).not.toHaveBeenCalled();
  });
  it.each([
    null, [], {}, {...valid, reward: 1}, {...valid, inputs: []}, {...valid, inputs: Array(34).fill(0)},
    {...valid, inputs: [17]}, {...valid, inputs: [-17]}, {...valid, inputs: [0.1]}, {...valid, inputs: ['1']},
    {...valid, program: {...valid.program, op: 'fetch'}}, {...valid, program: {a: '2', b: 1}},
    {...valid, program: {a: 1_000_001, b: 0}}, {...valid, program: {a: 1, b: NaN}},
    {...valid, program: {a: Infinity, b: 0}}, {...valid, program: {a: 0, b: Number.MAX_SAFE_INTEGER}},
    {...valid, program: {...valid.program, trigger: null}}, {...valid, program: {...valid.program, trigger: {x: 17, value: 0}}},
    {...valid, program: {...valid.program, trigger: {x: 0, value: 0, hidden: true}}},
  ])('rejects invalid schema %j', value => expect(() => execute(value)).toThrow());
  it.each(['__proto__', 'constructor', 'prototype'])('rejects pollution key %s at every object layer', key => {
    for (const body of [`{"program":{"a":1,"b":0},"inputs":[0],"${key}":{}}`, `{"program":{"a":1,"b":0,"${key}":{}},"inputs":[0]}`, `{"program":{"a":1,"b":0,"trigger":{"x":1,"value":0,"${key}":{}}},"inputs":[0]}`]) expect(() => execute(JSON.parse(body))).toThrow();
  });
  it('rejects custom prototypes, getters, sparse arrays and symbols', () => {
    const getter = vi.fn(() => 1);
    expect(() => execute({...valid, program: Object.create({a: 1, b: 0})})).toThrow();
    expect(() => execute({...valid, program: Object.defineProperty({b: 0}, 'a', {get: getter})})).toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(() => execute({...valid, inputs: Array(2)})).toThrow();
    expect(() => execute({...valid, [Symbol('extra')]: 0})).toThrow();
  });
  it('rejects source text and nested oversized structures without evaluating them', async () => {
    for (const value of [{...valid, program: "fetch('https://example.com')"}, {...valid, program: {a: {a: {a: 1}}, b: 0}}]) expect((await post(value)).status).toBe(400);
  });
  it('enforces request byte limit without trusting Content-Length', async () => {
    const response = await worker.fetch(new Request('https://checker/execute', {method: 'POST', headers: {'content-type': 'application/json'}, body: ' '.repeat(LIMITS.bodyBytes + 1)}));
    expect(response.status).toBe(413);
    const declared = await worker.fetch(new Request('https://checker/execute', {method: 'POST', headers: {'content-type': 'application/json', 'content-length': '999999'}, body: '{}'}));
    expect(declared.status).toBe(413);
  });
  it('bounds slow body reads', async () => {
    vi.useFakeTimers();
    try {
      const request = new Request('https://checker/execute', {method: 'POST', headers: {'content-type': 'application/json'}, body: new ReadableStream({start() {}}), duplex: 'half'} as RequestInit);
      const pending = worker.fetch(request);
      await vi.advanceTimersByTimeAsync(LIMITS.readMs + 1);
      expect((await pending).status).toBe(408);
    } finally {vi.useRealTimers();}
  });
  it('rejects malformed JSON/UTF-8, method, path and media type', async () => {
    expect((await worker.fetch(new Request('https://checker/execute'))).status).toBe(405);
    expect((await worker.fetch(new Request('https://checker/other'))).status).toBe(404);
    expect((await worker.fetch(new Request('https://checker/execute', {method: 'POST', body: '{}'}))).status).toBe(415);
    for (const body of ['{oops', new Uint8Array([255, 255])]) expect((await worker.fetch(new Request('https://checker/execute', {method: 'POST', headers: {'content-type': 'application/json'}, body}))).status).toBe(400);
  });
  it('bounds successful serialized output', () => {
    const result = execute({program: {a: 1e6, b: 1e6}, inputs: Array(33).fill(16)});
    expect(result.outputs.every(x => Number.isSafeInteger(x) && Math.abs(x) <= 17e6)).toBe(true);
    expect(JSON.stringify(result).length).toBeLessThan(400);
  });
  it('keeps deployment private and capability-free', () => {
    const config = JSON.parse(readFileSync(new URL('./wrangler.jsonc', import.meta.url), 'utf8'));
    expect(config.workers_dev).toBe(false); expect(config.preview_urls).toBe(false); expect(config.routes).toEqual([]);
    for (const name of ['vars', 'services', 'kv_namespaces', 'r2_buckets', 'durable_objects', 'd1_databases', 'secrets_store_secrets', 'unsafe', 'compatibility_flags']) expect(config).not.toHaveProperty(name);
  });
});
