/**
 * Anthropic Messages API provider using forced tool use for structured output.
 * Credentials come from ANTHROPIC_API_KEY on the server and are never sent to
 * browsers or written to logs.
 */
import { ProviderError, withRetries, type ModelProvider, type StructuredRequest, type StructuredResponse } from './provider.ts';

interface AnthropicOptions {
  apiKey: string;
  model: string;
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

interface AnthropicResponse {
  model?: string;
  content?: Array<{ type: string; name?: string; input?: unknown }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  stop_reason?: string;
}

export class AnthropicProvider implements ModelProvider {
  readonly name = 'anthropic';
  readonly model: string;
  #apiKey: string;
  #baseUrl: string;
  #fetch: typeof fetch;

  constructor(options: AnthropicOptions) {
    this.model = options.model;
    this.#apiKey = options.apiKey;
    this.#baseUrl = options.baseUrl;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  generateStructured(request: StructuredRequest): Promise<StructuredResponse> {
    return withRetries(() => this.#once(request), { retries: 2, baseDelayMs: 400, signal: request.signal });
  }

  async #once(request: StructuredRequest): Promise<StructuredResponse> {
    const controller = new AbortController();
    const timeoutMs = request.timeoutMs ?? 20_000;
    const timer = setTimeout(() => controller.abort(new ProviderError('timeout', 'Model request timed out', true)), timeoutMs);
    const onAbort = () => controller.abort(new ProviderError('cancelled', 'Request cancelled', false));
    request.signal?.addEventListener('abort', onAbort, { once: true });
    const started = Date.now();
    try {
      let response: Response;
      try {
        response = await this.#fetch(`${this.#baseUrl}/v1/messages`, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'content-type': 'application/json',
            'x-api-key': this.#apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: this.model,
            max_tokens: request.maxTokens,
            system: request.system,
            tools: [request.tool],
            tool_choice: { type: 'tool', name: request.tool.name },
            messages: [{ role: 'user', content: request.prompt }],
          }),
        });
      } catch (error) {
        const reason = controller.signal.reason;
        if (reason instanceof ProviderError) throw reason;
        throw new ProviderError('unavailable', `Could not reach the model provider (${(error as Error).name})`, true);
      }
      if (!response.ok) {
        // Never echo provider bodies verbatim to clients; they can contain request details.
        await response.text().catch(() => '');
        if (response.status === 401 || response.status === 403) throw new ProviderError('auth', 'The model provider rejected the API key.', false, response.status);
        if (response.status === 429) throw new ProviderError('rate_limited', 'The model provider is rate limiting requests.', true, response.status);
        if (response.status === 400 || response.status === 404) throw new ProviderError('bad_request', 'The model provider rejected the request.', false, response.status);
        throw new ProviderError('unavailable', `The model provider returned HTTP ${response.status}.`, response.status >= 500, response.status);
      }
      const data = (await response.json().catch(() => null)) as AnthropicResponse | null;
      const toolUse = data?.content?.find((block) => block.type === 'tool_use' && block.name === request.tool.name);
      if (!toolUse || typeof toolUse.input !== 'object' || toolUse.input === null) {
        throw new ProviderError('invalid_response', 'The model did not return structured output.', true);
      }
      return {
        input: toolUse.input,
        usage: { inputTokens: data?.usage?.input_tokens ?? 0, outputTokens: data?.usage?.output_tokens ?? 0 },
        model: data?.model ?? this.model,
        latencyMs: Date.now() - started,
      };
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', onAbort);
    }
  }
}
