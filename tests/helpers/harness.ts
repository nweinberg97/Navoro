/**
 * Test harness: boots a real Navoro server (real SQLite database in a temp dir,
 * real router, real job worker) on an ephemeral port and provides small HTTP
 * clients for the admin API (cookie + CSRF) and the SDK API (Origin + token).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { loadConfig, type AppConfig } from '../../server/config/env.ts';
import { createNavoroApp, type NavoroApp } from '../../server/app.ts';
import type { ModelProvider } from '../../server/ai/provider.ts';
import { setQuiet } from '../../server/lib/log.ts';

setQuiet(true);

export interface Harness {
  app: NavoroApp;
  baseUrl: string;
  config: AppConfig;
  close(): Promise<void>;
}

export async function startHarness(options: { provider?: ModelProvider | null; config?: Partial<AppConfig> } = {}): Promise<Harness> {
  const dir = mkdtempSync(path.join(tmpdir(), 'navoro-test-'));
  const config = loadConfig({
    nodeEnv: 'test',
    port: 0,
    host: '127.0.0.1',
    databasePath: path.join(dir, 'test.db'),
    sessionSecret: 'test-secret-test-secret-test-secret-0123',
    anthropicApiKey: null,
    serveDemo: false,
    ...options.config,
  });
  const app = createNavoroApp(config, { provider: options.provider ?? null });
  const server = await app.listen();
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  app.context.config.publicOrigin = baseUrl;
  return {
    app,
    baseUrl,
    config,
    async close() {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export interface JsonResponse<T = any> {
  status: number;
  body: T;
  headers: Headers;
}

/** Admin client that keeps the session cookie and CSRF token like the dashboard does. */
export class AdminClient {
  cookie = '';
  csrf = '';
  readonly baseUrl: string;
  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async request<T = any>(method: string, pathname: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<JsonResponse<T>> {
    const headers: Record<string, string> = { ...extraHeaders };
    if (this.cookie) headers.cookie = this.cookie;
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (method !== 'GET' && this.csrf && !('x-navoro-csrf' in extraHeaders)) headers['x-navoro-csrf'] = this.csrf;
    const response = await fetch(`${this.baseUrl}${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0] ?? '';
    const text = await response.text();
    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    if (parsed && typeof parsed === 'object' && typeof parsed.csrfToken === 'string') this.csrf = parsed.csrfToken;
    return { status: response.status, body: parsed as T, headers: response.headers };
  }

  get<T = any>(pathname: string) { return this.request<T>('GET', pathname); }
  post<T = any>(pathname: string, body: unknown = {}) { return this.request<T>('POST', pathname, body); }
  put<T = any>(pathname: string, body: unknown) { return this.request<T>('PUT', pathname, body); }
  patch<T = any>(pathname: string, body: unknown) { return this.request<T>('PATCH', pathname, body); }
  delete<T = any>(pathname: string) { return this.request<T>('DELETE', pathname); }

  async signup(email: string, organizationName = 'Test Org', password = 'correct-horse-battery'): Promise<this> {
    const result = await this.post('/api/auth/signup', { name: 'Test Admin', email, password, organizationName });
    if (result.status !== 201) throw new Error(`signup failed: ${result.status} ${JSON.stringify(result.body)}`);
    return this;
  }
}

/** SDK client that behaves like a browser page on `origin`. */
export class SdkClient {
  token = '';
  readonly baseUrl: string;
  readonly origin: string;
  constructor(baseUrl: string, origin: string) {
    this.baseUrl = baseUrl;
    this.origin = origin;
  }

  async init(publicKey: string, environment: 'development' | 'production' = 'development'): Promise<JsonResponse> {
    const response = await fetch(`${this.baseUrl}/api/sdk/v1/init`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: this.origin },
      body: JSON.stringify({ publicKey, environment, sdkVersion: '0.1.0' }),
    });
    const body = await response.json().catch(() => null);
    if (response.ok) this.token = body.sessionToken;
    return { status: response.status, body, headers: response.headers };
  }

  async post(pathname: string, body: unknown): Promise<Response> {
    return fetch(`${this.baseUrl}/api/sdk/v1/${pathname}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: this.origin, authorization: `Bearer ${this.token}` },
      body: JSON.stringify(body),
    });
  }

  /** Asks a question and returns the parsed NDJSON events. */
  async ask(question: string, context: Record<string, unknown> = {}, sessionId?: string): Promise<{ status: number; events: any[]; result: any }> {
    const response = await this.post('guidance', { question, context, requestId: `r-${Math.random().toString(36).slice(2)}`, ...(sessionId ? { sessionId } : {}) });
    const text = await response.text();
    const events = text.split('\n').filter(Boolean).map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { raw: line };
      }
    });
    return { status: response.status, events, result: events.find((event) => event.type === 'result')?.result ?? null };
  }
}

export const SAMPLE_DOC = `# Acme Help

## Feature: Projects

Projects group tasks for a team.

## How to create a project

Prerequisites: Admin role.

1. Open **Projects** from the sidebar.
2. Click **New project**.
3. Enter a **Project name**.
4. Click **Save project**.

## Troubleshooting: Project name is required (PROJECT_NAME_REQUIRED)

This appears when you click **Save project** with an empty name.

Resolution: Type a name into **Project name** and save again.

## Glossary

- **Project name** — The label shown to everyone in the workspace.
`;

/** Polls until `check` returns a truthy value or the timeout elapses. */
export async function waitFor<T>(check: () => Promise<T | null | undefined | false>, timeoutMs = 10_000, intervalMs = 50): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - started > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
