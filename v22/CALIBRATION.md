# Exact finite calibration (not empirical API results)

All 960 prespecified cells were enumerated: two finite domains, five singleton CoT rules, eight operational budgets, three shaping assumptions, two reward thresholds, and two semantic-gain margins. No favorable cell was selected as the sole result. The complete machine-readable record is `calibration.json`; reproduce it with `npx vite-node v22/calibrate.ts`.

| Cell label | Count |
|---|---:|
| Orthogonal | 592 |
| Aligned | 84 |
| In-conflict | 168 |
| Mixed | 82 |
| Threshold unreached | 34 |

There were **zero aligned cells when alpha=0**, as required: the reference already maximizes outcome over the same accessible set. Aligned cells require the explicitly declared reward-shaped accessibility model. This is a mathematical calibration property, not evidence that an actual API model learns better when given process rewards.

The coin population contains all 32 initial-state/operation combinations; partial tracking policies score one half, full correct tracking scores one, and full inverted tracking scores zero. The affine-trigger task uses all five declared inputs, with a binary pass-ordinary-tests-and-diverge outcome. Its outcome-only reference reaches the ceiling once a suitable trigger program is accessible. These are small constructed domains, not MBPP replication or unrestricted CoT.

The validation suite checks hand-derived cases, tied references and optimizers, missing attainment, typed-program roundtrips, outcome-arm prompt isolation, and random alpha-zero invariants. The separate paired-history analysis has not generated an empirical finding merely by passing these tests. Report the actual API-discovered frontier only after the fixed empirical run and frozen analysis finish.
