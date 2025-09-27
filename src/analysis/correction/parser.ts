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

const MessageSchema = z
  .object({
    role: z
      .string()
      .transform(sanitizeText)
      .pipe(z.string().max(50))
      .optional(),
    text: z
      .string()
      .transform(sanitizeText)
      .optional(),
  })
  // Accept and ignore any extra keys from Google Chat
  .passthrough();

export const ThreadContextSchema = z
  .object({
    // Scalars are now optional; we may derive from messages[] or fall back
    originalQuestion: z
      .string()
      .transform(sanitizeText)
      .pipe(
        z
          .string()
          .min(1, 'originalQuestion is required when provided'),
      )
      .optional(),
    botResponse: z
      .string()
      .transform(sanitizeText)
      .pipe(
        z
          .string()
          .min(1, 'botResponse is required when provided'),
      )
      .optional(),
    timestamp: z
      .string()
      .transform(sanitizeText)
      .pipe(
        z
          .string()
          .refine(
            (v) => isValidIsoTimestamp(v),
            'timestamp must be a valid ISO 8601 string (e.g., 2024-07-15T10:30:00Z)',
          ),
      )
      .optional(),
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
    messages: z.array(MessageSchema).min(1).optional(),
  })
  // Ignore unknown threadContext keys safely
  .passthrough();

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
  // Entire threadContext is now optional; we can still accept a minimal payload
  threadContext: ThreadContextSchema.optional(),
  correctionFields: CorrectionFieldsSchema,
});

export type ChatCorrectionInput = z.infer<typeof ChatCorrectionInputSchema>;

/** Standardized internal format used by our processing pipeline. */
export const ProcessedCorrectionSchema = z.object({
  originalQuestion: z.string().max(LIMITS.originalQuestion),
  botResponse: z.string().max(LIMITS.botResponse),
  incorrectAnswer: z.string(),
  correctAnswer: z.string(),
  correctionReason: z.string(),
  metadata: z.object({
    timestamp: z.string(),
    userId: z.string().optional(),
    channelId: z.string().optional(),
    derived: z
      .object({
        originalQuestion: z.enum(['fromMessages', 'missing']).optional(),
        botResponse: z
          .enum(['fromMessages', 'fallbackFromWrong', 'missing'])
          .optional(),
        timestamp: z.enum(['generated']).optional(),
      })
      .optional(),
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
type DerivedMeta = {
  originalQuestion?: 'fromMessages' | 'missing';
  botResponse?: 'fromMessages' | 'fallbackFromWrong' | 'missing';
  timestamp?: 'generated';
};

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
  const tc = threadContext ?? {};

  // 1) Start from provided scalars if present
  let originalQuestion = tc.originalQuestion?.trim();
  let botResponse = tc.botResponse?.trim();
  const derived: DerivedMeta = {};

  // 2) Derive from messages[] when scalars are missing
  const messages = tc.messages ?? [];
  if (!originalQuestion && messages.length > 0) {
    const firstUserLike = messages.find((m) =>
      /^(user|human)$/i.test((m.role ?? '').toString()),
    );
    const first = firstUserLike ?? messages[0];
    const text = sanitizeText(
      (first as any)?.text ?? (first as any)?.content ?? '',
    );
    if (text) {
      originalQuestion = text;
      derived.originalQuestion = 'fromMessages';
    }
  }
  if (!originalQuestion) {
    originalQuestion = 'Unknown';
    derived.originalQuestion = 'missing';
  }

  if (!botResponse && messages.length > 0) {
    let lastAssistantLike: typeof messages[number] | undefined;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (/^(assistant|ai|bot)$/i.test((m.role ?? '').toString())) {
        lastAssistantLike = m;
        break;
      }
    }
    const last = lastAssistantLike ?? messages[messages.length - 1];
    const text = sanitizeText(
      (last as any)?.text ?? (last as any)?.content ?? '',
    );
    if (text) {
      botResponse = text;
      derived.botResponse = 'fromMessages';
    }
  }
  // 3) Fallback to the snippet under review when still missing
  if (!botResponse) {
    botResponse = correctionFields.wrong;
    derived.botResponse = 'fallbackFromWrong';
  }

  // 4) Timestamp: prefer provided; otherwise generate now (ISO) so downstream always has one
  let timestamp = tc.timestamp;
  if (!timestamp) {
    timestamp = new Date().toISOString();
    derived.timestamp = 'generated';
  }

  // Enforce hard caps post-derivation (truncate)
  originalQuestion = originalQuestion.slice(0, LIMITS.originalQuestion);
  botResponse = botResponse.slice(0, LIMITS.botResponse);

  const result: ProcessedCorrection = {
    originalQuestion,
    botResponse,
    incorrectAnswer: correctionFields.wrong,
    correctAnswer: correctionFields.right,
    correctionReason: correctionFields.reason,
    metadata: {
      timestamp,
      userId: tc.userId,
      channelId: tc.channelId,
      derived: Object.keys(derived).length ? derived : undefined,
    },
  };
  // Type guard via schema
  return ProcessedCorrectionSchema.parse(result);
}
