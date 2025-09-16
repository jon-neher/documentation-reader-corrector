/// <reference types="vitest" />
import { bench, describe, vi } from 'vitest';

// Lightweight SDK mock to avoid any real I/O
const createMock = async () => ({ id: 'r', model: 'gpt-4o-mini', output_text: 'ok', usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } });

vi.mock('openai', () => {
  class OpenAI { public responses = { create: vi.fn(createMock) }; }
  return { default: OpenAI };
});

import { OpenAIClient, type ChatMessage } from '../../src/openai/client.js';

describe('perf: OpenAIClient.chat mapping', () => {
  const client = new OpenAIClient('sk-test');
  const heavyMessages: ChatMessage[] = Array.from({ length: 50 }, (_, i) => ({
    role: i % 2 ? 'user' : 'assistant',
    content: [
      { type: 'text', text: 'hello ' + i },
      { type: 'image_url', image_url: { url: 'https://img/' + i + '.png' } },
    ] as any,
  }));

  bench('string prompt', async () => {
    await client.chat('quick');
  });

  bench('messages mapping (50 items)', async () => {
    await client.chat(heavyMessages);
  });
});
