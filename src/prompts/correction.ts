import { ChatPromptTemplate } from '@langchain/core/prompts';

/**
* Correction analysis prompt template.
*
* This module centralizes the structured prompt for correction analysis.
* In the future, templates can be versioned or dynamically loaded. For now,
* we export a stable factory to retrieve the prompt used by the chain.
*/
export function getCorrectionAnalysisPrompt() {
  return ChatPromptTemplate.fromMessages([
    [
      'system',
      [
        'You analyze corrections to an internal AI support bot.',
        'Extract a structured judgment using the provided schema and follow the format instructions exactly.',
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
        '',
        '{format_instructions}',
      ].join('\n'),
    ],
  ]);
}

export type CorrectionPromptVars = {
  originalQuestion: string;
  botResponse: string;
  wrong?: string | null;
  right?: string | null;
  reason?: string | null;
  format_instructions: string;
};
