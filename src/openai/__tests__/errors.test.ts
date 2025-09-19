/// <reference types="vitest" />
import { describe, it, expect } from 'vitest';
import { RateLimitError, InvalidApiKeyError, ServerError, NetworkTimeoutError, InvalidRequestError, BudgetExceededError } from '../../openai/errors.js';

describe('OpenAI error classes', () => {
  it('RateLimitError exposes retryAfterMs', () => {
    const e = new RateLimitError('rate', 1500);
    expect(e.name).toBe('RateLimitError');
    expect(e.status).toBe(429);
    expect(e.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(e.retryAfterMs).toBe(1500);
  });

  it('other error shapes expose codes/status', () => {
    expect(new BudgetExceededError().code).toBe('BUDGET_EXCEEDED');
    expect(new InvalidApiKeyError().status).toBe(401);
    expect(new ServerError(502).status).toBe(502);
    expect(new NetworkTimeoutError().code).toBe('NETWORK_TIMEOUT');
    expect(new InvalidRequestError().status).toBe(400);
  });
});
