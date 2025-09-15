import type { RunnableLike, RunnableConfig } from '@langchain/core/runnables';
import { RunnableLambda } from '@langchain/core/runnables';
import { AIMessage } from '@langchain/core/messages';
import { OpenAIRateLimiter } from '../openai/OpenAIRateLimiter.js';
import { estimateCostUSD } from '../openai/pricing.js';
import { logger } from '../openai/logger.js';

type TokenUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  // Alternative keys sometimes used by LangChain
  input_tokens?: number;
  output_tokens?: number;
};

/**
* Wrap a LangChain model runnable with our rate limiter pre/post hooks.
* - Before invoke: wait for RPM slot via limiter.
* - After invoke: read token usage from AIMessage metadata and record cost.
*/
export function withRateLimiter<TInput = unknown, TOutput = unknown>(
  limiter: OpenAIRateLimiter,
  model: RunnableLike<TInput, TOutput>,
  opts: { modelName: string } & Partial<{ config: RunnableConfig }>
) {
  const wrapped = RunnableLambda.from(async (input: TInput, config?: RunnableConfig): Promise<TOutput> => {
    await limiter.waitForRateLimit();
    const start = Date.now();
    const out = (await (model as any).invoke(input, config)) as TOutput;
    const elapsedMs = Date.now() - start;

    try {
      // Try to read token usage for cost tracking
      // Case 1: AIMessage output
      const msg = out as unknown as AIMessage;
      const usage: TokenUsage | undefined =
        (msg as any)?.usage_metadata || (msg as any)?.response_metadata?.tokenUsage || (msg as any)?.lc_kwargs?.usage;
      if (usage) {
        const promptTokens = usage.prompt_tokens ?? usage.input_tokens;
        const completionTokens = usage.completion_tokens ?? usage.output_tokens;
        if (typeof promptTokens === 'number' && typeof completionTokens === 'number') {
          const cost = estimateCostUSD({ model: opts.modelName, promptTokens, completionTokens });
          // Record budget spend via limiter's public method
          limiter.recordUsage?.(opts.modelName, promptTokens, completionTokens);
          logger.info('LC usage', { elapsedMs, model: opts.modelName, promptTokens, completionTokens, costUSD: cost });
        }
      }
    } catch (err) {
      // Cost tracking should never break the flow
      logger.warn('Failed to record LC usage', { err: (err as Error).message });
    }

    return out;
  });

  return wrapped;
}
