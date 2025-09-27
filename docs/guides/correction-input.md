# Correction input parsing and validation (JON-22)

This module defines the expected payload coming from Haley's Google Chat integration and provides a strict, sanitized, internal format for downstream processing.

## Expected input (from Google Chat)

```json
{
  "threadContext": {
    "originalQuestion": "How do I reset my partner dashboard password?",
    "botResponse": "You can reset passwords in Account Settings under Security.",
    "timestamp": "2024-07-15T10:30:00Z",
    "userId": "user123",
    "channelId": "channel456"
  },
  "correctionFields": {
    "wrong": "Account Settings → Security",
    "right": "Partner Center → Profile page",
    "reason": "UI changed in 2024.07"
  }
}
```

## Standardized internal format

```json
{
  "originalQuestion": "string",
  "botResponse": "string",
  "incorrectAnswer": "string",
  "correctAnswer": "string",
  "correctionReason": "string",
  "metadata": {
    "timestamp": "ISO string",
    "userId": "string",
    "channelId": "string"
  }
}
```

## Validation rules

- Required fields: `wrong`, `right`, `reason`, `threadContext.originalQuestion`, `threadContext.botResponse`, and `threadContext.timestamp`.
- `timestamp` must be a valid ISO-8601 string like `2024-07-15T10:30:00Z`.
- Length limits (hard caps):
  - `originalQuestion` ≤ 2000 chars
  - `botResponse` ≤ 4000 chars
  - `wrong`/`right`/`reason` ≤ 1000 chars
  - `userId`/`channelId` ≤ 200 chars
- Sanitization removes control and hidden unicode (CR/LF, zero-width, bidi controls), collapses whitespace, and trims.

## Usage

```ts
import { parseCorrectionInput } from '../../src/analysis/correction/parser.js';

const processed = parseCorrectionInput(chatPayload);
// → { originalQuestion, botResponse, incorrectAnswer, correctAnswer, correctionReason, metadata }
```

On invalid input, the parser logs a warning line (redacting sensitive values) and throws `CorrectionInputError` containing structured `issues`.

## Implementation notes

- Schemas are defined with Zod in `src/analysis/correction/parser.ts`.
- Logging uses the project’s structured JSON logger (`src/openai/logger.ts`).
- Unknown keys in the input are ignored (not an error).
