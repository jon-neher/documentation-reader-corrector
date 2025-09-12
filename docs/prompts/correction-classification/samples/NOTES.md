# Sample Classification Notes

- Date: 2025-09-11
- Prompt: docs/prompts/correction-classification/prompt.md
- Output schema: docs/prompts/correction-classification/schema.json

Summary

- The 5 samples in this folder cleanly map to the three correction types (factual, navigation, outdated).
- Designed for determinism at low temperature (e.g., 0–0.2). Confidence values may vary ±5, but the classification label should remain stable.

Observed consistency (manual evaluation)

- All five cases are unambiguous:
  - 01, 04 → factual
  - 02, 05 → navigation
  - 03 → outdated
- Expected results produced by the prompt are included as `*.expected.json` for each `*.input.md`.

Next steps (optional)

- Wire a small harness (or reuse `examples/langchain/poc_correction_analysis.mjs` as a starting point) to batch-run these samples against a model with temperature 0 and assert JSON schema validity.
