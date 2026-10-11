/** Admin API: knowledge sources, ingestion jobs and Refresh Learning. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { badRequest, conflict, notFound, readJson, sendJson, type Router } from '../http/http.ts';
import { v } from '../lib/validate.ts';
import { requireApp, requireRole, requireSession, type AdminRequest, type ServerContext } from './context.ts';
import { contentHash, inferTitle, normalizeText } from '../knowledge/normalize.ts';
import { FetchError, validatePublicUrl, youtubeVideoId } from '../knowledge/fetchers.ts';
import { jobDTO } from '../data/jobs.ts';
import { INGEST_STEPS, REFRESH_STEPS } from '../jobs/handlers.ts';
import type { SourceType } from '../../packages/contracts/src/admin-types.ts';

const SAMPLE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'seed', 'lumen-help-center.md');
const MAX_CONTENT = 400_000;

const createSchema = v.object({
  type: v.oneOf(['manual', 'text', 'file', 'url', 'youtube'] as const),
  title: v.optional(v.string({ max: 120 })),
  content: v.optional(v.string({ max: MAX_CONTENT, trim: false })),
  reference: v.optional(v.string({ max: 500 })),
});

const updateSchema = v.object({
  title: v.optional(v.string({ min: 1, max: 120 })),
  content: v.optional(v.string({ min: 1, max: MAX_CONTENT, trim: false })),
});

function queueIngest(server: ServerContext, request: AdminRequest, appId: string, sourceId: string): void {
  request.t.jobs.enqueue({ appId, type: 'ingest', payload: { sourceId }, steps: INGEST_STEPS.map((step) => ({ ...step })), requestedBy: request.session.userId });
  server.runner.kick();
}

export function createSource(
  server: ServerContext,
  request: AdminRequest,
  appId: string,
  input: { type: SourceType; title?: string; content?: string; reference?: string },
): string {
  let title = input.title?.trim() ?? '';
  let content = '';
  let reference: string | null = null;
  if (input.type === 'url' || input.type === 'youtube') {
    if (!input.reference?.trim()) throw badRequest('Enter a URL.');
    try {
      const url = validatePublicUrl(input.reference);
      reference = url.toString();
    } catch (error) {
      throw badRequest(error instanceof FetchError ? error.userMessage : 'Invalid URL.');
    }
    if (input.type === 'youtube' && !youtubeVideoId(reference)) throw badRequest('That doesn’t look like a YouTube video URL (youtube.com/watch?v=… or youtu.be/…).');
    if (input.type === 'url' && youtubeVideoId(reference)) throw badRequest('This is a YouTube link — add it as a YouTube source so its transcript can be imported.');
    title = title || reference;
  } else {
    content = normalizeText(input.content ?? '');
    if (content.length < 20) throw badRequest('Add at least a few sentences of documentation.');
    if (input.type === 'file') {
      const name = (input.reference ?? '').trim();
      if (!/\.(md|markdown|txt)$/i.test(name)) throw badRequest('Upload a Markdown (.md) or plain-text (.txt) file.');
      reference = name.slice(0, 200);
    }
    title = title || inferTitle(content, reference ?? 'Untitled document');
  }
  const sourceId = request.t.knowledge.create(appId, { type: input.type, title: title.slice(0, 120), reference, content, contentHash: content ? contentHash(content) : null });
  request.t.activity.audit({ actorUserId: request.session.userId, action: 'knowledge.source_added', targetType: 'knowledge_source', targetId: sourceId, summary: `Added ${input.type} source “${title.slice(0, 80)}”` });
  queueIngest(server, request, appId, sourceId);
  return sourceId;
}

export function registerKnowledgeRoutes(router: Router, server: ServerContext): void {
  router.get('/api/admin/applications/:id/sources', (ctx) => {
    const request = requireSession(server, ctx);
    const app = requireApp(request, ctx.params.id);
    sendJson(ctx.res, 200, { sources: request.t.knowledge.list(app.id).map((row) => request.t.knowledge.dto(row)) });
  });

  router.post('/api/admin/applications/:id/sources', async (ctx) => {
    const request = requireSession(server, ctx);
    requireRole(request, 'admin');
    const app = requireApp(request, ctx.params.id);
    const body = await readJson(ctx, createSchema, 1024 * 1024);
    const sourceId = createSource(server, request, app.id, body);
    const row = request.t.knowledge.get(sourceId);
    sendJson(ctx.res, 201, row ? request.t.knowledge.dto(row) : null);
  });

  router.post('/api/admin/applications/:id/sources/sample', (ctx) => {
    const request = requireSession(server, ctx);
    requireRole(request, 'admin');
    const app = requireApp(request, ctx.params.id);
    const content = readFileSync(SAMPLE_PATH, 'utf8');
    const sourceId = createSource(server, request, app.id, { type: 'manual', title: 'Lumen Help Center (sample)', content });
    const row = request.t.knowledge.get(sourceId);
    sendJson(ctx.res, 201, row ? request.t.knowledge.dto(row) : null);
  });

  router.get('/api/admin/sources/:id', (ctx) => {
    const request = requireSession(server, ctx);
    const source = request.t.knowledge.get(ctx.params.id ?? '');
    if (!source) throw notFound('Source not found.');
    sendJson(ctx.res, 200, request.t.knowledge.detailDTO(source));
  });

  router.patch('/api/admin/sources/:id', async (ctx) => {
    const request = requireSession(server, ctx);
    requireRole(request, 'admin');
    const source = request.t.knowledge.get(ctx.params.id ?? '');
    if (!source) throw notFound('Source not found.');
    const body = await readJson(ctx, updateSchema, 1024 * 1024);
    if (body.content !== undefined && (source.type === 'url' || source.type === 'youtube')) {
      throw badRequest('Remote sources are re-fetched from their URL. Use Refresh Learning to pick up changes.');
    }
    const content = body.content !== undefined ? normalizeText(body.content) : undefined;
    request.t.knowledge.updateContent(source.id, { title: body.title, content, contentHash: content !== undefined ? contentHash(content) : undefined });
    request.t.activity.audit({ actorUserId: request.session.userId, action: 'knowledge.source_edited', targetType: 'knowledge_source', targetId: source.id, summary: `Edited “${body.title ?? source.title}”` });
    queueIngest(server, request, source.app_id, source.id);
    const row = request.t.knowledge.get(source.id);
    sendJson(ctx.res, 200, row ? request.t.knowledge.dto(row) : null);
  });

  router.delete('/api/admin/sources/:id', (ctx) => {
    const request = requireSession(server, ctx);
    requireRole(request, 'admin');
    const source = request.t.knowledge.get(ctx.params.id ?? '');
    if (!source) throw notFound('Source not found.');
    request.t.transaction(() => {
      request.t.guidance.archiveMissing(source.id, new Set());
      request.t.knowledge.delete(source.id);
    });
    request.t.activity.audit({ actorUserId: request.session.userId, action: 'knowledge.source_deleted', targetType: 'knowledge_source', targetId: source.id, summary: `Deleted “${source.title}”` });
    sendJson(ctx.res, 200, { ok: true });
  });

  router.post('/api/admin/applications/:id/refresh', (ctx) => {
    const request = requireSession(server, ctx);
    requireRole(request, 'admin');
    const app = requireApp(request, ctx.params.id);
    const active = request.t.jobs.activeRefresh(app.id);
    if (active) throw conflict('Refresh Learning is already running for this application.');
    const jobId = request.t.jobs.enqueue({
      appId: app.id,
      type: 'refresh',
      payload: { appId: app.id, userId: request.session.userId },
      steps: REFRESH_STEPS.map((step) => ({ ...step })),
      requestedBy: request.session.userId,
    });
    request.t.activity.audit({ actorUserId: request.session.userId, action: 'refresh.started', targetType: 'application', targetId: app.id, summary: `Started Refresh Learning for ${app.name}` });
    server.runner.kick();
    const job = request.t.jobs.get(jobId);
    sendJson(ctx.res, 202, job ? jobDTO(job) : null);
  });

  router.get('/api/admin/jobs', (ctx) => {
    const request = requireSession(server, ctx);
    const appId = ctx.url.searchParams.get('applicationId');
    if (appId) requireApp(request, appId);
    sendJson(ctx.res, 200, { jobs: request.t.jobs.list(appId).map(jobDTO) });
  });

  router.get('/api/admin/jobs/:id', (ctx) => {
    const request = requireSession(server, ctx);
    const job = request.t.jobs.get(ctx.params.id ?? '');
    if (!job) throw notFound('Job not found.');
    sendJson(ctx.res, 200, jobDTO(job));
  });

  router.post('/api/admin/jobs/:id/cancel', (ctx) => {
    const request = requireSession(server, ctx);
    requireRole(request, 'admin');
    const job = request.t.jobs.get(ctx.params.id ?? '');
    if (!job) throw notFound('Job not found.');
    request.t.jobs.requestCancel(job.id);
    const updated = request.t.jobs.get(job.id);
    sendJson(ctx.res, 200, updated ? jobDTO(updated) : null);
  });
}
