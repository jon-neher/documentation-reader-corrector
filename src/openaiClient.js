import OpenAI from "openai";

let cachedClient = null;

/**
* Create and return a new OpenAI client instance configured from environment.
* Throws a clear, actionable error when OPENAI_API_KEY is missing.
*/
export function getOpenAIClient() {
  if (cachedClient) return cachedClient;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing OPENAI_API_KEY. Set it in your environment (e.g., export OPENAI_API_KEY=... or add it to a local .env file) before using the OpenAI client."
    );
  }

  cachedClient = new OpenAI({ apiKey });
  return cachedClient;
}

/**
* Perform a minimal request to verify connectivity/authentication.
* On API failure (e.g., invalid key), throws an Error with message prefix:
*   "API connection failed: ..."
* Returns true on success.
*/
export async function testConnection() {
  // Let missing-API-key errors surface directly without the "API connection failed:" prefix.
  const openai = getOpenAIClient();

  try {
    await openai.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "user", content: "test" }],
      max_tokens: 1,
    });
    return true;
  } catch (error) {
    const message = error && typeof error === "object" && "message" in error ? error.message : String(error);
    throw new Error(`API connection failed: ${message}`);
  }
}

export default {
  getOpenAIClient,
  testConnection,
};
