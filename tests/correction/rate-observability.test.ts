import { describe, it, expect } from 'vitest';
import { RunnableLambda } from '@langchain/core/runnables';
import { AIMessage } from '@langchain/core/messages';
import { createCorrectionAnalysisChain } from '../../src/analysis/correction/chain.js';
import { OpenAIRateLimiter } from '../../src/openai/OpenAIRateLimiter.js';
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';

class TestHandler extends BaseCallbackHandler {
  name = 'test-handler';
  chainStart = 0;
  chainEnd = 0;
  async handleChainStart() {
    this.chainStart++;
  }
  async handleChainEnd() {
    this.chainEnd++;
  }
}

describe('Rate limiting adapter and observability', () => {
  it('waits for limiter and records cost; callbacks fire', async () => {
    const fakeModel = RunnableLambda.from(async () => {
      return new AIMessage({
        content: JSON.stringify({
          classification: 'other',
          confidence: 0.5,
          rationale: 'n/a',
          fields: { wrong: null, right: null, reason: null },
        }),
        usage_metadata: { input_tokens: 10, output_tokens: 5 },
      }) as any;
    });

    process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test';
    const limiter = new OpenAIRateLimiter(0, 1000);
    let waited = 0;
    // Spy on waitForRateLimit and recordUsage
    const origWait = limiter.waitForRateLimit.bind(limiter);
    limiter.waitForRateLimit = async () => {
      waited++;
      return origWait();
    };
    let recorded: Array<{ model: string; p: number; c: number }> = [];
    // @ts-expect-error augment for spy
    const origRecord = limiter.recordUsage.bind(limiter);
    limiter.recordUsage = (model: string, promptTokens: number, completionTokens: number) => {
      recorded.push({ model, p: promptTokens, c: completionTokens });
      return origRecord(model, promptTokens, completionTokens);
    };

    const handler = new TestHandler();

    const chain = createCorrectionAnalysisChain({
      modelRunnable: fakeModel,
      limiter,
      callbacks: { callbacks: [handler] },
    });

    const res = await chain.invoke({
      originalQuestion: 'Q',
      botResponse: 'A',
      wrong: null,
      right: null,
      reason: null,
    });

    expect(res).toMatchObject({ classification: 'other' });
    expect(waited).toBe(1);
    expect(recorded.length).toBe(1);
    expect(recorded[0].p).toBe(10);
    expect(recorded[0].c).toBe(5);
    expect(handler.chainStart).toBeGreaterThan(0);
    expect(handler.chainEnd).toBeGreaterThan(0);
  });
});
