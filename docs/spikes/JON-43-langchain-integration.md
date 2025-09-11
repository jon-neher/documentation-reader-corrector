# Spike: LangChain.js integration for AI workflow orchestration (JON-43)

Date: 2025-09-11

This document captures a focused investigation into integrating LangChain.js into this repository’s AI workflows. It references concrete pieces of this codebase and evaluates where LangChain would add value, risks, and an initial proof‑of‑concept.

## Summary

- Recommendation: Go (scoped). Adopt LangChain.js for orchestration, prompt templating, and structured outputs in new “analysis” workflows, while keeping the existing `OpenAIClient`/`OpenAIRateLimiter` for enforcement of budget and retries. Integrate via a thin boundary so we can incrementally migrate call sites.
- Primary value adds: LCEL runnables for multi‑step flows; robust structured output via Zod; callbacks + optional LangSmith tracing; standardized tool/agent abstractions for future Jira/GitHub automation; strong TS types in v0.3.
- Complexity: Low–moderate. Initial integration can be additive without touching current `src/openai/*` code. Rate limiting/budget enforcement can be preserved by gating LangChain calls through a small adapter.

---

## Architecture assessment (current repo)

Relevant files:

- `src/openai/client.ts` — small wrapper over the official `openai` SDK. Exposes `chat(prompt, options)` returning `{ id, model, content, usage, raw }`.
- `src/openai/OpenAIRateLimiter.ts` — centralizes monthly budget tracking, RPM throttling, retries with backoff, and structured logging. Uses `estimateCostUSD()` from `src/openai/pricing.ts` and `logger` in `src/openai/logger.ts`.
- `src/index.ts` — re‑exports the client and rate limiter.
- `src/openaiClient.js` — a minimal ESM helper for runtime connectivity checks that imports the compiled library from `dist`.

Observed patterns:

- All OpenAI calls ideally go through `OpenAIRateLimiter.makeRequest()` which: (a) enforces RPM; (b) retries on 429/5xx/timeouts; (c) calculates and persists monthly spend (in‑memory or file‑backed); (d) logs inputs/outputs metadata.
- The wrapper `OpenAIClient.chat()` uses Chat Completions (OpenAI SDK v5) and returns normalized usage.

Implications for LangChain:

- LangChain’s `ChatOpenAI` (from `@langchain/openai`) would bypass our wrapper unless we add an integration layer. We should keep our limiter/budget semantics and attach them to LangChain calls via a small adapter.

---

## Where LangChain can add value

1) Orchestration with LCEL runnables
   - Compose multi‑step flows (`RunnableSequence`, `RunnableMap`, `.withFallbacks`) without bespoke glue code.
   - Easier to express “analyze → extract → format → route” pipelines for corrections and docs generation.

2) Structured outputs (Zod, JSON mode)
   - Use `StructuredOutputParser` and/or `model.withStructuredOutput(schema)` to reliably produce typed objects for Jira ticket payloads and analytics.

3) Prompt management
   - `ChatPromptTemplate` for parameterized prompts, partials, and few‑shot patterns. Optional LangSmith Prompt Hub for versioning if we later want hosted prompts.

4) Tools and agents (future‑facing)
   - Define strongly‑typed tools (Zod schemas) for Jira/GitHub operations. Later, graduate to LangGraph for stateful agents if needed.

5) Observability
   - Built‑in callbacks; optional LangSmith tracing for step‑level visibility. Complements existing JSON logging.

---

## Mapping current use cases to LangChain concepts

- Correction Analysis Pipeline → RunnableSequence
  - `ChatPromptTemplate` → `ChatOpenAI` → `StructuredOutputParser<CorrectionAnalysis>`
  - Add a tiny pre‑step gate that checks RPM/budget via our limiter before each model call.

- Documentation Generation → RunnableSequence or early LangGraph
  - Stages: classify → draft change note → structure Jira payload. Potential tool‑calling step later for posting to Jira.

- Pattern Recognition → Map/Reduce runnables
  - Batch analyze many corrections (map), then summarize or cluster (reduce).

- Prompt Management → In‑repo prompt modules
  - Keep prompts local in code for now; optional LangSmith Hub later.

- Memory/Context → Start with explicit message windows
  - Prefer explicit message assembly or `trimMessages` utilities; adopt LangGraph state when we truly need long‑lived conversational memory.

---

## Integration points & compatibility

- Runtime: Node 18+, ESM (repo already uses `"type": "module"`, `tsconfig` targets NodeNext). LangChain is ESM‑friendly.
- Packages: `@langchain/openai` + `@langchain/core` (v0.3 requires `@langchain/core` as an explicit peer). Zod for output schemas.
- Rate limiting & budget: Keep `OpenAIRateLimiter` authoritative. For LangChain usage, add a small adapter runnable that:
  - Calls `limiter.waitForRateLimit()` prior to model invocation.
  - After the call, reads `AIMessage.usage_metadata` and uses `estimateCostUSD()` to update spend via a new budget adaptor (or log cost only in phase 1).
- Retries: Use LangChain’s `maxRetries` for transient errors; keep our backoff semantics where critical paths rely on the limiter.
- Logging: Keep `logger` as the baseline; optionally add a `CallbackHandler` that mirrors LangChain run events into our logger.

---

## Technical investigation highlights (references in footnotes)

- Install & packaging: LangChain v0.3 requires explicit `@langchain/core`. Callbacks are backgrounded by default; if using LangSmith in serverless, await or set env var to block for traces. [1]
- Structured outputs: `withStructuredOutput` and `StructuredOutputParser` with Zod schemas; OpenAI supports JSON mode. [2][3]
- Token usage: `AIMessage.usage_metadata` and/or `response_metadata` exposes token counts for OpenAI, which we can feed into our pricing calculator. [4]
- Error handling & retries: Chat models support `maxRetries`, per‑call `timeout`, and `maxConcurrency` throttling. [5]
- Observability: LangChain callbacks and LangSmith tracing are first‑class; environment variables control behavior. [6]

---

## Minimal proof‑of‑concept (added under `examples/langchain/poc_correction_analysis.mjs`)

Demonstrates a single‑step correction analysis chain:

1. Zod schema for typed output ({ classification, confidence, rationale, fields }).
2. `ChatPromptTemplate` with format instructions injected from the parser.
3. `ChatOpenAI` call with `gpt-4o-mini` (configurable).
4. Logs token usage and estimated cost using `src/openai/pricing.ts` logic.

Run locally (after installing dependencies and setting `OPENAI_API_KEY`):

```bash
npm install
node ./examples/langchain/poc_correction_analysis.mjs
```

This does not change production code paths. It’s purely illustrative and safe to remove.

---

## Recommendations (Go/No‑Go)

Decision: **Go (scoped)**

- Start by using LangChain only in new pipeline code where orchestration/structured output clarity matters most (Correction Analysis). Keep existing `OpenAIRateLimiter` for any production‑critical flows.
- Defer agents/LangGraph until we validate a few pipelines and establish logging/metrics parity.

### Suggested boundaries for a first integration

1) LangChain model surface
   - Use `@langchain/openai` `ChatOpenAI` for calls made via Runnable chains.
   - Set `maxRetries`, `timeout`, and (optionally) `maxConcurrency` to conservative defaults.

2) Rate limit/budget adaptor
   - Add a small helper that gates calls with our limiter. Phase 1 can log cost only; Phase 2 can update budget persistently through a slim exported method.

3) Prompt modules
   - Create `src/prompts/` with `ChatPromptTemplate` exports per workflow. Avoid implicit global memory.

4) Observability
   - Ship a `CallbackHandler` that bridges LangChain run events into `src/openai/logger.ts`. Optionally enable LangSmith via env for ad‑hoc traces.

---

## Effort estimate (coarse)

- Phase 1 (this sprint):
  - POC chain + prompts and structured outputs: 0.5–1 day
  - Callback‑to‑logger bridge + token usage cost log: 0.5 day
  - Docs and examples: 0.5 day

- Phase 2 (opt‑in):
  - Rate/Budget bridge (read/write) and wrapper runnable: 1–2 days
  - First end‑to‑end pipeline (analysis → payload): 1–2 days

- Phase 3 (later):
  - Tools for Jira/GitHub + LangGraph orchestration where needed: 3–5 days

Risks & dependencies:

- Version alignment across `@langchain/*` and `@langchain/core` (v0.3 requires explicit dependency). Low risk with lockfile.
- Need to reconcile retries between our limiter and LangChain’s `maxRetries` to avoid duplicate backoffs.
- Optional LangSmith introduces another vendor/service; keep off by default.

---

## Footnotes (docs)

1. Installation, v0.3 changes (peer dependency on `@langchain/core`; background callbacks): https://js.langchain.com/docs/how_to/installation, https://js.langchain.com/docs/versions/v0_3/
2. Structured outputs and JSON mode: https://js.langchain.com/docs/concepts/structured_outputs, https://js.langchain.com/docs/how_to/output_parser_structured
3. `StructuredOutputParser` (Zod): https://js.langchain.com/v0.1/docs/modules/model_io/output_parsers/types/structured/
4. Token usage on `AIMessage`: https://js.langchain.com/docs/how_to/chat_token_usage_tracking/
5. Retries / timeouts / concurrency: https://js.langchain.com/v0.1/docs/modules/model_io/chat/dealing_with_api_errors/, https://js.langchain.com/v0.1/docs/modules/model_io/chat/timeouts/, https://js.langchain.com/v0.1/docs/modules/model_io/chat/dealing_with_rate_limits/
6. Callbacks & LangSmith tracing: https://js.langchain.com/docs/concepts/callbacks/, https://docs.smith.langchain.com/observability/how_to_guides/tracing/trace_with_langchain
