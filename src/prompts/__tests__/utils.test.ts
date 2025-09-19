/// <reference types="vitest" />
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { createPromptSpec, makeFormatInjector } from '../utils.js';

describe('prompt utils: createPromptSpec + makeFormatInjector', () => {
  const schema = z.object({ a: z.string(), b: z.number() });
  const template = ChatPromptTemplate.fromMessages([
    ['system', 'You output JSON'],
    ['human', 'A={a} B={b}'],
  ]);

  it('createPromptSpec returns parser and getFormatInstructions()', () => {
    const spec = createPromptSpec(
      { id: 'x.y', version: 'v1', updatedAt: '2025-09-19' },
      template,
      schema,
    );
    const fi = spec.getFormatInstructions();
    expect(typeof fi).toBe('string');
    expect(fi.toLowerCase()).toContain('json');
  });

  it('makeFormatInjector injects format_instructions only when undefined', async () => {
    const spec = createPromptSpec(
      { id: 'x.y', version: 'v1', updatedAt: '2025-09-19' },
      template,
      schema,
    );
    const inject = makeFormatInjector(spec);

    const out1 = await inject.invoke({ a: 'aa', b: 1 });
    expect(out1).toHaveProperty('format_instructions');
    expect(typeof (out1 as any).format_instructions).toBe('string');

    const out2 = await inject.invoke({ a: 'aa', b: 1, format_instructions: null });
    // preserves explicit null
    expect((out2 as any).format_instructions).toBeNull();

    const out3 = await inject.invoke({ a: 'aa', b: 1, format_instructions: 'X' });
    // preserves explicit string
    expect((out3 as any).format_instructions).toBe('X');
  });
});
