import { describe, it, expect, beforeEach } from 'vitest';
import { LoggerCallbackHandler } from '../../src/langchain/observability.js';
import type { LLMResult } from '@langchain/core/outputs';

function captureOnce(expectedMsg: string, fn: () => Promise<void> | void): Promise<any> {
  return new Promise(async (resolve, reject) => {
    const origLog = console.log;
    const origWarn = console.warn;
    const origError = console.error;
    try {
      let captured: any | undefined;
      // eslint-disable-next-line no-console
      console.log = (line?: any) => {
        try {
          const obj = typeof line === 'string' ? JSON.parse(line) : line;
          if (obj && obj.msg === expectedMsg) captured = obj;
        } catch {}
      };
      // Some handlers log to warn/error; ignore and preserve
      console.warn = origWarn;
      console.error = origError;
      await fn();
      console.log = origLog;
      resolve(captured);
    } catch (err) {
      console.log = origLog;
      reject(err);
    }
  });
}

describe('observability: tags summarization and model extraction', () => {
  let handler: LoggerCallbackHandler;
  beforeEach(() => {
    handler = new LoggerCallbackHandler();
  });

  it('handleChainStart: emits tagsCount and no raw tags; metadata.tags summarized but not overriding', async () => {
    const tags = ['t1', 't2', 't3'];
    const metadata = { tags: ['meta'] } as Record<string, unknown>;
    const line = await captureOnce('LC chain start', async () => {
      await handler.handleChainStart({}, { a: 1 }, 'run-1', undefined, tags, metadata, 'chain', 'unit');
    });
    expect(line).toBeTruthy();
    expect(line.tags).toBeUndefined();
    expect(line.tagsCount).toBe(3); // from tags param
  });

  it('handleLLMStart: model prefers extra.options.model over metadata.model; emits tagsCount only', async () => {
    const tags = ['a'];
    const extra = { options: { model: 'gpt-x' } } as Record<string, unknown>;
    const metadata = { model: 'meta-model', tags: ['m1', 'm2'] } as Record<string, unknown>;
    const line = await captureOnce('LC LLM start', async () => {
      await handler.handleLLMStart({}, ['p1', 'p2'], 'run-2', undefined, extra, tags, metadata, 'llm');
    });
    expect(line).toBeTruthy();
    expect(line.model).toBe('gpt-x');
    expect(line.tags).toBeUndefined();
    expect(line.tagsCount).toBe(1);
  });

  it('handleChatModelStart: model prefers extra.options.model over metadata.model; emits tagsCount only', async () => {
    const tags = ['a', 'b'];
    const extra = { options: { model: 'chat-x' } } as Record<string, unknown>;
    const metadata = { model: 'chat-meta' } as Record<string, unknown>;
    const msgs = [[{ role: 'system' }], [{ role: 'user' }]] as unknown[][];
    const line = await captureOnce('LC chat start', async () => {
      await handler.handleChatModelStart({}, msgs, 'run-3', undefined, extra, tags, metadata, 'chat');
    });
    expect(line).toBeTruthy();
    expect(line.model).toBe('chat-x');
    expect(line.tags).toBeUndefined();
    expect(line.tagsCount).toBe(2);
  });

  it('handleLLMEnd: model prefers extra.options.model over llmOutput.model; never emits tags', async () => {
    const result: LLMResult = {
      generations: [[]],
      llmOutput: { model: 'from-llm' },
    } as any;
    const extra = { options: { model: 'from-extra' } } as Record<string, unknown>;
    const line = await captureOnce('LC LLM end', async () => {
      await handler.handleLLMEnd(result, 'run-4', undefined, ['should-not-log'], extra);
    });
    expect(line).toBeTruthy();
    expect(line.model).toBe('from-extra');
    expect(line.tags).toBeUndefined();
    expect(line.tagsCount).toBeUndefined();
  });
});
