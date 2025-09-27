import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseCorrectionInput,
  ChatCorrectionInputSchema,
  type ProcessedCorrection,
  LIMITS,
  CorrectionInputError,
} from '../../src/analysis/correction/parser.js';

describe('parseCorrectionInput', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const base = {
    threadContext: {
      originalQuestion: 'How do I reset my partner dashboard password?  ',
      botResponse: 'You can reset passwords in Account Settings under Security.\n',
      timestamp: '2024-07-15T10:30:00Z',
      userId: 'user123',
      channelId: 'channel456',
    },
    correctionFields: {
      wrong: ' Account Settings → Security\n',
      right: ' Partner Center → Profile page ',
      reason: ' UI changed in 2024.07\r\n',
    },
  } as const;

  it('parses valid chat input and returns standardized object with sanitization', () => {
    const processed = parseCorrectionInput(base) as ProcessedCorrection;
    expect(processed.originalQuestion).toBe('How do I reset my partner dashboard password?');
    expect(processed.botResponse).toBe('You can reset passwords in Account Settings under Security.');
    expect(processed.incorrectAnswer).toBe('Account Settings → Security');
    expect(processed.correctAnswer).toBe('Partner Center → Profile page');
    expect(processed.correctionReason).toBe('UI changed in 2024.07');
    expect(processed.metadata.timestamp).toBe('2024-07-15T10:30:00Z');
    expect(processed.metadata.userId).toBe('user123');
    expect(processed.metadata.channelId).toBe('channel456');
    // Ensure no control characters remain
    const all = Object.values(processed).flatMap((v) =>
      typeof v === 'string' ? [v] : typeof v === 'object' && v ? Object.values(v) : []
    ) as string[];
    for (const s of all) {
      expect(/[\u0000-\u001F\u007F\u0085\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060]/.test(s)).toBe(false);
    }
  });

  it('rejects empty correction fields', () => {
    const bad = {
      ...base,
      correctionFields: { wrong: '', right: 'x', reason: 'y' },
    } as any;

    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => parseCorrectionInput(bad)).toThrow(CorrectionInputError);
    const calls = spy.mock.calls.map((args) => args.map((a) => String(a)));
    const joined = calls.flat().join(' ');
    expect(joined).toMatch(/Invalid correction input/);
    spy.mockRestore();
  });

  it('rejects invalid timestamp', () => {
    const bad = { ...base, threadContext: { ...base.threadContext, timestamp: '2024/07/15 10:30:00' } } as any;
    expect(() => parseCorrectionInput(bad)).toThrow(CorrectionInputError);
  });

  it('enforces length limits', () => {
    const long = 'a'.repeat(LIMITS.correctionField + 1);
    const bad = { ...base, correctionFields: { wrong: long, right: 'x', reason: 'y' } } as any;
    expect(() => parseCorrectionInput(bad)).toThrow(CorrectionInputError);
  });
});

describe('ChatCorrectionInputSchema type shape', () => {
  it('validates shape with zod (smoke)', () => {
    const parsed = ChatCorrectionInputSchema.parse({
      threadContext: {
        originalQuestion: 'Q',
        botResponse: 'A',
        timestamp: '2024-01-01T00:00:00Z',
      },
      correctionFields: { wrong: 'w', right: 'r', reason: 'b' },
    });
    expect(parsed.threadContext.originalQuestion).toBe('Q');
  });
});
