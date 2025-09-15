import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { LLMResult } from '@langchain/core/outputs';
import { LoggerCallbackHandler } from '../../src/langchain/observability.js';

function captureOnce<T>(fn: () => Promise<T> | T): Promise<{ line: any; result: T }> {
  return new Promise(async (resolve, reject) => {
    const origLog = console.log;
    try {
      let captured: any | undefined;
      // eslint-disable-next-line no-console
      console.log = (line?: any) => {
        try {
          const obj = typeof line === 'string' ? JSON.parse(line) : line;
          if (obj && obj.msg === 'LC LLM end') captured = obj;
        } catch {}
      };
      const res = await fn();
      // restore before resolving
      console.log = origLog;
      resolve({ line: captured, result: res });
    } catch (err) {
      console.log = origLog;
      reject(err);
    }
  });
}

describe('observability: extractTokenUsage normalization', () => {
  let handler: LoggerCallbackHandler;
  beforeEach(() => {
    handler = new LoggerCallbackHandler();
  });
  afterEach(() => {
    // nothing
  });

  it('derives completionTokens when totalTokens present and promptTokens known (cross-source)', async () => {
    const result: LLMResult = {
      generations: [[]],
      llmOutput: { tokenUsage: { prompt_tokens: 10 } },
    } as any;
    // Provide total via extra.usage
    const extra = { usage: { total_tokens: 16 } } as Record<string, unknown>;

    const { line } = await captureOnce(async () => {
      await handler.handleLLMEnd(result, 'r1', undefined, [], extra);
    });

    expect(line).toBeTruthy();
    expect(line.promptTokens).toBe(10);
    expect(line.completionTokens).toBe(6);
    expect(line.totalTokens).toBe(16);
  });

  it('derives promptTokens when totalTokens present and completionTokens known', async () => {
    const result: LLMResult = {
      generations: [[]],
      llmOutput: { tokenUsage: { completion_tokens: 7, total_tokens: 15 } },
    } as any;

    const { line } = await captureOnce(async () => {
      await handler.handleLLMEnd(result, 'r2');
    });

    expect(line).toBeTruthy();
    expect(line.promptTokens).toBe(8);
    expect(line.completionTokens).toBe(7);
    expect(line.totalTokens).toBe(15);
  });

  it('clamps totalTokens upward when provider total < sum(parts)', async () => {
    const result: LLMResult = {
      generations: [[]],
      llmOutput: { tokenUsage: { prompt_tokens: 10, completion_tokens: 7, total_tokens: 15 } },
    } as any;

    const { line } = await captureOnce(async () => {
      await handler.handleLLMEnd(result, 'r3');
    });

    expect(line).toBeTruthy();
    expect(line.promptTokens).toBe(10);
    expect(line.completionTokens).toBe(7);
    // prefer parts; adjust total to match sum
    expect(line.totalTokens).toBe(17);
  });

  it('derives totalTokens from parts when total missing', async () => {
    const result: LLMResult = {
      generations: [[]],
      llmOutput: { tokenUsage: { input_tokens: 3, output_tokens: 2 } },
    } as any;

    const { line } = await captureOnce(async () => {
      await handler.handleLLMEnd(result, 'r4');
    });

    expect(line).toBeTruthy();
    expect(line.promptTokens).toBe(3);
    expect(line.completionTokens).toBe(2);
    expect(line.totalTokens).toBe(5);
  });

  it('only total known emits only totalTokens', async () => {
    const result: LLMResult = {
      generations: [[]],
      llmOutput: { tokenUsage: { total_tokens: 9 } },
    } as any;

    const { line } = await captureOnce(async () => {
      await handler.handleLLMEnd(result, 'r5');
    });

    expect(line).toBeTruthy();
    expect(line.totalTokens).toBe(9);
    expect(Object.prototype.hasOwnProperty.call(line, 'promptTokens')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(line, 'completionTokens')).toBe(false);
  });

  it('no usage data emits no token fields', async () => {
    const result: LLMResult = { generations: [[]], llmOutput: {} } as any;

    const { line } = await captureOnce(async () => {
      await handler.handleLLMEnd(result, 'r6');
    });

    expect(line).toBeTruthy();
    expect(line.msg).toBe('LC LLM end');
    expect(line).not.toHaveProperty('promptTokens');
    expect(line).not.toHaveProperty('completionTokens');
    expect(line).not.toHaveProperty('totalTokens');
  });
});
