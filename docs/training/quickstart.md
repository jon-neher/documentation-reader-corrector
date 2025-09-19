# Team quickstart: Response API + LangChain

This is the shortest path to productive use of either approach. Links point to deeper docs.

## Prereqs

- Node 18+
- `OPENAI_API_KEY` in environment
- Optional: `LANGSMITH_ENABLED=true` to include LangChain tracer

## Option A: Direct Response API (thin wrapper + limiter)

```
import { OpenAIRateLimiter } from './src/openai/OpenAIRateLimiter.js';

const limiter = new OpenAIRateLimiter(60 /* rpm */, 50 /* USD monthly budget */);
const res = await limiter.makeRequest('Summarize: ...', { model: 'gpt-4o-mini', maxRetries: 2, timeoutMs: 20_000 });
console.log(res.content);
```

- When success includes usage, cost is recorded and logged.
- Errors are normalized: `InvalidApiKeyError`, `InvalidRequestError`, `NetworkTimeoutError`, `ServerError`, `BudgetExceededError`.

## Option B: LangChain chain (adapter + observability)

```
import { analyzeCorrection } from './src/analysis/correction/chain.js';
import { OpenAIRateLimiter } from './src/openai/OpenAIRateLimiter.js';

const limiter = new OpenAIRateLimiter(60, 50);
const out = await analyzeCorrection(
  {
    originalQuestion: 'How do I reset my password?',
    botResponse: 'Go to Settings → Security',
    wrong: 'Settings → Security',
    right: 'Profile → Account',
    reason: 'UI updated',
  },
  { limiter, model: process.env.OPENAI_MODEL || 'gpt-4o-mini' }
);
```

- The adapter gates calls via `waitForRateLimit()` and logs cost when usage is present. It does not mutate budgets.
- Observability bridge logs structured lifecycle events without prompts/outputs.

## Common workflows

- Create a typed prompt: `src/prompts/**` (Zod schema + `ChatPromptTemplate`)
- Build a chain: `RunnableSequence.from([inputMapper, prompt, withRateLimiter(limiter, model), parser])`
- Add callbacks/tags/metadata: pass `config` option to chain factory (e.g., `createCorrectionAnalysisChain({ config: { tags: ['prod'] } })`)

## Troubleshooting

- Response API specifics: `docs/troubleshooting/response-api.md`
- Migration notes: `docs/guides/response-api-migration.md`
- Architecture overview: `docs/guides/architecture-response-langchain.md`
