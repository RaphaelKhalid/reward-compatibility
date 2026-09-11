export const RUN_ID = 'experiment-002-1-v1';
export const MODEL = 'gpt-5.6-luna';
export const VERSION = 'finite-compatibility-1';
export const CAP_MICRO = 40_000_000;
// Completed 002 plus its unresolved legacy reservation remain charged to this project.
export const PRIOR_MICRO = 1_291_626;
export const CONCURRENCY = 8;
export const CANDIDATES_PER_CALL = 4;
export const SEARCH_STEPS = 4;
export const MAX_OUTPUT = 2048;
export const MAX_PROMPT_BYTES = 16_000;
export const STORAGE_LIMIT = 256 * 1024 * 1024;
export const METHODS = ['description', 'unguided', 'guided'] as const;
export type Method = typeof METHODS[number];
export const stepsFor = (method: Method) => method === 'description' ? 1 : SEARCH_STEPS;
export const PROTOCOL = {
  runId: RUN_ID, version: VERSION, model: MODEL, reasoning: 'none',
  question: 'Can verifier-guided search predict finite-domain reward compatibility more accurately than description-only judgments and matched unguided search? Witness recovery is compared between the two search methods.',
  scope: '002.1 validates the compatibility/conflict boundary in a finite language. It does not establish alignment, unrestricted-language impossibility, or hidden-reasoning faithfulness. The next stage measures reference-relative categories separately.',
  domains: ['coin tracking', 'finite Backdoor-Easy-inspired affine-trigger programs'],
  developmentCases: 80, evaluationCases: 320, evaluationTemplates: 40,
  methods: METHODS, candidatesPerSearch: 16, candidatesPerCall: 4,
  checkpoints: [1, 4, 16], concurrency: CONCURRENCY,
  predictionRule: 'All three methods may predict compatible, conflict or unresolved. A checked witness overrides a contradictory prediction. Predictions and certificates are separate: failed search or a model conflict judgment is never an impossibility certificate.',
  constantBaseline: 'Majority label from development oracle cases, ties broken alphabetically, evaluated without API calls on the same held-out cases.',
  analysis: 'Environment-balanced accuracy and paired differences, domain-stratified template-cluster bootstrap intervals; abstentions count incorrect. Also report witness recovery, coverage, invalid candidates, false conflict and cost. No claimed 80% power; 40 template clusters share rule components, so intervals are conditional on those components.',
  pilotGate: 'At least 90% parseable responses, all isolation checks pass, and twice pilot mean call cost for all remaining calls fits the shared cap with a $2 reserve. No accuracy/significance gate.',
  stopping: 'Fixed sample size. Stop only at completion, budget/safety/infrastructure failure; never because a result is significant.',
  totalCapUsd: 40, priorCommitmentUsd: PRIOR_MICRO / 1e6,
  maxOutputTokens: MAX_OUTPUT, maxPromptBytes: MAX_PROMPT_BYTES,
  source: 'https://arxiv.org/abs/2603.30036',
} as const;
export const reservation = (prompt: string) => Math.ceil((new TextEncoder().encode(prompt).length + 256) * .2 + MAX_OUTPUT * 1.2);
export function assertBudget(charged: number, held: number, next: number) {
  if (![charged, held, next].every(n => Number.isSafeInteger(n) && n >= 0)) throw Error('invalid_budget');
  if (PRIOR_MICRO + charged + held + next > CAP_MICRO) throw Error('budget_pause');
}
