/// <reference types="vitest" />
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Capture the last init arg passed to the OpenAI SDK constructor
let lastCtorArg: any;
const createMock: any = vi.fn(async (_params: any) => ({ id: 'r', model: 'gpt-4o-mini', output_text: 'ok' }));
vi.mock('openai', () => {
  class OpenAI {
    public responses = { create: createMock };
    constructor(cfg?: any) {
      lastCtorArg = cfg;
    }
  }
  return { default: OpenAI };
});

import { OpenAIClient } from '../../openai/client.js';

describe('OpenAIClient initialization and env handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset stubbed env vars between tests to prevent leakage
    vi.unstubAllEnvs();
    lastCtorArg = undefined;
  });

  it('passes explicit apiKey to SDK constructor', async () => {
    const client = new OpenAIClient('sk-from-arg');
    await client.chat('ping');
    expect(lastCtorArg).toEqual({ apiKey: 'sk-from-arg' });
  });

  it('reads OPENAI_API_KEY from env when not provided', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-from-env');
    const client = new OpenAIClient();
    await client.chat('ping');
    expect(lastCtorArg).toEqual({ apiKey: 'sk-from-env' });
  });

  it('uses OPENAI_MODEL when options.model omitted', async () => {
    vi.stubEnv('OPENAI_MODEL', 'gpt-env');
    const client = new OpenAIClient('sk');
    await client.chat('hello');
    const [params] = createMock.mock.calls.at(-1)! as [any, any];
    expect(params.model).toBe('gpt-env');
  });
});
