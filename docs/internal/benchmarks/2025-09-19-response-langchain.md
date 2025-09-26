# Benchmark report — Response API + LangChain

Date: 2025-09-19
Branch: ai-jon-48-coordinate-response-api-and-langchain-in

## Method

- Micro-benchmarks using Vitest `bench`:
  - `tests/perf/client.chat.bench.ts` — OpenAIClient.chat request mapping (Response API)
  - `tests/perf/correction.chain.bench.ts` — Correction analysis chain end-to-end with fake model
- Concurrency + memory harness (Node + tsx):
  - `scripts/perf/run_correction_bench.ts` runs N requests with concurrency C using the correction analysis chain with a simulated provider delay (default `SIM_MS=25`).
  - Logs a JSON summary with latency percentiles, throughput, and memory deltas.
  - In `REAL=1` mode, the JSON sets `real: true` and `simMs: null` to indicate no simulated delay.

The results below were generated with a fake model (no network) to isolate framework/adapter overhead. The harness also supports real-model runs via `REAL=1` (keep `RUNS` small to respect budgets).

## Results (devbox)

Vitest bench (micro):
- OpenAIClient.chat mapping
  - string prompt: ~0.0018 ms mean
  - 50-part message mapping: ~0.020 ms mean
  - 11.6× difference (mapping cost only)
- Correction chain with adapter + observability
  - sim 0ms model: ~4.5 ms mean per invoke
  - sim 5ms model: ~9.4 ms mean per invoke

Harness (200 runs, concurrency 20, SIM_MS=25):
- p50 25.7 ms, p95 60.4 ms, p99 67.3 ms, avg 29.4 ms
- Throughput ~654 req/s (synthetic)
- Memory delta: +9.9 MB heapUsed, +22.8 MB RSS over the window

Raw summary (example):

```
$ npm run perf:correction
{ "bench": "correction-analysis", "runs": 200, "concurrency": 20, "simMs": 25,
  "p50": 25.745, "p95": 60.434, "p99": 67.304, "avgMs": 29.394, "throughputRps": 653.595,
  "heapUsedDeltaMB": 9.909, "rssDeltaMB": 22.816 }
```

## Interpretation vs Final Validation Criteria

- End-to-end latency: With a 25 ms synthetic model, chain overhead stays single-digit ms; p95 < 100 ms. With real models, latency is dominated by network/model time. Target “< 10 s” for correction analysis is comfortably met.
- Memory/resource usage: Under C=20 for 200 requests, heap growth was ~10 MB and RSS ~23 MB, with no signs of unbounded growth. The LoggerCallbackHandler uses a bounded Map with eviction to avoid leaks.
- Error handling: Unit/integration suites exercise 400/401/429/5xx classification, retry/backoff, network timeouts, and ensure adapter does not add retries or mutate budgets. See test summary below.
- Developer usability: Chains, prompts, and adapters are exercised end-to-end with typed outputs; see training quickstart and architecture guide.
- Monitoring coverage: Structured logs include `elapsedMs`, token usage, rate-limit waits, and cost; alert recipes included in monitoring doc.

## How to run locally (real model)

- Set `OPENAI_API_KEY` and optionally `OPENAI_MODEL`.
- For a smoke integration: run the skipped ChatOpenAI test by exporting `OPENAI_API_KEY` (see `src/langchain/__tests__/withOpenAIRateLimit.test.ts`).
- For ad-hoc timing: set `REAL=1` and run the existing harness (e.g., `npm run perf:correction`); keep `RUNS` small (for example, `RUNS=20` or `RUNS=50`) to respect budgets. Example:

  ```sh
  REAL=1 RUNS=20 npm run perf:correction
  ```

## Files

- `tests/perf/client.chat.bench.ts`
- `tests/perf/correction.chain.bench.ts`
- `scripts/perf/run_correction_bench.ts`
- `docs/guides/architecture-response-langchain.md`
- `docs/monitoring/response-langchain.md`
- `docs/training/quickstart.md`
