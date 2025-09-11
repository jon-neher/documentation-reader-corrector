export class BudgetExceededError extends Error {
  readonly code = 'BUDGET_EXCEEDED';
  readonly status = 402; // Payment Required semantics
  constructor(message = 'Monthly OpenAI budget exceeded') {
    super(message);
    this.name = 'BudgetExceededError';
  }
}

export class RateLimitError extends Error {
  readonly code = 'RATE_LIMIT_EXCEEDED';
  readonly status = 429;
  readonly retryAfterMs?: number;
  constructor(message = 'Rate limit exceeded', retryAfterMs?: number) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

export class InvalidApiKeyError extends Error {
  readonly code = 'INVALID_API_KEY';
  readonly status = 401;
  constructor(message = 'Invalid OpenAI API key') {
    super(message);
    this.name = 'InvalidApiKeyError';
  }
}

export class ServerError extends Error {
  readonly code = 'OPENAI_SERVER_ERROR';
  readonly status: number;
  constructor(status = 500, message = 'OpenAI server error') {
    super(message);
    this.name = 'ServerError';
    this.status = status;
  }
}

export class NetworkTimeoutError extends Error {
  readonly code = 'NETWORK_TIMEOUT';
  constructor(message = 'Network timeout while calling OpenAI') {
    super(message);
    this.name = 'NetworkTimeoutError';
  }
}

export class InvalidRequestError extends Error {
  readonly code = 'INVALID_REQUEST';
  readonly status = 400;
  constructor(message = 'Invalid OpenAI request') {
    super(message);
    this.name = 'InvalidRequestError';
  }
}

export type KnownOpenAIError =
  | BudgetExceededError
  | RateLimitError
  | InvalidApiKeyError
  | ServerError
  | NetworkTimeoutError
  | InvalidRequestError;
