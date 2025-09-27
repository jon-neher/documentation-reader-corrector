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
    "channelId": "channel456",
    "messages": [
      { "role": "user", "text": "How do I reset my partner dashboard password?" },
      { "role": "assistant", "text": "You can reset passwords in Account Settings under Security." }
    ]
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

## Validation & derivation rules

- Always required: `correctionFields.wrong`, `correctionFields.right`, `correctionFields.reason`.
- `threadContext` is optional. When present:
  - `timestamp` is preferred and validated if provided (`YYYY-MM-DDTHH:mm:ss(.SSS)Z`). If omitted, the parser generates a current ISO timestamp and sets `metadata.derived.timestamp = "generated"`.
  - `originalQuestion` and `botResponse` are optional. If omitted, the parser will try to derive them from `threadContext.messages[]`:
    - `originalQuestion` := first message with `role` in {`user`,`human`} (fallback: first message text)
    - `botResponse` := last message with `role` in {`assistant`,`ai`,`bot`} (fallback: last message text)
  - If still missing after derivation, the parser falls back to:
    - `originalQuestion` := `"Unknown"` with `metadata.derived.originalQuestion = "missing"`
    - `botResponse` := `correctionFields.wrong` with `metadata.derived.botResponse = "fallbackFromWrong"`
- Length limits (hard caps):
  - `originalQuestion` ≤ 2000 chars
  - `botResponse` ≤ 4000 chars
  - `wrong`/`right`/`reason` ≤ 1000 chars
  - `userId`/`channelId` ≤ 200 chars
- Sanitization removes control and hidden unicode (CR/LF, zero-width, bidi controls), collapses whitespace, and trims.

Note: When a provided or derived field exceeds its cap, the parser truncates it to the maximum length before emitting the standardized object.

## Usage

```ts
import { parseCorrectionInput } from '../../src/analysis/correction/parser.js';

const processed = parseCorrectionInput(chatPayload);
// → { originalQuestion, botResponse, incorrectAnswer, correctAnswer, correctionReason, metadata }
```

On invalid input, the parser logs a warning line (redacting sensitive values) and throws `CorrectionInputError` containing structured `issues`.

## Minimal payload examples

- No assistant answer yet; accept and fall back:

```json
{
  "threadContext": {
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

- Messages-only derivation (no scalars):

```json
{
  "threadContext": {
    "messages": [
      { "role": "user", "text": "How do I reset my partner dashboard password?" },
      { "role": "assistant", "text": "You can reset passwords in Account Settings under Security." }
    ]
  },
  "correctionFields": {
    "wrong": "Account Settings → Security",
    "right": "Partner Center → Profile page",
    "reason": "UI changed in 2024.07"
  }
}
```

## Implementation notes

- Schemas are defined with Zod in `src/analysis/correction/parser.ts`.
- Logging uses the project’s structured JSON logger (`src/openai/logger.ts`).
- Unknown keys in the input are ignored (not an error).
