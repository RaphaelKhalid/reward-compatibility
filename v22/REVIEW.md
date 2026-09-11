# Pre-result claim-scope review: Experiment 002.2

Review date: 2026-09-10. Reviewed `PROTOCOL.md`, `protocol.ts`, `analysis.ts`, and `frontier.ts`; no paid calls or sealed experimental results were inspected. This is an AI-assisted self-review: the reviewing agent contributed to the scientific modules. It is not independent or blinded peer review. No frozen source was changed for this memo.

## Bottom line

The experiment operationalizes a **bounded version** of Google's question: measure reward compatibility relative to an outcome-only reference, with executable semantics and an explicit search budget. It does not resolve empirical classification for arbitrary LLM reasoning. The strongest defensible contribution is a reproducible finite-policy assay, validated certificates, measured search limitations, and clearly scoped directional evidence if obtained.

## What is actually measured

The paper distinguishes reference-relative semantic improvement, preservation, and conflict, rather than ordinary reward correlation; its arguments also depend on assumptions about semantics and optimization. See [Sections 4.1 and Appendix B](https://arxiv.org/html/2603.30036v1).

Here, candidate programs have exact interpreter semantics. Outcome-only and combined-reward API searches run in separate histories with equal call budgets. Each fixed policy is evaluated over the complete small task population. Analysis retains tied optima, compares their outcomes with the discovered reference, and separately checks whether maximum-CoT-reward text can preserve reference semantics. Failed search is not an impossibility certificate. The exact instruction-cost/alpha frontier is a calibration model, not an estimate of API learnability.

## High-risk validity limits

1. **Construct mismatch.** The API proposes typed programs; the checker constructs canonical text. That is not a model's freely written CoT or private computation. Selection effects in program search do not establish obfuscation, faithfulness, or post-training monitorability.
2. **Reference and ceiling dependence.** Four-call best-found references are protocol-specific, not globally trained reference policies. A reference at outcome one prevents positive improvement. Do not lower it after observing this ceiling.
3. **Limited external validity.** There are two deliberately small domains and eight related reward conjunctions. Shared components are compositional tests, not eight independent research domains. The affine task is Backdoor-Easy-inspired, not the original modified MBPP benchmark. The constructed reward geometry is useful for assay validation but is not itself a novel natural-language safety finding.
4. **Population equivalence cannot pass the frozen bound.** With 64 pairs, the simultaneous Hoeffding radius is approximately 0.4494. An interval this wide cannot fit within the required +/-0.05 equivalence band. Thus this run cannot issue population-equivalence support using its frozen rule, even with identical zero-gain observations. It can still report exact observed semantic-preservation witnesses. This is a design limitation, not evidence against orthogonality.
5. **Independence is assumed, not supplied by an API flag.** Private prompts and separate requests prevent context sharing but do not establish statistical independence or a stable provider distribution. Check model identity, timestamps, failures, and temporal clustering before interpreting population bounds.
6. **Finite semantics are chosen.** Ordered instruction-list equality deliberately distinguishes computations that happen to yield the same answer. It is a declared operational meaning, not a uniquely correct human semantic interpretation. Full-grammar witnesses establish feasibility, not search accessibility at every budget.

## Interpretation rules after unsealing

| Outcome | Defensible statement | Do not claim |
|---|---|---|
| Mixed, failed attainment, or wide bounds | The fixed assay did not resolve the population direction under these constraints. | The rewards are orthogonal, or the framework is false. |
| Outcome-only ceiling | The reference already achieved the maximum task outcome; aligned improvement was unidentifiable here. | Process rewards cannot help reasoning generally. |
| Observed equal outcomes plus witnesses | These recorded histories preserved outcomes, and explicit finite semantic-preservation witnesses exist. | Population equivalence or unrestricted orthogonality is proven. |
| Robust positive/negative direction | Under the stated independence and stability assumptions, equal-budget search favored higher/lower interpreter outcomes relative to the reference on this template. | Google's universal category, hidden reasoning, or RL monitorability has been established. |
| Exact calibration categories | The enumerated finite model satisfies the declared category conditions at specified costs, alpha, threshold, and budget. | The API experiment demonstrated these same conditions in cognition. |

Keep `observedHistoryLabel`, descriptive bootstrap intervals, and robust population `label` visually and verbally separate. Report all templates, failures, attainment rates, reference ceilings, tie ranges, and budgets. A favorable final direction must not cause sample expansion, threshold changes, or selective reporting of a favorable checkpoint.

## Release recommendation

Release as a bounded operationalization and reproducible measurement prototype, with the full ledger and these limitations attached. A credible extension toward Google's broader ask would need empirical reachability in a less restricted explanation language, independent semantic validation, non-ceiling reference tasks, and a separate test connecting the measured categories to monitoring behavior. Such work needs a newly frozen protocol; it must not be retrofitted to the present held-out outcomes.
