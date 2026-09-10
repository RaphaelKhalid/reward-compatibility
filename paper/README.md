# Manuscript

`main.tex` is a pre-results scientific manuscript, not an arXiv-ready submission. The experiment's primary protocol is unchanged. It contains no fabricated results or synthetic result plots. The sole-author byline is provisional pending confirmation of the exact name/affiliation.

## Build

From `paper/`, use `pdflatex main.tex` twice, or `tectonic main.tex`. The bibliography is embedded so BibTeX is not required. A compiled preview is kept in `../output/pdf/main.pdf`; the preview and source must be updated together after edits. Standard TeX packages are used; no shell escape is required.

## Complete after the study

1. Confirm all frozen units completed. Run `npm run export` from the repository root; do not bypass its completeness/sealing checks.
2. Audit counts, paired task IDs, all returned model identifiers, failures, cost accounting, exact scores, and analysis consistency. Check that task reuse is not described as independent evidence.
3. Freeze a human-audit plan before inspecting final effects. Prefer all 160 diagnostic transfers, blinded to reward family, treatment outcomes and automatic audit label where practical. Reward criteria must be checked separately; do not ask blinded raters to guess them. Preserve original and human labels. Do not promise human auditing is already complete.
4. Fill all pending results, add intervals, and report every family-held-out MAE including the intercept baseline. Convert the exported SVG to vector PDF as `paper/figures/main-results.pdf` for inclusion. The figure is descriptive; predictive value also requires the MAE comparison.
5. Separate registered endpoints from additional human-audit/robustness analyses. Report unsupported, negative and inconclusive results honestly. No theoretical classification or causal-faithfulness claims.
6. Confirm authorship, AI disclosure, related work, final title/abstract, data license and an immutable archive. Remove the provisional byline and draft banner only after human review. Search for every `pending` marker before release.

## Submission route

The current goal is a defensible short empirical methods paper. arXiv is a moderated preprint repository, not peer review; depositing a paper is not journal/conference acceptance. First submissions or new categories may require endorsement. Read [submission guidance](https://info.arxiv.org/help/submit/index.html), [endorsement](https://info.arxiv.org/help/endorsement.html), and [TeX requirements](https://info.arxiv.org/help/submit_tex.html). Check the current rules again at submission time. Submission is free.

First finish/audit the evidence and get a knowledgeable human's critical read. Then consider an arXiv preprint and a suitably scoped interpretability/safety workshop or other venue. No venue fit, novelty, endorsement, or acceptance is guaranteed. If the evidence is too limited for a paper, a transparent technical report is preferable to overstated claims. Do not submit or contact researchers automatically.

Only package manuscript source and required figure assets for submission. Never upload the entire research repository, `.dev.vars`, logs containing credentials, local tooling, or API keys. Publishing this draft repository is not an arXiv submission.
