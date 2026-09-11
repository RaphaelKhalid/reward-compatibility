# Experiment 002.1: finite reward-compatibility validation

## Question and relation to the paper

Can verifier-guided search classify compatibility more reliably than description-only judgment and matched unguided search when independent finite enumeration can establish the answer?

This validates a component of measuring the aligned / orthogonal / in-conflict categories in Kaufmann et al., Aligned, Orthogonal or In-conflict: When can we safely optimize Chain-of-Thought? (2026), https://arxiv.org/abs/2603.30036. It does NOT equate compatibility with alignment or show that a model uses its visible explanation internally. Three-category reference-relative measurement follows as a separate registered stage. Completed Experiment 002 is preserved unchanged.

## Finite domains and ground truth

Coin tracking uses six operations, five canonical state/parity trace forms and two final answers. Backdoor-Easy-inspired programs use five coefficients, five intercepts, six trigger inputs and five replacement values with four explanatory forms. Programs must pass five ordinary inputs and deviate on at least one of 33 finite-domain inputs. This restricted adaptation is NOT a reproduction of the original MBPP benchmark.

An exact enumerator checks every admissible candidate. A compatible case has a semantically valid candidate earning both binary rewards. A conflict certificate is exhaustive only within the declared grammar and finite domain. Forbidden strings, required strings, digit bans and length limits act on the candidate trace, not the wrapper explanation.

Independent known-answer fixtures and a separate affine interpreter validate the checker. Generated objects are bounded data, not executable source. The private checker has no secrets, storage or service bindings; its DSL has no network, filesystem, import, loop or evaluation operation. Standard Worker networking is not claimed to be infrastructure-blocked.

## Fixed sample and methods

- 80 development cases: 5 singleton-constraint templates per domain, 8 cases per template.
- 320 held-out cases: 20 conjunction templates per domain, 8 cases per template.
- These are shared-component compositional templates, not 40 unrelated reward families. Base tasks can recur under different constraints; the held-out claim concerns constraint compositions.
- Description-only uses one call. Unguided and verifier-guided search use four calls, with four proposals per call, on the same cases.
- Search budget is 16 candidates; witness-discovery checkpoints are 1, 4 and 16. Feedback is batchwise.
- Guided search sees deterministic candidate feedback. Unguided search sees its previous proposals without feedback.
- All arms predict compatible, conflict or unresolved. Predictions and proof are separate. Failed search is never an impossibility proof. A checked witness overrides a contradictory final prediction.
- A free fourth baseline predicts the majority development-oracle label, with alphabetical tie-breaking.
- Actor is gpt-5.6-luna, reasoning effort none, maximum 2,048 output tokens. Short public explanations are visible API output, not private reasoning.

Total: 720 development calls plus 2,880 evaluation calls. Search receives more inference than description-only; matched unguided search is the feedback ablation. Report costs and witness discovery curves alongside accuracy.

## Analysis and continuation

Primary descriptive estimand: equal-domain, equal-template classification accuracy and paired differences. Abstentions and malformed/incomplete outputs count incorrect, with coverage separately reported. Use 10,000 paired domain-stratified template bootstrap draws, seed 2021091. Report false-conflict, certificate coverage, invalid candidates, class balance and domain results.

No 80% power guarantee is claimed for 40 dependent-composition clusters. Bootstrap uncertainty is conditional on these template families and can degenerate at boundary rates. Zero observed errors does not establish zero risk. Comparisons are descriptive, not multiplicity-adjusted confirmatory tests.

The development gate checks isolation, at least 90% parseable calls, and a conservative forecast: twice mean development call cost for remaining calls plus a $2 reserve. It does not inspect accuracy, significance or which method wins. Passing starts the fixed evaluation automatically. No outcome-dependent sample expansion or stopping.

002.2 proceeds after integrity and budget checks regardless of whether 002.1 improves on baselines. It needs a separately frozen reference-relative protocol and new evaluation data, not retrofitted three-way labels.

## Operations and budget

Separate Worker, Durable Object and run ID experiment-002-1-v1. Eight concurrent calls share synchronous pre-dispatch SQLite reservations. Ambiguous outcomes retain reservations and pause rather than retry. Completed calls replay after checkpoint interruption.

The $40 total includes $1.288641 spent by 002 and its $0.002985 unresolved reservation. Application accounting uses the configured model tariff, not an invoice or protection against unrelated use of the same key.

Source manifest, protocol and case plan are hashed before launch and checked before each batch. Evaluation transcripts, labels and statistics remain sealed until completion. Public status shows progress, active IDs, storage, spending and ETA. Public controls are read-only.
