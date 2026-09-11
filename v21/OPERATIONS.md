# Operational amendment: failed provider request

On 2026-09-11, Experiment 002.1 paused after an explicit OpenAI HTTP 503 response at 2,255 completed steps out of the frozen 3,600. One attempted request had an unknown bill and a $0.003135 reservation. Evaluation remained sealed; its scores were not inspected to choose this recovery.

The original scientific implementation, protocol, source manifest, and fingerprint are preserved. A separate deployment adapter handles explicit provider HTTP 5xx failures only. It consumes the original planned step as an empty/invalid attempt using the original parser and analysis, preserves any earlier candidate history, and never issues a replacement for that failed request. All remaining planned calls keep their original prompts, budgets and stopping rule.

The full reserved amount is conservatively accounted against the shared cap. It is an uncertain upper-bound charge, not a claim that the provider billed that amount. The public status distinguishes known spend from this allowance; the ledger preserves the original prompt, error, and absent response without inventing model output.

Recovery requires a paused provider-5xx state, expired lease, no inflight calls, and no unrelated unknown requests. Repeated recovery of the same call is prohibited. Guarded watchdog recovery waits at least one minute and stops after five accounted provider failures. Other ambiguous failures still pause for investigation.

The separate operational deployment manifest records the wrapper and configuration. The original scientific fingerprint stays 9375e6a48c97aecb080ae4b1631e1a0e6cad620ce9840454d5907d665d757ea8. Analysis must disclose this operational amendment and all failed attempts; no case may be dropped because of the failure.
