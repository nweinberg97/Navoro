/**
 * Public SDK API, version 1 (see packages/contracts/src/sdk-types.ts).
 *
 * Trust model: the public key only identifies an application — it is not a
 * secret. Every request's Origin must be registered for the requested
 * environment; /init then issues a short-lived HMAC token bound to app,
 * environment and origin, which the other endpoints require. CORS headers are
 * emitted only for registered origins, but enforcement happens server-side.
 * These endpoints can never reach admin data or mutate configuration.
 */
import type { ServerResponse } from 'node:http';
import { HttpError, readJson, sendJson, type RequestContext, type Router } from '../http/http.ts';
import { v } from '../lib/validate.ts';
import type { ServerContext } from './context.ts';
import { ENVIRONMENTS, findApplicationByPublicKey, isOriginRegisteredAnywhere } from '../data/applications.ts';
import { tenant, type Tenant } from '../data/tenant.ts';
import { isOriginAllowed, normalizeOrigin } from '../security/origins.ts';
import { signSdkToken, verifySdkToken, type SdkTokenClaims } from '../security/crypto.ts';
import { activeSnapshot, publicConfig } from '../services/publishing.ts';
import { generateGuidance } from '../services/guidance.ts';
import { ProviderError } from '../ai/provider.ts';
import { parseJson } from '../db/database.ts';
import { log } from '../lib/log.ts';
import type { ApplicationRow } from '../data/types.ts';
import type { EnvironmentName, GuidanceStreamEvent, SdkInitResponse } from '../../packages/contracts/src/sdk-types.ts';
import { SDK_API_VERSION } from '../../packages/contracts/src/sdk-types.ts';

const TOKEN_TTL_SECONDS = 15 * 60;
const env = v.oneOf(['development', 'production'] as const);
const short = (max: number) => v.string({ max });
const nullableShort = (max: number) => v.nullable(v.string({ max }));

const initSchema = v.object({ publicKey: v.string({ min: 8, max: 80, pattern: /^nav_pk_[A-Za-z0-9_]+$/, patternMessage: 'Invalid public key' }), environment: env, sdkVersion: v.string({ min: 1, max: 20 }) });

const contextSchema = v.object({
  route: v.optional(short(300)),
  pageTitle: v.optional(short(200)),
  headings: v.optional(v.array(short(200), { max: 10 })),
  elements: v.optional(
    v.array(
      v.object({ navoroId: v.string({ min: 1, max: 100 }), role: nullableShort(40), label: nullableShort(200), disabled: v.boolean(), invalid: v.boolean() }),
      { max: 80 },
    ),
  ),
  fieldLabels: v.optional(v.array(short(200), { max: 40 })),
  visibleErrors: v.optional(v.array(v.object({ code: nullableShort(80), message: nullableShort(300), nearNavoroId: nullableShort(100) }), { max: 10 })),
});

const guidanceSchema = v.object({
  question: v.string({ min: 1, max: 500 }),
  context: contextSchema,
  requestId: v.string({ min: 1, max: 80 }),
  sessionId: v.optional(v.string({ min: 1, max: 80 })),
});

const eventSchema = v.object({
  events: v.array(
    v.object({
      type: v.oneOf([
        'launcher_opened', 'guidance_shown', 'step_viewed', 'step_target_missing', 'workflow_completed',
        'guidance_dismissed', 'request_cancelled', 'feedback_helpful', 'feedback_not_helpful',
      ] as const),
      sessionId: v.optional(short(80)),
      workflowId: v.optional(short(80)),
      stepIndex: v.optional(v.number({ min: 0, max: 200, integer: true })),
      mappingKey: v.optional(short(80)),
    }),
    { max: 50 },
  ),
});

const discoverySchema = v.object({
  route: v.string({ min: 1, max: 300 }),
  viewport: v.object({ width: v.number({ min: 0, max: 20000 }), height: v.number({ min: 0, max: 20000 }) }),
  documentHeight: v.number({ min: 0, max: 200000 }),
  elements: v.array(
    v.object({
      navoroId: v.string({ min: 1, max: 100, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/ }),
      role: nullableShort(40),
      label: nullableShort(200),
      tag: v.string({ min: 1, max: 20 }),
      inputType: nullableShort(30),
      rect: v.object({ x: v.number(), y: v.number(), width: v.number({ min: 0 }), height: v.number({ min: 0 }) }),
    }),
    { max: 300 },
  ),
});

function corsHeaders(origin: string): Record<string, string> {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}

function allowedOriginsFor(t: Tenant, appId: string, environment: EnvironmentName): string[] {
  const row = t.apps.environment(appId, environment);
  return row ? parseJson<string[]>(row.allowed_origins, []) : [];
}

interface Authorized {
  claims: SdkTokenClaims;
  t: Tenant;
  app: ApplicationRow;
  origin: string;
}

function authorize(server: ServerContext, ctx: RequestContext): Authorized {
  const origin = ctx.req.headers.origin;
  const header = ctx.req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const claims = token ? verifySdkToken(token, server.config.sessionSecret) : null;
  if (!claims) throw new HttpError(401, 'unauthorized', 'SDK session expired. Re-initialize.');
  if (!origin || normalizeOrigin(origin) !== claims.origin) throw new HttpError(403, 'origin_not_allowed', 'Origin does not match the SDK session.');
  const t = tenant(server.db, claims.org);
  const app = t.apps.get(claims.app);
  if (!app) throw new HttpError(401, 'unauthorized', 'Application no longer exists.');
  // Re-check the origin is still registered (it may have been removed since the token was issued).
  if (!isOriginAllowed(origin, allowedOriginsFor(t, app.id, claims.env))) throw new HttpError(403, 'origin_not_allowed', 'Origin is no longer registered.');
  return { claims, t, app, origin: claims.origin };
}

function writeEvent(res: ServerResponse, event: GuidanceStreamEvent): void {
  if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
}

/** Returns true when the request was a handled CORS preflight. */
export function handleSdkPreflight(server: ServerContext, ctx: RequestContext): boolean {
  if (ctx.method !== 'OPTIONS' || !ctx.url.pathname.startsWith('/api/sdk/')) return false;
  const origin = ctx.req.headers.origin;
  const normalized = origin ? normalizeOrigin(origin) : null;
  // Preflight can't identify the application, so allow any origin registered for some application.
  const known = normalized ? isOriginRegisteredAnywhere(server.db, normalized) : false;
  ctx.res.writeHead(known && normalized ? 204 : 403, known && normalized ? corsHeaders(normalized) : {});
  ctx.res.end();
  return true;
}

export function registerSdkRoutes(router: Router, server: ServerContext): void {
  router.post('/api/sdk/v1/init', async (ctx) => {
    if (server.limits.sdkInit.take(`init:${ctx.ip}`)) throw new HttpError(429, 'rate_limited', 'Too many requests.');
    const body = await readJson(ctx, initSchema, 4 * 1024);
    const origin = ctx.req.headers.origin;
    const app = findApplicationByPublicKey(server.db, body.publicKey);
    // Same answer for unknown keys and wrong origins: no key-existence oracle.
    if (!app || !origin) throw new HttpError(403, 'origin_not_allowed', 'This origin is not registered for the application.');
    const t = tenant(server.db, app.org_id);
    if (!isOriginAllowed(origin, allowedOriginsFor(t, app.id, body.environment))) {
      log('warn', 'sdk.origin_rejected', { app: app.id, env: body.environment, origin: normalizeOrigin(origin) ?? 'invalid' });
      throw new HttpError(403, 'origin_not_allowed', 'This origin is not registered for the application.');
    }
    const normalized = normalizeOrigin(origin) as string;
    const { version, snapshot } = activeSnapshot(t, app, body.environment);
    // The privacy policy's environment list is application-wide, but publishing to an environment the
    // policy excludes is refused — so the newest published policy (any environment) must also be honoured,
    // otherwise disabling production and publishing to development would leave production running.
    const newest = ENVIRONMENTS.map((name) => t.apps.activeSnapshot(app.id, name))
      .filter((entry) => entry !== null)
      .sort((a, b) => b.version - a.version)[0];
    const disabledByNewest = newest !== undefined && !newest.snapshot.privacy.environments.includes(body.environment);
    if ((version > 0 && !snapshot.privacy.environments.includes(body.environment)) || disabledByNewest) {
      throw new HttpError(403, 'environment_disabled', `Navoro is disabled for ${body.environment} by the workspace privacy policy.`);
    }
    const expiresAtSeconds = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
    const sessionToken = signSdkToken({ app: app.id, org: app.org_id, env: body.environment, origin: normalized, exp: expiresAtSeconds }, server.config.sessionSecret);
    t.apps.markSeen(app.id, body.environment, body.sdkVersion);
    const response: SdkInitResponse = {
      apiVersion: SDK_API_VERSION,
      sessionToken,
      expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
      config: publicConfig(app, body.environment, version, snapshot),
    };
    sendJson(ctx.res, 200, response, corsHeaders(normalized));
  });

  router.post('/api/sdk/v1/guidance', async (ctx) => {
    const auth = authorize(server, ctx);
    const cors = corsHeaders(auth.origin);
    if (server.limits.guidanceByApp.take(`app:${auth.app.id}`) || server.limits.guidanceByIp.take(`ip:${auth.app.id}:${ctx.ip}`)) {
      throw new HttpError(429, 'rate_limited', 'Too many questions in a short time. Try again in a moment.');
    }
    const body = await readJson(ctx, guidanceSchema, 64 * 1024);
    const { version, snapshot } = activeSnapshot(auth.t, auth.app, auth.claims.env);
    void version;

    const controller = new AbortController();
    ctx.res.on('close', () => {
      if (!ctx.res.writableFinished) controller.abort();
    });
    ctx.res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...cors });

    const useModel = server.provider && !server.limits.aiByOrg.take(`ai:${auth.t.orgId}`);
    const existingSession = body.sessionId ? auth.t.activity.session(body.sessionId, auth.app.id) : undefined;
    try {
      const output = await generateGuidance(
        auth.t,
        auth.app,
        snapshot,
        { question: body.question, context: body.context, requestId: body.requestId, sessionId: existingSession?.id ?? 'pending' },
        {
          provider: useModel ? server.provider : null,
          includeDrafts: false,
          signal: controller.signal,
          onPhase: (phase) => writeEvent(ctx.res, { type: 'status', phase }),
          onUsage: (usage) =>
            auth.t.activity.recordAiUsage({ appId: auth.app.id, purpose: 'guidance', provider: server.provider?.name ?? 'none', model: usage.model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, latencyMs: usage.latencyMs, ok: usage.ok, errorCode: usage.errorCode }),
        },
      );
      if (controller.signal.aborted) return;
      const sessionId = auth.t.activity.recordGuidance({
        appId: auth.app.id,
        environment: auth.claims.env,
        sessionId: existingSession?.id,
        kind: output.result.kind,
        outcome: output.result.kind === 'unresolved' ? 'unresolved' : 'answered',
        workflowId: output.result.workflow?.id ?? null,
        topic: output.topic,
        stepCount: output.result.steps.length,
        mode: output.result.mode,
      });
      auth.t.activity.recordQuestion({
        appId: auth.app.id,
        sessionId,
        // Question text is persisted only when the published policy opts in.
        text: snapshot.privacy.retainQuestions ? body.question.slice(0, 500) : null,
        topic: output.topic,
        grounded: output.result.grounded,
        confidence: output.result.confidence,
        retentionDays: snapshot.privacy.retentionDays,
      });
      if (snapshot.privacy.analyticsEnabled && output.errorCodes.length) auth.t.activity.recordErrorStates(auth.app.id, auth.claims.env, sessionId, output.errorCodes);
      writeEvent(ctx.res, { type: 'result', result: { ...output.result, sessionId } });
    } catch (error) {
      if (controller.signal.aborted || (error instanceof ProviderError && error.code === 'cancelled')) return;
      log('error', 'sdk.guidance_failed', { app: auth.app.id, error: (error as Error).message });
      writeEvent(ctx.res, { type: 'error', code: 'internal', message: 'Navoro hit a problem answering that. Please try again.', retryable: true });
    } finally {
      if (!ctx.res.writableEnded) ctx.res.end();
    }
  });

  router.post('/api/sdk/v1/events', async (ctx) => {
    const auth = authorize(server, ctx);
    if (server.limits.sdkEvents.take(`events:${auth.app.id}:${ctx.ip}`)) throw new HttpError(429, 'rate_limited', 'Too many events.');
    const body = await readJson(ctx, eventSchema, 32 * 1024);
    const { snapshot } = activeSnapshot(auth.t, auth.app, auth.claims.env);
    const accepted = snapshot.privacy.analyticsEnabled ? auth.t.activity.recordEvents(auth.app.id, auth.claims.env, body.events) : 0;
    sendJson(ctx.res, 200, { ok: true, accepted }, corsHeaders(auth.origin));
  });

  router.post('/api/sdk/v1/discovery', async (ctx) => {
    const auth = authorize(server, ctx);
    if (auth.claims.env !== 'development') throw new HttpError(403, 'forbidden', 'Discovery is only accepted from development environments.');
    const { snapshot } = activeSnapshot(auth.t, auth.app, auth.claims.env);
    if (!snapshot.privacy.discoveryInDevelopment) throw new HttpError(403, 'forbidden', 'Discovery is disabled by the privacy policy.');
    if (server.limits.sdkEvents.take(`discovery:${auth.app.id}:${ctx.ip}`, 5)) throw new HttpError(429, 'rate_limited', 'Too many requests.');
    const body = await readJson(ctx, discoverySchema, 256 * 1024);
    const blocked = new Set(snapshot.privacy.neverCollect.filter((rule) => rule.kind === 'navoro_id').map((rule) => rule.value));
    const route = body.route.slice(0, 300);
    const elements = body.elements.map((element) => ({
      ...element,
      // Labels of admin-blocked elements are never stored, even structurally.
      label: blocked.has(element.navoroId) ? null : element.label,
      rect: { x: Math.round(element.rect.x), y: Math.round(element.rect.y), width: Math.round(element.rect.width), height: Math.round(element.rect.height) },
    }));
    auth.t.apps.saveBlueprint(auth.app.id, { route, viewport: body.viewport, documentHeight: Math.round(body.documentHeight), elements });
    const accepted = auth.t.apps.upsertCatalog(
      auth.app.id,
      elements.map((element) => ({ navoroId: element.navoroId, label: element.label, role: element.role, route })),
      'sdk_discovery',
    );
    sendJson(ctx.res, 200, { ok: true, accepted }, corsHeaders(auth.origin));
  });
}

/** Ensures error responses on SDK routes still carry CORS headers for registered origins. */
export function sdkErrorHeaders(server: ServerContext, ctx: RequestContext): Record<string, string> {
  if (!ctx.url.pathname.startsWith('/api/sdk/')) return {};
  const origin = ctx.req.headers.origin;
  const normalized = origin ? normalizeOrigin(origin) : null;
  if (!normalized) return {};
  const known = isOriginRegisteredAnywhere(server.db, normalized);
  return known ? corsHeaders(normalized) : {};
}
