import { z } from 'zod';

// Classification labels for correction analysis. Keep names stable for analytics.
export const CorrectionClassificationEnum = z.enum([
  'wrong_reference',
  'outdated_ui',
  'incorrect_procedure',
  'missing_context',
  'other',
]);

export const CorrectionAnalysisSchema = z.object({
  classification: CorrectionClassificationEnum,
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1),
  fields: z.object({
    wrong: z.string().optional().nullable(),
    right: z.string().optional().nullable(),
    reason: z.string().optional().nullable(),
  }),
});

export type CorrectionClassification = z.infer<typeof CorrectionClassificationEnum>;
export type CorrectionAnalysis = z.infer<typeof CorrectionAnalysisSchema>;

// Input required by the correction analysis prompt. Mirrored from the initial POC shape.
export type CorrectionAnalysisInput = {
  originalQuestion: string;
  botResponse: string;
  wrong?: string | null;
  right?: string | null;
  reason?: string | null;
};
