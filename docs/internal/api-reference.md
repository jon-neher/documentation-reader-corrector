# Internal API Reference: OpenAI Client and Rate Limiter (Response API)

This repository uses the OpenAI Response API via a thin wrapper (`OpenAIClient`) and a request mediator (`OpenAIRateLimiter`). This document is the canonical reference for internal developers.

Updated on: 2025-09-16

## Overview

- Transport: OpenAI Response API (Responses)
- Wrapper: `src/openai/client.ts` (class `OpenAIClient`)
- Mediator: `src/openai/OpenAIRateLimiter.ts` (class `OpenAIRateLimiter`)
- Pricing helper: `src/openai/pricing.ts` (maps token usage → USD)
- Structured logging: `src/openai/logger.ts`

## OpenAIClient

### `chat(prompt, options): Promise<OpenAIResponse>`

- `prompt`: `string | ChatMessage[]`
  - When a string is provided, it is sent as `input: string` to the Responses API.
  - When an array of `ChatMessage` is provided, messages are mapped to Responses `input` messages (EasyInputMessage).
- `options`:
  - `model?: string` (default: `process.env.OPENAI_MODEL || 'gpt-4o-mini'`)
  - `temperature?: number` (default: `0.2`)
  - `maxTokens?: number` → maps to `max_output_tokens`
  - `timeoutMs?: number` → request timeout
  - `messages?: ChatMessage[]` → explicitly set messages (wins over a string `prompt`)
  - `extra?: Record<string, unknown>` → forwarded to `responses.create(...)` after sanitizing conflicting keys
  - `maxRetries?: number` → consumed only by the rate limiter when used through it

Returns:

```ts
{
  id: string;
  model: string;
  created: number; // unix seconds
  content: string; // `output_text` or first text-like from `output`
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  raw: unknown; // full SDK response for advanced callers
}
```

Notes:

- Roles `tool` and `function` are normalized to `user` to avoid misattribution when translated to Responses messages. Unknown roles also fall back to `user`.
- Content mapping supports `text`, `image_url`, `input_audio`, and `file` parts. Unknown parts are preserved in a small JSON blob to avoid silent data loss.

### Examples

String prompt:

```ts
import { OpenAIClient } from '../src/openai/client.js';

const client = new OpenAIClient(process.env.OPENAI_API_KEY);
const res = await client.chat('Hello', { model: 'gpt-4o-mini', maxTokens: 64 });
console.log(res.content);
```

Messages with multimodal parts:

```ts
import type { ChatMessage } from '../src/openai/client.js';
import { OpenAIClient } from '../src/openai/client.js';

const messages: ChatMessage[] = [
  { role: 'system', content: 'Be concise' },
  { role: 'user', content: [
      { type: 'text', text: 'Caption this image' },
      { type: 'image_url', image_url: { url: 'https://example.com/cat.png' } },
    ] },
];
const client = new OpenAIClient();
const res = await client.chat(messages, { model: 'gpt-4o' });
```

## OpenAIRateLimiter

Use for all production calls. It enforces requests-per-minute, retries transient errors, records spend against a monthly budget, and logs structured events.

Constructor:

```ts
new OpenAIRateLimiter(requestsPerMinute = 50, monthlyBudgetUSD = 100)
```

Primary method:

```ts
await limiter.makeRequest(promptOrMessages, {
  model: 'gpt-4o-mini',
  temperature: 0.2,
  maxTokens: 256,
  timeoutMs: 20_000,
});
```

Additional hooks:

- `waitForRateLimit()` — acquire a slot without sending a request (useful in adapters)
- `recordUsage(model, promptTokens, completionTokens)` — record post-hoc usage (e.g., when using LangChain)

## Environment

Required:

- `OPENAI_API_KEY`

Optional:

- `OPENAI_MODEL` — default model when not provided per call (e.g., `gpt-4o-mini`)
- `OPENAI_MAX_RETRIES` — limiter retries for transient failures (default: `3`)
- `OPENAI_BUDGET_PERSIST` — set to `file` to persist monthly spend across restarts
- `OPENAI_BUDGET_FILE` — path for persisted spend (default: `.cache/openai_budget.json`)
- `LOG_LEVEL` — `debug|info|warn|error` (default: `info`)

## Observability

- Logs are JSON lines; payloads avoid PII and redact API keys.
- Token usage and estimated cost (USD) are logged when available.

## Compatibility and gotchas

- Streaming is not implemented in `OpenAIClient`.
- If you pass both `prompt` (string) and `options.messages`, `messages` wins.
- `extra` is forwarded, but conflicting keys (e.g., another `model`, `input`, or `max_output_tokens`) are ignored in favor of explicit options.
