/** Preregistered descriptive analysis; no outcome-dependent stopping or sample expansion. */
export const ANALYSIS_PLAN = Object.freeze({
  developmentCases: 80,
  evaluationCases: 320,
  evaluationTemplatesPerDomain: 20,
  casesPerTemplate: 8,
  bootstrapReplicates: 10_000,
  bootstrapSeed: 2_021_091,
  confidenceLevel: 0.95,
  scope: 'Compositional generalization within two finite-domain grammars; not unrestricted natural-language reward classification.',
  precisionNote: 'No 80% power guarantee. At perfect within-template dependence, 40 templates give a worst-case normal-approximation accuracy half-width of about 15.5 percentage points. Paired precision depends on method discordance.',
});

export interface ClassificationRow {
  caseId: string;
  templateId: string;
  domain: string;
  method: string;
  truth: string;
  predicted: string | null;
  certificate?: 'valid' | 'invalid' | 'none';
}

interface Metrics {
  accuracy: number;
  coverage: number;
  selectiveError: number | null;
  falseConflictRate: number | null;
  certifiedCoverage: number;
  invalidCertificateRate: number | null;
}

interface DomainMetrics extends Metrics {
  domain: string;
  templates: number;
  cases: number;
  accuracyInterval: [number, number] | null;
}

interface MethodMetrics extends Metrics {
  method: string;
  accuracyInterval: [number, number] | null;
  domains: DomainMetrics[];
}

export interface ClassificationAnalysis {
  plan: typeof ANALYSIS_PLAN;
  status: 'descriptive';
  estimand: string;
  intervalWarning: string;
  cases: number;
  resolvedCases: number;
  unresolvedCases: number;
  templates: number;
  bootstrap: {replicates: number; seed: number; available: boolean};
  methods: MethodMetrics[];
  comparisons: {methodA: string; methodB: string; accuracyDifference: number; interval: [number, number] | null}[];
}

interface Template {
  id: string;
  domain: string;
  cases: ClassificationRow[][];
}

interface Counts {
  accuracy: number;
  coverage: number;
  falseConflict: number;
  nonConflict: number;
  certified: number;
  invalid: number;
  submitted: number;
}

const average = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;
const ratio = (numerator: number, denominator: number): number | null => denominator > 0 ? numerator / denominator : null;
const abstains = (prediction: string | null): boolean => prediction === null || prediction === 'unresolved';

function summarize(templates: Template[], method: number): Metrics {
  const domains = [...new Set(templates.map(template => template.domain))];
  const counts = domains.map(domain => {
    const clusterCounts = templates.filter(template => template.domain === domain).map(template => {
      const rows = template.cases.map(cases => cases[method]);
      const rate = (condition: (row: ClassificationRow) => boolean): number => average(rows.map(row => Number(condition(row))));
      return {
        accuracy: rate(row => !abstains(row.predicted) && row.predicted === row.truth),
        coverage: rate(row => !abstains(row.predicted)),
        falseConflict: rate(row => row.truth !== 'conflict' && row.predicted === 'conflict'),
        nonConflict: rate(row => row.truth !== 'conflict'),
        certified: rate(row => row.certificate === 'valid'),
        invalid: rate(row => row.certificate === 'invalid'),
        submitted: rate(row => row.certificate === 'valid' || row.certificate === 'invalid'),
      };
    });
    const aggregate = (key: keyof Counts): number => average(clusterCounts.map(count => count[key]));
    return {accuracy: aggregate('accuracy'), coverage: aggregate('coverage'), falseConflict: aggregate('falseConflict'),
      nonConflict: aggregate('nonConflict'), certified: aggregate('certified'), invalid: aggregate('invalid'), submitted: aggregate('submitted')};
  });
  const macro = (key: keyof Counts): number => average(counts.map(count => count[key]));
  const accuracy = macro('accuracy'), coverage = macro('coverage');
  return {
    accuracy,
    coverage,
    selectiveError: ratio(coverage - accuracy, coverage),
    falseConflictRate: ratio(macro('falseConflict'), macro('nonConflict')),
    certifiedCoverage: macro('certified'),
    invalidCertificateRate: ratio(macro('invalid'), macro('submitted')),
  };
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state += 0x6D2B79F5;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4_294_967_296;
  };
}

function percentile(values: number[], probability: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * probability;
  const lower = Math.floor(index), upper = Math.ceil(index);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function interval(values: number[]): [number, number] {
  return [percentile(values, 0.025), percentile(values, 0.975)];
}

/** Predictions are not certificates. In particular, unsuccessful search may predict
 * conflict, but its prediction never becomes a proof merely by repetition. */
export function analyzeClassification(rows: ClassificationRow[], options: {replicates?: number; seed?: number} = {}): ClassificationAnalysis {
  const replicates = options.replicates ?? ANALYSIS_PLAN.bootstrapReplicates;
  const seed = options.seed ?? ANALYSIS_PLAN.bootstrapSeed;
  if (!Number.isSafeInteger(replicates) || replicates < 100 || replicates > 100_000) throw new Error('Invalid bootstrap replicate count');
  if (!Number.isSafeInteger(seed)) throw new Error('Invalid bootstrap seed');
  if (!rows.length) throw new Error('No classification rows');
  const methods = [...new Set(rows.map(row => row.method))].sort();
  const cases = new Map<string, ClassificationRow[]>();
  for (const row of rows) {
    if (![row.caseId, row.templateId, row.domain, row.method, row.truth].every(value => typeof value === 'string' && value.length > 0)) throw new Error('Invalid classification identifier');
    if (row.predicted !== null && (typeof row.predicted !== 'string' || row.predicted.length === 0)) throw new Error('Invalid prediction');
    if (row.certificate !== undefined && !['valid', 'invalid', 'none'].includes(row.certificate)) throw new Error('Invalid certificate status');
    const paired = cases.get(row.caseId) ?? [];
    if (paired.some(previous => previous.method === row.method)) throw new Error(`Duplicate method for case ${row.caseId}`);
    if (paired.some(previous => previous.truth !== row.truth || previous.domain !== row.domain || previous.templateId !== row.templateId)) throw new Error(`Inconsistent paired case ${row.caseId}`);
    paired.push(row);
    cases.set(row.caseId, paired);
  }
  const templates = new Map<string, Template>();
  let unresolvedCases = 0;
  for (const [caseId, paired] of cases) {
    if (paired.length !== methods.length) throw new Error(`Missing paired method for case ${caseId}; record failures as abstentions`);
    const reference = paired[0];
    if (reference.truth === 'unresolved') { unresolvedCases++; continue; }
    const key = JSON.stringify([reference.domain, reference.templateId]);
    const template = templates.get(key) ?? {id: reference.templateId, domain: reference.domain, cases: []};
    template.cases.push(methods.map(method => paired.find(row => row.method === method)!));
    templates.set(key, template);
  }
  const clusters = [...templates.values()];
  if (!clusters.length) throw new Error('No oracle-resolved cases');
  const domains = [...new Set(clusters.map(cluster => cluster.domain))].sort();
  const strata = domains.map(domain => clusters.filter(cluster => cluster.domain === domain));
  const enoughClusters = strata.every(stratum => stratum.length >= 2);
  const random = seededRandom(seed);
  const draws: number[][] = [];
  const domainDraws: number[][][] = domains.map(() => []);
  // A cluster's accuracy does not change between resamples. Precompute these
  // sufficient statistics so the cloud runner does not repeatedly parse traces
  // or recompute unrelated metrics during the 10,000 bootstrap draws.
  const accuracyStrata = strata.map(stratum => stratum.map(template => methods.map((_, method) =>
    average(template.cases.map(paired => Number(!abstains(paired[method].predicted) && paired[method].predicted === paired[method].truth))))));
  if (enoughClusters) for (let draw = 0; draw < replicates; draw++) {
    const sampled = accuracyStrata.map(stratum => {
      const sums = methods.map(() => 0);
      for (let cluster = 0; cluster < stratum.length; cluster++) {
        const selected = stratum[Math.floor(random() * stratum.length)];
        selected.forEach((value, method) => {sums[method] += value;});
      }
      return sums.map(sum => sum / stratum.length);
    });
    draws.push(methods.map((_, method) => average(sampled.map(stratum => stratum[method]))));
    sampled.forEach((stratum, domain) => domainDraws[domain].push(stratum));
  }
  const point = methods.map((method, index) => ({
    method,
    ...summarize(clusters, index),
    accuracyInterval: enoughClusters ? interval(draws.map(draw => draw[index])) : null,
    domains: domains.map((domain, domainIndex) => ({
      domain, templates: strata[domainIndex].length,
      cases: strata[domainIndex].reduce((sum, template) => sum + template.cases.length, 0),
      ...summarize(strata[domainIndex], index),
      accuracyInterval: enoughClusters ? interval(domainDraws[domainIndex].map(draw => draw[index])) : null,
    })),
  }));
  const comparisons = methods.flatMap((methodA, indexA) => methods.slice(indexA + 1).map((methodB, offset) => {
    const indexB = indexA + offset + 1;
    return {methodA, methodB, accuracyDifference: point[indexA].accuracy - point[indexB].accuracy,
      interval: enoughClusters ? interval(draws.map(draw => draw[indexA] - draw[indexB])) : null};
  }));
  return {
    plan: ANALYSIS_PLAN,
    status: 'descriptive' as const,
    estimand: 'Equal-domain, equal-template accuracy; abstentions count as incorrect. Intervals are paired domain-stratified template-cluster percentile bootstrap intervals, conditional on these template families.',
    intervalWarning: 'Percentile intervals may degenerate at boundary rates. Zero observed errors does not certify zero population risk. Comparisons are descriptive and not multiplicity-adjusted.',
    cases: cases.size, resolvedCases: cases.size - unresolvedCases, unresolvedCases, templates: clusters.length,
    bootstrap: {replicates: enoughClusters ? replicates : 0, seed, available: enoughClusters},
    methods: point, comparisons,
  };
}
