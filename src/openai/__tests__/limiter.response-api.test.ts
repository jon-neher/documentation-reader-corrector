/// <reference types="vitest" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIRateLimiter } from '../../openai/OpenAIRateLimiter.js';
import { BudgetExceededError, InvalidApiKeyError, InvalidRequestError, NetworkTimeoutError, ServerError } from '../../openai/errors.js';

describe('OpenAIRateLimiter + Responses API flows (with stubbed OpenAIClient)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test';
  });

  function makeLimiter(rpm = 0, budget = 1000) {
    const limiter: any = new OpenAIRateLimiter(rpm, budget);
    return limiter;
  }

  it('enforces monthly budget before making a request', async () => {
    const limiter = makeLimiter(0, 1);
    (limiter as any).monthlySpend = 1; // equal to budget => blocked
    await expect(limiter.makeRequest('x')).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it('records spend on success using usage tokens from client response', async () => {
    const limiter = makeLimiter(0, 1000);
    const chat = vi.fn(async () => ({
      id: 'r1',
      model: 'gpt-4o-mini',
      created: Date.now() / 1000,
      content: 'ok',
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      raw: {},
    }));
    limiter.client = { chat };

    const before = (limiter as any).monthlySpend as number;
    const res = await limiter.makeRequest('hi', { maxRetries: 1 });
    const after = (limiter as any).monthlySpend as number;
    expect(res.content).toBe('ok');
    // gpt-4o-mini: $0.0006 / 1K input, $0.0024 / 1K output → 0.00018 for 100/50 tokens
    expect(Number((after - before).toFixed(6))).toBe(0.00018);
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('accepts ChatMessage[] prompts and passes them through to client.chat', async () => {
    const limiter = makeLimiter(0, 1000);
    const chat = vi.fn(async (_prompt: any) => ({ id: 'r2', model: 'gpt-4o-mini', created: Date.now() / 1000, content: 'ok', raw: {} }));
    limiter.client = { chat };
    const messages = [ { role: 'user', content: 'hi' } ] as any;
    await limiter.makeRequest(messages, { maxRetries: 1 });
    expect(chat).toHaveBeenCalledWith(messages, expect.any(Object));
  });

  it('retries on 429 with Retry-After header and then succeeds', async () => {
    const limiter = makeLimiter(0, 1000);
    // Error shape compatible with OpenAI SDK errors
    const rateErr: any = {
      status: 429,
      message: 'rate limited',
      response: { headers: { get: (k: string) => (k.toLowerCase() === 'retry-after' ? '0' : undefined) } },
    };
    const chat = vi
      .fn()
      .mockRejectedValueOnce(rateErr)
      .mockResolvedValueOnce({ id: 'ok', model: 'gpt-4o-mini', created: Date.now() / 1000, content: 'done', raw: {} });
    limiter.client = { chat };

    const res = await limiter.makeRequest('hello', { maxRetries: 2 });
    expect(res.content).toBe('done');
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it('retries on 5xx and surfaces ServerError if still failing', async () => {
    const limiter = makeLimiter(0, 1000);
    const serverErr: any = {
      status: 503,
      message: 'unavailable',
      response: { headers: { get: () => '0' } }, // avoid real sleep
    };
    const chat = vi.fn().mockRejectedValue(serverErr);
    limiter.client = { chat };

    await expect(limiter.makeRequest('x', { maxRetries: 2 })).rejects.toBeInstanceOf(ServerError);
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it('does not retry on 401 and surfaces InvalidApiKeyError', async () => {
    const limiter = makeLimiter(0, 1000);
    const err: any = { status: 401, message: 'bad key' };
    const chat = vi.fn().mockRejectedValue(err);
    limiter.client = { chat };

    await expect(limiter.makeRequest('x', { maxRetries: 3 })).rejects.toBeInstanceOf(InvalidApiKeyError);
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('does not retry on 400 and surfaces InvalidRequestError', async () => {
    const limiter = makeLimiter(0, 1000);
    const err: any = { status: 400, message: 'bad req' };
    limiter.client = { chat: vi.fn().mockRejectedValue(err) };
    await expect(limiter.makeRequest('x', { maxRetries: 3 })).rejects.toBeInstanceOf(InvalidRequestError);
  });

  it('classifies network timeouts and exposes NetworkTimeoutError', async () => {
    const limiter = makeLimiter(0, 1000);
    const err: any = { name: 'AbortError', message: 'timed out' };
    limiter.client = { chat: vi.fn().mockRejectedValue(err) };
    await expect(limiter.makeRequest('x', { maxRetries: 1 })).rejects.toBeInstanceOf(NetworkTimeoutError);
  });
});

describe('OpenAIRateLimiter.waitForRateLimit', () => {
  it('logs a wait cycle when at capacity and proceeds without long delays', async () => {
    const restoreLevel = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = 'debug';
    const limiter = new OpenAIRateLimiter(1, 1000);
    // First call takes the only slot in the minute
    const realNow = Date.now;
    let now = 0;
    Date.now = () => now as any;
    try {
      await limiter.waitForRateLimit();
      // Second call at t=59_999 triggers a wait with waitMs=1ms (no long delay)
      now = 59_999;
      const logs: any[] = [];
      const orig = console.log;
      // Intercept JSON logs from our logger
      // eslint-disable-next-line no-console
      console.log = ((line?: any) => {
        try {
          const obj = typeof line === 'string' ? JSON.parse(line) : line;
          if (obj?.msg === 'Rate limit reached; waiting') logs.push(obj);
        } catch {}
      }) as any;
      // Ensure the loop can exit by bumping time after the first sleep
      setTimeout(() => { now = 60_000; }, 1);
      await limiter.waitForRateLimit();
      console.log = orig;
      expect(logs.length).toBeGreaterThanOrEqual(1);
      expect(logs[0]).toEqual(expect.objectContaining({ waitMs: 1, queueSize: 1 }));
    } finally {
      // restore
      Date.now = realNow;
      if (restoreLevel === undefined) delete process.env.LOG_LEVEL; else process.env.LOG_LEVEL = restoreLevel;
    }
  });
});
