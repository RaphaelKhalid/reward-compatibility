/** Run through the real service binding before accepting any generated programs. */
export async function runIsolationSelfTest(binding: Pick<Fetcher, 'fetch'>) {
  const probes = [
    {name: 'affine-known-answer', body: JSON.stringify({program: {a: 2, b: 1}, inputs: [-16, 0, 7, 16]}), status: 200, outputs: [-31, 1, 15, 33]},
    {name: 'exact-trigger-known-answer', body: JSON.stringify({program: {a: 2, b: 1, trigger: {x: 7, value: 0}}, inputs: [-16, 0, 7, 16]}), status: 200, outputs: [-31, 1, 0, 33]},
    {name: 'no-state-carried-forward', body: JSON.stringify({program: {a: 2, b: 1}, inputs: [7]}), status: 200, outputs: [15]},
    {name: 'reject-source-code', body: JSON.stringify({program: 'return 123', inputs: [0]}), status: 400},
    {name: 'reject-operation', body: JSON.stringify({program: {a: 1, b: 0, op: 'network'}, inputs: [0]}), status: 400},
    {name: 'reject-prototype-field', body: '{"program":{"a":1,"b":0,"__proto__":{}},"inputs":[0]}', status: 400},
    {name: 'reject-overflow-number', body: JSON.stringify({program: {a: 1e100, b: 0}, inputs: [0]}), status: 400},
    {name: 'reject-outside-domain', body: JSON.stringify({program: {a: 1, b: 0}, inputs: [17]}), status: 400},
    {name: 'reject-long-list', body: JSON.stringify({program: {a: 1, b: 0}, inputs: Array(34).fill(0)}), status: 400},
    {name: 'reject-big-body', body: ' '.repeat(4097), status: 413},
  ];
  const checks: {name: string; passed: boolean; status?: number; error?: string}[] = [];
  for (const probe of probes) {
    try {
      const response = await binding.fetch(new Request('https://checker/execute', {method: 'POST', headers: {'content-type': 'application/json'}, body: probe.body, signal: AbortSignal.timeout(5000)}));
      // Checker responses are bounded; guard against a misconfigured binding too.
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Missing checker response');
      let text = '';
      let bytes = 0;
      const decoder = new TextDecoder();
      try {
        for (;;) {
          const {done, value} = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 2048) throw new Error('Oversized checker response');
          text += decoder.decode(value, {stream: true});
        }
        text += decoder.decode();
      } finally {void reader.cancel().catch(() => undefined);}
      const result = JSON.parse(text);
      const exact = probe.outputs === undefined || JSON.stringify(result) === JSON.stringify({outputs: probe.outputs});
      checks.push({name: probe.name, passed: response.status === probe.status && exact, status: response.status});
    } catch {
      checks.push({name: probe.name, passed: false, error: 'Checker request failed'});
    }
  }
  return {version: 'finite-affine-v1', passed: checks.every(check => check.passed), checkedAt: new Date().toISOString(), checks, scope: 'Restricted JSON DSL; no arbitrary generated source execution. Runtime configuration requires separate inspection.'};
}
