# Troubleshooting: OpenAI Response API

Updated on: 2025-09-16

This guide covers common issues when using the Response API through our `OpenAIClient` and `OpenAIRateLimiter`.

## 1) 401 Unauthorized: Invalid API key

Symptoms:

- Errors of type `InvalidApiKeyError` in code paths using the limiter
- HTTP 401 from the SDK

Fix:

- Ensure `OPENAI_API_KEY` is set in your environment
- Re-run `npm run openai:test` to verify connectivity

## 2) 429 Rate limited

Symptoms:

- `RateLimitError` or retries logged with `status=429`

Fix:

- The limiter automatically backs off and retries transient 429s. If you still see failures:
  - Reduce concurrency in your caller
  - Increase `requestsPerMinute` only if your plan allows it
  - Check logs for `Retry-After` guidance

## 3) 400 Invalid request

Symptoms:

- `InvalidRequestError` thrown without retries

Common causes and fixes:

- Incompatible input shape (e.g., malformed `messages` parts). Use `ChatMessage[]` with supported parts: `text`, `image_url`, `input_audio`, or `file` (either `file_id` or `file_data [+ filename]`).
- Passing both `prompt` and `options.messages` with conflicting content. The wrapper prefers `messages`; provide one or the other intentionally.
- Oversized unknown content: we cap preserved JSON blobs, but extremely large inputs can still breach model limits. Trim raw payloads.

## 4) 5xx server errors

Symptoms:

- `ServerError` after retry exhaustion

Fix:

- The limiter retries transient 5xxs. If exhaustion persists, lower QPS and try again. Consider a fallback model during vendor incidents.

## 5) Timeouts

Symptoms:

- `NetworkTimeoutError` or errors with `AbortError`

Fix:

- Increase `timeoutMs` in the call options.
- Avoid very large inputs; check logs for token counts.

## 6) Missing `usage` in responses

Symptoms:

- `usage` is `undefined` on the normalized result

Fix:

- Some responses do not include a usage block. Cost recording will be skipped. For LangChain flows, pass usage metadata (if available) to `limiter.recordUsage(...)` post-call.

## 7) Pricing and unknown models

Symptoms:

- Cost logging shows a fallback or errors for unknown model names

Fix:

- `src/openai/pricing.ts` uses a snapshot table and a fallback mode. If your model is missing, update the table or set `OPENAI_PRICING_FALLBACK_MODE` to `mini` or `conservative` for safe estimates. Use `error` to enforce strictness during development.

## 8) Streaming

Symptoms:

- You need streaming responses, but the wrapper returns only final content

Fix:

- Streaming is not implemented in `OpenAIClient`. Open a ticket with the call site and required semantics to scope the work.

## Logs and observability

- Logs are JSON and include timing, token usage (when available), model, cost estimates, and redacted sensitive values.
- Use `LOG_LEVEL=debug` locally to see rate-limit waits and retry details.
