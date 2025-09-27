#!/usr/bin/env node
/*
  Correction Analysis Bench Harness

  - Runs the correction analysis chain with a fake model (default) to measure overhead of:
    LangChain pipeline + rate limit adapter + observability bridge + StructuredOutputParser.
  - Produces a JSON summary with latency percentiles, throughput, and memory deltas.

  Env vars:
    RUNS=200           Total number of requests (default 200)
    CONCURRENCY=20     Concurrent in-flight requests (default 20)
    SIM_MS=25          Simulated provider latency inside fake model (default 25ms)
    LOG_LEVEL=warn     Keep logs quiet during benchmark (default warn)
    RAW_LATENCIES=1    Include raw per-request latencies array in JSON output (default: omitted)
    PRETTY_JSON=1      Pretty-print JSON output (default: compact)

  Optionally set OPENAI_API_KEY + REAL=1 to run a small sample with a real model; see docs.
*/
import { RunnableLambda } from '@langchain/core/runnables';
import { AIMessage } from '@langchain/core/messages';
import { createCorrectionAnalysisChain } from '../../src/analysis/correction/chain.js';
import { OpenAIRateLimiter } from '../../src/openai/OpenAIRateLimiter.js';

const SCHEMA_VERSION = 1 as const;

type StatsBase = {
  schemaVersion: number;
  runs: number;
  concurrency: number;
  // When REAL=1, simulated delay doesn't apply. Emit `simMs: null` and `real: true` for clarity.
  simMs: number | null;
  real: boolean;
  errors: number;
  successes: number;
  p50: number;
  p95: number;
  p99: number;
  avgMs: number;
  throughputRps: number;
  heapUsedDeltaMB: number;
  rssDeltaMB: number;
};
type StatsWithLatencies = StatsBase & { latencies: number[] };
type Stats = StatsBase | StatsWithLatencies;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

function makeFakeModel(simMs = 25) {
  return RunnableLambda.from<unknown, AIMessage>(async () => {
    if (simMs > 0) await new Promise((r) => setTimeout(r, simMs));
    const payload = {
      classification: 'other',
      confidence: 0.5,
      rationale: 'n/a',
      fields: { wrong: null, right: null, reason: null },
    };
    return new AIMessage({
      content: JSON.stringify(payload),
      usage_metadata: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    });
  });
}

async function runBench(): Promise<Stats> {
  // Normalize env inputs: ensure non-negative runs and at least 1 concurrency to avoid hangs
  const rawRuns = Number(process.env.RUNS ?? 200);
  const runs = Number.isFinite(rawRuns) ? Math.max(0, Math.trunc(rawRuns)) : 200;
  const rawConcurrency = Number(process.env.CONCURRENCY ?? 20);
  const concurrency = Math.max(1, Number.isFinite(rawConcurrency) ? Math.trunc(rawConcurrency) : 20);
  const rawSim = Number(process.env.SIM_MS ?? 25);
  const simMs = Math.max(0, Number.isFinite(rawSim) ? Math.trunc(rawSim) : 25);
  process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'warn';
  // Guard REAL mode: require a non-stub API key; otherwise fall back to fake model.
  const requestedReal = process.env.REAL === '1';
  const existingKey = process.env.OPENAI_API_KEY;
  const hasValidKey = !!existingKey && existingKey !== 'sk-test';
  const effectiveReal = requestedReal && hasValidKey;
  if (!effectiveReal) {
    // For any simulated run (including REAL fallback), ensure a stub key to avoid SDK init errors.
    process.env.OPENAI_API_KEY = existingKey || 'sk-test';
  }
  if (requestedReal && !effectiveReal) {
    // eslint-disable-next-line no-console
    console.error('REAL=1 requires a valid OPENAI_API_KEY; falling back to fake model');
  }

  const limiter = new OpenAIRateLimiter(0, 1_000_000);
  const chain = effectiveReal
    ? createCorrectionAnalysisChain({ limiter })
    : createCorrectionAnalysisChain({ modelRunnable: makeFakeModel(simMs), limiter });

  // Latencies for successful invokes only
  const latencies: number[] = [];
  // Use a single monotonic clock source for timing to avoid cross-clock drift
  const tStart = performance.now();
  const memBefore = process.memoryUsage();

  let launched = 0;
  let completed = 0;
  let errors = 0;

  // Promise-based completion: resolve when all runs complete
  let resolveDone: (() => void) | null = null;
  const done = new Promise<void>((r) => {
    resolveDone = r;
  });

  const next = async () => {
    if (launched >= runs) return;
    launched++;
    const t0 = performance.now();
    let ok = true;
    try {
      await chain.invoke({
        originalQuestion: 'Q',
        botResponse: 'A',
        wrong: null,
        right: null,
        reason: null,
      });
    } catch {
      // Count and swallow errors to avoid unhandled promise rejections in fire-and-forget tasks
      errors++;
      ok = false;
    } finally {
      const t1 = performance.now();
      if (ok) latencies.push(t1 - t0);
      completed++;
      if (completed === runs && resolveDone) resolveDone();
      if (launched < runs) void next();
    }
  };

  // Prime the pump with up to `concurrency` tasks
  const starters = Math.min(concurrency, runs);
  for (let i = 0; i < starters; i++) void next();

  // If there are zero runs, resolve immediately; otherwise await completion without polling
  if (runs === 0 && resolveDone) resolveDone();
  await done;

  const totalMs = performance.now() - tStart;
  const memAfter = process.memoryUsage();

  const successes = latencies.length;
  const sorted = [...latencies].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const p99 = percentile(sorted, 99);
  const avgMs = successes > 0 ? sorted.reduce((a, b) => a + b, 0) / successes : 0;
  // Throughput: base on successful invokes to avoid overstating when errors occur
  const throughputRps = totalMs > 0 ? (successes / totalMs) * 1000 : 0;
  const heapUsedDeltaMB = (memAfter.heapUsed - memBefore.heapUsed) / (1024 * 1024);
  const rssDeltaMB = (memAfter.rss - memBefore.rss) / (1024 * 1024);
  const includeLatencies = process.env.RAW_LATENCIES === '1';
  const base: StatsBase = {
    schemaVersion: SCHEMA_VERSION,
    runs,
    concurrency,
    simMs: effectiveReal ? null : simMs,
    real: effectiveReal,
    errors,
    successes,
    p50,
    p95,
    p99,
    avgMs,
    throughputRps,
    heapUsedDeltaMB,
    rssDeltaMB,
  };
  return includeLatencies ? { ...base, latencies } : base;
}

runBench().then((stats) => {
  // eslint-disable-next-line no-console
  const pretty = process.env.PRETTY_JSON === '1' ? 2 : 0;
  console.log(JSON.stringify({ bench: 'correction-analysis', ts: new Date().toISOString(), ...stats }, null, pretty));
});
