// Minimal POC: Correction analysis with LangChain.js
// Usage: OPENAI_API_KEY=... node examples/langchain/poc_correction_analysis.mjs

import { z } from 'zod';
import { ChatOpenAI } from '@langchain/openai';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StructuredOutputParser } from '@langchain/core/output_parsers';

// --- Simple pricing snapshot for demo logging (USD per 1K tokens) ---
const PRICING = {
  'gpt-4o': { in1000: 0.005, out1000: 0.015 },
  'gpt-4o-mini': { in1000: 0.0006, out1000: 0.0024 },
};

function estimateCostUSD(model, promptTokens = 0, completionTokens = 0) {
  const p = PRICING[model] || PRICING['gpt-4o-mini'];
  const cost = (promptTokens / 1000) * p.in1000 + (completionTokens / 1000) * p.out1000;
  return Number(cost.toFixed(6));
}

// --- Schema ---
const CorrectionSchema = z.object({
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

const parser = StructuredOutputParser.fromZodSchema(CorrectionSchema);

// --- Prompt ---
const prompt = ChatPromptTemplate.fromMessages([
  [
    'system',
    [
      'You analyze corrections to an internal AI support bot.',
      'Extract a structured judgment using the schema and follow format instructions strictly.',
    ].join(' '),
  ],
  [
    'human',
    [
      'Original question: {originalQuestion}',
      'Bot response: {botResponse}',
      'Correction provided:',
      'wrong = {wrong}',
      'right = {right}',
      'reason = {reason}',
      '\n\n{format_instructions}',
    ].join('\n'),
  ],
]);

const modelName = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const model = new ChatOpenAI({
  model: modelName,
  temperature: 0.2,
  maxRetries: 2,
  timeout: 20_000,
});

const chain = prompt.pipe(model).pipe(parser);

async function main() {
  const input = {
    originalQuestion: 'How do I reset my partner dashboard password?',
    botResponse: 'You can reset passwords in Account Settings under Security.',
    wrong: 'Account Settings → Security',
    right: 'Partner Center → Profile page',
    reason: 'UI changed in 2024.07',
    format_instructions: parser.getFormatInstructions(),
  };

  const start = Date.now();
  const result = await chain.invoke(input);
  const elapsedMs = Date.now() - start;

  // Access token usage when available (implementation-dependent per provider)
  // For OpenAI via LangChain, usage may be on the last message metadata in recent versions.
  const usage = model?.lc_kwargs?.lastResponse?.usage || null;
  // Fallback: try to read from experimental public API if present on model
  const promptTokens = usage?.prompt_tokens ?? undefined;
  const completionTokens = usage?.completion_tokens ?? undefined;
  const cost =
    promptTokens != null && completionTokens != null
      ? estimateCostUSD(modelName, promptTokens, completionTokens)
      : undefined;

  // Pretty print
  // eslint-disable-next-line no-console
  console.log('\nCorrection analysis (POC)');
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ result, elapsedMs, usage, costUSD: cost }, null, 2));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('POC failed:', err?.message || err);
  process.exit(1);
});
