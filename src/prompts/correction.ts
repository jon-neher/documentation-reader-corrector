import { z } from 'zod';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import type { BaseLanguageModelInterface } from '@langchain/core/language_models/base';
import { Runnable } from '@langchain/core/runnables';
import type { PromptSpec } from './types.js';
import { buildStructuredChain, createPromptSpec } from './utils.js';

// -------------------------
// Zod schema (structured output)
// -------------------------
export const CorrectionAnalysisSchema = z.object({
  classification: z.enum([
    'wrong_reference',
    'outdated_ui',
    'incorrect_procedure',
    'missing_context',
    'other',
  ]),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1),
  fields: z.object({
    wrong: z.string().optional().nullable(),
    right: z.string().optional().nullable(),
    reason: z.string().optional().nullable(),
  }),
});

export type CorrectionAnalysis = z.infer<typeof CorrectionAnalysisSchema>;

// -------------------------
// Template (v1) with few-shot
// -------------------------
const fewShotJson = JSON.stringify(
  {
    classification: 'outdated_ui',
    confidence: 0.86,
    rationale: 'The correction indicates a navigation change; the original uses an old path.',
    fields: {
      wrong: 'Account Settings → Security',
      right: 'Partner Center → Profile page',
      reason: 'UI changed in 2024.07',
    },
  },
  null,
  2,
)
  .replaceAll('{', '{{')
  .replaceAll('}', '}}');

const correctionAnalysisV1Template = ChatPromptTemplate.fromMessages([
  [
    'system',
    [
      'You analyze user-provided corrections to an internal AI support bot.',
      'Return a structured judgment that follows the provided format instructions exactly.',
      'Be concise but precise; avoid speculation.',
    ].join(' '),
  ],
  // Few-shot example
  [
    'human',
    [
      'Original question: How do I reset my partner dashboard password?',
      'Bot response: You can reset passwords in Account Settings under Security.',
      'Correction provided:',
      'wrong = Account Settings → Security',
      'right = Partner Center → Profile page',
      'reason = UI changed in 2024.07',
      '{format_instructions}',
    ].join('\n'),
  ],
  ['ai', fewShotJson],
  // Actual task
  [
    'human',
    [
      'Original question: {originalQuestion}',
      'Bot response: {botResponse}',
      'Correction provided:',
      'wrong = {wrong}',
      'right = {right}',
      'reason = {reason}',
      '',
      '{format_instructions}',
    ].join('\n'),
  ],
]);

// -------------------------
// Spec export
// -------------------------
export const correctionAnalysisV1: PromptSpec<typeof CorrectionAnalysisSchema> = createPromptSpec(
  {
    id: 'correction.analysis',
    version: 'v1',
    description:
      'Analyze a correction to a support bot answer and extract a structured classification with fields.',
    updatedAt: '2025-09-12',
    tags: ['few-shot', 'json', 'zod'],
  },
  correctionAnalysisV1Template,
  CorrectionAnalysisSchema,
);

/** Build a model → parser pipeline for correction analysis v1. */
export function buildCorrectionAnalysisChain(
  model: BaseLanguageModelInterface,
): Runnable<Record<string, unknown>, CorrectionAnalysis> {
  return buildStructuredChain(correctionAnalysisV1, model);
}
