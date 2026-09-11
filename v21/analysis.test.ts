import {describe, expect, it} from 'vitest';
import {analyzeClassification, type ClassificationRow} from './analysis';

const options = {replicates: 100, seed: 42};
function fixture(): ClassificationRow[] {
  return ['coin', 'backdoor'].flatMap(domain => [0, 1].flatMap(template => [0, 1].flatMap(item => ['guided', 'description'].map(method => ({
    caseId: `${domain}-${template}-${item}`, templateId: `${domain}-${template}`, domain, method,
    truth: item ? 'conflict' : 'compatible', predicted: item ? 'conflict' : 'compatible', certificate: 'none' as const,
  })))));
}

describe('preregistered paired classification analysis', () => {
  it('is deterministic and pairs the bootstrap draws', () => {
    const rows = fixture();
    const result = analyzeClassification(rows, options);
    expect(result).toEqual(analyzeClassification(rows, options));
    expect(result.methods[0].accuracy).toBe(1);
    expect(result.comparisons[0].interval).toEqual([0, 0]);
    expect(result.methods[0].domains).toHaveLength(2);
  });
  it('counts abstention as incorrect and separates selective error from coverage', () => {
    const rows = fixture().map(row => row.method === 'guided' && row.truth === 'compatible' ? {...row, predicted: 'unresolved'} : row);
    const method = analyzeClassification(rows, options).methods.find(row => row.method === 'guided')!;
    expect(method.accuracy).toBe(0.5);
    expect(method.coverage).toBe(0.5);
    expect(method.selectiveError).toBe(0);
    expect(method.certifiedCoverage).toBe(0);
    expect(method.invalidCertificateRate).toBeNull();
  });
  it('counts unsupported conflict predictions as predictions, not proofs', () => {
    const rows = fixture().map(row => ({...row, predicted: 'conflict'}));
    const method = analyzeClassification(rows, options).methods[0];
    expect(method.falseConflictRate).toBe(1);
    expect(method.accuracy).toBe(0.5);
    expect(method.certifiedCoverage).toBe(0);
  });
  it('rejects duplicate and missing pairs instead of dropping failed calls', () => {
    expect(() => analyzeClassification([...fixture(), fixture()[0]], options)).toThrow('Duplicate');
    expect(() => analyzeClassification(fixture().slice(1), options)).toThrow('Missing paired');
  });
  it('rejects inconsistent oracle labels', () => {
    const rows = fixture(); rows[0].truth = 'conflict';
    expect(() => analyzeClassification(rows, options)).toThrow('Inconsistent');
  });
  it('explicitly excludes unresolved oracle cases and cannot invent precision from one cluster', () => {
    const rows = fixture().map(row => row.templateId.endsWith('-1') ? {...row, truth: 'unresolved'} : row);
    const result = analyzeClassification(rows, options);
    expect(result.unresolvedCases).toBe(4);
    expect(result.bootstrap.available).toBe(false);
    expect(result.methods[0].accuracyInterval).toBeNull();
  });
  it('does not inflate effective sample size by duplicating cases within templates', () => {
    const rows = fixture().map(row => row.templateId.endsWith('-1') ? {...row, predicted: null} : row);
    const expanded = rows.flatMap(row => [row, {...row, caseId: `${row.caseId}-copy`}]);
    expect(analyzeClassification(expanded, options).methods).toEqual(analyzeClassification(rows, options).methods.map(method => ({
      ...method, domains: method.domains.map(domain => ({...domain, cases: domain.cases * 2})),
    })));
  });
  it('separates invalid submitted certificates from no submission', () => {
    const rows = fixture().map(row => ({...row, certificate: row.truth === 'compatible' ? 'valid' as const : 'invalid' as const}));
    const method = analyzeClassification(rows, options).methods[0];
    expect(method.certifiedCoverage).toBe(0.5);
    expect(method.invalidCertificateRate).toBe(0.5);
  });
  it('rejects invalid resampling controls', () => {
    expect(() => analyzeClassification(fixture(), {replicates: 0})).toThrow('replicate');
    expect(() => analyzeClassification(fixture(), {seed: NaN})).toThrow('seed');
  });
});
