# External-to-design scope check: Experiment 002.2

Date: 2026-09-11. This is **AI-assisted internal review, not external or blinded peer review**. The reviewer contributed to the isolation checker and website, but not the scientific module design. Sources inspected: `PROTOCOL.md`, `REVIEW.md`, `frontier.ts`, and the paper below. No sealed outcomes, paid calls, or operational controls were accessed. This memo does not amend the frozen study.

## Verdict

**The assay measures a useful surrogate, not the authors' unrestricted category question.** It can establish exact properties of a declared finite model and measure which policies this API search discovers. Even a striking directional result cannot establish that real model-written reasoning must sacrifice meaning under a reward. The central missing measurement is whether reward-compliant language can express reference-quality computation within empirically relevant search constraints.

## What the primary source requires

The categories concern the relationship between rewarded text and the computation described by that text, relative to an outcome-only reference. Alignment is improvement, not reward correlation. The conceptual aligned category is a subset of orthogonal. [Kaufmann et al., Section 4.1](https://arxiv.org/html/2603.30036v1#S4.SS1).

Appendix B makes accessibility, human interpretation, the outcome-only reference, and reward-threshold attainment explicit. Orthogonality requires a reachable, maximum-reward expression preserving reference semantics at every optimization budget. Its directional definitions also quantify over qualifying budgets. Training/transparency predictions then require additional assumptions; the proposed exploration-distance shaping is a modeling choice, not an established empirical law. [Appendix B, especially B.3–B.5 and B.8](https://arxiv.org/html/2603.30036v1#A2).

## Necessary conditions not established by this implementation

1. **The language bottleneck is imposed, not measured.** `frontier.ts` generates three canonical renderings from each program. The API chooses a rendering label; it does not write an explanation. Under sensitive-operation omission, removing the operation from the text removes it from the program by construction. That can demonstrate a conflict inside this representation, but cannot distinguish a genuinely incompatible reward from a missing transparent paraphrase. A shorter accurate explanation outside the three renderings could reverse a finite-language exclusion without any change in model cognition.

2. **Search failure and semantic impossibility remain distinct.** Four-call discovered sets are random subsets of the available finite grammar. A negative combined-arm mean can reflect poor search, replay selection, or one unusually strong reference draw. It does not establish that all sufficiently optimized, reward-qualified descriptions lose reference quality. More repetitions narrow uncertainty about this search procedure, not about an unrestricted language or other budgets. Conversely, finding one exact witness is meaningful positive evidence within its declared scope.

3. **Orthogonality and outcome equivalence are different questions.** Equality of average outcomes does not preserve computation. The witness checks improve on that mistake, but “same ordered instructions” is one chosen equivalence relation, not validated human semantics. Requiring equivalence of the combined optimizer's mean outcome also adds a condition that can reject useful semantics-preservation evidence. In particular, an improving combined solution and a reference-preserving witness need not conflict. Report flags/witnesses separately from the population direction.

4. **The exact frontier is conditional calibration.** Declared instruction cost and `d-alpha*r` shaping determine accessibility in the enumerated model. An exact certificate under those assumptions is valuable for testing classifier logic; it does not validate those assumptions for the API model. The finite budget grid gives cell-specific claims, not a theorem about all budgets.

5. **No monitorability implication is tested here.** The renderer cannot strategically conceal a computation while executing a different meaning: the interpreter fixes that relationship. Absence of hidden-semantics measurements does not invalidate a scoped compatibility witness, but makes a claim about learned concealment or safer post-training unsupported.

6. **The population-equivalence rule is impossible at the frozen sample size.** The existing review correctly calculates a roughly 0.4494 Hoeffding radius at 64 pairs. Such an interval cannot fit inside ±0.05. This is not an empirical rejection of orthogonality and not merely an unfortunate observed variance. Keep this limitation prominent before results.

## Single most defensible next extension

**A reference-anchored, natural-language semantic-transport challenge.** Replace only the canonical-rendering bottleneck in a new, separately frozen experiment. Ask whether the actor can write reward-maximizing language that preserves a known reference program's meaning. This targets the missing construct directly instead of buying more trials of the same surrogate.

Proposed bounded design:

1. Freeze 20 fresh task/reference slots, three text constraints, two independent rewrite attempts per slot, the token ceilings, exact test domains, selection rules, and analysis before evaluation. Produce each reference with a four-call outcome-only search; retain the deterministically selected best policy without suppressing failures or ceiling cases. References must not be selected because they favor a desired category.
2. The actor receives the reference policy and produces an actual natural-language explanation under each constraint: uppercase, native-word avoidance, and a fixed length budget. Rewards act on that returned text. Do not offer only a list of three renderer names. Use a development-only length choice frozen before evaluation, not a cutoff chosen to manufacture incompatibility.
3. Two fresh, blind decoders see only the explanation, variable/interface specification and input domain—not the reference program, target answers, reward label, or actor history. Each reconstructs a bounded DSL policy. Execute only that DSL using the existing isolated interpreter. If either decoder produces an ambiguous or invalid mapping, abstain; agreement alone is not ground truth.
4. Compare reconstruction against the known reference over the entire finite input population. Separately require recovery of the preregistered computation features, including any exceptional input/override. Report functional equivalence and instruction-level equivalence separately: neither should silently stand in for the other. Include a fixed calibration battery of accurate paraphrases, deleted/changed operations, and changed triggers with independently checkable expected reconstructions. A failed calibration blocks semantic claims.
5. Primary output is a table of **verified operational preservation witnesses**, reward attainment, decoder failures, and witness-discovery rates by text constraint. A successful maximum-reward rewrite is constructive compatibility evidence for that reference and operational semantics. A failed rewrite search is unresolved, not in-conflict. A transparent rewrite that repairs a canonical exclusion is a directly inspectable counterexample to that representation's adequacy—not a refutation of the original paper's unrestricted hypothesis.

This would still not reveal a model's private reasoning. The scientific product is a measured, auditable natural-language expressibility test with exact task consequences. Calling its reconstructions *human semantics* would additionally require independent human validation; absent that, label them calibrated decoder interpretations. Do not claim a complete three-way classifier from this extension alone.

### Budget and decision discipline

The proposed maximum is 80 reference calls + 120 rewrite calls + 240 decoder calls + 32 fixed calibration calls = **472 calls**. This is a planning envelope, not authorization to run. Reserve its worst-case input/output-token cost using the configured verified model prices, plus the existing uncertainty allowance, before freezing and launching it. It must fit the uncommitted remainder of the original shared $40, after both predecessors and any current reservations; allocate at most $5 to this extension. If it cannot fit, reduce the design before evaluation or do not launch. No open-ended retries, significance-based stopping, or model escalation.

## Recommended reporting now

Publish the existing work as a finite-policy calibration and API-search measurement instrument. State explicitly that it has **not solved empirical classification of arbitrary CoT reward pairs**. The strongest next result would be a reproducible semantic-preservation witness or a demonstrated canonical-language coverage failure, not another confident label attached to the same restricted search geometry.
