import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { RunnableConfig } from '@langchain/core/runnables';
import { logger } from '../openai/logger.js';

/**
* LangChain → local logger bridge.
* Mirrors key run lifecycle events into our JSON logger for parity with existing telemetry.
*/
export class LoggerCallbackHandler extends BaseCallbackHandler {
  name = 'logger-callback-handler';

  // Root-level run events
  async handleChainStart(_chain: unknown, inputs: unknown, runId: string) {
    logger.info('LC chain start', { runId, inputs: safePreview(inputs) });
  }
  async handleChainEnd(outputs: unknown, runId: string) {
    logger.info('LC chain end', { runId, outputs: safePreview(outputs) });
  }
  async handleChainError(err: unknown, runId: string) {
    logger.error('LC chain error', { runId, error: (err as Error)?.message || String(err) });
  }

  // Model-level events
  async handleLLMStart(_llm: unknown, prompts: string[], runId: string) {
    logger.info('LC LLM start', { runId, promptPreview: prompts.join('\n').slice(0, 200) });
  }
  async handleLLMEnd(output: unknown, runId: string) {
    logger.info('LC LLM end', { runId, output: safePreview(output) });
  }
  async handleLLMError(err: unknown, runId: string) {
    logger.error('LC LLM error', { runId, error: (err as Error)?.message || String(err) });
  }
}

function safePreview(v: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(v));
  } catch {
    return String(v);
  }
}

export function withObservability<TArgs, TReturn>(
  runnable: { invoke(input: TArgs, config?: RunnableConfig): Promise<TReturn> },
  config?: RunnableConfig
) {
  const handler = new LoggerCallbackHandler();
  const merged = mergeConfig(config, { callbacks: [handler] });
  return {
    invoke(input: TArgs, cfg?: RunnableConfig) {
      return runnable.invoke(input, mergeConfig(merged, cfg));
    },
  };
}

function mergeConfig(a?: RunnableConfig, b?: RunnableConfig): RunnableConfig | undefined {
  if (!a) return b;
  if (!b) return a;
  return {
    ...a,
    ...b,
    callbacks: [...normalizeCallbacks(a.callbacks), ...normalizeCallbacks(b.callbacks)],
    tags: [...(a.tags || []), ...(b.tags || [])],
    metadata: { ...(a.metadata || {}), ...(b.metadata || {}) },
  };
}

function normalizeCallbacks(cbs: any): any[] {
  if (!cbs) return [];
  if (Array.isArray(cbs)) return cbs;
  if (Array.isArray(cbs?.handlers)) return cbs.handlers; // CallbackManager -> handlers
  return [cbs];
}
