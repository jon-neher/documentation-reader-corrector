import OpenAI from "openai";
import { OpenAIRateLimiter } from "../dist/openai/OpenAIRateLimiter.js";

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
  // Trigger API key validation; throws if missing
  getOpenAIClient();
  const limiter = new OpenAIRateLimiter(50, 100);

  try {
    await limiter.makeRequest(
      [{ role: "user", content: "test" }],
      { model: "gpt-4o-mini", maxTokens: 1, temperature: 0 }
    );
    return true;
  } catch (error) {
    const message = error && typeof error === "object" && "message" in error ? error.message : String(error);
    throw new Error(`API connection failed: ${message}`, { cause: error });
  }
}

export default {
  getOpenAIClient,
  testConnection,
};
