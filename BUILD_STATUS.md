# Current research status

Updated 2026-09-11 UTC.

- Experiment 002: complete, 716/716 main units, preserved at its original Worker and public archive.
- Experiment 002.1: completed all 3,600 steps at 2026-09-11T07:11:48.849Z. Frozen scientific sources unchanged. Guided accuracy 55.3125% versus 55% development-majority baseline; 61/320 cases have guided compatibility witnesses. Complete archive verified under data/followups/experiment-002-1-v1: all prompts replayed, all results reconstructed, entire analysis reproduced exactly. One provider-failed attempt and 11 total malformed/abstaining calls are retained.
- 002.1 live: https://autolabs-ebon.vercel.app/experiments/reward-compatibility-21
- Experiment 002.2: automatically launched at 2026-09-11T07:12:39.894Z after all 10 isolation probes passed and the complete fixed plan fit the shared $40 cap. Development passed 20/20; fixed 4,096-call evaluation is running and sealed. Public interface: https://autolabs-ebon.vercel.app/experiments/reward-categories-22
- Provider-failure recovery: 002.1 resumed after one explicit 503, preserving the failed attempt as an abstention and its $0.003135 uncertain cost allowance. Separate operational adapters leave both scientific manifests unchanged; see each version's OPERATIONS.md and operations-manifest.json. 002.2 configuration recovered before any paid calls.
- Current source tests: 111 passing at the 002.1 launch; public interface: 99 tests, typecheck and production build passing. New-stage tests are separate.
- Published sources contain no API-key literals; credentials are stored only as private local configuration and encrypted Worker secrets.

## Historical Experiment 002 build log

Updated 2026-09-10. Research repository, cloud runner and live page deployed. The feasibility gate passed; the main study is running. The initial HTTP 401 came from a legacy placeholder credential; the supplied key was validated and installed securely. A narrowly scoped initial-authentication retry preserved the failed record and reservation; the scientific protocol is unchanged.

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

Live verification:
- Desktop/phone layouts verified, including live status, log pagination and no horizontal overflow; initial authentication recovered.
- All 68 feasibility units completed and the gate passed. All six criteria passed; 42-step actor correctness was 10/12 (descriptive, not a selection threshold).
- Main study started automatically under the frozen protocol. Conservative forecast at the gate: $4.81285; entire study hard cap remains $40. Initial main-stage spending was $0.01734.

Pending:
- Additional cloud task confirmed an hourly read-only monitor, quiet during healthy progress. The deployed five-minute Worker watchdog also operates independently of local devices.
- Final export (`npm run export`) and human evidence audit after the run finishes.

Parallel execution update:
- Owner-paused and drained at main cursor 35; deployed `parallel-ledger-v1` and resumed the same checkpoint without a restart.
- Verified three simultaneous live calls and advancement to cursor 39; actual ledger size approximately 1.7 MiB against the new 512 MiB soft threshold.
- 32 research tests passed, including concurrency, budget reservation races, drain/recovery, large-page completeness, and compact/full analysis equivalence. Typecheck and Worker dry-run passed.
- Public UI production deployment `252303a` succeeded; 86 website tests and production build passed. Live browser displays concurrent calls and storage usage.
