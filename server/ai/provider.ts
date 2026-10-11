/**
 * Server-side model-provider boundary. The rest of Navoro talks to models only
 * through `ModelProvider.generateStructured`, which returns tool-call input
 * (structured JSON) — never free-form prose that we would have to parse into
 * instructions. Swapping providers means adding another implementation.
 */

export type ProviderErrorCode = 'timeout' | 'rate_limited' | 'unavailable' | 'auth' | 'bad_request' | 'invalid_response' | 'cancelled';

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;
  readonly status: number | null;
  constructor(code: ProviderErrorCode, message: string, retryable: boolean, status: number | null = null) {
    super(message);
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface StructuredRequest {
  system: string;
  /** User-turn content. Untrusted material must already be wrapped in delimiters. */
  prompt: string;
  tool: ToolDefinition;
  maxTokens: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface StructuredResponse {
  input: unknown;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
  latencyMs: number;
}

export interface ModelProvider {
  readonly name: string;
  readonly model: string;
  generateStructured(request: StructuredRequest): Promise<StructuredResponse>;
}

/** Runs `fn` with bounded retries and jittered exponential backoff for retryable errors. */
export async function withRetries<T>(fn: (attempt: number) => Promise<T>, options: { retries: number; baseDelayMs: number; signal?: AbortSignal }): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    if (options.signal?.aborted) throw new ProviderError('cancelled', 'Request cancelled', false);
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      const retryable = error instanceof ProviderError && error.retryable;
      if (!retryable || attempt === options.retries) throw error;
      const delay = options.baseDelayMs * 2 ** attempt * (0.75 + Math.random() * 0.5);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
