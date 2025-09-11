export type TokenPricing = {
  inputPer1K: number; // USD per 1K input tokens
  outputPer1K: number; // USD per 1K output tokens
};

// Pricing snapshot. Update as OpenAI models/pricing change.
// Model names are aligned with the current reference list:
// Source (models): https://platform.openai.com/docs/models
// Source (pricing): https://openai.com/api/pricing
// NOTE: Values are manually transcribed (USD) and expressed per 1K tokens; they may drift and should be refreshed periodically.
export const MODEL_PRICING: Record<string, TokenPricing> = {
  // Chat-capable, general models
  // gpt-4o: $5 / 1M input, $15 / 1M output
  'gpt-4o': { inputPer1K: 0.005, outputPer1K: 0.015 },
  // gpt-4o-mini: $0.60 / 1M input, $2.40 / 1M output
  'gpt-4o-mini': { inputPer1K: 0.0006, outputPer1K: 0.0024 },

  // GPT-4.1 family (per https://openai.com/index/gpt-4-1/)
  // gpt-4.1: $2 / 1M input, $8 / 1M output
  'gpt-4.1': { inputPer1K: 0.002, outputPer1K: 0.008 },
  // gpt-4.1-mini: $0.40 / 1M input, $1.60 / 1M output
  'gpt-4.1-mini': { inputPer1K: 0.0004, outputPer1K: 0.0016 },
  // gpt-4.1-nano: $0.10 / 1M input, $0.40 / 1M output
  'gpt-4.1-nano': { inputPer1K: 0.0001, outputPer1K: 0.0004 },
};

type FallbackMode = 'mini' | 'conservative' | 'error';
const FALLBACK_MODE: FallbackMode = (
  // Guard for non-Node environments
  typeof process !== 'undefined' && (process.env?.OPENAI_PRICING_FALLBACK_MODE as string)
    ? (process.env!.OPENAI_PRICING_FALLBACK_MODE as string)
    : 'mini'
).toLowerCase() as FallbackMode;

// Precompute keys once and keep longest-first to ensure the most specific
// prefix match wins (e.g., 'gpt-4.1-mini' before 'gpt-4.1').
const PRICING_KEYS_BY_LENGTH = Object.keys(MODEL_PRICING).sort((a, b) => b.length - a.length);

function resolvePricing(model: string): TokenPricing {
  // Exact match
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];

  // Longest prefix match
  for (const key of PRICING_KEYS_BY_LENGTH) {
    if (model.startsWith(key)) return MODEL_PRICING[key];
  }

  // Fallbacks (see note in estimateCostUSD)
  if (FALLBACK_MODE === 'conservative') return MODEL_PRICING['gpt-4o'];
  if (FALLBACK_MODE === 'error') throw new Error(`Unknown OpenAI model for pricing: ${model}`);
  return MODEL_PRICING['gpt-4o-mini'];
}

export function estimateCostUSD(args: {
  model: string;
  promptTokens: number;
  completionTokens: number;
}): number {
  const { model, promptTokens, completionTokens } = args;
  const pricing = resolvePricing(model);

  if (!Number.isFinite(promptTokens) || !Number.isFinite(completionTokens)) {
    throw new Error('Token counts must be finite numbers');
  }
  if (promptTokens < 0 || completionTokens < 0) {
    throw new Error('Token counts must be >= 0');
  }

  const cost = (promptTokens / 1000) * pricing.inputPer1K + (completionTokens / 1000) * pricing.outputPer1K;
  return Number(cost.toFixed(6));
}
