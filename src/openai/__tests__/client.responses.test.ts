/// <reference types="vitest" />
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the OpenAI SDK before importing the client under test.
// We capture the last call to `responses.create` for assertions.
const createMock: any = vi.fn(async (_params: any, _opts?: any) => {
  return {
    id: 'resp_123',
    model: 'gpt-4o-mini',
    created_at: 1_690_000_000,
    output_text: 'OK',
    usage: { input_tokens: 5, output_tokens: 7, total_tokens: 12 },
  };
});

vi.mock('openai', () => {
  class OpenAI {
    public responses = { create: createMock };
    constructor(_cfg?: any) {}
  }
  return { default: OpenAI };
});

import { OpenAIClient, type ChatMessage } from '../../openai/client.js';

describe('OpenAIClient.chat (Responses API mapping)', () => {
  beforeEach(() => {
    // Clear mock call history/state but keep existing implementations and module mocks intact
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test';
  });

  it('builds a minimal Responses request for a plain string prompt and normalizes the response', async () => {
    const client = new OpenAIClient('sk-test');
    const res = await client.chat('Hello world', {
      model: 'gpt-4o-mini',
      temperature: 0.3,
      maxTokens: 123,
      timeoutMs: 999,
      extra: {
        // Attempt to override core params — these must be ignored in favor of explicit options above
        model: 'gpt-ignored',
        max_output_tokens: 666,
        max_tokens: 999,
        input: 'SHOULD_NOT_WIN',
        messages: ['ignored'],
        foo: 'bar',
      } as any,
    });

    // Verify the outbound call shape
    expect(createMock).toHaveBeenCalledTimes(1);
    const [params, opts] = createMock.mock.calls[0] as [any, any];
    expect(params).toStrictEqual({
      model: 'gpt-4o-mini',
      input: 'Hello world',
      temperature: 0.3,
      max_output_tokens: 123,
      foo: 'bar',
    });
    expect(opts).toStrictEqual({ timeout: 999 });

    // Verify the normalized result
    expect(res).toStrictEqual({
      id: 'resp_123',
      model: 'gpt-4o-mini',
      created: 1_690_000_000,
      content: 'OK',
      usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 },
      raw: expect.any(Object),
    });
  });

  it('prefers options.messages when provided (even if prompt is a string)', async () => {
    const client = new OpenAIClient('sk-test');
    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are a bot' },
      { role: 'user', content: 'Hi' },
    ];
    await client.chat('SHOULD_BE_IGNORED', { model: 'gpt-4o-mini', messages });
    const [params] = createMock.mock.calls.at(-1)! as [any, any];
    expect(params.input).toEqual([
      { role: 'system', content: 'You are a bot', type: 'message' },
      { role: 'user', content: 'Hi', type: 'message' },
    ]);
  });

  it('maps Chat Completions style content parts to Responses input message content', async () => {
    const client = new OpenAIClient('sk-test');
    const messages: ChatMessage[] = [
      // text-only string content
      { role: 'user', content: 'plain' },
      // array content with multiple supported part types + an unknown one
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'hello' },
          { type: 'image_url', image_url: { url: 'https://img/x.png', detail: 'high' } },
          { type: 'input_audio', input_audio: { data: 'b64', format: 'wav' } },
          { type: 'file', file: { file_id: 'file_123' } },
          { type: 'file', file: { file_data: 'ZmlsZQ==', filename: 'foo.txt' } },
          // Unknown type stays preserved as a JSON blob tail
          { type: 'something_new', payload: { a: 1 } } as any,
        ],
      },
      // tool/function roles are downgraded to user
      { role: 'tool' as any, content: 'tool-output' },
      { role: 'function' as any, content: 'fn-output' },
      // unknown role should become user
      { role: 'banana' as any, content: 'weird' },
    ];

    await client.chat(messages, { model: 'gpt-4o-mini' });
    const [params] = createMock.mock.calls.at(-1)! as [any, any];

    expect(Array.isArray(params.input)).toBe(true);
    const input = params.input as Array<any>;
    expect(input[0]).toEqual({ role: 'user', content: 'plain', type: 'message' });
    // assistant content mapped parts
    expect(input[1].role).toBe('assistant');
    expect(input[1].type).toBe('message');
    expect(Array.isArray(input[1].content)).toBe(true);
    const parts: any[] = input[1].content;
    expect(parts).toEqual([
      { type: 'input_text', text: 'hello' },
      { type: 'input_image', image_url: 'https://img/x.png', detail: 'high' },
      { type: 'input_audio', input_audio: { data: 'b64', format: 'wav' } },
      { type: 'input_file', file_id: 'file_123' },
      { type: 'input_file', file_data: 'ZmlsZQ==', filename: 'foo.txt' },
      expect.objectContaining({ type: 'input_text', text: expect.stringContaining('something_new') }),
    ]);
    // role fallbacks
    expect(input[2].role).toBe('user');
    expect(input[3].role).toBe('user');
    expect(input[4].role).toBe('user');
  });

  it('falls back to first output item text when `output_text` is missing', async () => {
    createMock.mockResolvedValueOnce({
      id: 'resp_alt',
      model: 'gpt-4o-mini',
      output: [
        {
          type: 'message',
          content: [
            { type: 'output_text', text: 'Hello from nested output' },
          ],
        },
      ],
      usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
    });
    const client = new OpenAIClient('sk-test');
    const res1 = await client.chat('x');
    expect(res1.content).toBe('Hello from nested output');

    createMock.mockResolvedValueOnce({
      id: 'resp_top',
      model: 'gpt-4o-mini',
      output: [ { type: 'output_text', text: 'Top-level text' } ],
      usage: { input_tokens: 0, output_tokens: 1, total_tokens: 1 },
    });
    const res2 = await client.chat('y');
    expect(res2.content).toBe('Top-level text');
  });

  it('omits usage when Responses API returns no usage block', async () => {
    createMock.mockResolvedValueOnce({ id: 'r', model: 'gpt-4o-mini', output_text: 'no usage' });
    const client = new OpenAIClient('sk-test');
    const res = await client.chat('z');
    expect(res.usage).toBeUndefined();
  });
});
