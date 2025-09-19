import { describe, it, expect } from 'vitest';
import { RunnableLambda } from '@langchain/core/runnables';
import { AIMessage } from '@langchain/core/messages';
import { createCorrectionAnalysisChain } from '../../src/analysis/correction/chain.js';
import type { CorrectionAnalysis } from '../../src/analysis/correction/types.js';
import { OpenAIRateLimiter } from '../../src/openai/OpenAIRateLimiter.js';

function makeFakeModel(result: CorrectionAnalysis, usage = { input_tokens: 20, output_tokens: 10 }) {
  return RunnableLambda.from(async () => {
    return new AIMessage({
      content: JSON.stringify(result),
      usage_metadata: usage,
    }) as any;
  });
}

describe('Correction analysis chain scenarios (fake model)', () => {
  // Ensure limiter constructor doesn't fail on missing API key
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test';
  it('navigation-style correction → incorrect_procedure', async () => {
    const expected: CorrectionAnalysis = {
      classification: 'incorrect_procedure',
      confidence: 0.86,
      rationale: 'The navigation path was wrong; updated steps provided.',
      fields: { wrong: 'Settings → Security', right: 'Partner Center → Profile', reason: 'UI changed 2024.07' },
    };
    const chain = createCorrectionAnalysisChain({
      modelRunnable: makeFakeModel(expected),
      limiter: new OpenAIRateLimiter(0, 1000),
    });

    const out = await chain.invoke({
      originalQuestion: 'How do I reset my password?',
      botResponse: 'Go to Settings → Security',
      wrong: 'Settings → Security',
      right: 'Partner Center → Profile',
      reason: 'UI changed 2024.07',
    });
    expect(out).toStrictEqual(expected);
  });

  it('factual correction → wrong_reference', async () => {
    const expected: CorrectionAnalysis = {
      classification: 'wrong_reference',
      confidence: 0.9,
      rationale: 'Feature availability statement was incorrect.',
      fields: { wrong: 'Audit logs on all plans', right: 'Pro/Enterprise only', reason: 'Pricing policy' },
    };
    const chain = createCorrectionAnalysisChain({
      modelRunnable: makeFakeModel(expected),
      limiter: new OpenAIRateLimiter(0, 1000),
    });
    const out = await chain.invoke({
      originalQuestion: 'Do we have audit logs on Starter?',
      botResponse: 'Yes, available on all plans',
      wrong: 'All plans',
      right: 'Only Pro/Enterprise',
      reason: 'Updated pricing',
    });
    expect(out).toStrictEqual(expected);
  });

  it('outdated information → outdated_ui', async () => {
    const expected: CorrectionAnalysis = {
      classification: 'outdated_ui',
      confidence: 0.82,
      rationale: 'Menu moved in recent release',
      fields: { wrong: 'Workspace → Settings → Locale', right: 'Profile → Preferences → Locale', reason: '2025.01 redesign' },
    };
    const chain = createCorrectionAnalysisChain({
      modelRunnable: makeFakeModel(expected),
      limiter: new OpenAIRateLimiter(0, 1000),
    });
    const out = await chain.invoke({
      originalQuestion: 'How to change locale?',
      botResponse: 'Workspace → Settings → Locale',
      wrong: 'Workspace → Settings → Locale',
      right: 'Profile → Preferences → Locale',
      reason: 'Redesign',
    });
    expect(out).toStrictEqual(expected);
  });

  it('edge case: incomplete inputs still parse (missing wrong/right/reason)', async () => {
    const expected: CorrectionAnalysis = {
      classification: 'missing_context',
      confidence: 0.5,
      rationale: 'Insufficient info; suggest clarifying question',
      fields: { wrong: null, right: null, reason: null },
    };
    const chain = createCorrectionAnalysisChain({
      modelRunnable: makeFakeModel(expected),
      limiter: new OpenAIRateLimiter(0, 1000),
    });
    const out = await chain.invoke({
      originalQuestion: 'Why is it not working?',
      botResponse: 'Try again',
      // wrong/right/reason omitted intentionally
    });
    expect(out).toStrictEqual(expected);
  });
});
