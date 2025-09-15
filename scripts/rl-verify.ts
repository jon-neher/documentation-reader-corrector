import { OpenAIRateLimiter } from '../src/openai/OpenAIRateLimiter.js';
import { estimateCostUSD } from '../src/openai/pricing.js';

// Ensure SDK constructor doesn't throw before we inject our fake client.
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test';

function makeFakeClient({ model = 'gpt-4o-mini', promptTokens = 100, completionTokens = 50, content = 'ok' } = {}) {
  return {
    async chat(_prompt: any, _opts: any) {
      return {
        id: 'r_fake',
        model,
        created: Math.floor(Date.now() / 1000),
        content,
        usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
        raw: { usage: { input_tokens: promptTokens, output_tokens: completionTokens, total_tokens: promptTokens + completionTokens } },
      };
    },
  };
}

async function testPricingAndBudget() {
  const limiter = new OpenAIRateLimiter(0, 0.00015); // No RPM limit; super small budget
  // @ts-ignore override private for test
  limiter.client = makeFakeClient({ model: 'gpt-4o-mini', promptTokens: 100, completionTokens: 50 });
  const expectedCost = estimateCostUSD({ model: 'gpt-4o-mini', promptTokens: 100, completionTokens: 50 });
  const r1 = await limiter.makeRequest('hi', { model: 'gpt-4o-mini' });
  const spendAfter = (limiter as any).monthlySpend as number;
  let budgetBlocked = false;
  try {
    await limiter.makeRequest('again', { model: 'gpt-4o-mini' });
  } catch (e: any) {
    budgetBlocked = e?.code === 'BUDGET_EXCEEDED';
  }
  return { expectedCost, recordedSpend: spendAfter, budgetBlocked, firstContent: r1.content };
}

async function testRateLimitBurstShortWait() {
  const limiter = new OpenAIRateLimiter(2, 1000); // 2 rpm (1 every 30s)
  // @ts-ignore override private for test
  limiter.client = makeFakeClient();
  // Preload timestamps to force a small wait (~200ms) for the next token
  const now = Date.now();
  // @ts-ignore override private for test
  limiter.lastMinuteTimestamps = [now - 59_800, now - 59_800]; // two tokens just within the minute
  const t0 = Date.now();
  await limiter.waitForRateLimit();
  const waitedMs = Date.now() - t0;
  return { waitedMs };
}

async function testSustainedLoadN(n = 8) {
  const limiter = new OpenAIRateLimiter(10, 1000); // 10 rpm
  // @ts-ignore override private for test
  limiter.client = makeFakeClient();
  // Preload 10 tokens so that most of the burst must wait a bit (near expiry)
  const now = Date.now();
  // @ts-ignore
  limiter.lastMinuteTimestamps = Array.from({ length: 10 }, () => now - 59_800);
  const t0 = Date.now();
  const tasks = Array.from({ length: n }, () => limiter.makeRequest('x', { model: 'gpt-4o-mini', maxRetries: 1 }));
  await Promise.all(tasks);
  const elapsedMs = Date.now() - t0;
  // With ~200ms remaining until the window slides, total should be ~200ms for the first 10, then ~400ms for stragglers if any.
  return { n, elapsedMs };
}

(async () => {
  const p = await testPricingAndBudget();
  const r = await testRateLimitBurstShortWait();
  const s = await testSustainedLoadN(5);
  console.log(JSON.stringify({ pricingAndBudget: p, shortWait: r, sustained: s }, null, 2));
})();
