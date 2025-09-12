# Prompt templates (centralized)

This repository uses LangChain ChatPromptTemplate with Zod-typed structured outputs for all AI workflows. Templates live under `src/prompts/` and are versioned so we can evolve them safely.

## Categories and modules

- Correction Analysis → `src/prompts/correction.ts`
  - Export: `correctionAnalysisV1`, `buildCorrectionAnalysisChain(model)`
  - Schema: `CorrectionAnalysisSchema`
- Documentation Generation → `src/prompts/docs.ts`
  - Ticket generation: `ticketV1`, `buildTicketChain(model)`; schema: `TicketSchema`
  - Doc update plan: `docUpdateV1`, `buildDocUpdateChain(model)`; schema: `DocUpdatePlanSchema`
- Pattern Recognition → `src/prompts/patterns.ts`
  - Clustering + summary: `patternSummaryV1`, `buildPatternSummaryChain(model)`; schema: `PatternSummarySchema`

Each exported `*V1` constant is a `PromptSpec` with:

- `meta`: `{ id, version, description, updatedAt, tags }`
- `template`: a `ChatPromptTemplate` with parameterized variables and few-shots
- `schema`: a Zod schema defining the structured output
- `parser`: a `StructuredOutputParser` derived from the schema
- `getFormatInstructions()`: helper for `{format_instructions}` partials

## Usage

Most call sites will either compose chains directly or use the `build*Chain` helpers.

```ts
import { ChatOpenAI } from '@langchain/openai';
// Package consumers: import from the public API (package barrel)
import {
  buildCorrectionAnalysisChain,
  correctionAnalysisV1,
} from 'documentation-reader-corrector';

const model = new ChatOpenAI({ model: 'gpt-4o-mini', temperature: 0.2 });
const chain = buildCorrectionAnalysisChain(model);

const result = await chain.invoke({
  originalQuestion: 'How do I reset my partner dashboard password?',
  botResponse: 'You can reset passwords in Account Settings under Security.',
  wrong: 'Account Settings → Security',
  right: 'Partner Center → Profile page',
  reason: 'UI changed in 2024.07',
  // You may also use: correctionAnalysisV1.getFormatInstructions()
  format_instructions: correctionAnalysisV1.getFormatInstructions(),
});
```

For local development in this repo (before publishing), mirror the example and import from the compiled barrel in `dist/`:

```ts
import { ChatOpenAI } from '@langchain/openai';
import { buildCorrectionAnalysisChain, correctionAnalysisV1 } from '../../dist/index.js';
```

See `examples/langchain/poc_correction_analysis.mjs` for a runnable example that already uses `../../dist/index.js`.

## Versioning

- Each template is exported as `*V{n}` and carries `meta.version` and `meta.updatedAt`.
- Breaking changes to wording, variables, or schema should bump the version (e.g., `v2`) and keep the prior export in place for callers that still depend on it.
- Future: we can publish or sync templates with LangSmith Prompt Hub without changing this API; the `meta.id` would serve as the hub key.

## Adding a new template

1. Create a new module in `src/prompts/` or extend an existing one.
2. Define a Zod schema and derive a parser with `withFormatInstructions()`.
3. Create a `ChatPromptTemplate` with variables and few-shot examples.
4. Export a `PromptSpec` and optional `build*Chain(model)` helper.
5. Update this README with the new export.

## Parameters and partials

- Variables are declared in the template body (e.g., `{originalQuestion}`).
- Use the `format_instructions` partial to inject the parser’s format hints. All exported specs already include a partial so callers can pass `format_instructions` as an input variable.

## Structured outputs

All schemas use Zod and are validated by LangChain’s `StructuredOutputParser`. The parsed result is strongly typed via `z.infer<typeof Schema>`.

---

Historical background: see the spike at `docs/spikes/JON-43-langchain-integration.md` for prior assessment and rationale.
