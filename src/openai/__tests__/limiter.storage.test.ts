/// <reference types="vitest" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { OpenAIRateLimiter } from '../../openai/OpenAIRateLimiter.js';

function monthKey(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

describe('OpenAIRateLimiter persistence + recordUsage', () => {
  const tmpDir = path.join(process.cwd(), '.tmp-test-budget');
  const budgetFile = path.join(tmpDir, 'budget.json');

  beforeEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  it('persists monthly spend to file when OPENAI_BUDGET_PERSIST=file', () => {
    vi.stubEnv('OPENAI_BUDGET_PERSIST', 'file');
    vi.stubEnv('OPENAI_BUDGET_FILE', budgetFile);
    // Avoid touching the real SDK in constructor
    vi.mock('../../openai/client.js', () => ({ OpenAIClient: class {} }));

    const limiter: any = new OpenAIRateLimiter(0, 1000);
    // First record
    limiter.recordUsage('gpt-4o-mini', 1000, 1000); // ~$0.003
    const data1 = JSON.parse(fs.readFileSync(budgetFile, 'utf8'));
    expect(data1[monthKey()]).toBeGreaterThan(0);

    // Second record accumulates
    limiter.recordUsage('gpt-4o-mini', 1000, 1000);
    const data2 = JSON.parse(fs.readFileSync(budgetFile, 'utf8'));
    expect(data2[monthKey()]).toBeGreaterThan(data1[monthKey()]);
  });

  it('logs warn when pricing throws inside recordUsage', async () => {
    const limiter: any = new OpenAIRateLimiter(0, 1000);
    // Force estimateCostUSD to throw
    const mod = await import('../pricing.js');
    vi.spyOn(mod, 'estimateCostUSD').mockImplementation(() => {
      throw new Error('boom');
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    limiter.recordUsage('gpt-4o-mini', 1, 1);
    expect(warnSpy).toHaveBeenCalled();
  });
});
