# Integrated Architecture: Response API + LangChain

This guide explains how the repository wires OpenAI's Response API and LangChain together so teams can choose either direct SDK calls or LangChain chains while sharing rate limiting, observability, and prompt management.

## Components

- OpenAI Response API wrapper: `src/openai/client.ts`
- Unified rate limiter: `src/openai/OpenAIRateLimiter.ts`
- Pricing and cost tracking: `src/openai/pricing.ts`
- JSON logger: `src/openai/logger.ts`
- LangChain adapter (rate limit + cost logging): `src/langchain/RateLimitedChatOpenAI.ts` and `src/langchain/rateLimitAdapter.ts`
- LangChain observability bridge: `src/langchain/observability.ts`
- Structured prompts (Zod typed): `src/prompts/**`
- Correction analysis chain (migrated to LangChain): `src/analysis/correction/chain.ts`

## How calls flow

Direct Response API (no LangChain):

```
caller → OpenAIRateLimiter.makeRequest() → OpenAIClient.chat() → OpenAI SDK (responses.create)
   ↘ logs usage+cost (on success) via pricing → logger
```

LangChain chain (ChatOpenAI with adapter):

```
caller → createCorrectionAnalysisChain() → prompt → withRateLimiter(limiter, model) → ChatOpenAI.invoke()
      ↘ LoggerCallbackHandler mirrors run lifecycle (start/end/errors, token usage)
      ↘ Rate limiter gate waits before invoke; post-call cost logged via pricing → logger
```

Key properties:
- One rate limit surface area. All paths honor the same RPM gate. Budget enforcement remains in `OpenAIRateLimiter` for direct calls; the LangChain adapter only gates and logs cost.
- One observability story. LangChain runs emit structured logs via `LoggerCallbackHandler`. Direct calls log success/error and spend via the limiter.
- One prompt story. All prompts live under `src/prompts/**` with Zod schemas and versioning.

## Selecting an approach

Use direct Response API when:
- You need tight control of request shapes or streaming is required (not implemented here yet).
- You’re building a small integration without chain composition.

Use LangChain chains when:
- You want typed outputs, prompt templating, and composition.
- You want first-class callbacks/tracing while still reusing our rate limit and cost tracking.

Both approaches may coexist in a single service. They share logging, pricing, and rate limiting semantics.

## Migration path for future API changes

- Keep OpenAI request/response mapping isolated in `OpenAIClient`.
- Keep LangChain-specific glue out of the OpenAI wrapper. The adapter reads usage/model metadata without depending on LangChain internals.
- If Response API models/pricing change, update `src/openai/pricing.ts` and add a focused unit test. The LangChain adapter uses the same pricing table.
- If LangChain usage metadata shapes change, adjust extraction helpers in `RateLimitedChatOpenAI.ts` and `observability.ts`. Tests already cover multiple alias keys.

## References
- Migration notes: `docs/guides/response-api-migration.md`
- Observability details: `src/langchain/observability.ts` and `tests/correction/observability-*.test.ts`
- Adapter tests: `src/langchain/__tests__/withOpenAIRateLimit.test.ts`
- Correction chain: `src/analysis/correction/chain.ts`
