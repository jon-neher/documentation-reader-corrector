import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { LLMResult } from '@langchain/core/outputs';
import type { RunnableConfig } from '@langchain/core/runnables';
import { LangChainTracer } from '@langchain/core/tracers/tracer_langchain';
import { logger } from '../openai/logger.js';

type TokenUsage = {
  // Common shapes exposed by LangChain/OpenAI integrations
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  // Alternate keys used by some message metadata
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
};

/**
* LangChain → local logger bridge.
*
* Mirrors key run lifecycle events into our JSON logger while:
* - never logging raw content (inputs, prompts, outputs)
* - including step timing and token usage when available
* - keeping payload fields consistent with our existing logging
*/
export class LoggerCallbackHandler extends BaseCallbackHandler {
  name = 'logger-callback-handler';

  private starts = new Map<string, number>();

  private trackStart(runId: string) {
    // Prevent unbounded growth if end/error isn't called due to abrupt termination.
    // Instead of clearing all entries at once, evict a small fraction of the
    // oldest entries (iteration order of Map preserves insertion order) to
    // avoid dropping all in-flight timings.
    const MAX_STARTS = 10_000;
    if (this.starts.size >= MAX_STARTS) {
      const toEvict = Math.ceil(MAX_STARTS * 0.1); // evict ~10% oldest
      let evicted = 0;
      for (const key of this.starts.keys()) {
        this.starts.delete(key);
        if (++evicted >= toEvict) break;
      }
    }
    this.starts.set(runId, Date.now());
  }

  // Chain events
  async handleChainStart(
    _chain: unknown,
    inputs: Record<string, unknown>,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    metadata?: Record<string, unknown>,
    runType?: string,
    runName?: string
  ) {
    this.trackStart(runId);
    const inputKeys = summarizeKeys(inputs);
    logger.info('LC chain start', {
      runId,
      parentRunId,
      runType,
      runName,
      inputKeys,
      tags,
      ...safeMeta(metadata),
    });
  }

  async handleChainEnd(
    outputs: Record<string, unknown>,
    runId: string,
    parentRunId?: string,
    _tags?: string[],
    _kwargs?: { inputs?: Record<string, unknown> }
  ) {
    const elapsedMs = this.elapsed(runId);
    const outputKeys = summarizeKeys(outputs);
    logger.info('LC chain end', { runId, parentRunId, elapsedMs, outputKeys });
  }

  async handleChainError(
    err: unknown,
    runId: string,
    parentRunId?: string,
    _tags?: string[],
    _kwargs?: { inputs?: Record<string, unknown> }
  ) {
    const elapsedMs = this.elapsed(runId);
    const e = normalizeError(err);
    const { errorName, errorMessage, errorStack } = sanitizedErrorFields(e);
    logger.error('LC chain error', {
      runId,
      parentRunId,
      elapsedMs,
      errorName,
      errorMessage,
      ...(errorStack ? { errorStack } : {}),
    });
  }

  // LLM / ChatModel events
  async handleLLMStart(
    _llm: unknown,
    prompts: string[],
    runId: string,
    parentRunId?: string,
    extraParams?: Record<string, unknown>,
    tags?: string[],
    metadata?: Record<string, unknown>,
    runName?: string
  ) {
    this.trackStart(runId);
    const promptCount = Array.isArray(prompts) ? prompts.length : 0;
    const charLen = Array.isArray(prompts) ? prompts.reduce((n, p) => n + (p?.length || 0), 0) : 0;
    const model = (extraParams as any)?.options?.model ?? (metadata as any)?.model;
    logger.info('LC LLM start', {
      runId,
      parentRunId,
      runName,
      promptCount,
      promptCharLen: charLen,
      model,
      tags,
    });
  }

  async handleChatModelStart(
    _llm: unknown,
    messages: unknown[][],
    runId: string,
    parentRunId?: string,
    extraParams?: Record<string, unknown>,
    tags?: string[],
    metadata?: Record<string, unknown>,
    runName?: string
  ) {
    this.trackStart(runId);
    const totalMessages = Array.isArray(messages) ? messages.reduce((n, m) => n + (Array.isArray(m) ? m.length : 0), 0) : 0;
    const model = (extraParams as any)?.options?.model ?? (metadata as any)?.model;
    logger.info('LC chat start', { runId, parentRunId, runName, totalMessages, model, tags });
  }

  async handleChatModelError(
    err: unknown,
    runId: string,
    parentRunId?: string,
    _tags?: string[],
    _extra?: Record<string, unknown>
  ) {
    const elapsedMs = this.elapsed(runId);
    const e = normalizeError(err);
    const { errorName, errorMessage, errorStack } = sanitizedErrorFields(e);
    logger.error('LC chat error', {
      runId,
      parentRunId,
      elapsedMs,
      errorName,
      errorMessage,
      ...(errorStack ? { errorStack } : {}),
    });
  }

  async handleLLMEnd(
    output: LLMResult,
    runId: string,
    parentRunId?: string,
    _tags?: string[],
    extraParams?: Record<string, unknown>
  ) {
    const elapsedMs = this.elapsed(runId);
    const usage = extractTokenUsage(output, extraParams);
    const model = (extraParams as any)?.options?.model ?? (output?.llmOutput as any)?.model;
    const meta: Record<string, unknown> = { runId, parentRunId, elapsedMs };
    if (model) meta.model = model;
    if (usage) {
      const { promptTokens, completionTokens, totalTokens } = usage;
      if (typeof promptTokens === 'number') meta.promptTokens = promptTokens;
      if (typeof completionTokens === 'number') meta.completionTokens = completionTokens;
      if (typeof totalTokens === 'number') meta.totalTokens = totalTokens;
    }
    logger.info('LC LLM end', meta);
  }

  async handleLLMError(
    err: unknown,
    runId: string,
    parentRunId?: string,
    _tags?: string[],
    _extra?: Record<string, unknown>
  ) {
    const elapsedMs = this.elapsed(runId);
    const e = normalizeError(err);
    const { errorName, errorMessage, errorStack } = sanitizedErrorFields(e);
    logger.error('LC LLM error', {
      runId,
      parentRunId,
      elapsedMs,
      errorName,
      errorMessage,
      ...(errorStack ? { errorStack } : {}),
    });
  }

  // Tool events
  async handleToolStart(
    tool: unknown,
    _input: string,
    runId: string,
    parentRunId?: string,
    _tags?: string[],
    metadata?: Record<string, unknown>,
    runName?: string
  ) {
    this.trackStart(runId);
    logger.info('LC tool start', { runId, parentRunId, runName, tool: safeType(tool), ...safeMeta(metadata) });
  }

  async handleToolEnd(_output: unknown, runId: string, parentRunId?: string) {
    const elapsedMs = this.elapsed(runId);
    logger.info('LC tool end', { runId, parentRunId, elapsedMs });
  }

  async handleToolError(err: unknown, runId: string, parentRunId?: string) {
    const elapsedMs = this.elapsed(runId);
    const e = normalizeError(err);
    const { errorName, errorMessage, errorStack } = sanitizedErrorFields(e);
    logger.error('LC tool error', {
      runId,
      parentRunId,
      elapsedMs,
      errorName,
      errorMessage,
      ...(errorStack ? { errorStack } : {}),
    });
  }

  // Retriever events (not used yet, but safe to include)
  async handleRetrieverStart(
    retriever: unknown,
    _query: string,
    runId: string,
    parentRunId?: string,
    _tags?: string[],
    metadata?: Record<string, unknown>,
    runName?: string
  ) {
    this.trackStart(runId);
    logger.info('LC retriever start', { runId, parentRunId, runName, retriever: safeType(retriever), ...safeMeta(metadata) });
  }
  async handleRetrieverEnd(_documents: unknown[], runId: string, parentRunId?: string) {
    const elapsedMs = this.elapsed(runId);
    logger.info('LC retriever end', { runId, parentRunId, elapsedMs });
  }
  async handleRetrieverError(err: unknown, runId: string, parentRunId?: string) {
    const elapsedMs = this.elapsed(runId);
    const e = normalizeError(err);
    const { errorName, errorMessage, errorStack } = sanitizedErrorFields(e);
    logger.error('LC retriever error', {
      runId,
      parentRunId,
      elapsedMs,
      errorName,
      errorMessage,
      ...(errorStack ? { errorStack } : {}),
    });
  }

  private elapsed(runId: string): number | undefined {
    const start = this.starts.get(runId);
    this.starts.delete(runId);
    return typeof start === 'number' ? Date.now() - start : undefined;
  }
}

// Helpers
function safeMeta(meta?: Record<string, unknown>): Record<string, unknown> {
  if (!meta || typeof meta !== 'object') return {};
  // Allowlist a conservative set of non-sensitive, primitive fields only.
  const allowed = new Set<string>([
    'model',
    'temperature',
    'top_p',
    'max_tokens',
    'frequency_penalty',
    'presence_penalty',
    'n',
    'stream',
    'tool',
    'toolName',
    'retriever',
    'project',
    'runName',
    'runType',
    'parentRunId',
    'tags',
  ]);
  const isPrimitive = (v: unknown) => v == null || ['string', 'number', 'boolean'].includes(typeof v);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (allowed.has(k) && isPrimitive(v)) out[k] = v as any;
  }
  return out;
}

function safeType(x: unknown): string | undefined {
  if (x && typeof x === 'object') {
    const any = x as any;
    if (typeof any?.lc_id?.join === 'function') return String(any.lc_id.join(':'));
    const name = any?.name || any?.constructor?.name;
    if (typeof name === 'string') return name;
  }
  return undefined;
}

function summarizeKeys(obj: Record<string, unknown> | undefined): string[] | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  try {
    return Object.keys(obj);
  } catch {
    return undefined;
  }
}

function normalizeError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

/**
* Produce sanitized error fields for logging to avoid accidental content leakage.
* - The message is truncated to a conservative maximum length.
* - The stack trace is omitted by default and only included when `LOG_ERROR_STACKS`
*   is explicitly enabled ("true" or "1"). When included, it is limited to a
*   small number of lines to minimize potential leakage of prompts or inputs
*   embedded in exception messages.
*/
function sanitizedErrorFields(e: Error): {
  errorName: string;
  errorMessage: string;
  errorStack?: string;
} {
  const MAX_MESSAGE_LEN = 500;
  const MAX_STACK_LINES = 10;
  const includeStack = (() => {
    const val = String(process.env.LOG_ERROR_STACKS || '').toLowerCase();
    return val === 'true' || val === '1';
  })();

  const errorName = e?.name || 'Error';
  const msg = String(e?.message ?? '').slice(0, MAX_MESSAGE_LEN);
  const rawStack = includeStack ? e?.stack : undefined;
  const errorStack = rawStack
    ? rawStack
        .split('\n')
        .slice(0, MAX_STACK_LINES)
        .join('\n')
    : undefined;

  return { errorName, errorMessage: msg, ...(errorStack ? { errorStack } : {}) };
}

function extractTokenUsage(
  result: LLMResult | undefined,
  extra?: Record<string, unknown>
): { promptTokens?: number; completionTokens?: number; totalTokens?: number } | undefined {
  const out = (result || {}) as LLMResult;
  const llmOut = (out.llmOutput || {}) as Record<string, unknown>;
  const tokenUsage = (llmOut?.tokenUsage || {}) as TokenUsage;
  const promptTokens = tokenUsage.promptTokens ?? tokenUsage.prompt_tokens ?? tokenUsage.input_tokens;
  const completionTokens = tokenUsage.completionTokens ?? tokenUsage.completion_tokens ?? tokenUsage.output_tokens;
  const totalTokens = tokenUsage.totalTokens ?? tokenUsage.total_tokens;

  // Fallbacks: some providers pass usage via extra params
  const ex = (extra || {}) as Record<string, unknown>;
  const exUsage = (ex?.tokenUsage || ex?.usage || {}) as TokenUsage;
  const p = promptTokens ?? exUsage.promptTokens ?? exUsage.prompt_tokens ?? exUsage.input_tokens;
  const c = completionTokens ?? exUsage.completionTokens ?? exUsage.completion_tokens ?? exUsage.output_tokens;
  const t = totalTokens ?? exUsage.totalTokens ?? exUsage.total_tokens;

  if (p == null && c == null && t == null) return undefined;

  // Coerce to numbers once, then derive total when providers omit it but parts are present.
  const pNum = asNumber(p);
  const cNum = asNumber(c);
  let tNum = asNumber(t);
  if (tNum == null && pNum != null && cNum != null) tNum = pNum + cNum;

  return { promptTokens: pNum, completionTokens: cNum, totalTokens: tNum };
}

function asNumber(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? (n as number) : undefined;
}

// Public API
export function buildObservabilityHandlers(): BaseCallbackHandler[] {
  const handlers: BaseCallbackHandler[] = [new LoggerCallbackHandler()];
  if (isLangSmithEnabled()) {
    // Add the official LangSmith tracer when explicitly enabled by environment
    try {
      handlers.push(new LangChainTracer());
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      logger.warn('LangSmith tracer not initialized', { errorMessage: err.message });
    }
  }
  return handlers;
}

export function withObservability<TArgs, TReturn>(
  runnable: { invoke(input: TArgs, config?: RunnableConfig): Promise<TReturn> },
  config?: RunnableConfig
) {
  const handlers = buildObservabilityHandlers();
  const merged = mergeConfig(config, { callbacks: handlers });
  return {
    invoke(input: TArgs, cfg?: RunnableConfig) {
      return runnable.invoke(input, mergeConfig(merged, cfg));
    },
  };
}

function isLangSmithEnabled(): boolean {
  const val = String(process.env.LANGSMITH_ENABLED || process.env.LANGCHAIN_TRACING_V2 || '').toLowerCase();
  return val === '1' || val === 'true';
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
