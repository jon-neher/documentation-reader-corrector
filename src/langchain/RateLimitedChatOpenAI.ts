import type { RunnableLike, Runnable } from '@langchain/core/runnables';
import { RunnableLambda } from '@langchain/core/runnables';
import { logger } from '../openai/logger.js';
import { estimateCostUSD } from '../openai/pricing.js';
import type { OpenAIRateLimiter } from '../openai/OpenAIRateLimiter.js';

// Minimal shape we expect from LangChain AIMessage for usage/model introspection.
// We intentionally avoid importing concrete message classes to keep this adapter
// lightweight and avoid pinning to internal types.
type UsageLike = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  // Some providers/models use alternate keys
  input_tokens?: number;
  output_tokens?: number;
};

type ResponseMetadataLike = {
  model?: string;
  model_name?: string;
  modelId?: string;
  token_usage?: UsageLike;
  usage?: UsageLike;
};

type AIMessageLike = {
  // LangChain attaches usage info here for many providers
  usage_metadata?: UsageLike | null;
  // And/or in provider-specific response metadata
  response_metadata?: ResponseMetadataLike | null;
};

// Narrower probe that avoids `any` casts when checking for metadata presence
function hasAnyUsageOrResponseMetadata(x: unknown): x is AIMessageLike {
  return !!x && typeof x === 'object' && ('response_metadata' in x || 'usage_metadata' in x);
}

function extractModelAndUsage(
  output: unknown,
  fallbackModel?: string
): { model?: string; promptTokens?: number; completionTokens?: number; totalTokens?: number } {
  const msg = (output || {}) as AIMessageLike;
  const rm = (msg.response_metadata || {}) as ResponseMetadataLike;
  const direct = (msg.usage_metadata || {}) as UsageLike;
  const nested = (rm.token_usage || rm.usage || {}) as UsageLike;

  const promptTokens =
    (direct.prompt_tokens ?? direct.input_tokens ?? nested.prompt_tokens ?? nested.input_tokens) as
      | number
      | undefined;
  const completionTokens =
    (direct.completion_tokens ?? direct.output_tokens ?? nested.completion_tokens ?? nested.output_tokens) as
      | number
      | undefined;
  const totalTokens = (direct.total_tokens ?? nested.total_tokens) as number | undefined;

  const model = (rm.model || rm.model_name || rm.modelId || fallbackModel) as string | undefined;
  return { model, promptTokens, completionTokens, totalTokens };
}

/**
* Wrap a LangChain Runnable (typically `new ChatOpenAI(...)`) so that each call:
*  1) waits for the OpenAIRateLimiter slot before invoking the underlying model
*  2) after success, computes estimated cost using src/openai/pricing.ts and logs it
*
* Notes:
*  - This adapter intentionally does NOT mutate or enforce budgets. That remains the
*    responsibility of OpenAIRateLimiter in non-LangChain call paths.
*  - No additional retries are introduced—LangChain/underlying model `maxRetries`
*    semantics are preserved.
*/
export function withOpenAIRateLimit<TIn = unknown, TOut = unknown>(
  model: RunnableLike<TIn, TOut>,
  limiter: Pick<OpenAIRateLimiter, 'waitForRateLimit'>,
  opts: { modelHint?: string } = {}
): Runnable<TIn, TOut> {
  const gate = new RunnableLambda<TIn, TIn>({
    func: async (input) => {
      await limiter.waitForRateLimit();
      return input;
    },
  });

  const logCost = new RunnableLambda<TOut, TOut>({
    func: async (output) => {
      try {
        const { model, promptTokens, completionTokens, totalTokens } = extractModelAndUsage(
          output,
          opts.modelHint
        );

        if (model && typeof promptTokens === 'number' && typeof completionTokens === 'number') {
          const cost = estimateCostUSD({ model, promptTokens, completionTokens });
          const meta: Record<string, unknown> = {
            model,
            promptTokens,
            completionTokens,
            costUSD: cost,
          };
          if (typeof totalTokens === 'number') meta.totalTokens = totalTokens;
          logger.info('LangChain OpenAI call success', meta);
        } else if (
          hasAnyUsageOrResponseMetadata(output) &&
          (typeof promptTokens === 'number' ||
            typeof completionTokens === 'number' ||
            typeof totalTokens === 'number')
        ) {
          // Suppress debug spam when there is no usage metadata at all (common during streaming).
          logger.debug('LangChain OpenAI: usage present but incomplete; cost not logged', {
            model: model ?? opts.modelHint,
            promptTokens,
            completionTokens,
            totalTokens,
          });
        }
      } catch (err) {
        // Never fail the chain due to logging issues; keep this side effect best-effort.
        const e = err as unknown;
        const payload = e instanceof Error ? { message: e.message, stack: e.stack } : { error: e };
        logger.warn('LangChain OpenAI: failed to compute/log cost', payload);
      }
      return output;
    },
  });

  // Compose: gate → model → cost logger
  return gate.pipe(model).pipe(logCost);
}

