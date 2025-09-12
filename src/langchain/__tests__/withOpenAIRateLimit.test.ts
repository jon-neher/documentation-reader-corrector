/// <reference types="vitest" />
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
  
  it('extracts token usage from usage_metadata when provided and logs cost (uses modelHint)', async () => {
    const limiter = { waitForRateLimit: vi.fn().mockResolvedValue(undefined) } as Pick<OpenAIRateLimiter, 'waitForRateLimit'>;
    const underlying = new RunnableLambda<string, any>({
      func: async () => ({
        content: 'ok',
        usage_metadata: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
      }),
    });

    const spyPrice = vi.spyOn(pricing, 'estimateCostUSD');
    const spyInfo = vi.spyOn(logger.logger, 'info');

    const wrapped = withOpenAIRateLimit(underlying, limiter, { modelHint: 'gpt-4o-mini' });
    await wrapped.invoke('x');

    expect(spyPrice).toHaveBeenCalledTimes(1);
    expect(spyPrice).toHaveBeenCalledWith({ model: 'gpt-4o-mini', promptTokens: 7, completionTokens: 3 });
    expect(spyInfo).toHaveBeenCalled();
  });

  it('suppresses debug logging when no usage or response metadata exists', async () => {
    const limiter = { waitForRateLimit: vi.fn().mockResolvedValue(undefined) } as Pick<OpenAIRateLimiter, 'waitForRateLimit'>;
    const underlying = new RunnableLambda<string, any>({
      func: async () => ({ content: 'no-metadata' }),
    });

    const spyDebug = vi.spyOn(logger.logger, 'debug');
    const wrapped = withOpenAIRateLimit(underlying, limiter, { modelHint: 'gpt-4o-mini' });
    await wrapped.invoke('x');
    expect(spyDebug).not.toHaveBeenCalled();
  });

  it('logs warn with {message, stack} when pricing throws', async () => {
    const limiter = { waitForRateLimit: vi.fn().mockResolvedValue(undefined) } as Pick<OpenAIRateLimiter, 'waitForRateLimit'>;
    const underlying = new RunnableLambda<string, any>({
      func: async () => ({
        content: 'ok',
        response_metadata: { model: 'gpt-4o-mini', token_usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } },
      }),
    });

    vi.spyOn(pricing, 'estimateCostUSD').mockImplementation(() => {
      throw new Error('price boom');
    });
    const spyWarn = vi.spyOn(logger.logger, 'warn');

    const wrapped = withOpenAIRateLimit(underlying, limiter);
    await wrapped.invoke('x');

    expect(spyWarn).toHaveBeenCalled();
    const payload = spyWarn.mock.calls[0]?.[1] as any;
    expect(payload?.message).toBe('price boom');
    expect(typeof payload?.stack).toBe('string');
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
