/// <reference types="vitest" />
import { describe, it, expect, vi } from 'vitest';

describe('pricing: estimateCostUSD + fallbacks', () => {
  const importFresh = async () => {
    // Ensure a clean environment for each fresh import to avoid order-dependent behavior.
    // Preserve a caller-provided fallback mode (if any) across the cleanup so tests can
    // intentionally control behavior by stubbing before calling importFresh().
    const desiredMode = process.env.OPENAI_PRICING_FALLBACK_MODE;
    vi.unstubAllEnvs();
    if (desiredMode !== undefined) vi.stubEnv('OPENAI_PRICING_FALLBACK_MODE', desiredMode);
    vi.resetModules();
    const mod = await import('../../openai/pricing.js');
    return mod as typeof import('../../openai/pricing.js');
  };

  it('prefix-matches model names (gpt-4o-mini-2025 → gpt-4o-mini)', async () => {
    const { estimateCostUSD } = await importFresh();
    const cost = estimateCostUSD({ model: 'gpt-4o-mini-2025', promptTokens: 1000, completionTokens: 1000 });
    // gpt-4o-mini pricing: 0.0006 + 0.0024 = 0.003 per 1K+1K
    expect(cost).toBeCloseTo(0.003, 6);
  });

  it('falls back to mini pricing by default for unknown models', async () => {
    const { estimateCostUSD } = await importFresh();
    const cost = estimateCostUSD({ model: 'unknown-model', promptTokens: 1000, completionTokens: 1000 });
    expect(cost).toBeGreaterThan(0); // uses mini pricing by default
  });

  it('conservative fallback uses gpt-4o pricing when OPENAI_PRICING_FALLBACK_MODE=conservative', async () => {
    vi.stubEnv('OPENAI_PRICING_FALLBACK_MODE', 'conservative');
    const { estimateCostUSD } = await importFresh();
    const cost = estimateCostUSD({ model: 'unknown-model', promptTokens: 1000, completionTokens: 1000 });
    // gpt-4o: 0.005 + 0.015 = 0.02
    expect(cost).toBeCloseTo(0.02, 6);
  });

  it('error fallback throws for unknown models when OPENAI_PRICING_FALLBACK_MODE=error', async () => {
    vi.stubEnv('OPENAI_PRICING_FALLBACK_MODE', 'error');
    const { estimateCostUSD } = await importFresh();
    expect(() => estimateCostUSD({ model: 'nope', promptTokens: 1, completionTokens: 1 })).toThrow(
      /Unknown OpenAI model/
    );
  });

  it('validates finite, non-negative token counts', async () => {
    vi.unstubAllEnvs();
    const { estimateCostUSD } = await importFresh();
    expect(() => estimateCostUSD({ model: 'gpt-4o-mini', promptTokens: -1, completionTokens: 0 })).toThrow();
    expect(() => estimateCostUSD({ model: 'gpt-4o-mini', promptTokens: Infinity, completionTokens: 0 })).toThrow();
  });
});
