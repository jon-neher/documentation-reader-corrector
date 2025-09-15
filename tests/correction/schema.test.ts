import { describe, it, expect } from 'vitest';
import { CorrectionAnalysisSchema } from '../../src/analysis/correction/types.js';

describe('CorrectionAnalysisSchema', () => {
  it('accepts a valid object', () => {
    const obj = {
      classification: 'wrong_reference',
      confidence: 0.92,
      rationale: 'The bot linked to the wrong page',
      fields: { wrong: 'A', right: 'B', reason: 'C' },
    };
    const parsed = CorrectionAnalysisSchema.parse(obj);
    expect(parsed.classification).toBe('wrong_reference');
    expect(parsed.confidence).toBeGreaterThan(0.9);
  });

  it('rejects an invalid object', () => {
    const bad = {
      classification: 'not-a-valid-label',
      confidence: 2,
      rationale: '',
      fields: {},
    } as any;
    expect(() => CorrectionAnalysisSchema.parse(bad)).toThrow();
  });
});
