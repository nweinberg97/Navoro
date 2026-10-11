/**
 * Minimal HTTP toolkit on top of node:http: routing, body parsing with limits,
 * JSON responses, cookies, and a uniform error model. Kept small on purpose —
 * see docs/ARCHITECTURE.md for why Navoro has no web framework dependency.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Issue, Schema } from '../lib/validate.ts';

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, 'invalid_request', message, details);
export const unauthorized = (message = 'Sign in to continue.') => new HttpError(401, 'unauthorized', message);
export const forbidden = (message = 'You do not have permission to do that.') => new HttpError(403, 'forbidden', message);
export const notFound = (message = 'Not found.') => new HttpError(404, 'not_found', message);
export const conflict = (message: string) => new HttpError(409, 'conflict', message);

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  method: string;
  params: Record<string, string>;
  /** Unique id for log correlation. */
  requestId: string;
  ip: string;
}

export type Handler = (ctx: RequestContext) => Promise<void> | void;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

export class Router {
  #routes: Route[] = [];

  on(method: string, path: string, handler: Handler): this {
    const keys: string[] = [];
    const pattern = new RegExp(
      '^' +
        path.replace(/\//g, '\\/').replace(/:([a-zA-Z]+)/g, (_match, key: string) => {
          keys.push(key);
          return '([^/]+)';
        }) +
        '\\/?$',
    );
    this.#routes.push({ method, pattern, keys, handler });
    return this;
  }

  get(path: string, handler: Handler) { return this.on('GET', path, handler); }
  post(path: string, handler: Handler) { return this.on('POST', path, handler); }
  put(path: string, handler: Handler) { return this.on('PUT', path, handler); }
  patch(path: string, handler: Handler) { return this.on('PATCH', path, handler); }
  delete(path: string, handler: Handler) { return this.on('DELETE', path, handler); }

  match(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | 'method_not_allowed' | null {
    let pathMatched = false;
    for (const route of this.#routes) {
      const match = route.pattern.exec(pathname);
      if (!match) continue;
      pathMatched = true;
      if (route.method !== method) continue;
      const params: Record<string, string> = {};
      route.keys.forEach((key, index) => {
        params[key] = decodeURIComponent(match[index + 1] ?? '');
      });
      return { handler: route.handler, params };
    }
    return pathMatched ? 'method_not_allowed' : null;
  }
}

export async function readBody(req: IncomingMessage, limitBytes = 256 * 1024): Promise<string> {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > limitBytes) throw new HttpError(413, 'payload_too_large', `Request body exceeds ${Math.round(limitBytes / 1024)} KB.`);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > limitBytes) throw new HttpError(413, 'payload_too_large', `Request body exceeds ${Math.round(limitBytes / 1024)} KB.`);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function readJson<T>(ctx: RequestContext, schema: Schema<T>, limitBytes?: number): Promise<T> {
  const type = ctx.req.headers['content-type'] ?? '';
  if (!type.includes('application/json')) throw new HttpError(415, 'unsupported_media_type', 'Send JSON with Content-Type: application/json.');
  const text = await readBody(ctx.req, limitBytes);
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw badRequest('Request body is not valid JSON.');
  }
  const result = schema.parse(data);
  if (!result.ok) throw badRequest(formatIssues(result.issues), { issues: result.issues });
  return result.value;
}

export function formatIssues(issues: Issue[]): string {
  const first = issues[0];
  if (!first) return 'Invalid request.';
  const more = issues.length > 1 ? ` (+${issues.length - 1} more)` : '';
  return `${first.path}: ${first.message}${more}`;
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  if (res.headersSent) return;
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload).toString(),
    ...headers,
  });
  res.end(payload);
}

export function sendError(res: ServerResponse, error: HttpError): void {
  sendJson(res, error.status, { error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } });
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) {
      try {
        cookies[key] = decodeURIComponent(value);
      } catch {
        cookies[key] = value;
      }
    }
  }
  return cookies;
}

export function serializeCookie(
  name: string,
  value: string,
  options: { maxAgeSeconds?: number; secure: boolean; httpOnly?: boolean; path?: string },
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path ?? '/'}`, 'SameSite=Lax'];
  if (options.httpOnly !== false) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  if (options.maxAgeSeconds !== undefined) parts.push(`Max-Age=${options.maxAgeSeconds}`);
  return parts.join('; ');
}

export function clientIp(req: IncomingMessage): string {
  return req.socket.remoteAddress ?? 'unknown';
}
