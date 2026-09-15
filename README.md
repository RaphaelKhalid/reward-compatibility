# Reward compatibility — AutoLabs research

A bounded experiment on whether a reward that values visible reasoning changes
the outcome of a separate, outcome-only reference search.

## Status

**Experiment 002.2 is still in progress.** It started automatically on
2026-09-11 at 07:12:39 UTC after Experiment 002.1 completed. The 20 development
formatting calls were parseable, the fixed evaluation began, and evaluation
records remain sealed until the planned calls finish. Read current state from the
[public status endpoint](https://autolabs-reward-categories-22.raphaelbahadurkhan.workers.dev/status)
or the [live experiment page](https://autolabs-ebon.vercel.app/experiments/reward-categories-22).

This README intentionally does not report a final 002.2 result. No endpoint,
paper draft, or pre-results observation should be treated as a completed
empirical conclusion.

## TL;DR

- The question is reference-relative: can an outcome-only search find a
  higher-quality reference policy than a search that also rewards a visible
  reasoning signal?
- The study uses eight finite reward templates, matched independent histories,
  an exact interpreter, equal budgets, tied-optimum retention, and sealed
  held-out evaluation.
- It measures a bounded finite-policy assay, not hidden reasoning, arbitrary
  natural-language chain of thought, or Google's universal reward categories.
- Experiment 002.1 is complete and descriptive: guided classification accuracy
  was 55.3125% versus a 55% development-majority baseline, with checked
  compatibility witnesses for 61/320 held-out cases.
- The $40 ceiling includes prior spending and uncertain charge allowances.
  Unresolved results remain unresolved rather than being relabeled orthogonal.

## Question

The primary question is:

> Can a small, pre-optimization search for readable, high-reward reasoning
> predict subsequent loss of monitorability better than a description-only
> judgment, initial monitorability, or reasoning length?

The current implementation operationalizes a narrower question about
reference-relative reward categories: under the declared finite interpreter and
search procedure, does adding a reasoning reward change the best discovered
outcome compared with an outcome-only reference arm?

## Competing explanations

The fixed assay distinguishes among:

1. Additional monitoring loss: the combined-reward arm loses more monitored
   outcome than the outcome-only reference.
2. No detectable difference under this search: the combined and outcome-only arms
   have the same observed result within the declared procedure.
3. Search or construct limitation: a negative direction reflects finite search,
   the imposed language, replay choices, ceiling references, or insufficient
   accessibility, not a universal incompatibility.
4. Measurement ambiguity: exact interpreter witnesses, visible-text evidence,
   and population-level support answer different questions and must not be merged.

A successful finite-policy witness is constructive evidence within its declared
semantics. Failed search is unresolved, not an impossibility certificate.

## Identification logic

The experiment holds the task population, prompts, budgets, and registered design
fixed while comparing two isolated searches:

- **Outcome-only arm:** the actor is not told the unused reasoning reward.
- **Combined-reward arm:** the actor receives the outcome reward plus the declared
  reasoning reward.
- **Reference:** the best outcome-only policy discovered with the same accessible
  search procedure.
- **Evaluation:** each tied optimum is retained and scored by the exact interpreter
  over the complete small task population.

The main endpoint is additional monitoring loss:

~~~text
(baseline - terminal monitorability in combined)
-
(baseline - terminal monitorability in outcome-only)
~~~

Positive values mean additional loss in the combined arm. Confidence intervals
are computed at repeat level, not by treating thousands of correlated completions
as independent runs.

## Method at a glance

| Item | Frozen or observed design |
| --- | --- |
| Reward templates | 8 finite templates, including length thresholds, string, semantic coin, simulated preference, and process supervision |
| Matched histories | 64 independent history pairs per template |
| Calls per arm | 4 calls per pair; 4,096 main calls across both arms and all templates, plus 20 formatting checks |
| Main schedule | 8 configurations × 2 conditions × 3 repeats × 12 sequential batches × 1 candidate = 576 candidates and 2,880 fresh transfer evaluations |
| Diagnostics | 4 independently generated strategies, each transferred to 5 distinct diagnostic tasks |
| Evaluation | 10 balanced held-out tasks/history, scored by a fresh fixed monitor; records remain sealed until completion |
| Compute | OpenAI gpt-5.6-luna actor at effort none; fresh Luna high calls for grading, monitoring, audit, and progress |
| Budget | Hard application cap of $40 including retries, failures, grading, reporting, and reservations; feasibility cap $4 |

The 4,096-call accounting and the 576-candidate/2,880-transfer schedule count
different layers of the run. The registered protocol is authoritative for the
frozen schedule and declared deviations.

## What is actually measured

- Exact answer accuracy and reasoning-reward values.
- Blinded coin-identification ratings and visible-text evidence audits.
- Search-discovered policies under the declared finite grammar and budgets.
- Exact semantic-preservation witnesses over complete finite task populations.
- Baseline and terminal monitorability under the fixed held-out evaluation.

Visible explanations are elicited output, not exposed private model reasoning.
No model weights change. No generated code is executed. Backdoor-Easy is deferred
until a sandbox, test harness, and source fidelity are independently verified.

## Evidence available before 002.2 finishes

### Completed 002.1

Experiment 002.1 completed all 3,600 planned steps on 2026-09-11 at 07:11:48
UTC. Guided classification accuracy was 55.3125% versus 55% for the
development-majority baseline, with checked compatibility witnesses for 61/320
held-out cases. These are descriptive results, not evidence of a strong general
classifier.

The verified archive contains replayed prompts/results and reproduced analysis:
[data/followups/experiment-002-1-v1/EXPORT_COMPLETE.json](data/followups/experiment-002-1-v1/EXPORT_COMPLETE.json).
Use the [export instructions](scripts/EXPORT_FOLLOWUPS.md). The public records
remain available through the
[final analysis](https://autolabs-compatibility-21.raphaelbahadurkhan.workers.dev/analysis).
Reported usage was $1.34718 plus a $0.003135 uncertain-charge allowance.

### Exact finite calibration

The separate calibration enumerated all 960 prespecified cells:

| Cell | Count |
| --- | ---: |
| Orthogonal | 592 |
| Aligned | 84 |
| In-conflict | 168 |
| Mixed | 82 |
| Threshold unreached | 34 |

There were zero aligned cells when alpha=0 because the reference already
maximizes outcome over the same accessible set. This is a mathematical property
of the finite calibration model, not evidence that an API model learns better
with process rewards.

## Primary results

There are no final 002.2 results to interpret yet. The fixed evaluation is
sealed while planned calls finish. Once complete, export must pass completeness
checks before generating results.json, analysis.json, estimates.csv, and
figure.svg under data/experiment-002-v01/.

The eventual report must keep these quantities separate:

- observed semantic-preservation witnesses;
- population-support bounds;
- reward attainment and correctness;
- monitorability loss;
- failures and inconclusive runs.

With 64 pairs, the frozen distribution-free bound has an approximately 0.4494
Hoeffding radius. It cannot establish population equivalence within ±5
percentage points. That is a design limitation, not evidence against
orthogonality.

## Why believe the result when it arrives?

The main safeguards are:

- outcome-only and combined searches use isolated histories and equal budgets;
- every tied optimum is retained;
- prompts, sample ordering, identifiers, and registered design remain frozen;
- held-out prompts, answers, and scores stay sealed until completion;
- exact interpreter scores complete finite populations;
- the evidence auditor distinguishes supported computation from unsupported or
  empty explanations;
- unknown billing retains the full reservation and ambiguous requests are not
  blindly retried;
- public routes are read-only, paginated, and cached; owner commands require a
  server-side secret;
- the 002.2 run passed 10 isolation probes and its shared-budget preflight before
  evaluation began.

These controls reduce specific risks; they do not establish statistical
independence, generalization, or a universal safety property.

## Claim ledger

| Evidence state | Supports | Does not support |
| --- | --- | --- |
| 002.1 descriptive accuracy and witnesses | A bounded finite classifier and checked witnesses were obtained in that run | A strong general classifier or universal compatibility categories |
| Exact calibration cells | The declared finite model satisfies the stated category conditions under its assumptions | API learnability, arbitrary chain-of-thought semantics, or cognition |
| One semantic-preservation witness | Constructive compatibility evidence for that reference and operational semantics | Population equivalence or unrestricted orthogonality |
| Failed search or mixed result | The fixed assay did not resolve a direction under its constraints | In-conflict, orthogonal, or impossible in general |
| Robust directional result | A direction under the stated model, search, budget, and stability assumptions | Google's universal category, hidden reasoning, or RL monitorability |

The [claim-scope review](v22/REVIEW.md) and
[external-to-design scope check](v22/EXTERNAL_SCOPE_CHECK.md) are part of the
research record. Both are AI-assisted internal reviews, not external or blinded
peer review.

## Limitations

- The API proposes typed programs and the checker constructs canonical text; it
  does not write unrestricted natural-language explanations.
- Four-call discovered sets are random subsets of a finite grammar. Search
  failure does not prove semantic impossibility.
- Ordered instruction-list equality is a chosen operational equivalence, not
  validated human semantics.
- The study uses two deliberately small domains and eight related reward
  conjunctions. The affine task is Backdoor-Easy-inspired, not the original
  modified MBPP benchmark.
- The actor, graders, monitors, and reporters use the same model family; fresh
  requests prevent context sharing but do not establish independence or a stable
  provider distribution.
- Prompts are independently worded adaptations of the paper, not verbatim
  reproductions. Declared choices are not bit-for-bit replication.
- No weights change, no generated code executes, and the study does not reveal
  private reasoning or test monitorability implications for real model-written
  chain of thought.
- The $40 budget, small finite populations, three repeats, and 64-pair bound
  limit detectable effects and external validity.
- Aligned is a subset of orthogonal, not an unrelated third category.

## Reproduce the current implementation

Requires Node 24+, an OpenAI API key, and a Cloudflare account supporting SQLite
Durable Objects. Change the Worker name, run ID, and public links for a personal
deployment; never point owner tools at someone else's lab.

~~~bash
npm ci
npm run types
npm run typecheck
npm test
npm run deploy -- --dry-run
npm run deploy
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put ADMIN_TOKEN
~~~

Use a random owner token of at least 16 characters. Trigger POST /admin/start
with its bearer token. The browser is a read-only observer. Pause and owner-paused
resume preserve data and spending; scientific or ambiguous-billing pauses require
investigation, not blind automatic resumption.

After the run completes:

~~~bash
npm run export
~~~

Export makes no model calls and refuses to make a final figure from sealed or
incomplete evaluations. The 002.1 archive has separate instructions in
scripts/EXPORT_FOLLOWUPS.md.

## Repository map

- v21/ — registered 002.1 protocol, operations record, and completed-run artifacts.
- v22/ — successor protocol, calibration, cloud runner, analysis, recovery, tests, and claim-scope reviews.
- v23/ — next versioned study materials.
- src/ — shared analysis and experiment interface code.
- scripts/ — export and follow-up reproduction utilities.
- data/ — archived records and export artifacts.
- paper/ — pre-results manuscript and submission checklist.
- output/ — compiled manuscript output.
- tests/ — type, engine, recovery, runner, and isolation checks.

## Earlier Experiment 002

The earlier exploratory study is based on
[Kaufmann et al. (2026)](https://arxiv.org/abs/2603.30036). See the
[AutoLabs homepage](https://autolabs-ebon.vercel.app), the
[stable Experiment 002 record](https://autolabs-ebon.vercel.app/experiments/reward-compatibility),
the [protocol](PROTOCOL.md), and the
[public analysis](https://autolabs-reward-compatibility.raphaelbahadurkhan.workers.dev/analysis).

## License and attribution

Original implementation: MIT (see [LICENSE](LICENSE)). Scientific ideas and
source experiment are attributed to Kaufmann, Lindner, Zimmermann, and Shah.
Prompts are independently worded adaptations. No affiliation with, endorsement
by, or employment relationship with Google DeepMind or OpenAI is implied.