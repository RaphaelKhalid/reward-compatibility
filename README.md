# Reward compatibility — AutoLabs Experiment 002

An exploratory measurement study based on [Kaufmann et al. (2026)](https://arxiv.org/abs/2603.30036). Searches for human-readable high-reward strategies, then tests whether this diagnostic predicts monitoring loss under in-context optimization.

- [AutoLabs homepage — newest experiment](https://autolabs-ebon.vercel.app)
- [Stable Experiment 002 record](https://autolabs-ebon.vercel.app/experiments/reward-compatibility)
- [AutoLabs interface repository](https://github.com/RaphaelKhalid/autolabs)
- [Protocol, limitations and declared deviations](PROTOCOL.md)
- [Public status](https://autolabs-reward-compatibility.raphaelbahadurkhan.workers.dev/status)
- [Visible output logs](https://autolabs-reward-compatibility.raphaelbahadurkhan.workers.dev/logs) (`?offset=10` pagination)
- [Scored records](https://autolabs-reward-compatibility.raphaelbahadurkhan.workers.dev/results) (`?offset=20` pagination)
- [Final analysis](https://autolabs-reward-compatibility.raphaelbahadurkhan.workers.dev/analysis) (sealed until completion)

## Scope

Coin-tracking only. Not a replication of every paper experiment, not a proof of the reward categories, and not a safety certificate. Generated code execution / Backdoor-Easy is deferred. No model weights are trained. Visible explanations are not private reasoning traces.

Actor: Luna with effort none. Independent grading, monitoring and operational summaries: fresh Luna High calls. Same-model evaluator dependence is explicitly a limitation. API cap $40, including all calls and outstanding reservations; first $4 maximum allocated to feasibility.

## Run your own instance

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

## Analysis

`src/analysis.ts` builds repeat-level paired effects from exported records. The final figure compares frozen diagnostic estimates with observed additional monitoring loss, alongside correctness and reward attainment. Confidence intervals use independent histories, not thousands of correlated individual completions. All reward families, failures and inconclusive outcomes remain in the record. Human evidence audit is required before strong claims.

After the run is complete, `npm run export` downloads all scored records, checks completeness and regenerates `results.json`, `analysis.json`, `estimates.csv` and a publication-editable `figure.svg` under `data/experiment-002-v01/`. It refuses to make a final figure from sealed or incomplete evaluations. No model calls are made during export.

## License and attribution

Original implementation: MIT (see LICENSE). Scientific ideas and source experiment attributed to Kaufmann, Lindner, Zimmermann and Shah. Prompts here are independently worded adaptations; consult the paper for original text. No affiliation with, endorsement by, or employment relationship with Google DeepMind or OpenAI is implied.
