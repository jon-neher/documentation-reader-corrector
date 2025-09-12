import { z } from 'zod';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import type { BaseLanguageModelInterface } from '@langchain/core/language_models/base';
import { Runnable } from '@langchain/core/runnables';
import type { PromptSpec } from './types.js';
import { withFormatInstructions } from './utils.js';

// -------------------------
// Cluster corrections into themes & summarize
// -------------------------
export const PatternClusterSchema = z.object({
  label: z.string().min(3),
  rationale: z.string().min(5),
  /** indices of inputs belonging to this cluster */
  items: z.array(z.number()).min(1),
  representativeExamples: z.array(z.string()).default([]),
});

export const PatternSummarySchema = z.object({
  clusters: z.array(PatternClusterSchema).min(1),
  highLevelSummary: z.string().min(10),
  recommendations: z.array(z.string()).default([]),
});

export type PatternSummary = z.infer<typeof PatternSummarySchema>;

const patternV1Template = ChatPromptTemplate.fromMessages([
  [
    'system',
    [
      'You are an expert analyst. Group related correction records into clusters and provide a concise executive summary.',
      'Prefer a small number of clear clusters (3–7).',
      'Follow the output format instructions strictly.',
    ].join(' '),
  ],
  [
    'human',
    [
      'Inputs are an array of correction summaries. Index each item starting from 0.',
      'Corrections:',
      '{corrections}',
      '',
      '{format_instructions}',
    ].join('\n'),
  ],
]);

export const patternSummaryV1: PromptSpec<typeof PatternSummarySchema> = (await (async () => {
  const { template, parser } = await withFormatInstructions(
    patternV1Template,
    PatternSummarySchema,
  );
  return {
    meta: {
      id: 'patterns.clusterAndSummarize',
      version: 'v1',
      description: 'Cluster a list of correction summaries and produce an executive summary.',
      updatedAt: '2025-09-12',
      tags: ['json', 'zod'],
    },
    template,
    schema: PatternSummarySchema,
    parser,
    getFormatInstructions: () => parser.getFormatInstructions(),
  } as const;
})());

export function buildPatternSummaryChain(
  model: BaseLanguageModelInterface,
): Runnable<Record<string, unknown>, PatternSummary> {
  return patternSummaryV1.template.pipe(model).pipe(patternSummaryV1.parser);
}
