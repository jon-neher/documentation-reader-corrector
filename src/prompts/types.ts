import { z } from 'zod';
import type { ChatPromptTemplate } from '@langchain/core/prompts';
import { StructuredOutputParser } from '@langchain/core/output_parsers';

/**
* Metadata describing a versioned prompt.
*/
export type PromptVersionMeta = {
  id: string; // stable identifier, e.g., "correction.analysis"
  version: `${number}` | `v${number}`; // simple numeric or v-prefixed version
  description?: string;
  updatedAt: string; // ISO date string for human traceability
  /**
   * Arbitrary tags for grouping and future routing (e.g., "few-shot", "json").
   */
  tags?: string[];
};

/**
* A typed, versioned prompt spec that bundles the template with its Zod schema
* and a StructuredOutputParser, so downstream code can compose chains easily.
*/
export type PromptSpec<Schema extends z.ZodTypeAny> = {
  meta: PromptVersionMeta;
  /** Parameterized, versioned template */
  template: ChatPromptTemplate;
  /** Structured output schema */
  schema: Schema;
  /** Parser derived from the schema */
  parser: StructuredOutputParser<Schema>;
  /**
   * Helper to expose format instructions for the parser. Prefer to wire this
   * via a ChatPromptTemplate partial named `format_instructions`.
   */
  getFormatInstructions(): string;
};
