/** Admin API: workflows, steps, element mappings, knowledge items and guidance preview. */
import { badRequest, HttpError, notFound, readJson, sendJson, type Router } from '../http/http.ts';
import { v } from '../lib/validate.ts';
import { requireApp, requireRole, requireSession, type ServerContext } from './context.ts';
import { revalidateMapping, strategiesFromAdmin } from '../knowledge/mapping.ts';
import { buildSnapshot } from '../services/publishing.ts';
import { generateGuidance } from '../services/guidance.ts';
import { newId } from '../db/database.ts';
import type { WorkflowStatus } from '../../packages/contracts/src/admin-types.ts';
import type { SanitizedContext } from '../../packages/contracts/src/sdk-types.ts';

const ALLOWED_TRANSITIONS: Record<WorkflowStatus, WorkflowStatus[]> = {
  draft: ['published', 'archived'],
  needs_review: ['published', 'draft', 'archived'],
  published: ['draft', 'archived'],
  archived: ['draft'],
};

const workflowPatch = v.object({
  title: v.optional(v.string({ min: 1, max: 120 })),
  summary: v.optional(v.string({ max: 600 })),
  kind: v.optional(v.oneOf(['task', 'onboarding', 'troubleshooting'] as const)),
  status: v.optional(v.oneOf(['draft', 'published', 'needs_review', 'archived'] as const)),
});

const stepPatch = v.object({
  title: v.optional(v.string({ min: 1, max: 120 })),
  instruction: v.optional(v.string({ min: 1, max: 600 })),
  targetKey: v.optional(v.nullable(v.string({ min: 1, max: 80 }))),
});

const navoroIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const mappingSchema = v.object({
  label: v.string({ min: 1, max: 80 }),
  navoroId: v.optional(v.string({ max: 100 })),
  ariaLabel: v.optional(v.string({ max: 120 })),
  text: v.optional(v.string({ max: 120 })),
  role: v.optional(v.string({ max: 40 })),
});

const previewSchema = v.object({ question: v.string({ min: 2, max: 500 }), route: v.optional(v.string({ max: 200 })) });

export function registerGuidanceRoutes(router: Router, server: ServerContext): void {
  router.get('/api/admin/applications/:id/workflows', (ctx) => {
    const request = requireSession(server, ctx);
    const app = requireApp(request, ctx.params.id);
    sendJson(ctx.res, 200, { workflows: request.t.guidance.workflows(app.id).map((row) => request.t.guidance.workflowDTO(row)) });
  });

  router.get('/api/admin/workflows/:id', (ctx) => {
    const request = requireSession(server, ctx);
    const workflow = request.t.guidance.workflow(ctx.params.id ?? '');
    if (!workflow) throw notFound('Workflow not found.');
    sendJson(ctx.res, 200, request.t.guidance.workflowDetailDTO(workflow));
  });

  router.patch('/api/admin/workflows/:id', async (ctx) => {
    const request = requireSession(server, ctx);
    requireRole(request, 'admin');
    const workflow = request.t.guidance.workflow(ctx.params.id ?? '');
    if (!workflow) throw notFound('Workflow not found.');
    const body = await readJson(ctx, workflowPatch);
    if (body.status && body.status !== workflow.status && !ALLOWED_TRANSITIONS[workflow.status].includes(body.status)) {
      throw badRequest(`A ${workflow.status.replace('_', ' ')} workflow can't move to ${body.status.replace('_', ' ')}.`);
    }
    request.t.guidance.updateWorkflow(workflow.id, body);
    const summary = body.status && body.status !== workflow.status ? `Marked “${workflow.title}” as ${body.status.replace('_', ' ')}` : `Edited workflow “${body.title ?? workflow.title}”`;
    request.t.activity.audit({ actorUserId: request.session.userId, action: body.status ? `workflow.${body.status}` : 'workflow.edited', targetType: 'workflow', targetId: workflow.id, summary });
    const updated = request.t.guidance.workflow(workflow.id);
    sendJson(ctx.res, 200, updated ? request.t.guidance.workflowDetailDTO(updated) : null);
  });

  router.patch('/api/admin/workflows/:id/steps/:stepId', async (ctx) => {
    const request = requireSession(server, ctx);
    requireRole(request, 'admin');
    const workflow = request.t.guidance.workflow(ctx.params.id ?? '');
    if (!workflow) throw notFound('Workflow not found.');
    const step = request.t.guidance.step(workflow.id, ctx.params.stepId ?? '');
    if (!step) throw notFound('Step not found.');
    const body = await readJson(ctx, stepPatch);
    if (body.targetKey && !request.t.guidance.mapping(workflow.app_id, body.targetKey)) throw badRequest('That element mapping does not exist. Create it in Element mappings first.');
    request.t.guidance.updateStep(workflow.id, step.id, body);
    request.t.activity.audit({ actorUserId: request.session.userId, action: 'workflow.step_edited', targetType: 'workflow', targetId: workflow.id, summary: `Edited step ${step.ordinal + 1} of “${workflow.title}”` });
    const updated = request.t.guidance.workflow(workflow.id);
    sendJson(ctx.res, 200, updated ? request.t.guidance.workflowDetailDTO(updated) : null);
  });

  router.get('/api/admin/applications/:id/knowledge', (ctx) => {
    const request = requireSession(server, ctx);
    const app = requireApp(request, ctx.params.id);
    sendJson(ctx.res, 200, { items: request.t.knowledge.items(app.id) });
  });

  router.get('/api/admin/applications/:id/mappings', (ctx) => {
    const request = requireSession(server, ctx);
    const app = requireApp(request, ctx.params.id);
    sendJson(ctx.res, 200, { mappings: request.t.guidance.mappings(app.id).map((row) => request.t.guidance.mappingDTO(row)) });
  });

  router.put('/api/admin/applications/:id/mappings/:key', async (ctx) => {
    const request = requireSession(server, ctx);
    requireRole(request, 'admin');
    const app = requireApp(request, ctx.params.id);
    const key = (ctx.params.key ?? '').trim();
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(key)) throw badRequest('Mapping keys use lowercase letters, numbers and dashes.');
    const body = await readJson(ctx, mappingSchema);
    if (body.navoroId && !navoroIdPattern.test(body.navoroId.trim())) throw badRequest('That is not a valid data-navoro-id value.');
    const strategies = strategiesFromAdmin(body);
    if (!strategies.length) throw badRequest('Provide at least one of: data-navoro-id, accessible name, or visible text.');
    const catalog = request.t.apps.catalog(app.id);
    const draft = { id: newId('map'), org_id: request.t.orgId, app_id: app.id, key, label: body.label, strategies: JSON.stringify(strategies), provenance: 'admin' as const, confidence: 0.9, validation: 'unverified' as const, validation_detail: null, updated_at: '' };
    const resolution = revalidateMapping(draft, catalog);
    request.t.guidance.upsertMapping(app.id, { key, label: body.label, strategies, provenance: 'admin', confidence: resolution.confidence, validation: resolution.validation, detail: resolution.detail });
    request.t.activity.audit({ actorUserId: request.session.userId, action: 'mapping.updated', targetType: 'mapping', targetId: key, summary: `Corrected mapping “${body.label}”${body.navoroId ? ` → ${body.navoroId}` : ''}` });
    const mapping = request.t.guidance.mapping(app.id, key);
    sendJson(ctx.res, 200, mapping ? request.t.guidance.mappingDTO(mapping) : null);
  });

  router.post('/api/admin/applications/:id/preview', async (ctx) => {
    const request = requireSession(server, ctx);
    const app = requireApp(request, ctx.params.id);
    const body = await readJson(ctx, previewSchema);
    if (server.limits.aiByOrg.take(`ai:${request.t.orgId}`)) throw new HttpError(429, 'rate_limited', 'Too many preview requests. Wait a moment.');
    const snapshot = buildSnapshot(request.t, app);
    const context: SanitizedContext = body.route ? { route: body.route } : {};
    const output = await generateGuidance(
      request.t,
      app,
      snapshot,
      { question: body.question, context, requestId: newId('prev'), sessionId: 'preview' },
      {
        provider: server.provider,
        includeDrafts: true,
        onUsage: (usage) => request.t.activity.recordAiUsage({ appId: app.id, purpose: 'preview', provider: server.provider?.name ?? 'none', model: usage.model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, latencyMs: usage.latencyMs, ok: usage.ok, errorCode: usage.errorCode }),
      },
    );
    sendJson(ctx.res, 200, { result: output.result, context, retrieval: output.retrieval });
  });
}
