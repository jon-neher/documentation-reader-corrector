import OpenAI from 'openai';

export type ChatMessage = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string };

export type MakeRequestOptions = {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  // Allow passing full messages; if `prompt` string is provided, it will be mapped to a user message.
  messages?: ChatMessage[];
  // Extra options forwarded as-is in case JON-18 exposes more knobs
  extra?: Record<string, unknown>;
  // Per-call override: maximum total attempts (initial try + retries) for transient failures; overrides
  // limiter default/env for this call. Example: 3 => up to 3 total attempts.
  maxRetries?: number;
};

export type OpenAIResponse = {
  id: string;
  model: string;
  created: number;
  content: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  raw: unknown; // raw SDK response for callers that need it
};

export class OpenAIClient {
  private sdk: OpenAI;

  constructor(apiKey?: string) {
    this.sdk = new OpenAI({ apiKey: apiKey || process.env.OPENAI_API_KEY });
  }

  async chat(prompt: string | ChatMessage[], options: MakeRequestOptions = {}): Promise<OpenAIResponse> {
    const messages: ChatMessage[] = Array.isArray(prompt)
      ? prompt
      : [{ role: 'user', content: String(prompt) }];

    const { model = process.env.OPENAI_MODEL || 'gpt-4o-mini', temperature = 0.2, maxTokens, timeoutMs, extra } =
      options;

    // Use Chat Completions for broad compatibility
    const resp = await this.sdk.chat.completions.create(
      {
        model,
        messages: messages as any,
        temperature,
        max_tokens: maxTokens,
        ...(extra || {}),
      },
      { timeout: timeoutMs }
    );

    const choice = resp.choices[0];
    const content = choice?.message?.content ?? '';

    return {
      id: resp.id,
      model: resp.model || model,
      created: resp.created || Math.floor(Date.now() / 1000),
      content,
      usage: resp.usage
        ? {
            prompt_tokens: resp.usage.prompt_tokens ?? 0,
            completion_tokens: resp.usage.completion_tokens ?? 0,
            total_tokens: resp.usage.total_tokens ?? 0,
          }
        : undefined,
      raw: resp,
    };
  }
}
