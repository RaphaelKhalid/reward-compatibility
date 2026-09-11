# Export completed follow-up experiments

Run from the research repository after the relevant public status is `complete`:

```sh
npx vite-node scripts/export-followups.ts 002.1
npx vite-node scripts/export-followups.ts 002.2
```

Default destinations are `data/followups/experiment-002-1-v1` and
`data/followups/experiment-002-2-v1`. An optional second argument selects a **new**
destination directory:

```sh
npx vite-node scripts/export-followups.ts 002.1 data/followups/independent-recheck-002-1
```

No API key, owner secret or cloud credentials are needed. The script issues public
GETs only, in fixed five-record pages with at most four simultaneous requests.
It refuses a sealed/incomplete status before requesting logs, results or analysis.
There are no model calls, automatic retries, deployment changes or scientific
protocol edits.

## What is checked

- Exact registered run, model, version, protocol fingerprint and source build;
  local frozen file hashes, plus the operational amendment when present.
- Complete planned calls and results, unique identities, correct development and
  evaluation splits, zero active/reserved calls, and the shared $40 cap.
- Known usage-derived charges separately from documented `failed-accounted`
  HTTP-5xx reservation upper bounds. These failures remain abstentions; no usage
  or response is invented. Malformed/incomplete responses remain in the archive.
- Every prompt and final result reconstructed using the frozen local functions,
  followed by exact equality of the entire recomputed analysis.
- Matching before/after completion status and page counts/cursors.

## Archive contents

`raw/` preserves the received public page text. Separate `logs-dev.jsonl`,
`logs-eval.jsonl`, `results-dev.jsonl` and `results-eval.jsonl` retain all records.
The protocol, before/after status, reported and recomputed analyses, and frozen
source/operational manifests are included. `EXPORT_COMPLETE.json` records every
artifact's SHA-256 and byte count, the validated accounting and scope limitations.

**The destination must not already exist, even if a prior export was partial.**
Files are created exclusively, and `EXPORT_COMPLETE.json` is written last.
An interrupted write may leave an incomplete directory; preserve it for diagnosis
and choose a fresh destination. Do not treat a directory without the completion
marker as a verified archive. The script never overwrites an existing export.

These are public runner records, not complete OpenAI wire responses or independent
billing attestations. A source fingerprint validates the specified code, not the
authenticity of a remote server. The predecessor commitment remains a ledger
snapshot; this exporter does not re-audit earlier billing. Passing these checks is
an archival/reproducibility result, not evidence for a scientific hypothesis.

## Offline tests

```sh
npx vitest run tests/export-followups.test.ts
```

Tests use mocked responses only, including a complete 002.1 archive rehearsal and
002.2 result/analysis reconstruction. They never access sealed production data.
