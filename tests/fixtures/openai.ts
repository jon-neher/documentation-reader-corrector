// Shared helpers/fixtures for mocking the OpenAI Responses API and related errors
// Used by tests to keep shapes consistent and deterministic.

export type LiteResponse = {
  id: string;
  model?: string;
  created_at?: number;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
  output_text?: string;
  output?: Array<unknown>;
};

export function makeLiteResponse(partial: Partial<LiteResponse> = {}): LiteResponse {
  return {
    id: partial.id || 'resp_test',
    model: partial.model || 'gpt-4o-mini',
    created_at: typeof partial.created_at === 'number' ? partial.created_at : 1_700_000_000,
    usage: partial.usage || { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    output_text: partial.output_text ?? 'OK',
    output: partial.output,
  };
}

export function rateLimitError(retryAfterSeconds = 0) {
  return {
    status: 429,
    message: 'rate limited',
    response: { headers: { get: (k: string) => (k.toLowerCase() === 'retry-after' ? String(retryAfterSeconds) : undefined) } },
  } as const;
}

export function serverError(status = 503, message = 'server unavailable') {
  return { status, message, response: { headers: { get: () => '0' } } } as const;
}

export function invalidRequest(message = 'bad request') {
  return { status: 400, message } as const;
}

export function invalidKey(message = 'invalid key') {
  return { status: 401, message } as const;
}

export function networkTimeout() {
  return { name: 'AbortError', message: 'timed out' } as const;
}
