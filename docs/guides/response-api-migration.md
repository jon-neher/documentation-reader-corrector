# Migration Guide: Chat Completions → Response API

Updated on: 2025-09-16
Migration commit: f7439c5 (2025-09-15) — "feat(openai): migrate client wrapper to Responses API (JON-39)"

This guide explains the switch from the legacy Chat Completions API to the OpenAI Response API in this repository and covers what changed, how to update call sites, and how to troubleshoot.

## Why we migrated

- Single, consistent API for multimodal inputs and tool outputs
- Clearer output model (`output_text` + `output[]`)
- Usage blocks are standardized (`input_tokens`, `output_tokens`, `total_tokens`)

## What changed (in this repo)

- `src/openai/client.ts` now calls `openai.responses.create(...)` instead of `chat.completions.create(...)`.
- Public surface area is intentionally stable:
  - We still export `ChatMessage` for callers that build Chat Completions–style messages.
  - `OpenAIClient.chat(promptOrMessages, options)` is unchanged.
  - Return shape is unchanged: `{ id, model, created, content, usage?, raw }`.
- Mapping details:
  - `options.maxTokens` → `max_output_tokens`
  - `options.messages` or `prompt: ChatMessage[]` → mapped to Responses `input` messages
  - `usage.input_tokens|output_tokens` → mapped to `usage.prompt_tokens|completion_tokens`
  - Roles `tool`/`function` and unknown roles are normalized to `user`

## Breaking changes (behavioral differences)

We preserved the TypeScript surface, but there are subtle behavior changes to be aware of:

- Role normalization: `tool`/`function` content now counts as `user` in the request. If a caller relied on the assistant consuming its own previous tool output differently, review the prompt construction.
- Content mapping strictness: Unsupported content parts are preserved as a compact JSON blob appended as an `input_text` part. This avoids data loss but may slightly alter how the model perceives the tail of message content.
- Streaming: Our wrapper does not implement streaming with the Response API. If you need streaming, open an issue with a concrete call site.

If additional breaking changes are discovered in downstream services, document them here and link the PRs.

## What you need to do

Most internal code requires no change. For new code:

- Prefer `OpenAIRateLimiter.makeRequest(...)` for production pathways.
- For low-level calls, prefer `OpenAIClient.chat(...)` with either a string prompt or `ChatMessage[]`.
- For LangChain chains, keep using the existing adapters in `src/langchain/*` and, when needed, call `limiter.recordUsage(model, promptTokens, completionTokens)` with usage metadata from the chain’s output.

### Example (string prompt)

```ts
const limiter = new OpenAIRateLimiter(50, 100);
const res = await limiter.makeRequest('Summarize: ...', {
  model: 'gpt-4o-mini',
  maxTokens: 128,
  temperature: 0.2,
});
console.log(res.content);
```

### Example (messages with an image)

```ts
const messages: ChatMessage[] = [
  { role: 'user', content: [
      { type: 'text', text: 'What is in this picture?' },
      { type: 'image_url', image_url: { url: 'https://example.com/cat.png' } },
    ] }
];
const res = await limiter.makeRequest(messages, { model: 'gpt-4o' });
```

## Validation checklist

- TypeScript: `npm run typecheck`
- Tests: `npm test`
- Connectivity: `npm run openai:test` (requires `OPENAI_API_KEY`)

## Open questions and gaps

- Do we need streaming? If yes, specify the call sites and desired semantics with the Response API.
- Should monthly budget be configurable via env (e.g., `OPENAI_MONTHLY_BUDGET`)? Today it’s only set via the `OpenAIRateLimiter` constructor.
- Confirm the canonical list of supported models for pricing. `src/openai/pricing.ts` includes a snapshot that we should refresh periodically.

Link updates or clarifications here as they land.
