/// <reference types="vitest" />
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the OpenAI SDK BEFORE importing any module that depends on it.
// This avoids relying on hoisting and ensures the mock is applied at module load.
const createMock: any = vi.fn(async (params: any) => ({ id: 'r', model: params.model, usage: {} }));
vi.mock('openai', () => {
  class OpenAI {
    public responses = { create: createMock };
    constructor(_cfg?: any) {}
  }
  return { default: OpenAI };
});

import { OpenAIClient, type ChatMessage } from '../../openai/client.js';

beforeEach(() => {
  // Ensure the SDK mock and any per-test mockOnce behavior don't leak between tests
  createMock.mockReset();
  createMock.mockImplementation(async (params: unknown) => ({ id: 'r', model: (params as any).model, usage: {} }));
});

describe('OpenAIClient content normalization edge cases', () => {
  it('truncates oversized unknown JSON tail in message content', async () => {
    const client = new OpenAIClient('sk');
    // Use a large string instead of allocating tens of thousands of objects.
    // This still exceeds the 16KB truncation threshold in `safeJsonBlob` but is faster and lighter.
    const big = 'x'.repeat(50_000);
    const messages: ChatMessage[] = [
      { role: 'user', content: [{ type: 'something_new', payload: big }] as any },
    ];
    await client.chat(messages);
    const [params] = createMock.mock.calls.at(-1)! as [any, any];
    const contentParts = params.input[0].content as Array<any>;
    const tail = contentParts.at(-1);
    expect(tail.type).toBe('input_text');
    expect(String(tail.text)).toContain('…(truncated)');
  });

  it('returns empty content string when no output text is present', async () => {
    // Return a response with neither output_text nor usable output items
    createMock.mockResolvedValueOnce({ id: 'r2', model: 'gpt-4o-mini', output: [{ type: 'json', foo: 1 }] });
    const client = new OpenAIClient('sk');
    const res = await client.chat('x');
    expect(res.content).toBe('');
  });
});
