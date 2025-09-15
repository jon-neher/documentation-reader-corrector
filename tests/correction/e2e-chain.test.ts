import { describe, it, expect } from 'vitest';
import { RunnableLambda } from '@langchain/core/runnables';
import { AIMessage } from '@langchain/core/messages';
import { analyzeCorrection } from '../../src/analysis/correction/chain.js';
import type { CorrectionAnalysis } from '../../src/analysis/correction/types.js';
import { OpenAIRateLimiter } from '../../src/openai/OpenAIRateLimiter.js';

describe('Correction analysis chain (E2E with fake model)', () => {
  it('produces a typed result via StructuredOutputParser', async () => {
    const expected: CorrectionAnalysis = {
      classification: 'outdated_ui',
      confidence: 0.83,
      rationale: 'UI changed; bot pointed to an old location',
      fields: { wrong: 'Old path', right: 'New path', reason: 'Release 2024.07' },
    };

    // Fake model returns the JSON content and simulates token usage
    const fakeModel = RunnableLambda.from(async () => {
      return new AIMessage({
        content: JSON.stringify(expected),
        additional_kwargs: {},
        // Provide usage metadata in a form our adapter understands
        // (these properties are not enforced by types and are purely for tests)
        usage_metadata: { input_tokens: 42, output_tokens: 21 },
      }) as any;
    });

    process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test';
    const limiter = new OpenAIRateLimiter(0, 1000); // RPM=0 → no throttling

    const result = await analyzeCorrection(
      {
        originalQuestion: 'How do I reset my password?',
        botResponse: 'Go to Settings → Security',
        wrong: 'Settings → Security',
        right: 'Profile → Account',
        reason: 'UI updated',
      },
      { modelRunnable: fakeModel, limiter }
    );

    expect(result).toStrictEqual(expected);
  });
});
