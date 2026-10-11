/** Admin API: applications, environments, publishing, approved metadata, Training Mode, privacy. */
import { badRequest, notFound, readJson, sendJson, type Router } from '../http/http.ts';
import { v } from '../lib/validate.ts';
import { normalizeOrigin } from '../security/origins.ts';
import { requireApp, requireRole, requireSession, type ServerContext } from './context.ts';
import { BUILT_IN_EXCLUSIONS, publish, PublishError } from '../services/publishing.ts';
import { ENVIRONMENTS } from '../data/applications.ts';
import { ALL_CATEGORIES, type ApplicationRow, type StoredPrivacyPolicy } from '../data/types.ts';
import { newId, now, parseJson } from '../db/database.ts';
import type { Tenant } from '../data/tenant.ts';
import type { ApplicationDetail, PrivacyPolicyDTO } from '../../packages/contracts/src/admin-types.ts';
import type { EnvironmentName } from '../../packages/contracts/src/sdk-types.ts';

const originList = v.refine(v.array(v.string({ min: 1, max: 200 }), { max: 20 }), (origins) => {
  const bad = origins.find((origin) => !normalizeOrigin(origin));
  return bad ? `"${bad}" is not a valid origin. Use scheme://host[:port] with no path, e.g. https://app.example.com` : null;
});

const createSchema = v.object({ name: v.string({ min: 1, max: 80 }), developmentOrigins: originList, productionOrigins: originList });
const updateSchema = v.object({
  name: v.optional(v.string({ min: 1, max: 80 })),
  supportUrl: v.optional(v.nullable(v.string({ max: 300, pattern: /^https?:\/\/\S+$/, patternMessage: 'Must be an http(s) URL' }))),
  greeting: v.optional(v.string({ min: 1, max: 200 })),
  suggestions: v.optional(v.array(v.string({ min: 1, max: 80 }), { max: 4 })),
});
const envSchema = v.object({ allowedOrigins: originList });
const publishSchema = v.object({ environment: v.oneOf(['development', 'production'] as const), notes: v.optional(v.string({ max: 300 })) });
const catalogPatchSchema = v.object({ approved: v.boolean() });
const navoroIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const catalogImportSchema = v.object({
  elements: v.array(
    v.object({
      navoroId: v.string({ min: 1, max: 100, pattern: navoroIdPattern, patternMessage: 'Use letters, numbers, dots, dashes, colons or underscores' }),
      label: v.optional(v.string({ max: 120 })),
      role: v.optional(v.string({ max: 40 })),
      route: v.optional(v.string({ max: 200 })),
    }),
    { min: 1, max: 500 },
  ),
});

const category = v.oneOf(ALL_CATEGORIES as unknown as readonly ['route', 'pageTitle', 'headings', 'elements', 'fieldLabels', 'visibleErrors']);
const selectorPattern = /^[^{}<>;@\\]+$/;
const privacySchema = v.object({
  observe: v.array(category, { max: 6, unique: true }),
  transmit: v.array(category, { max: 6, unique: true }),
  neverCollect: v.array(
    v.object({
      kind: v.oneOf(['navoro_id', 'selector'] as const),
      value: v.string({ min: 1, max: 200 }),
      label: v.string({ min: 1, max: 120 }),
    }),
    { max: 200 },
  ),
  retainQuestions: v.boolean(),
  retentionDays: v.number({ min: 1, max: 365, integer: true }),
  analyticsEnabled: v.boolean(),
  discoveryInDevelopment: v.boolean(),
  environments: v.array(v.oneOf(['development', 'production'] as const), { min: 1, max: 2, unique: true }),
});

export function installSnippet(apiOrigin: string, publicKey: string, environment: EnvironmentName = 'production'): string {
  return `<script src="${apiOrigin}/sdk/v1/navoro.js"\n        data-navoro-key="${publicKey}"\n        data-navoro-env="${environment}"\n        defer></script>`;
}

function detail(server: ServerContext, t: Tenant, app: ApplicationRow): ApplicationDetail {
  return {
    ...t.apps.summary(app),
    supportUrl: app.support_url,
    greeting: app.greeting,
    suggestions: parseJson<string[]>(app.suggestions, []),
    configVersions: t.apps.configVersions(app.id),
    installSnippet: installSnippet(server.config.publicOrigin, app.public_key),
    apiOrigin: server.config.publicOrigin,
  };
}

export function privacyDTO(t: Tenant, appId: string): PrivacyPolicyDTO {
  const draft = t.privacy.draft(appId);
  if (!draft) throw notFound('Application not found.');
  const published = ENVIRONMENTS.map((env) => t.apps.activeSnapshot(appId, env)).filter((entry) => entry !== null);
  // Unpublished when nothing is live yet, or when any live environment runs a different policy than the draft.
  const unpublishedChanges = published.length === 0 || published.some((entry) => JSON.stringify(entry.snapshot.privacy) !== JSON.stringify(draft.policy));
  return { ...draft.policy, updatedAt: draft.updatedAt, builtInExclusions: BUILT_IN_EXCLUSIONS, unpublishedChanges };
}

export function registerApplicationRoutes(router: Router, server: ServerContext): void {
  router.get('/api/admin/applications', (ctx) => {
    const { t } = requireSession(server, ctx);
    sendJson(ctx.res, 200, { applications: t.apps.list().map((app) => t.apps.summary(app)) });
  });

  router.post('/api/admin/applications', async (ctx) => {
    const request = requireSession(server, ctx);
    requireRole(request, 'admin');
    const body = await readJson(ctx, createSchema);
    const normalize = (list: string[]) => [...new Set(list.map((origin) => normalizeOrigin(origin)).filter((origin): origin is string => Boolean(origin)))];
    const appId = request.t.apps.create({ name: body.name, developmentOrigins: normalize(body.developmentOrigins), productionOrigins: normalize(body.productionOrigins) });
    request.t.activity.audit({ actorUserId: request.session.userId, action: 'application.created', targetType: 'application', targetId: appId, summary: `Registered application ${body.name}` });
    const app = requireApp(request, appId);
    sendJson(ctx.res, 201, detail(server, request.t, app));
  });

  router.get('/api/admin/applications/:id', (ctx) => {
    const request = requireSession(server, ctx);
    sendJson(ctx.res, 200, detail(server, request.t, requireApp(request, ctx.params.id)));
  });

  router.patch('/api/admin/applications/:id', async (ctx) => {
    const request = requireSession(server, ctx);
    requireRole(request, 'admin');
    const app = requireApp(request, ctx.params.id);
    const body = await readJson(ctx, updateSchema);
    request.t.apps.update(app.id, body);
    request.t.activity.audit({ actorUserId: request.session.userId, action: 'application.updated', targetType: 'application', targetId: app.id, summary: `Updated settings for ${body.name ?? app.name}` });
    sendJson(ctx.res, 200, detail(server, request.t, requireApp(request, app.id)));
  });

  router.put('/api/admin/applications/:id/environments/:env', async (ctx) => {
    const request = requireSession(server, ctx);
    requireRole(request, 'admin');
    const app = requireApp(request, ctx.params.id);
    const env = ctx.params.env as EnvironmentName;
    if (!ENVIRONMENTS.includes(env)) throw notFound('Unknown environment.');
    const body = await readJson(ctx, envSchema);
    const origins = [...new Set(body.allowedOrigins.map((origin) => normalizeOrigin(origin)).filter((origin): origin is string => Boolean(origin)))];
    request.t.apps.setOrigins(app.id, env, origins);
    request.t.activity.audit({ actorUserId: request.session.userId, action: 'environment.origins_updated', targetType: 'application', targetId: app.id, summary: `Set ${env} origins: ${origins.join(', ') || '(none)'}` });
    sendJson(ctx.res, 200, detail(server, request.t, app));
  });

  router.post('/api/admin/applications/:id/publish', async (ctx) => {
    const request = requireSession(server, ctx);
    requireRole(request, 'admin');
    const app = requireApp(request, ctx.params.id);
    const body = await readJson(ctx, publishSchema);
    try {
      publish(request.t, app, body.environment, body.notes?.trim() || null, request.session.userId);
    } catch (error) {
      if (error instanceof PublishError) throw badRequest(error.message);
      throw error;
    }
    const version = request.t.apps.configVersions(app.id)[0];
    sendJson(ctx.res, 201, version);
  });

  router.get('/api/admin/applications/:id/catalog', (ctx) => {
    const request = requireSession(server, ctx);
    const app = requireApp(request, ctx.params.id);
    sendJson(ctx.res, 200, { elements: request.t.apps.catalog(app.id).map((row) => request.t.apps.catalogDTO(row)) });
  });

  router.patch('/api/admin/applications/:id/catalog/:elementId', async (ctx) => {
    const request = requireSession(server, ctx);
    requireRole(request, 'admin');
    const app = requireApp(request, ctx.params.id);
    const body = await readJson(ctx, catalogPatchSchema);
    const element = request.t.apps.catalogElement(app.id, ctx.params.elementId ?? '');
    if (!element) throw notFound('Element not found.');
    request.t.apps.setCatalogApproved(app.id, element.id, body.approved);
    request.t.activity.audit({ actorUserId: request.session.userId, action: body.approved ? 'metadata.approved' : 'metadata.unapproved', targetType: 'element', targetId: element.id, summary: `${body.approved ? 'Approved' : 'Unapproved'} ${element.navoro_id}` });
    const updated = request.t.apps.catalogElement(app.id, element.id);
    sendJson(ctx.res, 200, updated ? request.t.apps.catalogDTO(updated) : null);
  });

  router.post('/api/admin/applications/:id/catalog', async (ctx) => {
    const request = requireSession(server, ctx);
    requireRole(request, 'admin');
    const app = requireApp(request, ctx.params.id);
    const body = await readJson(ctx, catalogImportSchema, 512 * 1024);
    const count = request.t.apps.upsertCatalog(
      app.id,
      body.elements.map((element) => ({ navoroId: element.navoroId, label: element.label ?? null, role: element.role ?? null, route: element.route ?? null })),
      'manual',
    );
    request.t.activity.audit({ actorUserId: request.session.userId, action: 'metadata.imported', targetType: 'application', targetId: app.id, summary: `Imported ${count} approved element(s)` });
    sendJson(ctx.res, 200, { elements: request.t.apps.catalog(app.id).map((row) => request.t.apps.catalogDTO(row)) });
  });

  router.get('/api/admin/applications/:id/blueprints', (ctx) => {
    const request = requireSession(server, ctx);
    const app = requireApp(request, ctx.params.id);
    sendJson(ctx.res, 200, { blueprints: request.t.apps.blueprints(app.id) });
  });

  router.get('/api/admin/applications/:id/privacy', (ctx) => {
    const request = requireSession(server, ctx);
    const app = requireApp(request, ctx.params.id);
    sendJson(ctx.res, 200, privacyDTO(request.t, app.id));
  });

  router.put('/api/admin/applications/:id/privacy', async (ctx) => {
    const request = requireSession(server, ctx);
    requireRole(request, 'admin');
    const app = requireApp(request, ctx.params.id);
    const body = await readJson(ctx, privacySchema);
    const invalidTransmit = body.transmit.filter((entry) => !body.observe.includes(entry));
    if (invalidTransmit.length) throw badRequest(`Can't send categories that aren't observed: ${invalidTransmit.join(', ')}`);
    for (const rule of body.neverCollect) {
      if (rule.kind === 'navoro_id' && !navoroIdPattern.test(rule.value)) throw badRequest(`"${rule.value}" is not a valid data-navoro-id.`);
      if (rule.kind === 'selector' && !selectorPattern.test(rule.value)) throw badRequest(`"${rule.value}" is not an allowed CSS selector.`);
    }
    const previous = request.t.privacy.draft(app.id)?.policy;
    const existingRules = new Map((previous?.neverCollect ?? []).map((rule) => [`${rule.kind}:${rule.value}`, rule]));
    const seen = new Set<string>();
    const policy: StoredPrivacyPolicy = {
      observe: body.observe,
      transmit: body.transmit,
      neverCollect: body.neverCollect
        .filter((rule) => {
          const key = `${rule.kind}:${rule.value}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((rule) => existingRules.get(`${rule.kind}:${rule.value}`) ?? { id: newId('rule'), kind: rule.kind, value: rule.value, label: rule.label, createdAt: now() }),
      retainQuestions: body.retainQuestions,
      retentionDays: body.retentionDays,
      analyticsEnabled: body.analyticsEnabled,
      discoveryInDevelopment: body.discoveryInDevelopment,
      environments: body.environments,
    };
    request.t.privacy.save(app.id, policy);
    request.t.activity.audit({
      actorUserId: request.session.userId,
      action: 'privacy.updated',
      targetType: 'application',
      targetId: app.id,
      summary: `Saved privacy draft: ${policy.neverCollect.length} never-collect rule(s), sends ${policy.transmit.join(', ') || 'nothing'}`,
    });
    sendJson(ctx.res, 200, privacyDTO(request.t, app.id));
  });

}
