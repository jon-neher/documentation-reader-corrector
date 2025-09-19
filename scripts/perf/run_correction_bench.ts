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

  Optionally set OPENAI_API_KEY + REAL=1 to run a small sample with a real model; see docs.
*/
import { RunnableLambda } from '@langchain/core/runnables';
import { AIMessage } from '@langchain/core/messages';
import { createCorrectionAnalysisChain } from '../../src/analysis/correction/chain.js';
import { OpenAIRateLimiter } from '../../src/openai/OpenAIRateLimiter.js';

type Stats = {
  runs: number;
  concurrency: number;
  simMs: number;
  latencies: number[];
  p50: number;
  p95: number;
  p99: number;
  avgMs: number;
  throughputRps: number;
  heapUsedDeltaMB: number;
  rssDeltaMB: number;
};

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

function makeFakeModel(simMs = 25) {
  return RunnableLambda.from(async () => {
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
    }) as any;
  });
}

async function runBench(): Promise<Stats> {
  const runs = Number(process.env.RUNS || 200);
  const concurrency = Number(process.env.CONCURRENCY || 20);
  const simMs = Number(process.env.SIM_MS || 25);
  process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'warn';
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test';

  const limiter = new OpenAIRateLimiter(0, 1_000_000);
  const useReal = process.env.REAL === '1';
  const chain = useReal
    ? createCorrectionAnalysisChain({ limiter })
    : createCorrectionAnalysisChain({ modelRunnable: makeFakeModel(simMs), limiter });

  const latencies: number[] = [];
  const startTime = Date.now();
  const memBefore = process.memoryUsage();

  let inFlight = 0;
  let launched = 0;
  let completed = 0;

  const next = async () => {
    if (launched >= runs) return;
    inFlight++;
    const idx = launched++;
    const t0 = performance.now();
    try {
      await chain.invoke({
        originalQuestion: 'Q',
        botResponse: 'A',
        wrong: null,
        right: null,
        reason: null,
      });
    } finally {
      const t1 = performance.now();
      latencies[idx] = t1 - t0;
      completed++;
      inFlight--;
      if (launched < runs) void next();
    }
  };

  // Prime the pump with up to `concurrency` tasks
  const starters = Math.min(concurrency, runs);
  for (let i = 0; i < starters; i++) void next();

  // Wait for completion
  while (completed < runs) {
    await new Promise((r) => setTimeout(r, 5));
  }

  const totalMs = Date.now() - startTime;
  const memAfter = process.memoryUsage();

  const sorted = [...latencies].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const p99 = percentile(sorted, 99);
  const avgMs = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  const throughputRps = (runs / totalMs) * 1000;
  const heapUsedDeltaMB = (memAfter.heapUsed - memBefore.heapUsed) / (1024 * 1024);
  const rssDeltaMB = (memAfter.rss - memBefore.rss) / (1024 * 1024);

  return { runs, concurrency, simMs, latencies, p50, p95, p99, avgMs, throughputRps, heapUsedDeltaMB, rssDeltaMB };
}

runBench().then((stats) => {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ bench: 'correction-analysis', ts: new Date().toISOString(), ...stats }, null, 2));
});
