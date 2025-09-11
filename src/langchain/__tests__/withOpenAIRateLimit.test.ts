import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RunnableLambda } from '@langchain/core/runnables';
import { withOpenAIRateLimit } from '../RateLimitedChatOpenAI.js';
import { OpenAIRateLimiter } from '../../openai/OpenAIRateLimiter.js';
import * as pricing from '../../openai/pricing.js';
import * as logger from '../../openai/logger.js';

describe('withOpenAIRateLimit adapter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('calls limiter.waitForRateLimit exactly once per invoke', async () => {
    const waitForRateLimit = vi.fn().mockResolvedValue(undefined);
    const limiter = { waitForRateLimit } as Pick<OpenAIRateLimiter, 'waitForRateLimit'>;

    const underlying = new RunnableLambda<string, any>({
      func: async (input: string) => ({
        content: `echo:${input}`,
        response_metadata: { model: 'gpt-4o-mini', token_usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
      }),
    });

    const wrapped = withOpenAIRateLimit(underlying, limiter);
    const out = await wrapped.invoke('hi');
    expect(out?.content).toBe('echo:hi');
    expect(waitForRateLimit).toHaveBeenCalledTimes(1);
  });

  it('captures token usage and routes to pricing.estimateCostUSD + logs', async () => {
    const waitForRateLimit = vi.fn().mockResolvedValue(undefined);
    const limiter = { waitForRateLimit } as Pick<OpenAIRateLimiter, 'waitForRateLimit'>;

    const underlying = new RunnableLambda<string, any>({
      func: async () => ({
        content: 'ok',
        response_metadata: { model: 'gpt-4o-mini', token_usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } },
      }),
    });

    const spyPrice = vi.spyOn(pricing, 'estimateCostUSD');
    const spyLog = vi.spyOn(logger.logger, 'info');

    const wrapped = withOpenAIRateLimit(underlying, limiter);
    await wrapped.invoke('x');

    expect(spyPrice).toHaveBeenCalledTimes(1);
    expect(spyPrice).toHaveBeenCalledWith({ model: 'gpt-4o-mini', promptTokens: 100, completionTokens: 50 });
    expect(spyLog).toHaveBeenCalled();
    const args = spyLog.mock.calls[0]?.[1] as any;
    expect(args?.model).toBe('gpt-4o-mini');
    expect(args?.promptTokens).toBe(100);
    expect(args?.completionTokens).toBe(50);
    expect(typeof args?.costUSD).toBe('number');
  });

  it('does not introduce extra retries; underlying is invoked once on error', async () => {
    const waitForRateLimit = vi.fn().mockResolvedValue(undefined);
    const limiter = { waitForRateLimit } as Pick<OpenAIRateLimiter, 'waitForRateLimit'>;

    const underlyingFn = vi.fn().mockRejectedValue(new Error('boom'));
    const underlying = new RunnableLambda<any, any>({ func: underlyingFn });
    const wrapped = withOpenAIRateLimit(underlying, limiter);

    await expect(wrapped.invoke({})).rejects.toThrow('boom');
    expect(waitForRateLimit).toHaveBeenCalledTimes(1);
    expect(underlyingFn).toHaveBeenCalledTimes(1);
  });

  it('does not mutate limiter budget (spend stays unchanged)', async () => {
    const stub = { waitForRateLimit: vi.fn().mockResolvedValue(undefined), monthlySpend: 123.456 } as any;
    const spendBefore = stub.monthlySpend;

    const underlying = new RunnableLambda<string, any>({
      func: async () => ({
        content: 'ok',
        response_metadata: { model: 'gpt-4o-mini', token_usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
      }),
    });

    const wrapped = withOpenAIRateLimit(underlying, stub);
    await wrapped.invoke('x');
    expect(stub.monthlySpend).toBe(spendBefore);
  });
});

// Integration test: requires OPENAI_API_KEY; skipped if absent.
describe('integration with ChatOpenAI (skipped without OPENAI_API_KEY)', () => {
  const hasKey = Boolean(process.env.OPENAI_API_KEY);
  const maybe = hasKey ? it : it.skip;

  maybe('executes a basic chain and logs cost', async () => {
    const { ChatOpenAI } = await import('@langchain/openai');
    const { ChatPromptTemplate } = await import('@langchain/core/prompts');

    const limiter = new OpenAIRateLimiter(1000, 100); // permissive RPM
    const spyGate = vi.spyOn(limiter, 'waitForRateLimit');
    const modelName = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    const base = new ChatOpenAI({ model: modelName, temperature: 0, maxRetries: 1, timeout: 20_000 });
    const model = withOpenAIRateLimit(base, limiter, { modelHint: modelName });
    const prompt = ChatPromptTemplate.fromMessages([
      ['system', 'You are a helpful assistant. Answer briefly.'],
      ['human', 'Say hello to {name}.'],
    ]);

    const chain = prompt.pipe(model);
    const out = await chain.invoke({ name: 'LangChain' });
    expect(out).toBeTruthy();
    expect(spyGate).toHaveBeenCalled();
  });
});
