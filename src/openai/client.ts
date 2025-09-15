import OpenAI from 'openai';

// Public type surface: keep compatibility with callers that import `ChatMessage`.
// We intentionally continue exporting the Chat Completions message shape even
// though the implementation below uses the Responses API under the hood.
export type ChatMessage = OpenAI.ChatCompletionMessageParam;

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
    // Honor `options.messages` when provided; otherwise derive from `prompt`.
    const messages: ChatMessage[] =
      options.messages ?? (Array.isArray(prompt) ? prompt : [{ role: 'user', content: String(prompt) }]);

    const { model = process.env.OPENAI_MODEL || 'gpt-4o-mini', temperature = 0.2, maxTokens, timeoutMs, extra } =
      options;

    // Build Responses API input. If caller passed a plain string via `prompt` and
    // did not also provide messages, pass the string directly for the simplest
    // request shape. Otherwise, map Chat Completions-style messages to Responses
    // `input` items (EasyInputMessage objects).
    const input = (options.messages || Array.isArray(prompt))
      ? mapChatMessagesToResponsesInput(messages)
      : String(prompt);
    // Cast to `any` to avoid importing deep OpenAI types; we build the correct
    // shape (`ResponseInput` or `string`) above.
    const inputForApi: any = input;

    // Responses API call (replacement for Chat Completions).
    // Sanitize `extra` so it cannot override core params or inject incompatible fields.
    // Omit `max_output_tokens` entirely when not provided to avoid sending undefined fields.
    const baseParams = {
      model,
      input: inputForApi,
      temperature,
      ...(typeof maxTokens === 'number' ? { max_output_tokens: maxTokens } : {}),
    } as const;
    const {
      input: _ignoreInput,
      messages: _ignoreMessages,
      max_tokens: _ignoreMaxTokens,
      model: _ignoreModel,
      temperature: _ignoreTemperature,
      max_output_tokens: _ignoreMaxOut,
      ...restExtra
    } = (extra ?? {}) as Record<string, unknown>;

    const resp = await this.sdk.responses.create(
      {
        // Allow additional supported fields via `extra`, but ensure core params take precedence
        ...restExtra,
        ...baseParams,
      },
      { timeout: timeoutMs }
    );

    // Prefer SDK-provided `output_text`; fall back to first output message text.
    const content = getOutputText(resp) ?? '';

    return {
      id: resp.id,
      model: (resp as any).model || model,
      created: (resp as any).created_at || Math.floor(Date.now() / 1000),
      content,
      usage: (resp as any).usage
        ? {
            // Map Responses usage fields to our legacy shape
            prompt_tokens: (resp as any).usage.input_tokens ?? 0,
            completion_tokens: (resp as any).usage.output_tokens ?? 0,
            total_tokens: (resp as any).usage.total_tokens ?? 0,
          }
        : undefined,
      raw: resp,
    };
  }
}

// --- internal helpers: keep unexported to avoid expanding the public API surface ---

function mapChatMessagesToResponsesInput(msgs: ChatMessage[]): Array<Record<string, unknown>> {
  return msgs.map((m) => {
    const role = (m as any)?.role as string;
    // Handle special roles explicitly; default unknowns to 'user' to avoid the assistant
    // "talking to itself" or misattributing user content.
    let mappedRole: 'user' | 'assistant' | 'system' | 'developer';
    if (role === 'tool' || role === 'function') {
      // Treat tool/function outputs as user-provided context to avoid misattributing to assistant.
      mappedRole = 'user';
    } else if ((['user', 'assistant', 'system', 'developer'] as const).includes(role as any)) {
      mappedRole = role as any;
    } else {
      mappedRole = 'user';
    }
    const content = normalizeContent((m as any)?.content);
    return { role: mappedRole, content, type: 'message' };
  });
}

function normalizeContent(
  content: unknown
): string | Array<Record<string, unknown>> {
  // If content is already a simple string, pass through.
  if (typeof content === 'string' || content == null) {
    return content == null ? '' : content;
  }
  // Chat Completions allows arrays of content parts; map known part shapes.
  if (Array.isArray(content)) {
    const parts = content as Array<any>;
    const mapped: Array<Record<string, unknown>> = [];
    const unknown: Array<any> = [];

    for (const part of parts) {
      const t = (part as any)?.type as string | undefined;
      if (!t) {
        unknown.push(part);
        continue;
      }
      if (t === 'text' && typeof (part as any)?.text === 'string') {
        mapped.push({ type: 'input_text', text: (part as any).text });
        continue;
      }
      if (t === 'image_url' && (part as any)?.image_url && typeof (part as any).image_url?.url === 'string') {
        const detail = (part as any).image_url?.detail;
        mapped.push({ type: 'input_image', image_url: (part as any).image_url.url, detail: detail ?? 'auto' });
        continue;
      }
      if (t === 'input_audio' && (part as any)?.input_audio && typeof (part as any).input_audio?.data === 'string') {
        const fmt = (part as any).input_audio?.format;
        mapped.push({ type: 'input_audio', input_audio: { data: (part as any).input_audio.data, format: fmt } });
        continue;
      }
      if (t === 'file' && (part as any)?.file) {
        const f = (part as any).file;
        // Enforce mutual exclusivity between file_id and file_data; include filename only with file_data.
        if (typeof f.file_id === 'string') {
          mapped.push({ type: 'input_file', file_id: f.file_id });
        } else if (typeof f.file_data === 'string') {
          const out: Record<string, unknown> = { type: 'input_file', file_data: f.file_data };
          if (typeof f.filename === 'string') out.filename = f.filename;
          mapped.push(out);
        } else {
          // Neither file_id nor file_data provided; preserve as unknown for trailing JSON blob.
          unknown.push(part);
        }
        continue;
      }
      // Unrecognized known-type shape; preserve as unknown
      unknown.push(part);
    }

    if (unknown.length) {
      mapped.push({ type: 'input_text', text: safeJsonBlob(unknown) });
    }

    if (mapped.length === 0) {
      // Nothing recognized at all; preserve entire array as a JSON blob so no information is lost.
      return [{ type: 'input_text', text: safeJsonBlob(parts) }];
    }
    return mapped;
  }
  // Fallback: coerce to string
  try {
    return String(content);
  } catch {
    return '';
  }
}

// Cap size of JSON-serialized unknown content to avoid oversized requests.
const MAX_UNKNOWN_JSON = 16_384; // 16KB
function safeJsonBlob(value: unknown): string {
  let out: string;
  try {
    out = JSON.stringify(value);
  } catch {
    out = String(value);
  }
  if (out.length > MAX_UNKNOWN_JSON) {
    return out.slice(0, MAX_UNKNOWN_JSON) + ' …(truncated)';
  }
  return out;
}

function getOutputText(resp: unknown): string | undefined {
  const any = resp as any;
  if (typeof any?.output_text === 'string') return any.output_text;
  // Fallback: look for first output message content text
  const items = any?.output as Array<any> | undefined;
  if (Array.isArray(items)) {
    for (const it of items) {
      if (it?.type === 'message' && Array.isArray(it?.content)) {
        // Find first text-like content
        const textPart = (it.content as Array<any>).find(
          (p) => (p?.type === 'output_text' || p?.type === 'text') && typeof p?.text === 'string'
        );
        if (textPart?.text) return textPart.text as string;
      }
    }
  }
  return undefined;
}
