# Monitoring and alerting: Response API + LangChain

This repo emits structured JSON logs that can be ingested by your logging stack (Datadog, Loki, CloudWatch, etc.). Use these fields to power dashboards and alerts across both direct Response API calls and LangChain chains.

## Log events and fields

- Rate limiting
  - msg: `Rate limit reached; waiting`
  - fields: `waitMs`, `queueSize`
- Direct Response API success
  - msg: `OpenAI request success`
  - fields: `model`, `promptTokens`, `completionTokens`, `totalTokens?`, `costUSD`
- Direct Response API errors
  - msg: `OpenAI request error`
  - fields: `status?`, `errorName`, `errorMessage`
- LangChain lifecycle
  - msg: `LC LLM start` / `LC LLM end`
  - fields: `model`, `elapsedMs`, `promptTokens?`, `completionTokens?`, `totalTokens?`
  - msg: `LC chain start` / `LC chain end` (includes `elapsedMs` and summarized keys)
  - msg: `LangChain OpenAI call success` (post-call cost log when usage available)

Note: raw prompts/outputs are never logged. Only counts, timings, and model IDs.

## Dashboards (suggested panels)

- Latency
  - p50/p95/p99 for `LC chain end` → `elapsedMs`
  - p50/p95/p99 for `LC LLM end` → `elapsedMs`
- Throughput
  - count of `LC LLM end` and `OpenAI request success` per minute
- Cost
  - sum of `costUSD` from `LangChain OpenAI call success` and `OpenAI request success`
- Rate limiting
  - count of `Rate limit reached; waiting` and avg `waitMs`
- Errors
  - count of `LC LLM error`, `LC chain error`, and `OpenAI request error`

## Alerts (align with Success Metrics)

- Correction analysis p95 latency > 10s for 5 consecutive minutes
  - source: `LC chain end` where chain name includes correction analysis (tag via config.metadata/runName if needed)
- Error rate > 2% over 10 minutes
  - source: ratio of error events (`LC * error`, `OpenAI request error`) to total LLM/chain ends
- Rate limit pressure sustained
  - trigger when `Rate limit reached; waiting` count > 50/min AND avg `waitMs` > 250ms for 10 minutes
- Cost tracking anomaly
  - difference between summed `costUSD` and provider billing for the same window exceeds 1% (external reconciliation job)
- Quota/key issues
  - spike in `InvalidApiKeyError` or 401/403 on `OpenAI request error`

## Enabling optional tracing

Set `LANGSMITH_ENABLED=true` to include the official `LangChainTracer` alongside our logger bridge. The tracer is added best-effort; failures are logged as warnings.

## Tuning verbosity

- `LOG_LEVEL=debug|info|warn|error` (default: info)
- `LOG_ERROR_STACKS=1` to include truncated stack traces on `* error` events

## Sampling and PII

- We do not log raw prompts or outputs.
- If additional fields are added in your services, keep them to primitive, non-sensitive values and prefer counts over raw lists (see `safeMeta` in `src/langchain/observability.ts`).
