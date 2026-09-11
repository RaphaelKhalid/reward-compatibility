# Pre-run configuration amendment

On 2026-09-11, the first waiting alarm paused run experiment-002-2-v1 with missing_key. Cloudflare metadata showed both expected secret bindings. No jobs, API calls, budget snapshot, or study start existed.

The initial armed protocol fingerprint was 151ee5cafdc04c5fa38e45a654b9a6aa811179c8ac3ccecdcaa0c00925ca57af (source manifest c18d8d529cf7c4a4e5bd7aa029d7f82ea2341db33293082f1cc85e0ca80e93e8, commit 5510029).

An authenticated retry-config action was added to recover only this pre-run configuration failure. Atomic checks require the missing_key pause, no start, no predecessor budget snapshot, no jobs, no calls, no live lease, and a present configured key. The event ledger preserves old and replacement fingerprints. The action returns to waiting; it does not bypass predecessor completion, sandbox verification, budget checks, or development validation.

No rewards, prompts, samples, evaluation split, analysis, or stopping rules changed. The changed operational source is re-hashed and committed before any Experiment 002.2 paid execution. Experiment 002.1 remains untouched.

## Pre-run provider-failure adapter

After an explicit HTTP 503 interrupted the preceding 002.1 run, a separate operational adapter was prepared for 002.2 before its first paid call. Its original frozen scientific sources and fingerprint are not changed. It consumes explicit provider HTTP 5xx failures as the original planned empty/invalid attempt, preserves prior history, and never requests a replacement for the failed step. The full reserved cost remains conservatively accounted, separately identified as uncertain rather than confirmed provider usage.

Atomic recovery requires a provider-5xx pause, expired lease, no inflight calls, no unrelated ambiguous outcomes, and exact correspondence to the original planned prompt and step. The watchdog waits at least one minute and permits at most five accounted provider failures; other failures remain paused. A separate operations manifest identifies the adapter. All failures and the operational amendment must accompany the final analysis. No score or significance controls this recovery policy.
