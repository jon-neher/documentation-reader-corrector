import { z } from 'zod';
import { logger } from '../../openai/logger.js';

/** Length limits to prevent abuse */
export const LIMITS = Object.freeze({
  originalQuestion: 2000,
  botResponse: 4000,
  correctionField: 1000, // wrong/right/reason
  userId: 200,
  channelId: 200,
});

// Control chars, bidi/zero‑width, and line separators often used for injection/log forging
const CONTROL_OR_HIDDEN = /[\u0000-\u001F\u007F\u0085\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060]/g; // eslint-disable-line no-control-regex

/**
* Sanitize untrusted user strings for internal processing and logging.
* - Normalize to NFC
* - Remove control/hidden unicode (incl. CR/LF, ZW chars, bidi controls)
* - Collapse all whitespace runs to a single space
* - Trim ends
*/
export function sanitizeText(input: unknown): string {
  const s = String(input ?? '');
  return s
    .normalize('NFC')
    .replace(CONTROL_OR_HIDDEN, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isValidIsoTimestamp(ts: string): boolean {
  // Accept RFC 3339/ISO8601 basic variant with Z; allow fractional seconds
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
  if (!iso.test(ts)) return false;
  const d = new Date(ts);
  return !Number.isNaN(d.getTime());
}

export const ThreadContextSchema = z.object({
  originalQuestion: z
    .string()
    .transform(sanitizeText)
    .pipe(z.string().min(1, 'originalQuestion is required').max(LIMITS.originalQuestion, `originalQuestion exceeds ${LIMITS.originalQuestion} chars`)),
  botResponse: z
    .string()
    .transform(sanitizeText)
    .pipe(z.string().min(1, 'botResponse is required').max(LIMITS.botResponse, `botResponse exceeds ${LIMITS.botResponse} chars`)),
  timestamp: z
    .string()
    .transform(sanitizeText)
    .pipe(z.string().refine(isValidIsoTimestamp, 'timestamp must be a valid ISO 8601 string (e.g., 2024-07-15T10:30:00Z)')),
  userId: z
    .string()
    .transform(sanitizeText)
    .pipe(z.string().min(1).max(LIMITS.userId))
    .optional(),
  channelId: z
    .string()
    .transform(sanitizeText)
    .pipe(z.string().min(1).max(LIMITS.channelId))
    .optional(),
});

export const CorrectionFieldsSchema = z.object({
  wrong: z
    .string()
    .transform(sanitizeText)
    .pipe(z.string().min(1, 'wrong is required').max(LIMITS.correctionField, `wrong exceeds ${LIMITS.correctionField} chars`)),
  right: z
    .string()
    .transform(sanitizeText)
    .pipe(z.string().min(1, 'right is required').max(LIMITS.correctionField, `right exceeds ${LIMITS.correctionField} chars`)),
  reason: z
    .string()
    .transform(sanitizeText)
    .pipe(z.string().min(1, 'reason is required').max(LIMITS.correctionField, `reason exceeds ${LIMITS.correctionField} chars`)),
});

/** Raw payload expected from Google Chat via Haley's integration. */
export const ChatCorrectionInputSchema = z.object({
  threadContext: ThreadContextSchema,
  correctionFields: CorrectionFieldsSchema,
});

export type ChatCorrectionInput = z.infer<typeof ChatCorrectionInputSchema>;

/** Standardized internal format used by our processing pipeline. */
export const ProcessedCorrectionSchema = z.object({
  originalQuestion: z.string(),
  botResponse: z.string(),
  incorrectAnswer: z.string(),
  correctAnswer: z.string(),
  correctionReason: z.string(),
  metadata: z.object({
    timestamp: z.string(),
    userId: z.string().optional(),
    channelId: z.string().optional(),
  }),
});

export type ProcessedCorrection = z.infer<typeof ProcessedCorrectionSchema>;

export class CorrectionInputError extends Error {
  public issues: Array<{ path: string; message: string; code?: string }>;
  constructor(message: string, issues: Array<{ path: string; message: string; code?: string }> = []) {
    super(message);
    this.name = 'CorrectionInputError';
    this.issues = issues;
  }
}

/**
* Validate and transform Google Chat correction payload into our standardized format.
* Throws CorrectionInputError on invalid input and logs a warning line.
*/
export function parseCorrectionInput(raw: unknown): ProcessedCorrection {
  const parsed = ChatCorrectionInputSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
      code: (i as any).code,
    }));
    // Best-effort metadata extraction for logging (sanitized)
    const userId = sanitizeText((raw as any)?.threadContext?.userId ?? '');
    const channelId = sanitizeText((raw as any)?.threadContext?.channelId ?? '');
    logger.warn('Invalid correction input', {
      reason: 'zod_validation_failed',
      issues,
      userId: userId || undefined,
      channelId: channelId || undefined,
    });
    throw new CorrectionInputError('Invalid correction input', issues);
  }

  const { threadContext, correctionFields } = parsed.data;
  const result: ProcessedCorrection = {
    originalQuestion: threadContext.originalQuestion,
    botResponse: threadContext.botResponse,
    incorrectAnswer: correctionFields.wrong,
    correctAnswer: correctionFields.right,
    correctionReason: correctionFields.reason,
    metadata: {
      timestamp: threadContext.timestamp,
      userId: threadContext.userId,
      channelId: threadContext.channelId,
    },
  };
  // Type guard via schema
  return ProcessedCorrectionSchema.parse(result);
}
