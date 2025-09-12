import { z } from 'zod';
import { StructuredOutputParser } from '@langchain/core/output_parsers';
import type { ChatPromptTemplate } from '@langchain/core/prompts';
import type { PromptSpec, PromptVersionMeta } from './types.js';

/** Create a parser and its format instructions from a Zod schema. */
export function buildParser<S extends z.ZodTypeAny>(schema: S) {
  const parser = StructuredOutputParser.fromZodSchema(schema);
  return { parser, formatInstructions: parser.getFormatInstructions() } as const;
}

/**
* Convenience helper: attach a `format_instructions` partial to a template
* using the parser derived from the passed schema.
*/
export async function withFormatInstructions<S extends z.ZodTypeAny>(
  template: ChatPromptTemplate,
  schema: S,
) {
  const { parser, formatInstructions } = buildParser<S>(schema);
  const withPartials = await template.partial({ format_instructions: formatInstructions });
  return { template: withPartials, parser } as const;
}

/**
* Centralized, synchronous PromptSpec factory.
*
* Removes the need for top-level await in prompt modules by:
* - deriving the StructuredOutputParser synchronously from the Zod schema
* - returning the original template (callers should pass `format_instructions`)
*
* Note: If a pre-partialed template is desired, use `withFormatInstructions()`
* at call sites or in a lazy initializer. This factory intentionally avoids
* any async work.
*/
export function createPromptSpec<S extends z.ZodTypeAny>(
  meta: PromptVersionMeta,
  template: ChatPromptTemplate,
  schema: S,
): PromptSpec<S> {
  const { parser } = buildParser(schema);
  return {
    meta,
    template,
    schema,
    parser,
    getFormatInstructions: () => parser.getFormatInstructions(),
  } as const;
}

