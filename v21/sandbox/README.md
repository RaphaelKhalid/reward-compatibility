# Experiment 002.1 finite-program checker

This service executes a restricted JSON language, **not arbitrary Python or JavaScript**. It is a Backdoor-Easy-style toy adaptation, not a full replication of that benchmark. Generated text is parsed as data; it is never evaluated, imported, or passed to a shell.

Service-binding HTTP interface: `POST https://checker/execute`, `Content-Type: application/json`.

```json
{"program":{"a":2,"b":1,"trigger":{"x":7,"value":0}},"inputs":[-16,0,7,16]}
```

Returns `{"outputs":[-31,1,0,33]}`. `trigger` is optional. The ordinary program returns `a*x+b`; the exact trigger input returns its replacement. The caller owns all reward definitions, ordinary/trigger test separation, immutable expected outputs, and comparisons. The checker never returns a self-reported reward.

Limits: 4096-byte streamed request, 1-second total body-read deadline, 1–33 inputs, integer input/trigger domain [-16,16], integer coefficients and replacement in [-1,000,000,1,000,000]. At most 33 affine evaluations and outputs of magnitude at most 17,000,000. Exact object fields only. Unknown keys, accessors, inherited/custom prototypes, non-integers, malformed UTF-8, oversized values and arrays are rejected.

The configuration has no routes, public workers.dev endpoint, preview URL, secret, storage, or service bindings. The checker has no outbound-request, filesystem, dynamic import, or evaluation operation. **No network is a property of the finite language and trusted interpreter, not an infrastructure egress firewall on a standard Worker.** Runtime globals still exist for trusted deployed code. Do not extend this to arbitrary generated code. A general-code extension needs independently verified isolation (for example Dynamic Workers `globalOutbound:null` and empty bindings).

No Node compatibility is enabled: this interpreter has no dependencies and deliberately needs no Node API. No request/program contents are logged. Security includes trusting Cloudflare and this short interpreter; tests are evidence, not a proof against platform defects.

From repository root:

```sh
npx vitest run v21/sandbox/sandbox.test.ts
npx tsc -p v21/sandbox/tsconfig.json
npx wrangler deploy --dry-run --config v21/sandbox/wrangler.jsonc
npx wrangler dev --local --config v21/sandbox/wrangler.jsonc --port 8794
```

Before any cloud study: verify the deployed configuration has no bindings/secrets/routes, public and preview endpoints are disabled, run known-case and rejection tests through its authorized caller service binding, then freeze the interpreter/source hash alongside the protocol. Do not treat a local test as proof of the deployed configuration.

References: [service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/), [Dynamic Workers egress controls](https://developers.cloudflare.com/dynamic-workers/usage/egress-control/), [Dynamic Workers resource limits](https://developers.cloudflare.com/dynamic-workers/usage/limits/).
