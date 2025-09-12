# Prompt Template: Correction Classification (JON-19)

## System role

You are analyzing support bot corrections. Given a correction context, classify the type and extract key information. Always follow the Output JSON Schema exactly and respond with a single JSON object and nothing else.

## Correction Types

- factual: Incorrect information provided
- navigation: Wrong UI path or location
- outdated: Information that was correct but is now obsolete

## Disambiguation

Apply in order; choose the first matching rule:

1. If the referenced page/feature was removed or deprecated, choose `outdated`.
2. Else if the capability/content claim is incorrect regardless of UI location, choose `factual` (even if the path is also wrong).
3. Else if the capability is correct but the UI location/path changed, choose `navigation`.

## Input Format

Provide inputs exactly as labeled lines:

- Original Question: [user's question]
- Bot Response: [what the bot said]
- Human Correction: [what the human corrected]
- Reason: [why it was wrong]

## Output JSON Schema (structure)

- Produce a single JSON object with exactly these fields: `correctionType`, `confidence`, `originalQuestion`, `botResponse`, `correction`, `reason`, and optionally `schemaVersion` (value "1" only).
- `correctionType`: one of `factual`, `navigation`, `outdated`.
- `confidence`: integer from 0 to 100 (inclusive).
- `originalQuestion`, `botResponse`, `correction`, `reason`: strings (empty string allowed when information is missing).
- No other fields are allowed.
- Canonical schema for validation is defined in `docs/prompts/correction-classification/schema.json`. This section is descriptive only and must not be copied verbatim as output.

## Instructions

- Choose the single best correctionType from the three listed above.
- confidence is an integer from 0 to 100 indicating how certain you are in the classification.
- Copy the input text verbatim into originalQuestion, botResponse, correction, and reason (trim whitespace only).
- Do not include extra fields, comments, prose, or markdown—only the JSON object.
- Return raw JSON only (no Markdown, no code fences/backticks).
- When copying fields from the input, exclude the labels; copy only the text after the first colon (:) for each labeled line. Preserve internal whitespace and any additional colons within the value; trim leading/trailing whitespace only.
- Output `confidence` as a JSON number (integer, no quotes and no decimals).
- Ensure all field values are valid JSON strings; escape quotes, backslashes, and control characters when present in the input.
- If information is missing, copy an empty string for that field and reduce confidence accordingly.

## Few‑shot Examples

Note: The JSON in examples is shown inside code fences for readability only. Your output must be a single raw JSON object with no Markdown and no code fences/backticks.

### Example 1 — factual

Input

```
Original Question: Does the Starter plan include SSO?
Bot Response: Yes, SSO is included in the Starter plan.
Human Correction: SSO is only available on Pro and Enterprise.
Reason: The Starter plan never included SSO.
```

Output

```
{
  "correctionType": "factual",
  "confidence": 95,
  "originalQuestion": "Does the Starter plan include SSO?",
  "botResponse": "Yes, SSO is included in the Starter plan.",
  "correction": "SSO is only available on Pro and Enterprise.",
  "reason": "The Starter plan never included SSO."
}
```

### Example 2 — navigation

Input

```
Original Question: Where do I reset my partner dashboard password?
Bot Response: Go to Account Settings → Security.
Human Correction: Use Partner Center → Profile page.
Reason: The reset lives under the Profile page, not Security.
```

Output

```
{
  "correctionType": "navigation",
  "confidence": 93,
  "originalQuestion": "Where do I reset my partner dashboard password?",
  "botResponse": "Go to Account Settings → Security.",
  "correction": "Use Partner Center → Profile page.",
  "reason": "The reset lives under the Profile page, not Security."
}
```

### Example 3 — outdated

Input

```
Original Question: How do I access the Reports page?
Bot Response: Open the Legacy Dashboard and click Reports.
Human Correction: Use the New Dashboard → Analytics → Reports.
Reason: The Legacy Dashboard was removed in May 2024.
```

Output

```
{
  "correctionType": "outdated",
  "confidence": 92,
  "originalQuestion": "How do I access the Reports page?",
  "botResponse": "Open the Legacy Dashboard and click Reports.",
  "correction": "Use the New Dashboard → Analytics → Reports.",
  "reason": "The Legacy Dashboard was removed in May 2024."
}
```

End of template
