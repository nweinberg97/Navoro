/**
 * Composition root: wires configuration, database, job worker, model provider,
 * routes and static assets into a node:http request listener.
 */
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT_DIR, type AppConfig } from './config/env.ts';
import { Database } from './db/database.ts';
import { Accounts } from './data/accounts.ts';
import { tenant } from './data/tenant.ts';
import { JobRunner } from './jobs/runner.ts';
import { ingestHandler, refreshHandler } from './jobs/handlers.ts';
import { AnthropicProvider } from './ai/anthropic.ts';
import type { ModelProvider } from './ai/provider.ts';
import { clientIp, HttpError, Router, sendError, sendJson, type RequestContext } from './http/http.ts';
import { baseSecurityHeaders, dashboardCsp, htmlShell, sendHtml, serveFile } from './http/static.ts';
import { createLimits, type ServerContext } from './api/context.ts';
import { registerAuthRoutes } from './api/auth.ts';
import { registerApplicationRoutes } from './api/admin-apps.ts';
import { registerKnowledgeRoutes } from './api/admin-knowledge.ts';
import { registerGuidanceRoutes } from './api/admin-guidance.ts';
import { registerInsightRoutes } from './api/admin-insights.ts';
import { handleSdkPreflight, registerSdkRoutes, sdkErrorHeaders } from './api/sdk.ts';
import { log } from './lib/log.ts';

const DIST = path.join(ROOT_DIR, 'dist');
const PUBLIC = path.join(ROOT_DIR, 'web', 'public');

export interface NavoroApp {
  context: ServerContext;
  listener: (req: IncomingMessage, res: ServerResponse) => void;
  listen(): Promise<http.Server>;
  close(): Promise<void>;
}

export function createProvider(config: AppConfig): ModelProvider | null {
  if (!config.anthropicApiKey) return null;
  return new AnthropicProvider({ apiKey: config.anthropicApiKey, model: config.anthropicModel, baseUrl: config.anthropicBaseUrl });
}

export function createNavoroApp(config: AppConfig, options: { provider?: ModelProvider | null; startWorker?: boolean } = {}): NavoroApp {
  const db = new Database(config.databasePath);
  db.migrate();
  const runner = new JobRunner(db);
  const deps = { allowPrivateUrls: config.allowPrivateUrls };
  runner.register('ingest', ingestHandler(db, deps));
  runner.register('refresh', refreshHandler(db, deps));

  const context: ServerContext = {
    config,
    db,
    accounts: new Accounts(db),
    runner,
    provider: options.provider === undefined ? createProvider(config) : options.provider,
    limits: createLimits(),
  };

  const router = new Router();
  registerAuthRoutes(router, context);
  registerApplicationRoutes(router, context);
  registerKnowledgeRoutes(router, context);
  registerGuidanceRoutes(router, context);
  registerInsightRoutes(router, context);
  registerSdkRoutes(router, context);
  router.get('/api/health', (ctx) => sendJson(ctx.res, 200, { ok: true, mode: context.provider ? 'llm' : 'demo' }));

  const siteHtml = htmlShell({ title: 'navoro — Less searching. More doing.', description: 'Navoro brings answers to the exact place in your product where users need them.', script: '/assets/web/site.js', style: '/assets/web/site.css' });
  const appHtml = htmlShell({ title: 'navoro', description: 'Navoro workspace', script: '/assets/web/app.js', style: '/assets/web/app.css', bodyClass: 'app-body' });
  const csp = dashboardCsp();

  function serveStatic(ctx: RequestContext): boolean {
    const pathname = ctx.url.pathname;
    if (pathname.startsWith('/assets/web/')) {
      return serveFile(ctx.res, path.join(DIST, 'web'), pathname.slice('/assets/web/'.length), {}, config.nodeEnv === 'production' ? 'public, max-age=300' : 'no-cache');
    }
    if (pathname === '/sdk/v1/navoro.js' || pathname === '/sdk/v1/navoro.js.map') {
      // The SDK bundle is public and embeddable from any origin; API calls are what's origin-checked.
      return serveFile(ctx.res, path.join(DIST, 'sdk'), path.basename(pathname), { 'access-control-allow-origin': '*', 'cross-origin-resource-policy': 'cross-origin' }, 'public, max-age=300');
    }
    if (pathname.startsWith('/brand/')) return serveFile(ctx.res, PUBLIC, pathname.slice('/brand/'.length), { 'cross-origin-resource-policy': 'cross-origin' }, 'public, max-age=3600');
    if (pathname === '/favicon.ico') return serveFile(ctx.res, PUBLIC, 'navoro-mark.svg', { 'content-type': 'image/svg+xml' }, 'public, max-age=3600');
    return false;
  }

  function servePage(ctx: RequestContext): boolean {
    if (ctx.method !== 'GET' && ctx.method !== 'HEAD') return false;
    const pathname = ctx.url.pathname;
    const isApp = pathname === '/login' || pathname === '/signup' || pathname === '/app' || pathname.startsWith('/app/');
    if (pathname !== '/' && !isApp) return false;
    if (!existsSync(path.join(DIST, 'web', isApp ? 'app.js' : 'site.js'))) {
      ctx.res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
      ctx.res.end('Navoro front-end bundles are missing. Run "npm run build" (or "npm run dev") first.');
      return true;
    }
    sendHtml(ctx.res, isApp ? appHtml : siteHtml, csp);
    return true;
  }

  const listener = (req: IncomingMessage, res: ServerResponse): void => {
    const started = Date.now();
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://navoro.local');
    } catch {
      res.writeHead(400).end();
      return;
    }
    const ctx: RequestContext = { req, res, url, method: req.method ?? 'GET', params: {}, requestId: randomUUID(), ip: clientIp(req) };
    res.on('finish', () => {
      if (url.pathname.startsWith('/api/')) log('info', 'http', { id: ctx.requestId, method: ctx.method, path: url.pathname, status: res.statusCode, ms: Date.now() - started });
    });

    void (async () => {
      try {
        if (handleSdkPreflight(context, ctx)) return;
        if (url.pathname.startsWith('/api/')) {
          const match = router.match(ctx.method, url.pathname);
          if (match === null) throw new HttpError(404, 'not_found', 'No such endpoint.');
          if (match === 'method_not_allowed') throw new HttpError(405, 'method_not_allowed', 'Method not allowed.');
          ctx.params = match.params;
          await match.handler(ctx);
          return;
        }
        if (serveStatic(ctx) || servePage(ctx)) return;
        res.writeHead(404, { ...baseSecurityHeaders(), 'content-type': 'text/plain; charset=utf-8' });
        res.end('Not found');
      } catch (error) {
        if (error instanceof HttpError) {
          if (!res.headersSent) {
            for (const [key, value] of Object.entries(sdkErrorHeaders(context, ctx))) res.setHeader(key, value);
          }
          sendError(res, error);
          return;
        }
        log('error', 'http.unhandled', { id: ctx.requestId, path: url.pathname, error: (error as Error).message, stack: (error as Error).stack?.split('\n').slice(0, 4).join(' | ') });
        if (!res.headersSent) sendError(res, new HttpError(500, 'internal', `Something went wrong on our side (ref ${ctx.requestId.slice(0, 8)}).`));
        else res.end();
      }
    })();
  };

  let server: http.Server | null = null;
  let sweeper: NodeJS.Timeout | null = null;

  return {
    context,
    listener,
    async listen() {
      server = http.createServer(listener);
      server.headersTimeout = 20_000;
      server.requestTimeout = 60_000;
      if (options.startWorker !== false) runner.start();
      sweeper = setInterval(() => {
        const orgs = db.all<{ id: string }>('SELECT id FROM organizations');
        for (const org of orgs) tenant(db, org.id).activity.sweepRetention();
        context.accounts.deleteExpiredSessions();
      }, 60 * 60 * 1000);
      sweeper.unref();
      await new Promise<void>((resolve) => server?.listen(config.port, config.host, resolve));
      return server;
    },
    async close() {
      runner.stop();
      if (sweeper) clearInterval(sweeper);
      if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
      db.close();
    },
  };
}
