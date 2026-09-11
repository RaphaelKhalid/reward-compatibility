# Reward compatibility — AutoLabs research

## Experiment 002.2: reference-relative reward categories

Registered and deployed; starts automatically after 002.1 completes and its budget accounting is closed. [Live dashboard](https://autolabs-ebon.vercel.app/experiments/reward-categories-22) · [protocol](v22/PROTOCOL.md) · [claim-scope review](v22/REVIEW.md) · [public status](https://autolabs-reward-categories-22.raphaelbahadurkhan.workers.dev/status).

Eight reward templates, 64 matched independent history pairs per template, four calls per arm: 4,096 main calls plus 20 formatting checks. Outcome-only and combined-reward searches have equal budgets. An exact interpreter scores fixed policies over complete small task populations; all tied optima are retained. This measures a bounded version of the paper's reference-relative question, not hidden reasoning or arbitrary natural-language CoT.

Observed semantic-preservation witnesses and population support are separate. The frozen 64-pair distribution-free bounds can support sufficiently strong directions, but **cannot establish population equivalence within ±5 percentage points**. Unresolved results will be reported as unresolved, not relabeled orthogonal. The $40 ceiling includes all earlier project spending and uncertain charge allowances.

## Current study: Experiment 002.1

Finite-domain compatibility classification with independently checkable coin traces and restricted affine-trigger programs. Separate run and ledger; completed 002 is preserved.

- [Live 002.1](https://autolabs-ebon.vercel.app/experiments/reward-compatibility-21)
- [002.1 registered protocol](v21/PROTOCOL.md)
- [002.1 public status](https://autolabs-compatibility-21.raphaelbahadurkhan.workers.dev/status)
- [002.1 final analysis](https://autolabs-compatibility-21.raphaelbahadurkhan.workers.dev/analysis)

80 development cases, 320 fixed held-out cases, three API methods plus a free development-majority baseline. Shared $40 project cap includes the prior 002 spend and outstanding reservation. Compatibility is not alignment; the separate 002.2 stage above studies the reference-relative categories.

Operational amendments preserve the original scientific sources and fingerprints: [002.1 recovery record](v21/OPERATIONS.md), [002.2 recovery record](v22/OPERATIONS.md). Explicit provider 5xx failures consume their original planned attempt as an abstention, never a replacement call. Their full cost allowance remains counted and separately disclosed. At most five such failures are automatically handled; other ambiguous failures remain paused. Held-out outputs stay sealed until each fixed run completes.

## Completed Experiment 002

An exploratory measurement study based on [Kaufmann et al. (2026)](https://arxiv.org/abs/2603.30036). Searches for human-readable high-reward strategies, then tests whether this diagnostic predicts monitoring loss under in-context optimization.

- [AutoLabs homepage — newest experiment](https://autolabs-ebon.vercel.app)
- [Stable Experiment 002 record](https://autolabs-ebon.vercel.app/experiments/reward-compatibility)
- [AutoLabs interface repository](https://github.com/RaphaelKhalid/autolabs)
- [Protocol, limitations and declared deviations](PROTOCOL.md)
- [Public status](https://autolabs-reward-compatibility.raphaelbahadurkhan.workers.dev/status)
- [Visible output logs](https://autolabs-reward-compatibility.raphaelbahadurkhan.workers.dev/logs) (follow the returned `next` offset)
- [Scored records](https://autolabs-reward-compatibility.raphaelbahadurkhan.workers.dev/results) (follow the returned `next` offset)
- [Final analysis](https://autolabs-reward-compatibility.raphaelbahadurkhan.workers.dev/analysis) (sealed until completion)

## Experiment 002 scope

Coin-tracking only. Not a replication of every paper experiment, not a proof of the reward categories, and not a safety certificate. Generated code execution / Backdoor-Easy is deferred. No model weights are trained. Visible explanations are not private reasoning traces.

Actor: Luna with effort none. Independent grading, monitoring and operational summaries: fresh Luna High calls. Same-model evaluator dependence is explicitly a limitation. API cap $40, including all calls and outstanding reservations; first $4 maximum allocated to feasibility.

## Run your own Experiment 002 instance

Requires Node 24+, an OpenAI API key, and a Cloudflare account supporting SQLite Durable Objects. Change the Worker name, run ID and links for your own deployment; never point owner tools at someone else's lab.

```sh
npm ci
npm run types
npm run typecheck
npm test
npm run deploy -- --dry-run
npm run deploy
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put ADMIN_TOKEN
```

Use a random owner token of at least 16 characters. Trigger `POST /admin/start` with its bearer token. Never put keys in URLs or the browser. `pause` and owner-paused `resume` preserve data and spending. Scientific or ambiguous-billing pauses require investigation, not blind automatic resumption.

Cloudflare alarms own execution; the browser is a read-only observer. The five-minute scheduled watchdog repairs missing alarms, not failed scientific gates. A model-call checkpoint is persisted before proceeding. Unknown request outcomes keep their reserved maximum charge. No blind retry. Public reads are cached and paginated. Evaluation prompts/results are not released until completion and never enter replay or reporter context.

## Experiment 002 analysis

The [LaTeX manuscript](paper/main.tex), [compiled PDF](output/pdf/main.pdf), and [completion/submission checklist](paper/README.md) are available as a **pre-results draft**. Numerical results and conclusions remain pending final export and human audit; the draft is not an arXiv submission.

### Execution and ledger safeguards

Operational revision `parallel-ledger-v1` was introduced while owner-paused at main cursor 35 on 2026-09-10. Up to three independent sample pipelines execute concurrently within a unit; optimization units, replay updates, sample ordering, prompts, identifiers, and the registered study design remain unchanged. Resume reuses completed calls. In-flight calls drain before checkpoint release; reservations are committed before network dispatch against the same $40 cap.

Transcripts remain separate SQLite rows, not a growing state blob. Replay entries are also separate rows (legacy buffers remain readable). Records exceeding 1.5 MB fail closed without truncation; public pages target 512 KiB, serving a larger individual record alone. Clients must follow `next`, not assume fixed offsets. A 512 MiB storage threshold, with headroom for in-flight writes, pauses new requests before exhaustion. Final analysis projects only required scores in SQLite instead of loading all transcripts. The public status reports concurrency and actual storage usage. These protections reduce overflow risk; they are not a guarantee against every platform failure.

`src/analysis.ts` builds repeat-level paired effects from exported records. The final figure compares frozen diagnostic estimates with observed additional monitoring loss, alongside correctness and reward attainment. Confidence intervals use independent histories, not thousands of correlated individual completions. All reward families, failures and inconclusive outcomes remain in the record. Human evidence audit is required before strong claims.

After the run is complete, `npm run export` downloads all scored records, checks completeness and regenerates `results.json`, `analysis.json`, `estimates.csv` and a publication-editable `figure.svg` under `data/experiment-002-v01/`. It refuses to make a final figure from sealed or incomplete evaluations. No model calls are made during export.

## License and attribution

Original implementation: MIT (see LICENSE). Scientific ideas and source experiment attributed to Kaufmann, Lindner, Zimmermann and Shah. Prompts here are independently worded adaptations; consult the paper for original text. No affiliation with, endorsement by, or employment relationship with Google DeepMind or OpenAI is implied.
