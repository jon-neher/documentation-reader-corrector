import { ChatOpenAI } from '@langchain/openai';
import { StructuredOutputParser } from '@langchain/core/output_parsers';
import { RunnableSequence, type RunnableLike, type RunnableConfig } from '@langchain/core/runnables';
import { getCorrectionAnalysisPrompt } from '../../prompts/correction.js';
import { withRateLimiter } from '../../langchain/rateLimitAdapter.js';
import { withObservability } from '../../langchain/observability.js';
import { OpenAIRateLimiter } from '../../openai/OpenAIRateLimiter.js';
import { CorrectionAnalysisSchema, type CorrectionAnalysis, type CorrectionAnalysisInput } from './types.js';

export type CorrectionAnalysisOptions = {
  /** OpenAI model name. Defaults to env OPENAI_MODEL or gpt-4o-mini. */
  model?: string;
  /** Temperature for the model (default 0.2). */
  temperature?: number;
  /** Max retries at LC layer (default 2). Our limiter still controls retry/backoff elsewhere. */
  maxRetries?: number;
  /** Request timeout in ms (default 20_000). */
  timeoutMs?: number;
  /** LangChain RunnableConfig (e.g., callbacks, tags) applied to the chain via observability wrapper. */
  config?: RunnableConfig;
  /** Provide a shared limiter; if omitted, a default instance is created. */
  limiter?: OpenAIRateLimiter;
  /**
   * Testing hook: override the model runnable used by the chain. When provided,
   * `model`, `temperature`, `maxRetries`, and `timeoutMs` are ignored.
   */
  modelRunnable?: RunnableLike<any, any>;
};

export function createCorrectionAnalysisChain(opts: CorrectionAnalysisOptions = {}) {
  const modelName = opts.model || process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const temperature = opts.temperature ?? 0.2;
  const maxRetries = opts.maxRetries ?? 2;
  const timeout = opts.timeoutMs ?? 20_000;

  const parser = StructuredOutputParser.fromZodSchema(CorrectionAnalysisSchema);
  const prompt = getCorrectionAnalysisPrompt();
  const limiter = opts.limiter || new OpenAIRateLimiter();
  const baseModel = opts.modelRunnable || new ChatOpenAI({ model: modelName, temperature, maxRetries, timeout });
  const rateLimitedModel = withRateLimiter(limiter, baseModel, { modelName });

  const chain = RunnableSequence.from([
    // Map input into prompt variables and inject format instructions
    async (input: CorrectionAnalysisInput) => ({
      originalQuestion: input.originalQuestion,
      botResponse: input.botResponse,
      wrong: input.wrong ?? null,
      right: input.right ?? null,
      reason: input.reason ?? null,
      format_instructions: parser.getFormatInstructions(),
    }),
    prompt,
    rateLimitedModel,
    parser,
  ]);

  // Attach observability bridge so our logging receives LC run events
  const observed = withObservability(chain, opts.config);
  return observed;
}

export async function analyzeCorrection(
  input: CorrectionAnalysisInput,
  opts: CorrectionAnalysisOptions = {}
): Promise<CorrectionAnalysis> {
  const chain = createCorrectionAnalysisChain(opts);
  const result = await chain.invoke(input);
  // StructuredOutputParser.parse() already validates, but cast for TS purposes
  return result as CorrectionAnalysis;
}
