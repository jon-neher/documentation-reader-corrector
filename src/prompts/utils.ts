import { z } from 'zod';
import { StructuredOutputParser } from '@langchain/core/output_parsers';
import { ChatPromptTemplate } from '@langchain/core/prompts';

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
