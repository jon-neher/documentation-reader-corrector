import { z } from 'zod';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import type { BaseLanguageModelInterface } from '@langchain/core/language_models/base';
import { Runnable, RunnableLambda } from '@langchain/core/runnables';
import type { PromptSpec } from './types.js';
import { createPromptSpec } from './utils.js';

// -------------------------
// Ticket Generation
// -------------------------
export const TicketSchema = z.object({
  title: z.string().min(3),
  description: z.string().min(20),
  acceptanceCriteria: z.array(z.string()).min(1),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  labels: z.array(z.string()).optional().default([]),
});
export type Ticket = z.infer<typeof TicketSchema>;

const ticketV1Template = ChatPromptTemplate.fromMessages([
  [
    'system',
    [
      'You are an engineering assistant who writes clear, actionable Jira tickets.',
      'Use the provided context to propose a single ticket.',
      'Follow the output format instructions exactly.',
    ].join(' '),
  ],
  [
    'human',
    [
      'Context for the change:',
      '{context}',
      '',
      'Repository details (optional): {repoDetails}',
      'Target audience (optional): {targetAudience}',
      '',
      '{format_instructions}',
    ].join('\n'),
  ],
]);

export const ticketV1: PromptSpec<typeof TicketSchema> = createPromptSpec(
  {
    id: 'docs.ticket',
    version: 'v1',
    description: 'Generate a single Jira-style ticket from context with ACs and metadata.',
    updatedAt: '2025-09-12',
    tags: ['json', 'zod'],
  },
  ticketV1Template,
  TicketSchema,
);

export function buildTicketChain(
  model: BaseLanguageModelInterface,
): Runnable<Record<string, unknown>, Ticket> {
  const addFormat = RunnableLambda.from((input: Record<string, unknown>) => ({
    ...input,
    format_instructions: (input as any).format_instructions ?? ticketV1.getFormatInstructions(),
  }));
  return addFormat.pipe(ticketV1.template).pipe(model).pipe(ticketV1.parser);
}

// -------------------------
// Documentation Update Plan
// -------------------------
export const DocChangeSchema = z.object({
  section: z.string().nullable().optional(),
  current: z.string().nullable().optional(),
  proposed: z.string().min(1),
  rationale: z.string().min(1),
});

export const DocUpdatePlanSchema = z.object({
  summary: z.string().min(10),
  filePaths: z.array(z.string()).default([]),
  changes: z.array(DocChangeSchema).min(1),
  reviewers: z.array(z.string()).optional().default([]),
});

export type DocUpdatePlan = z.infer<typeof DocUpdatePlanSchema>;

const docUpdateFewShotJson = JSON.stringify(
  {
    summary: 'Document the Node 18+ runtime requirement in README.',
    filePaths: ['README.md', 'docs/setup.md'],
    changes: [
      {
        section: 'Prerequisites',
        current: null,
        proposed: 'Add a note that Node.js 18 or newer is required by the project.',
        rationale: 'Package.json engines node field is ">=18".',
      },
    ],
    reviewers: [],
  },
  null,
  2,
)
  .replaceAll('{', '{{')
  .replaceAll('}', '}}');

const docUpdateV1Template = ChatPromptTemplate.fromMessages([
  [
    'system',
    [
      'You create precise documentation update plans for internal docs and READMEs.',
      'Map the requested change to concrete file paths and proposed edits.',
      'Follow output format instructions exactly.',
    ].join(' '),
  ],
  // Simple few-shot to bias towards file-path oriented output
  [
    'human',
    [
      'Change request: Update the README to mention Node 18+ is required.',
      'Context: Our engines field enforces node >=18.',
      '{format_instructions}',
    ].join('\n'),
  ],
  ['ai', docUpdateFewShotJson],
  [
    'human',
    [
      'Change request: {changeDescription}',
      'Context: {context}',
      'Repository details (optional): {repoDetails}',
      '',
      '{format_instructions}',
    ].join('\n'),
  ],
]);

export const docUpdateV1: PromptSpec<typeof DocUpdatePlanSchema> = createPromptSpec(
  {
    id: 'docs.updatePlan',
    version: 'v1',
    description: 'Produce a file-path oriented documentation update plan with proposed edits.',
    updatedAt: '2025-09-12',
    tags: ['few-shot', 'json', 'zod'],
  },
  docUpdateV1Template,
  DocUpdatePlanSchema,
);

export function buildDocUpdateChain(
  model: BaseLanguageModelInterface,
): Runnable<Record<string, unknown>, DocUpdatePlan> {
  const addFormat = RunnableLambda.from((input: Record<string, unknown>) => ({
    ...input,
    format_instructions: (input as any).format_instructions ?? docUpdateV1.getFormatInstructions(),
  }));
  return addFormat.pipe(docUpdateV1.template).pipe(model).pipe(docUpdateV1.parser);
}
