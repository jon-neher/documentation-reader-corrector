import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RunnableLambda } from '@langchain/core/runnables';
import { AIMessage } from '@langchain/core/messages';
import { createCorrectionAnalysisChain } from '../../src/analysis/correction/chain.js';
import { OpenAIRateLimiter } from '../../src/openai/OpenAIRateLimiter.js';

async function captureOnce(expectedMsg: string, fn: () => Promise<void> | void) {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    await fn();
    const entries = [
      ...logSpy.mock.calls.map((args, i) => ({ args, order: logSpy.mock.invocationCallOrder?.[i] ?? i })),
      ...errSpy.mock.calls.map((args, i) => ({ args, order: errSpy.mock.invocationCallOrder?.[i] ?? i })),
      ...warnSpy.mock.calls.map((args, i) => ({ args, order: warnSpy.mock.invocationCallOrder?.[i] ?? i })),
    ].sort((a, b) => a.order - b.order);
    for (const { args } of entries) {
      for (const arg of args) {
        try {
          const obj = typeof arg === 'string' ? JSON.parse(arg) : arg;
          if (obj && (obj as any).msg === expectedMsg) return obj;
        } catch {
          // ignore non-JSON console lines
        }
      }
    }
    return undefined;
  } finally {
    logSpy.mockRestore();
    errSpy.mockRestore();
    warnSpy.mockRestore();
  }
}

describe('Correction chain error logging', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('logs LC chain error with sanitized fields when parsing fails', async () => {
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
