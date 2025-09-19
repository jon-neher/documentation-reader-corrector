import { describe, it, expect } from 'vitest';
import { RunnableLambda } from '@langchain/core/runnables';
import { AIMessage } from '@langchain/core/messages';
import { createCorrectionAnalysisChain } from '../../src/analysis/correction/chain.js';
import { OpenAIRateLimiter } from '../../src/openai/OpenAIRateLimiter.js';

function captureOnce(expectedMsg: string, fn: () => Promise<void> | void): Promise<any> {
  return new Promise(async (resolve, reject) => {
    const origLog = console.log;
    const origErr = console.error;
    try {
      let captured: any | undefined;
      // eslint-disable-next-line no-console
      console.log = (line?: any) => {
        try {
          const obj = typeof line === 'string' ? JSON.parse(line) : line;
          if (obj && obj.msg === expectedMsg) captured = obj;
        } catch {}
      };
      // Also capture error-level logs (logger.error writes to console.error)
      // eslint-disable-next-line no-console
      console.error = (line?: any) => {
        try {
          const obj = typeof line === 'string' ? JSON.parse(line) : line;
          if (obj && obj.msg === expectedMsg) captured = obj;
        } catch {}
      };
      await fn();
      console.log = origLog;
      console.error = origErr;
      resolve(captured);
    } catch (err) {
      console.log = origLog;
      console.error = origErr;
      reject(err);
    }
  });
}

describe('Correction chain error logging', () => {
  it('logs LC chain error with sanitized fields when parsing fails', async () => {
    process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test';
    // Fake model returns invalid JSON so StructuredOutputParser throws
    const fakeModel = RunnableLambda.from(async () => new AIMessage({ content: '{not json' }) as any);
    const limiter = new OpenAIRateLimiter(0, 1000);

    const chain = createCorrectionAnalysisChain({ modelRunnable: fakeModel, limiter });

    const errorLine = await captureOnce('LC chain error', async () => {
      await expect(
        chain.invoke({ originalQuestion: 'Q', botResponse: 'A' })
      ).rejects.toBeInstanceOf(Error);
    });

    expect(errorLine).toBeTruthy();
    expect(errorLine.errorName).toBeDefined();
    expect(typeof errorLine.errorMessage).toBe('string');
    // stack emission is gated by env; by default it should be absent
    expect(errorLine.errorStack).toBeUndefined();
  });
});
