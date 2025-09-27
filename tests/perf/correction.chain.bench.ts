/// <reference types="vitest" />
import { bench, describe } from 'vitest';
import { RunnableLambda } from '@langchain/core/runnables';
import { AIMessage } from '@langchain/core/messages';
import { createCorrectionAnalysisChain } from '../../src/analysis/correction/chain.js';
import { OpenAIRateLimiter } from '../../src/openai/OpenAIRateLimiter.js';

// Minimal fake model that simulates a tiny bit of work and returns JSON content
function makeFakeModel(simMs = 0) {
  return RunnableLambda.from<unknown, AIMessage>(async () => {
    if (simMs > 0) await new Promise((r) => setTimeout(r, simMs));
    const payload = {
      classification: 'other',
      confidence: 0.5,
      rationale: 'n/a',
      fields: { wrong: null, right: null, reason: null },
    };
    return new AIMessage({
      content: JSON.stringify(payload),
      usage_metadata: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    });
  });
}

describe('perf: Correction analysis chain', () => {
  // Avoid real SDK init by setting a stub key; no network calls occur in this bench.
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test';
  const limiter = new OpenAIRateLimiter(0, 10_000); // no throttle in bench

  // Hoist chain creation so benches measure invoke-only overhead
  const chain0 = createCorrectionAnalysisChain({ modelRunnable: makeFakeModel(0), limiter });
  const chain5 = createCorrectionAnalysisChain({ modelRunnable: makeFakeModel(5), limiter });

  bench('invoke with adapter + observability (sim 0ms)', async () => {
    await chain0.invoke({
      originalQuestion: 'Q',
      botResponse: 'A',
      wrong: null,
      right: null,
      reason: null,
    });
  });

  bench('invoke with adapter + observability (sim 5ms)', async () => {
    await chain5.invoke({
      originalQuestion: 'Q',
      botResponse: 'A',
      wrong: null,
      right: null,
      reason: null,
    });
  });
});
