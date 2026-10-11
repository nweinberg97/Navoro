/**
 * Knowledge ingestion: fetch (for URL/YouTube) → normalize → hash → extract
 * structured knowledge → resolve UI labels against approved metadata → persist
 * chunks, items, workflows and mappings with provenance.
 */
import type { Tenant } from '../data/tenant.ts';
import type { SourceRow } from '../data/types.ts';
import { contentHash, normalizeText } from '../knowledge/normalize.ts';
import { extractKnowledge, workflowContentHash } from '../knowledge/extract.ts';
import { mappingKeyForLabel, resolveLabel } from '../knowledge/mapping.ts';
import { FetchError, fetchDocumentationUrl, fetchYouTubeTranscript } from '../knowledge/fetchers.ts';
import type { ExtractedWorkflow } from '../data/guidance.ts';

export interface IngestionDeps {
  allowPrivateUrls: boolean;
}

export interface IngestionOutcome {
  sourceId: string;
  title: string;
  status: SourceRow['status'];
  error: string | null;
  contentChanged: boolean;
  workflowsAdded: string[];
  workflowsUpdated: string[];
  workflowsRemoved: string[];
  workflowsNeedingReview: string[];
  warnings: string[];
}

/** Re-fetches remote content. Returns true when the stored content changed. */
async function refreshRemoteContent(t: Tenant, source: SourceRow, deps: IngestionDeps): Promise<boolean> {
  if (!source.reference) throw new FetchError('This source has no URL.');
  const fetched = source.type === 'youtube' ? await fetchYouTubeTranscript(source.reference) : await fetchDocumentationUrl(source.reference, deps.allowPrivateUrls);
  const text = normalizeText(fetched.text);
  if (text.length < 40) throw new FetchError('The page contained no readable text.');
  const hash = contentHash(text);
  const changed = hash !== source.content_hash;
  const shouldRetitle = !source.title || source.title === source.reference;
  t.knowledge.setFetchedContent(
    source.id,
    text,
    hash,
    { finalUrl: fetched.finalUrl, contentType: fetched.contentType, fetchedAt: new Date().toISOString() },
    shouldRetitle && fetched.title ? fetched.title.slice(0, 120) : undefined,
  );
  return changed;
}

export async function processSource(t: Tenant, sourceId: string, deps: IngestionDeps, options: { refetch: boolean }): Promise<IngestionOutcome> {
  let source = t.knowledge.get(sourceId);
  if (!source) throw new Error('source not found');
  const outcome: IngestionOutcome = {
    sourceId,
    title: source.title,
    status: 'processing',
    error: null,
    contentChanged: source.content_hash !== source.processed_hash,
    workflowsAdded: [],
    workflowsUpdated: [],
    workflowsRemoved: [],
    workflowsNeedingReview: [],
    warnings: [],
  };
  const hadUsableContent = source.processed_at !== null && source.content.length > 0;
  t.knowledge.setStatus(sourceId, 'processing');

  if (source.type === 'url' || source.type === 'youtube') {
    if (options.refetch || !source.content) {
      try {
        const changed = await refreshRemoteContent(t, source, deps);
        outcome.contentChanged = outcome.contentChanged || changed;
      } catch (error) {
        const message = error instanceof FetchError ? error.userMessage : 'The source could not be retrieved.';
        // Keep previously imported knowledge usable, but surface the failure.
        const status = hadUsableContent ? 'needs_attention' : 'failed';
        const detail = hadUsableContent ? `Latest fetch failed: ${message} Previously imported content is still in use.` : message;
        t.knowledge.setStatus(sourceId, status, detail);
        return { ...outcome, status, error: detail };
      }
      source = t.knowledge.get(sourceId) ?? source;
      outcome.title = source.title;
    }
  }

  const text = source.content;
  if (text.trim().length < 20) {
    t.knowledge.setStatus(sourceId, 'failed', 'The source is empty or too short to learn from.');
    return { ...outcome, status: 'failed', error: 'The source is empty or too short to learn from.' };
  }

  const extraction = extractKnowledge(text);
  outcome.warnings.push(...extraction.warnings);
  const catalog = t.apps.catalog(source.app_id);
  const appId = source.app_id;
  const keptKeys = new Set<string>();

  t.transaction(() => {
    for (const workflow of extraction.workflows) {
      let resolved = 0;
      const steps = workflow.steps.map((step) => {
        if (!step.label) return { title: step.title, instruction: step.instruction, targetKey: null, excerpt: step.excerpt };
        const resolution = resolveLabel(step.label, catalog);
        const key = mappingKeyForLabel(step.label);
        t.guidance.upsertMapping(appId, {
          key,
          label: step.label,
          strategies: resolution.strategies,
          provenance: resolution.provenance,
          confidence: resolution.confidence,
          validation: resolution.validation,
          detail: resolution.detail,
        });
        const current = t.guidance.mapping(appId, key);
        if (current?.validation === 'valid') resolved += 1;
        else if (current?.validation === 'unverified') resolved += 0.5;
        return { title: step.title, instruction: step.instruction, targetKey: key, excerpt: step.excerpt };
      });
      const labelled = workflow.steps.filter((step) => step.label).length || 1;
      const extracted: ExtractedWorkflow = {
        key: workflow.key,
        title: workflow.title,
        summary: workflow.summary,
        kind: workflow.kind,
        prerequisites: workflow.prerequisites,
        steps,
        confidence: Math.round((0.5 + 0.45 * (resolved / labelled)) * 100) / 100,
        contentHash: workflowContentHash(workflow),
      };
      const { outcome: result } = t.guidance.upsertExtracted(appId, sourceId, extracted);
      keptKeys.add(workflow.key);
      if (result === 'added') outcome.workflowsAdded.push(workflow.title);
      else if (result === 'updated') outcome.workflowsUpdated.push(workflow.title);
      else if (result === 'needs_review') outcome.workflowsNeedingReview.push(workflow.title);
    }
    outcome.workflowsRemoved.push(...t.guidance.archiveMissing(sourceId, keptKeys));

    const structured = extraction.workflows.length + extraction.items.length;
    const status: SourceRow['status'] = structured === 0 ? 'needs_attention' : 'ready';
    const error = structured === 0 ? 'Imported as searchable text, but no workflows, errors or terms were recognized. Add headings and numbered steps for richer guidance.' : null;
    t.knowledge.replaceDerived(sourceId, extraction.chunks, extraction.items, status, error);
    t.knowledge.mergeMetadata(sourceId, { warnings: extraction.warnings, extractedAt: new Date().toISOString(), extractor: 'structured-markdown/v1' });
    outcome.status = status;
    outcome.error = error;
  });
  return outcome;
}
