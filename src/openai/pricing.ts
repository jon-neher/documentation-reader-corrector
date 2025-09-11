export type TokenPricing = {
  inputPer1K: number; // USD per 1K input tokens
  outputPer1K: number; // USD per 1K output tokens
};

// Pricing snapshot. Update as OpenAI pricing changes.
// Source: https://openai.com/api/pricing (manually transcribed; may need updates)
export const MODEL_PRICING: Record<string, TokenPricing> = {
  // 2025-era models (approx; adjust as needed)
  'gpt-4o': { inputPer1K: 0.005, outputPer1K: 0.015 },
  'gpt-4o-mini': { inputPer1K: 0.0005, outputPer1K: 0.0015 },
  'gpt-4.1': { inputPer1K: 0.01, outputPer1K: 0.03 },
  'gpt-4.1-mini': { inputPer1K: 0.0005, outputPer1K: 0.0015 },
  'gpt-4-turbo': { inputPer1K: 0.01, outputPer1K: 0.03 },
  'gpt-3.5-turbo': { inputPer1K: 0.0005, outputPer1K: 0.0015 },
};

export function estimateCostUSD(args: {
  model: string;
  promptTokens: number;
  completionTokens: number;
}): number {
  const { model, promptTokens, completionTokens } = args;
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['gpt-4o-mini'];
  const cost =
    (promptTokens / 1000) * pricing.inputPer1K +
    (completionTokens / 1000) * pricing.outputPer1K;
  return Number(cost.toFixed(6));
}
