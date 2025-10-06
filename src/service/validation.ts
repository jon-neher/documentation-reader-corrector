import { z } from 'zod';
import type { CorrectionAnalysisInput } from '../analysis/correction/types.js';

// Primary accepted input shape from Haley's integration
export const CorrectionRequestSchema = z
  .object({
    originalQuestion: z.string().min(1).max(10_000),
    botResponse: z.string().min(1).max(10_000),
    wrong: z.string().max(10_000).optional().nullable(),
    right: z.string().max(10_000).optional().nullable(),
    reason: z.string().max(10_000).optional().nullable(),
  })
  .strict();

export type CorrectionRequest = z.infer<typeof CorrectionRequestSchema>;

/**
* Best‑effort normalization that accepts a couple of likely shapes and maps
* them into the CorrectionAnalysisInput expected by our analysis pipeline.
*
* Supported bodies:
* 1) Flat shape (preferred):
*    { originalQuestion, botResponse, wrong?, right?, reason? }
* 2) Nested correction block:
*    { originalQuestion, botResponse, correction: { wrong?, right?, reason? } }
*/
export function normalizeToAnalysisInput(body: unknown): CorrectionAnalysisInput | { error: string; details?: unknown } {
  // Fast path: flat, validated shape
  const parsed = CorrectionRequestSchema.safeParse(body);
  if (parsed.success) return toAnalysisInput(parsed.data);

  // Fallback: nested shape with `correction` block
  try {
    const any = body as any;
    if (any && typeof any === 'object') {
      const originalQuestion = typeof any.originalQuestion === 'string' ? any.originalQuestion : undefined;
      const botResponse = typeof any.botResponse === 'string' ? any.botResponse : undefined;
      const correction = any.correction && typeof any.correction === 'object' ? any.correction : undefined;
      const wrong = typeof correction?.wrong === 'string' ? correction.wrong : undefined;
      const right = typeof correction?.right === 'string' ? correction.right : undefined;
      const reason = typeof correction?.reason === 'string' ? correction.reason : undefined;
      if (originalQuestion && botResponse) {
        return toAnalysisInput({ originalQuestion, botResponse, wrong, right, reason });
      }
    }
  } catch {}

  return { error: 'Invalid input format', details: parsed.error?.format?.() ?? undefined };
}

function toAnalysisInput(req: CorrectionRequest): CorrectionAnalysisInput {
  return sanitize({
    originalQuestion: req.originalQuestion,
    botResponse: req.botResponse,
    wrong: orNull(req.wrong),
    right: orNull(req.right),
    reason: orNull(req.reason),
  });
}

function orNull<T>(v: T | undefined | null): T | null {
  return v == null ? null : (v as T);
}

// Basic string sanitization: trim, drop most control chars (keep \n and \t), and clamp length.
function clean(s: string): string {
  const trimmed = s.trim();
  const noCtrl = trimmed.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '');
  // Hard cap at 10k again post-trim to guard against pathological inputs
  return noCtrl.length > 10_000 ? noCtrl.slice(0, 10_000) : noCtrl;
}

function sanitize(input: CorrectionAnalysisInput): CorrectionAnalysisInput {
  return {
    originalQuestion: clean(input.originalQuestion),
    botResponse: clean(input.botResponse),
    wrong: input.wrong == null ? null : clean(String(input.wrong)),
    right: input.right == null ? null : clean(String(input.right)),
    reason: input.reason == null ? null : clean(String(input.reason)),
  };
}
