import {describe, expect, it} from 'vitest';
import {buildCases, oracle} from './domain';
import {parseAttempt, promptFor, resultFor} from './engine';

const item = buildCases('dev').find(value => value.domain === 'coin' && value.templateId === 'dev-coin-00')!;

describe('002.1 method isolation and prediction/certificate distinction', () => {
  it('allows the same three empirical verdicts for all methods', () => {
    for (const method of ['description', 'unguided', 'guided'] as const) for (const verdict of ['compatible', 'conflict', 'unresolved'] as const) {
      const attempt = parseAttempt(item, method, 0, JSON.stringify({verdict, explanation: 'Prediction only', candidates: method === 'description' ? [] : [{}, {}, {}, {}]}));
      const result = resultFor(item, method, [attempt]);
      expect(attempt.parsed).toBe(true);
      expect(result.predicted).toBe(verdict);
      expect(result.certificate).toBe('none');
    }
  });
  it('lets an exact witness override a conflicting model prediction without treating failure as proof', () => {
    const candidate = oracle(item).witness!;
    const attempt = parseAttempt(item, 'guided', 0, JSON.stringify({verdict: 'conflict', explanation: 'Mistaken judgment', candidates: [candidate, {}, {}, {}]}));
    const result = resultFor(item, 'guided', [attempt]);
    expect(result.predicted).toBe('compatible');
    expect(result.certificate).toBe('valid');
    expect(result.witnessAt).toBe(1);
  });
  it('only exposes deterministic feedback to the guided method, never the oracle label', () => {
    const attempt = parseAttempt(item, 'guided', 0, JSON.stringify({verdict: 'unresolved', explanation: 'Prior judgment', candidates: [{}, {}, {}, {}]}));
    const guided = promptFor(item, 'guided', [attempt]);
    const unguided = promptFor(item, 'unguided', [attempt]);
    expect(guided).toContain('"check":');
    expect(unguided).not.toContain('"check":');
    for (const prompt of [guided, unguided]) {
      expect(prompt).not.toContain('compatibleCount');
      expect(prompt).not.toContain('candidatesExamined');
      expect(prompt).not.toContain('Prior judgment');
    }
  });
  it('does not silently accept a smaller candidate budget or a malformed final label', () => {
    expect(parseAttempt(item, 'guided', 0, '{"verdict":"conflict","explanation":"none","candidates":[]}').parsed).toBe(false);
    expect(parseAttempt(item, 'description', 0, '{"verdict":"proved","explanation":"none","candidates":[]}').verdict).toBe('unresolved');
  });
});
