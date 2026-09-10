# Experiment 002 build status

Updated 2026-09-10. Research repository and cloud runner deployed; live page deployed. First request was rejected with HTTP 401 because a legacy local file contained a placeholder credential. No model output was generated. The supplied key passed a non-billable model-access check and has been installed securely. A narrowly scoped initial-authentication retry preserves the failed record and reservation; the scientific protocol is unchanged.

Completed:
- Read existing AutoLabs project rules; primary frontend repository is `../autolabs-edit`, initially clean.
- Verified authenticated GitHub CLI and Cloudflare Wrangler access.
- Located existing server secrets in `../autolabs-edit/orchestrator-worker/.dev.vars` (names only inspected, no credentials copied to this repository).
- Inspected original paper Appendices D and I from the local PDF and official arXiv HTML.
- Registered PROTOCOL.md and task/replay/prompt modules, including five-transfer scoring and capped optimization.
- Implemented isolated durable Worker, fail-closed budget reservations, checkpoints and a five-minute watchdog.
- Verified scientific and operational tests: exact scoring, disjoint task partitions, matched schedules, calibration fixtures, failed-call accounting, restart recovery, sealed evaluations, paired effects and family-held-out prediction comparisons.
- Type check and Cloudflare dry-run build passed.
- Built the read-only AutoLabs live page and experiment navigation, preserving the Erdős archive.

Pending:
- Finish desktop/phone visual verification and initial-authentication recovery.
- Actual $4-capped feasibility run; main run only after valid gate and budget forecast. Entire study max $40.
- Cloud monitoring task, live verification, eventual analysis/export and human evidence audit.
