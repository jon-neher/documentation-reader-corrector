LangChain POC examples

This folder contains a minimal proof-of-concept for JON-43. It does not affect production code paths.

Correction analysis POC

Run with your OpenAI key:

    OPENAI_API_KEY=... npm run poc:langchain:correction-analysis

Optional: choose a model (defaults to gpt-4o-mini):

    OPENAI_MODEL=gpt-4o OPENAI_API_KEY=... npm run poc:langchain:correction-analysis

Outputs a typed JSON object along with timing and (when available) token usage and an estimated cost.
