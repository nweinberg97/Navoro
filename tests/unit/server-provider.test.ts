import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { AnthropicProvider } from '../../server/ai/anthropic.ts';
import { ProviderError, withRetries, type StructuredRequest } from '../../server/ai/provider.ts';

const API_KEY = 'sk-ant-test-key-123';
const TOOL = { name: 'provide_guidance', description: 'test', input_schema: { type: 'object' } };

function request(extra: Partial<StructuredRequest> = {}): StructuredRequest {
  return { system: 'sys', prompt: '<question>"hi"</question>', tool: TOOL, maxTokens: 100, ...extra };
}

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(responder: (call: Call, index: number) => Response | Promise<Response>): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    return responder(call, calls.length - 1);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function provider(fetchImpl: typeof fetch): AnthropicProvider {
  return new AnthropicProvider({ apiKey: API_KEY, model: 'claude-test', baseUrl: 'https://api.test', fetchImpl });
}

async function rejectsWithCode(promise: Promise<unknown>, code: string): Promise<ProviderError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof ProviderError, `expected ProviderError, got ${String(error)}`);
    assert.equal(error.code, code);
    return error;
  }
  assert.fail(`expected rejection with ${code}`);
}

describe('AnthropicProvider', () => {
  // The provider backs off 400ms+ between retries; clamp those waits so the suite stays fast.
  // Short timers (the 20ms timeouts used below) are left untouched.
  const realSetTimeout = globalThis.setTimeout;
  before(() => {
    globalThis.setTimeout = ((fn: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) =>
      realSetTimeout(fn, ms !== undefined && ms >= 300 && ms < 5_000 ? 1 : ms, ...args)) as typeof setTimeout;
  });
  after(() => {
    globalThis.setTimeout = realSetTimeout;
  });

  test('parses tool_use input and usage', async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      json(200, { model: 'claude-test-2025', content: [{ type: 'text', text: 'ignored' }, { type: 'tool_use', name: 'provide_guidance', input: { decision: 'answer' } }], usage: { input_tokens: 12, output_tokens: 7 } }),
    );
    const response = await provider(fetchImpl).generateStructured(request());
    assert.deepEqual(response.input, { decision: 'answer' });
    assert.deepEqual(response.usage, { inputTokens: 12, outputTokens: 7 });
    assert.equal(response.model, 'claude-test-2025');
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'https://api.test/v1/messages');
  });

  test('request forces the tool and keeps the key only in the x-api-key header', async () => {
    const { fetchImpl, calls } = fakeFetch(() => json(200, { content: [{ type: 'tool_use', name: 'provide_guidance', input: {} }] }));
    await provider(fetchImpl).generateStructured(request());
    const init = calls[0]?.init;
    const headers = init?.headers as Record<string, string>;
    assert.equal(headers['x-api-key'], API_KEY);
    assert.equal(headers['anthropic-version'], '2023-06-01');
    const bodyText = String(init?.body);
    assert.ok(!bodyText.includes(API_KEY), 'API key must not appear in the request body');
    assert.ok(!calls[0]?.url.includes(API_KEY), 'API key must not appear in the URL');
    const body = JSON.parse(bodyText);
    assert.deepEqual(body.tool_choice, { type: 'tool', name: 'provide_guidance' });
    assert.deepEqual(body.tools, [TOOL]);
    assert.equal(body.model, 'claude-test');
    assert.equal(body.max_tokens, 100);
    assert.deepEqual(body.messages, [{ role: 'user', content: '<question>"hi"</question>' }]);
  });

  test('401 is an auth error and is not retried', async () => {
    const { fetchImpl, calls } = fakeFetch(() => json(401, { error: { message: `bad key ${API_KEY}` } }));
    const error = await rejectsWithCode(provider(fetchImpl).generateStructured(request()), 'auth');
    assert.equal(error.retryable, false);
    assert.equal(error.status, 401);
    assert.ok(!error.message.includes(API_KEY), 'provider body is never echoed');
    assert.equal(calls.length, 1);
  });

  test('400 is a non-retryable bad_request', async () => {
    const { fetchImpl, calls } = fakeFetch(() => json(400, {}));
    await rejectsWithCode(provider(fetchImpl).generateStructured(request()), 'bad_request');
    assert.equal(calls.length, 1);
  });

  test('429 is retried a bounded number of times, then surfaces rate_limited', async () => {
    const { fetchImpl, calls } = fakeFetch(() => json(429, {}));
    await rejectsWithCode(provider(fetchImpl).generateStructured(request()), 'rate_limited');
    assert.equal(calls.length, 3, '1 attempt + 2 retries');
  });

  test('500 is retried and can recover', async () => {
    const { fetchImpl, calls } = fakeFetch((_call, index) =>
      index === 0 ? json(503, {}) : json(200, { content: [{ type: 'tool_use', name: 'provide_guidance', input: { ok: true } }] }),
    );
    const response = await provider(fetchImpl).generateStructured(request());
    assert.deepEqual(response.input, { ok: true });
    assert.equal(calls.length, 2);
  });

  test('persistent 500 ends as unavailable after bounded retries', async () => {
    const { fetchImpl, calls } = fakeFetch(() => json(500, {}));
    const error = await rejectsWithCode(provider(fetchImpl).generateStructured(request()), 'unavailable');
    assert.equal(error.status, 500);
    assert.equal(calls.length, 3);
  });

  test('network failure maps to unavailable', async () => {
    const { fetchImpl } = fakeFetch(() => {
      throw new TypeError('fetch failed');
    });
    await rejectsWithCode(provider(fetchImpl).generateStructured(request()), 'unavailable');
  });

  test('times out slow responses', async () => {
    const { fetchImpl, calls } = fakeFetch(
      (call) =>
        new Promise<Response>((_resolve, reject) => {
          call.init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    await rejectsWithCode(provider(fetchImpl).generateStructured(request({ timeoutMs: 20 })), 'timeout');
    assert.equal(calls.length, 3, 'timeouts are retryable but bounded');
  });

  test('caller cancellation is not retried', async () => {
    const controller = new AbortController();
    const { fetchImpl, calls } = fakeFetch(
      (call) =>
        new Promise<Response>((_resolve, reject) => {
          call.init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          setTimeout(() => controller.abort(), 5);
        }),
    );
    await rejectsWithCode(provider(fetchImpl).generateStructured(request({ signal: controller.signal })), 'cancelled');
    assert.equal(calls.length, 1);
  });

  test('missing tool_use block → invalid_response', async () => {
    const { fetchImpl, calls } = fakeFetch(() => json(200, { content: [{ type: 'text', text: 'I refuse' }] }));
    await rejectsWithCode(provider(fetchImpl).generateStructured(request()), 'invalid_response');
    assert.equal(calls.length, 3, 'invalid output is retried, but bounded');
  });

  test('tool_use for a different tool or non-JSON body → invalid_response', async () => {
    const other = fakeFetch((_call, index) =>
      index === 0 ? json(200, { content: [{ type: 'tool_use', name: 'other_tool', input: {} }] }) : new Response('not json', { status: 200 }),
    );
    await rejectsWithCode(provider(other.fetchImpl).generateStructured(request()), 'invalid_response');
    assert.equal(other.calls.length, 3);
  });
});

describe('withRetries', () => {
  test('retries retryable errors up to the limit', async () => {
    let attempts = 0;
    await assert.rejects(
      withRetries(async () => {
        attempts += 1;
        throw new ProviderError('unavailable', 'x', true);
      }, { retries: 2, baseDelayMs: 1 }),
      ProviderError,
    );
    assert.equal(attempts, 3);
  });

  test('does not retry non-retryable errors or plain errors', async () => {
    let attempts = 0;
    await assert.rejects(withRetries(async () => {
      attempts += 1;
      throw new ProviderError('auth', 'x', false);
    }, { retries: 3, baseDelayMs: 1 }));
    await assert.rejects(withRetries(async () => {
      attempts += 1;
      throw new Error('boom');
    }, { retries: 3, baseDelayMs: 1 }));
    assert.equal(attempts, 2);
  });

  test('returns the first success and passes the attempt number', async () => {
    const seen: number[] = [];
    const value = await withRetries(async (attempt) => {
      seen.push(attempt);
      if (attempt < 1) throw new ProviderError('timeout', 'x', true);
      return 'ok';
    }, { retries: 3, baseDelayMs: 1 });
    assert.equal(value, 'ok');
    assert.deepEqual(seen, [0, 1]);
  });

  test('an already-aborted signal cancels before the first attempt', async () => {
    let attempts = 0;
    const error = await rejectsWithCode(withRetries(async () => {
      attempts += 1;
      return 1;
    }, { retries: 1, baseDelayMs: 1, signal: AbortSignal.abort() }), 'cancelled');
    assert.equal(error.retryable, false);
    assert.equal(attempts, 0);
  });
});
