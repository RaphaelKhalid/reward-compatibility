/** Restricted affine-program interpreter. This is not a JavaScript/Python sandbox. */
export const LIMITS = Object.freeze({bodyBytes: 4096, inputs: 33, domain: 16, coefficient: 1_000_000, readMs: 1000});
export type Program = {a: number; b: number; trigger?: {x: number; value: number}};

class Rejection extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function record(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) throw new Rejection(400, 'Invalid object');
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== 'string' || ![...required, ...optional].includes(key))) throw new Rejection(400, 'Unknown field');
  for (const key of required) if (!Object.hasOwn(value, key)) throw new Rejection(400, 'Missing field');
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) throw new Rejection(400, 'Invalid property');
  }
  return value as Record<string, unknown>;
}

function integer(value: unknown, bound: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || Math.abs(value) > bound) throw new Rejection(400, 'Integer outside allowed range');
  return value;
}

export function execute(value: unknown): {outputs: number[]} {
  const request = record(value, ['program', 'inputs']);
  const supplied = record(request.program, ['a', 'b'], ['trigger']);
  const program: Program = {a: integer(supplied.a, LIMITS.coefficient), b: integer(supplied.b, LIMITS.coefficient)};
  if (Object.hasOwn(supplied, 'trigger')) {
    const trigger = record(supplied.trigger, ['x', 'value']);
    program.trigger = {x: integer(trigger.x, LIMITS.domain), value: integer(trigger.value, LIMITS.coefficient)};
  }
  if (!Array.isArray(request.inputs) || Object.getPrototypeOf(request.inputs) !== Array.prototype || request.inputs.length < 1 || request.inputs.length > LIMITS.inputs) throw new Rejection(400, 'Invalid input list');
  // Require dense, ordinary arrays; do not execute getters or custom iteration methods.
  if (Reflect.ownKeys(request.inputs).length !== request.inputs.length + 1) throw new Rejection(400, 'Invalid input list');
  const outputs: number[] = [];
  for (let i = 0; i < request.inputs.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(request.inputs, String(i));
    if (!descriptor || !('value' in descriptor)) throw new Rejection(400, 'Invalid input property');
    const x = integer(descriptor.value, LIMITS.domain);
    outputs.push(program.trigger?.x === x ? program.trigger.value : program.a * x + program.b);
  }
  return {outputs};
}

async function boundedJson(request: Request): Promise<unknown> {
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > LIMITS.bodyBytes)) throw new Rejection(413, 'Request too large');
  if (!request.body) throw new Rejection(400, 'Missing body');
  const reader = request.body.getReader();
  const buffer = new Uint8Array(LIMITS.bodyBytes);
  let size = 0;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Rejection(408, 'Body read timeout')), LIMITS.readMs); });
  try {
    for (;;) {
      const chunk = await Promise.race([reader.read(), deadline]);
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > LIMITS.bodyBytes) throw new Rejection(413, 'Request too large');
      buffer.set(chunk.value, size - chunk.value.byteLength);
    }
    return JSON.parse(new TextDecoder('utf-8', {fatal: true, ignoreBOM: false}).decode(buffer.subarray(0, size)));
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    // Cancellation must not extend the response deadline for an uncooperative stream.
    void reader.cancel().catch(() => undefined);
  }
}

export default {
  async fetch(request: Request): Promise<Response> {
    const headers = {'cache-control': 'no-store', 'x-content-type-options': 'nosniff'};
    if (new URL(request.url).pathname !== '/execute') return Response.json({error: 'Not found'}, {status: 404, headers});
    if (request.method !== 'POST') return Response.json({error: 'POST required'}, {status: 405, headers: {...headers, allow: 'POST'}});
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return Response.json({error: 'JSON required'}, {status: 415, headers});
    try {
      return Response.json(execute(await boundedJson(request)), {headers});
    } catch (error) {
      return Response.json({error: error instanceof Rejection ? error.message : 'Invalid request'}, {status: error instanceof Rejection ? error.status : 400, headers});
    }
  },
} satisfies ExportedHandler;
