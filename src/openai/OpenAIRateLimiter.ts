import { OpenAIClient } from './client.js';
import type { MakeRequestOptions, OpenAIResponse, ChatMessage } from './client.js';
import { estimateCostUSD } from './pricing.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { logger } from './logger.js';
import {
  BudgetExceededError,
  InvalidApiKeyError,
  InvalidRequestError,
  NetworkTimeoutError,
  RateLimitError,
  ServerError,
} from './errors.js';

type Retryable = {
  shouldRetry: boolean;
  reason: string;
  retryAfterMs?: number;
};

// Simple synchronous storage for monthly spend persistence. Intentionally
// synchronous to match current in-process use cases and avoid implicit async.
type Storage = {
  load(monthKey: string): number | undefined;
  save(monthKey: string, spend: number): void;
};

class InMemoryStorage implements Storage {
  private m = new Map<string, number>();
  load(monthKey: string): number | undefined {
    return this.m.get(monthKey);
  }
  save(monthKey: string, spend: number): void {
    this.m.set(monthKey, spend);
  }
}

class FileStorage implements Storage {
  private file: string;
  constructor(file: string) {
    this.file = file;
  }
  private readAll(): Record<string, number> {
    try {
      if (!fs.existsSync(this.file)) return {};
      const raw = fs.readFileSync(this.file, 'utf8');
      return JSON.parse(raw || '{}');
    } catch (err) {
      // Log (but do not throw) to avoid silently swallowing persistence issues
      // that could mask permission problems or file corruption. Keep behavior
      // unchanged by returning an empty object when read/parse fails.
      logger.warn('Failed to read/parse budget file', {
        file: this.file,
        err: (err as Error).message,
      });
      return {};
    }
  }
  private writeAll(data: Record<string, number>): void {
    // Ensure target directory exists
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    // Perform an atomic write: write to a temp file in the same directory,
    // then rename over the destination. This avoids corruption on crashes
    // and minimizes torn writes when multiple writers are present.
    const dir = path.dirname(this.file);
    const base = path.basename(this.file);
    const tmp = path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`);
    const json = JSON.stringify(data, null, 2);
    try {
      fs.writeFileSync(tmp, json, 'utf8');
      try {
        fs.renameSync(tmp, this.file);
      } catch (err: any) {
        // On Windows, rename cannot replace an existing file. Fall back to
        // unlinking first, then renaming. Keep POSIX fast‑path above.
        if (process.platform === 'win32' && (err?.code === 'EEXIST' || err?.code === 'EPERM')) {
          try { fs.rmSync(this.file, { force: true }); } catch {}
          fs.renameSync(tmp, this.file);
        } else {
          throw err;
        }
      }
    } finally {
      // Ensure no temp file lingers on failure
      try { fs.rmSync(tmp, { force: true }); } catch {}
    }
  }
  load(monthKey: string): number | undefined {
    const all = this.readAll();
    return all[monthKey];
  }
  save(monthKey: string, spend: number): void {
    const all = this.readAll();
    all[monthKey] = spend;
    this.writeAll(all);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

export class OpenAIRateLimiter {
  requestsPerMinute: number;
  monthlyBudget: number; // USD
  requestQueue: unknown[];
  monthlySpend: number;

  private lastMinuteTimestamps: number[] = [];
  private client: OpenAIClient;
  private maxRetries: number;
  private storage: Storage;
  private currentMonthKey: string;

  constructor(requestsPerMinute = 50, monthlyBudget = 100) {
    this.requestsPerMinute = requestsPerMinute;
    this.monthlyBudget = monthlyBudget;
    this.requestQueue = [];
    this.monthlySpend = 0;
    this.client = new OpenAIClient();
    this.maxRetries = Number(process.env.OPENAI_MAX_RETRIES || 3);
    const persist = (process.env.OPENAI_BUDGET_PERSIST || '').toLowerCase();
    if (persist === 'file') {
      const f = process.env.OPENAI_BUDGET_FILE || '.cache/openai_budget.json';
      this.storage = new FileStorage(f);
    } else {
      this.storage = new InMemoryStorage();
    }
    this.currentMonthKey = this.getMonthKey(new Date());
    const loaded = this.storage.load(this.currentMonthKey);
    if (typeof loaded === 'number' && !Number.isNaN(loaded)) this.monthlySpend = loaded;
  }

  private getMonthKey(d: Date): string {
    // Calendar month in UTC: YYYY-MM
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  private rotateMonthIfNeeded(): void {
    const nowKey = this.getMonthKey(new Date());
    if (nowKey !== this.currentMonthKey) {
      this.currentMonthKey = nowKey;
      const loaded = this.storage.load(this.currentMonthKey);
      this.monthlySpend = typeof loaded === 'number' ? loaded : 0;
    }
  }

  private recordSpend(deltaUSD: number): void {
    this.rotateMonthIfNeeded();
    this.monthlySpend = Number((this.monthlySpend + deltaUSD).toFixed(6));
    try {
      this.storage.save(this.currentMonthKey, this.monthlySpend);
    } catch (err) {
      logger.warn('Failed to persist monthly spend', { err: (err as Error).message });
    }
  }

  async makeRequest(prompt: string | MakeRequestOptions['messages'], options: MakeRequestOptions = {}): Promise<OpenAIResponse> {
    this.rotateMonthIfNeeded();
    if (this.monthlySpend >= this.monthlyBudget) {
      logger.error('Budget exceeded; blocking request', {
        monthlySpend: this.monthlySpend,
        monthlyBudget: this.monthlyBudget,
      });
      throw new BudgetExceededError();
    }

    await this.waitForRateLimit();

    return this.retryWithBackoff(prompt, options);
  }

  async waitForRateLimit(): Promise<void> {
    // Iterative version to avoid building deep promise chains under saturation.
    // Preserves semantics: prune, check capacity, push placeholder token for
    // visibility while waiting, sleep, remove placeholder, and re-check.
    // Loop until a slot is acquired, then record the timestamp and return.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      // Treat zero/negative RPM as "no limit" to avoid busy spinning on misconfiguration.
      if (this.requestsPerMinute <= 0) {
        // No rate limiting; avoid mutating tracking state to prevent unbounded growth.
        return;
      }
      const now = Date.now();
      // prune old timestamps
      this.lastMinuteTimestamps = this.lastMinuteTimestamps.filter((t) => now - t < 60_000);
      if (this.lastMinuteTimestamps.length < this.requestsPerMinute) {
        this.lastMinuteTimestamps.push(now);
        return;
      }

      const oldest = this.lastMinuteTimestamps[0];
      const waitMs = Math.max(0, 60_000 - (now - oldest));
      // track a placeholder in the queue for visibility
      const token = { at: now, waitMs } as const;
      this.requestQueue.push(token);
      logger.debug('Rate limit reached; waiting', { waitMs, queueSize: this.requestQueue.length });
      try {
        await sleep(waitMs);
      } finally {
        // remove the specific placeholder when proceeding (avoid removing another caller's token)
        const idx = this.requestQueue.indexOf(token);
        if (idx >= 0) this.requestQueue.splice(idx, 1);
      }
      // continue loop to re-check capacity
    }
  }

  async retryWithBackoff(
    prompt: string | MakeRequestOptions['messages'],
    options: MakeRequestOptions
  ): Promise<OpenAIResponse> {
    const maxAttempts = Math.max(1, Number(options.maxRetries ?? this.maxRetries));
    let attempt = 0;
    let lastErr: unknown;

    while (attempt < maxAttempts) {
      attempt++;
      try {
        const startedAt = Date.now();
        const resp = await this.performRequest(prompt, options);
        const elapsedMs = Date.now() - startedAt;
        const usage = resp.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
        const cost = estimateCostUSD({
          model: resp.model,
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
        });
        this.recordSpend(cost);
        logger.info('OpenAI request success', {
          attempt,
          elapsedMs,
          model: resp.model,
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          costUSD: cost,
          monthlySpend: this.monthlySpend,
          monthlyBudget: this.monthlyBudget,
        });
        return resp;
      } catch (err) {
        lastErr = err;
        const { shouldRetry, reason, retryAfterMs } = this.classifyRetry(err);
        logger.warn('OpenAI request failure', {
          attempt,
          maxAttempts,
          errorName: (err as any)?.name,
          errorMessage: (err as Error)?.message,
          reason,
          retryAfterMs,
        });
        if (!shouldRetry || attempt >= maxAttempts) break;
        // Honor server-provided Retry-After exactly (no jitter, no cap).
        if (typeof retryAfterMs === 'number') {
          await sleep(retryAfterMs);
        } else {
          // Exponential backoff fallback with jitter and a max cap.
          const base = 500 * Math.pow(2, attempt - 1);
          const jitter = Math.floor(Math.random() * 100);
          const delay = Math.min(15_000, base + jitter);
          await sleep(delay);
        }
      }
    }

    // Surface distinct error types
    throw this.normalizeError(lastErr);
  }

  private classifyRetry(err: unknown): Retryable {
    // OpenAI SDK errors expose `.status`; fetch timeouts have `.name` or `.code`.
    const any = err as any;
    const status = typeof any?.status === 'number' ? any.status : undefined;
    const code = any?.code || any?.error?.code;
    const name = any?.name;
    const retryAfterHeader = any?.response?.headers?.get?.('retry-after');
    const retryAfterMs = parseRetryAfter(retryAfterHeader);

    if (status === 429) return { shouldRetry: true, reason: 'rate_limit', retryAfterMs };
    if (status && status >= 500) return { shouldRetry: true, reason: 'server_error', retryAfterMs };
    if (name === 'AbortError' || code === 'ETIMEDOUT' || code === 'ECONNRESET')
      return { shouldRetry: true, reason: 'network_timeout' };

    return { shouldRetry: false, reason: 'non_retryable' };
  }

  private normalizeError(err: unknown): Error {
    const any = err as any;
    const status = typeof any?.status === 'number' ? any.status : undefined;
    const message: string = any?.message || 'OpenAI request failed';

    if (status === 401) return new InvalidApiKeyError();
    if (status === 400) return new InvalidRequestError(message);
    if (status === 429) {
      const retryAfterHeader = any?.response?.headers?.get?.('retry-after');
      const retryAfterMs = parseRetryAfter(retryAfterHeader);
      return new RateLimitError(message, retryAfterMs);
    }
    if (status && status >= 500) return new ServerError(status, message);
    if (any?.name === 'AbortError' || any?.code === 'ETIMEDOUT' || any?.code === 'ECONNRESET')
      return new NetworkTimeoutError();

    return any instanceof Error ? any : new Error(message);
  }

  private async performRequest(
    prompt: string | MakeRequestOptions['messages'],
    options: MakeRequestOptions
  ): Promise<OpenAIResponse> {
    const preview = Array.isArray(prompt)
      ? (prompt as ChatMessage[])
          .map((m) => (typeof m?.content === 'string' ? m.content : ''))
          .join(' ')
          .slice(0, 120)
      : String(prompt).slice(0, 120);
    logger.debug('Dispatching OpenAI request', {
      model: options.model || process.env.OPENAI_MODEL || 'gpt-4o-mini',
      promptPreview: preview,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
    });

    try {
      const resp = await this.client.chat(
        Array.isArray(prompt) ? (prompt as ChatMessage[]) : String(prompt),
        options
      );
      return resp;
    } catch (err) {
      throw err; // normalization handled by caller
    }
  }

  // --- helpers ---
}

function parseRetryAfter(retryAfter: string | null | undefined): number | undefined {
  if (!retryAfter) return undefined;
  // If it's a number, spec says it's seconds
  const seconds = Number(retryAfter);
  if (!Number.isNaN(seconds)) return Math.max(0, seconds * 1000);
  // Otherwise, it may be an HTTP-date
  const dateMs = Date.parse(retryAfter);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }
  return undefined;
}

export default OpenAIRateLimiter;
