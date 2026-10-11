/**
 * Job handlers: single-source ingestion and the Refresh Learning workflow.
 */
import type { Database } from '../db/database.ts';
import { tenant } from '../data/tenant.ts';
import { processSource, type IngestionDeps } from '../services/ingestion.ts';
import { revalidateMapping } from '../knowledge/mapping.ts';
import { publish, PublishError } from '../services/publishing.ts';
import { contentHash, normalizeText } from '../knowledge/normalize.ts';
import { FetchError, fetchDocumentationUrl, fetchYouTubeTranscript } from '../knowledge/fetchers.ts';
import type { JobStepDTO, RefreshReport } from '../../packages/contracts/src/admin-types.ts';
import type { JobContext, JobHandler } from './runner.ts';
import type { SourceRow } from '../data/types.ts';

export const INGEST_STEPS: JobStepDTO[] = [
  { key: 'process', label: 'Read, structure and index the source', status: 'pending', detail: null },
];

export const REFRESH_STEPS: JobStepDTO[] = [
  { key: 'identify', label: 'Identify sources and application configuration', status: 'pending', detail: null },
  { key: 'detect', label: 'Detect updated or previously failed sources', status: 'pending', detail: null },
  { key: 'reprocess', label: 'Reprocess changed content', status: 'pending', detail: null },
  { key: 'rebuild', label: 'Rebuild knowledge index and workflows', status: 'pending', detail: null },
  { key: 'revalidate', label: 'Revalidate element mappings', status: 'pending', detail: null },
  { key: 'review', label: 'Flag broken or uncertain mappings', status: 'pending', detail: null },
  { key: 'publish', label: 'Apply the approval policy', status: 'pending', detail: null },
];

function payload<T>(ctx: JobContext): T {
  return JSON.parse(ctx.job.payload) as T;
}

type Tenant = ReturnType<typeof tenant>;
/** Workflow changes from re-processing that happened since the last Refresh Learning (kept in source metadata). */
interface PendingRefresh {
  added: string[];
  updated: string[];
  removed: string[];
  needsReview: string[];
}
const PENDING_KEY = 'changedSinceRefresh';

function pendingRefresh(source: SourceRow): PendingRefresh | null {
  try {
    const value = (JSON.parse(source.metadata) as Record<string, unknown>)[PENDING_KEY] as PendingRefresh | undefined;
    return value && Array.isArray(value.updated) ? value : null;
  } catch {
    return null;
  }
}

function rememberChangeForRefresh(t: Tenant, sourceId: string, outcome: { workflowsAdded: string[]; workflowsUpdated: string[]; workflowsRemoved: string[]; workflowsNeedingReview: string[] }): void {
  const source = t.knowledge.get(sourceId);
  if (!source) return;
  const prev = pendingRefresh(source) ?? { added: [], updated: [], removed: [], needsReview: [] };
  const merge = (a: string[], b: string[]) => [...new Set([...a, ...b])];
  t.knowledge.mergeMetadata(sourceId, {
    [PENDING_KEY]: {
      added: merge(prev.added, outcome.workflowsAdded),
      updated: merge(prev.updated, outcome.workflowsUpdated),
      removed: merge(prev.removed, outcome.workflowsRemoved),
      needsReview: merge(prev.needsReview, outcome.workflowsNeedingReview),
    },
  });
}

export function ingestHandler(db: Database, deps: IngestionDeps): JobHandler {
  return async (ctx) => {
    const t = tenant(db, ctx.job.org_id);
    const { sourceId } = payload<{ sourceId: string }>(ctx);
    await ctx.step('process', async (setDetail) => {
      const before = t.knowledge.get(sourceId);
      const outcome = await processSource(t, sourceId, deps, { refetch: false });
      // An edit re-processed outside Refresh Learning must still show up in the next refresh report.
      if (before?.processed_at && outcome.contentChanged && outcome.status !== 'failed') rememberChangeForRefresh(t, sourceId, outcome);
      const parts = [
        `${outcome.workflowsAdded.length} workflow(s) added`,
        `${outcome.workflowsUpdated.length} updated`,
        outcome.workflowsNeedingReview.length ? `${outcome.workflowsNeedingReview.length} need review` : null,
      ].filter(Boolean);
      setDetail(outcome.error ? outcome.error : parts.join(', '));
      if (outcome.status === 'failed') throw new Error(outcome.error ?? 'Processing failed');
    });
  };
}

export function refreshHandler(db: Database, deps: IngestionDeps): JobHandler {
  return async (ctx) => {
    const t = tenant(db, ctx.job.org_id);
    const { appId, userId } = payload<{ appId: string; userId: string | null }>(ctx);
    const report: RefreshReport = {
      sourcesConsidered: 0,
      sourcesChanged: 0,
      sourcesUnchanged: 0,
      sourcesFailed: [],
      workflowsAdded: [],
      workflowsUpdated: [],
      workflowsRemoved: [],
      workflowsNeedingReview: [],
      mappingsValid: 0,
      mappingsBroken: [],
      mappingsUncertain: [],
      published: null,
      publishNote: '',
    };
    ctx.report = report;

    const { app, sources } = await ctx.step('identify', (setDetail) => {
      const app = t.apps.get(appId);
      if (!app) throw new Error('Application not found');
      const sources = t.knowledge.list(appId);
      const catalogSize = t.apps.catalog(appId).length;
      report.sourcesConsidered = sources.length;
      setDetail(`${sources.length} source(s), ${catalogSize} element(s) in application metadata`);
      return { app, sources };
    });

    const toProcess = await ctx.step('detect', async (setDetail) => {
      const changed: SourceRow[] = [];
      for (const source of sources) {
        ctx.checkCancelled();
        if (source.type === 'url' || source.type === 'youtube') {
          try {
            if (!source.reference) throw new FetchError('Missing URL');
            const fetched = source.type === 'youtube' ? await fetchYouTubeTranscript(source.reference) : await fetchDocumentationUrl(source.reference, deps.allowPrivateUrls);
            const text = normalizeText(fetched.text);
            const hash = contentHash(text);
            if (hash !== source.content_hash) {
              t.knowledge.setFetchedContent(source.id, text, hash, { finalUrl: fetched.finalUrl, contentType: fetched.contentType, fetchedAt: new Date().toISOString() });
            }
          } catch (error) {
            const message = error instanceof FetchError ? error.userMessage : 'Could not be retrieved.';
            const hadContent = source.processed_at !== null;
            t.knowledge.setStatus(source.id, hadContent ? 'needs_attention' : 'failed', hadContent ? `Latest fetch failed: ${message} Previously imported content is still in use.` : message);
            report.sourcesFailed.push({ id: source.id, title: source.title, error: message });
            continue;
          }
        }
        const current = t.knowledge.get(source.id);
        if (!current) continue;
        const needs =
          current.content_hash !== current.processed_hash || current.status === 'failed' || current.status === 'pending' || current.processed_at === null || pendingRefresh(current) !== null;
        if (needs) changed.push(current);
      }
      report.sourcesChanged = changed.length;
      report.sourcesUnchanged = sources.length - changed.length - report.sourcesFailed.length;
      setDetail(changed.length ? `${changed.length} source(s) changed or need reprocessing` : 'No source content changed');
      return changed;
    });

    await ctx.step('reprocess', async (setDetail) => {
      if (!toProcess.length) {
        setDetail('Nothing to reprocess');
        return;
      }
      let done = 0;
      for (const source of toProcess) {
        ctx.checkCancelled();
        setDetail(`Processing ${source.title} (${done + 1}/${toProcess.length})`);
        const pending = pendingRefresh(source);
        const outcome = await processSource(t, source.id, deps, { refetch: false });
        const add = (list: string[], titles: string[]) => {
          for (const title of titles) if (!list.includes(title)) list.push(title);
        };
        add(report.workflowsAdded, [...(pending?.added ?? []), ...outcome.workflowsAdded]);
        add(report.workflowsUpdated, [...(pending?.updated ?? []), ...outcome.workflowsUpdated]);
        add(report.workflowsRemoved, [...(pending?.removed ?? []), ...outcome.workflowsRemoved]);
        add(report.workflowsNeedingReview, [...(pending?.needsReview ?? []), ...outcome.workflowsNeedingReview]);
        if (pending) t.knowledge.mergeMetadata(source.id, { [PENDING_KEY]: undefined });
        if (outcome.status === 'failed') report.sourcesFailed.push({ id: source.id, title: source.title, error: outcome.error ?? 'Failed' });
        done += 1;
      }
      setDetail(`Reprocessed ${done} source(s)`);
    });

    await ctx.step('rebuild', (setDetail) => {
      const chunks = t.knowledge.usableChunks(appId).length;
      const items = t.knowledge.items(appId).length;
      const workflows = t.guidance.workflows(appId).filter((workflow) => workflow.status !== 'archived').length;
      setDetail(`${chunks} indexed passage(s), ${items} structured item(s), ${workflows} active workflow(s)`);
    });

    await ctx.step('revalidate', (setDetail) => {
      const catalog = t.apps.catalog(appId);
      const mappings = t.guidance.mappings(appId);
      for (const mapping of mappings) {
        const resolution = revalidateMapping(mapping, catalog);
        if (mapping.provenance === 'admin') {
          t.guidance.setMappingValidation(mapping.id, resolution.validation, resolution.detail, resolution.confidence);
        } else {
          t.guidance.upsertMapping(appId, {
            key: mapping.key,
            label: mapping.label,
            strategies: resolution.strategies,
            provenance: resolution.provenance,
            confidence: resolution.confidence,
            validation: resolution.validation,
            detail: resolution.detail,
          });
        }
      }
      setDetail(`Checked ${mappings.length} mapping(s) against ${catalog.filter((entry) => entry.approved === 1).length} approved element(s)`);
    });

    await ctx.step('review', (setDetail) => {
      const mappings = t.guidance.mappings(appId);
      report.mappingsValid = mappings.filter((mapping) => mapping.validation === 'valid').length;
      report.mappingsBroken = mappings.filter((mapping) => mapping.validation === 'broken').map((mapping) => ({ key: mapping.key, label: mapping.label, detail: mapping.validation_detail ?? '' }));
      report.mappingsUncertain = mappings.filter((mapping) => mapping.validation === 'uncertain').map((mapping) => ({ key: mapping.key, label: mapping.label, detail: mapping.validation_detail ?? '' }));
      // Workflows that depend on a broken mapping need human review.
      const brokenKeys = new Set(report.mappingsBroken.map((mapping) => mapping.key));
      for (const workflow of t.guidance.workflows(appId)) {
        if (workflow.status !== 'published') continue;
        if (t.guidance.steps(workflow.id).some((step) => step.target_key && brokenKeys.has(step.target_key))) {
          t.guidance.setWorkflowStatus(workflow.id, 'needs_review');
          if (!report.workflowsNeedingReview.includes(workflow.title)) report.workflowsNeedingReview.push(workflow.title);
        }
      }
      setDetail(`${report.mappingsBroken.length} broken, ${report.mappingsUncertain.length} uncertain, ${report.workflowsNeedingReview.length} workflow(s) need review`);
    });

    await ctx.step('publish', (setDetail) => {
      const org = t.activity.organization();
      if (org?.approvalPolicy !== 'auto') {
        const pending = t.guidance.workflows(appId).filter((workflow) => workflow.status === 'draft' || workflow.status === 'needs_review').length;
        report.publishNote = pending
          ? `Manual approval is on: ${pending} workflow(s) are waiting for review in Guidance. Nothing was published automatically.`
          : 'Manual approval is on and nothing is waiting for review. Live guidance is unchanged.';
        setDetail('Manual approval — nothing published');
        return;
      }
      const mappingsByKey = new Map(t.guidance.mappings(appId).map((mapping) => [mapping.key, mapping]));
      let promoted = 0;
      for (const workflow of t.guidance.workflows(appId)) {
        if (workflow.status !== 'draft' && workflow.status !== 'needs_review') continue;
        if (workflow.edited === 1 && workflow.status === 'needs_review') continue;
        const steps = t.guidance.steps(workflow.id);
        const healthy = steps.every((step) => !step.target_key || ['valid', 'unverified'].includes(mappingsByKey.get(step.target_key)?.validation ?? 'broken'));
        if (healthy && workflow.confidence >= 0.7) {
          t.guidance.setWorkflowStatus(workflow.id, 'published');
          promoted += 1;
        }
      }
      try {
        const result = publish(t, app, 'development', 'Auto-published by Refresh Learning', userId);
        report.published = { version: result.version, environment: 'development' };
        report.publishNote = `Auto-publish is on: ${promoted} workflow(s) passed validation and configuration v${result.version} was published to development. Production is unchanged until you publish it.`;
        setDetail(`Published v${result.version} to development`);
      } catch (error) {
        if (!(error instanceof PublishError)) throw error;
        report.publishNote = `Auto-publish skipped: ${error.message}`;
        setDetail('Auto-publish skipped');
      }
    });

    t.activity.audit({
      actorUserId: userId,
      action: 'refresh.completed',
      targetType: 'application',
      targetId: appId,
      summary: `Refresh Learning finished: ${report.sourcesChanged} changed, ${report.mappingsBroken.length} broken mapping(s), ${report.workflowsNeedingReview.length} need review`,
    });
  };
}
