import OpenAI from 'openai';

/**
* Thin wrapper around the official OpenAI SDK that uses the Response API
* (Responses) under the hood while keeping a stable, minimal surface for
* callers in this repo.
*
* Key notes for maintainers:
* - Input: accepts either a plain string prompt or Chat Completions–style
*   `messages: ChatMessage[]`. When `messages` are provided, they are mapped
*   to Responses `input` items (EasyInputMessage). Unsupported/unknown content
*   parts are preserved in a compact JSON blob so no information is lost.
* - Output: prefers `output_text` but falls back to the first text item found
*   in `output` when necessary. Token usage is mapped from Responses
*   `{ input_tokens, output_tokens, total_tokens }` to our legacy
*   `{ prompt_tokens, completion_tokens, total_tokens }` shape for
*   compatibility with existing budgeting/cost code.
* - Options: `maxTokens` maps to `max_output_tokens` and is omitted when not
*   specified. Arbitrary supported fields can be passed via `extra`; core
*   parameters (model, input, temperature, max_output_tokens) always win over
*   conflicting keys in `extra`.
* - Roles: content with role `tool` or `function` is normalized to `user` to
*   avoid attributing tool outputs to the assistant when translated to
*   Responses messages. Unknown roles also fall back to `user`.
*/

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

  /**
   * Create a single Response.
   *
   * Accepts either a plain string prompt or Chat Completions–style messages.
   * Maps inputs to the Responses API and returns a normalized result.
   */
  async chat(prompt: string | ChatMessage[], options: MakeRequestOptions = {}): Promise<OpenAIResponse> {
    // Determine where messages come from. Treat an empty `options.messages` as absent
    // so that a non-empty string `prompt` is not discarded.
    const hasExplicitMessages = Array.isArray(options.messages) && options.messages.length > 0;
    const isPromptArray = Array.isArray(prompt);
    const messages: ChatMessage[] | undefined = hasExplicitMessages
      ? (options.messages as ChatMessage[])
      : isPromptArray
        ? (prompt as ChatMessage[])
        : undefined;

    const { model = process.env.OPENAI_MODEL || 'gpt-4o-mini', temperature = 0.2, maxTokens, timeoutMs, extra } =
      options;

    // Build Responses API input. If caller passed a plain string via `prompt` and
    // did not also provide messages, pass the string directly for the simplest
    // request shape. Otherwise, map Chat Completions–style messages to Responses
    // `input` items (EasyInputMessage objects).
    const input = (hasExplicitMessages || isPromptArray)
      ? mapChatMessagesToResponsesInput(messages as ChatMessage[])
      : String(prompt);
    // Cast to `any` to avoid importing deep OpenAI types; we build the correct
    // shape (`ResponseInput` or `string`) above.
    const inputForApi: any = input;

    // Responses API call (successor to Chat Completions).
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
    type LiteResponse = {
      id: string;
      model?: string;
      created_at?: number;
      usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
      output_text?: string;
      output?: unknown[];
    };
    const r = resp as unknown as LiteResponse;
    const content = getOutputText(r) ?? '';

    return {
      id: r.id,
      model: r.model || model,
      created: r.created_at || Math.floor(Date.now() / 1000),
      content,
      usage: r.usage
        ? {
            // Map Responses usage fields to our legacy shape
            prompt_tokens: r.usage.input_tokens ?? 0,
            completion_tokens: r.usage.output_tokens ?? 0,
            total_tokens: r.usage.total_tokens ?? 0,
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
      // Some Responses return top-level text items
      if ((it?.type === 'output_text' || it?.type === 'text') && typeof it?.text === 'string') {
        return it.text as string;
      }
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
