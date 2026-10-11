/**
 * Builds an offline knowledge pack from a navoro.config.json: the app's docs, its
 * approved elements (data-navoro-id + accessible label) and its privacy rules.
 *
 * Uses the same extraction and element-mapping code as the hosted pipeline, so a
 * pack answers exactly what the hosted server would in demo mode. The output is a
 * static JSON file the SDK loads from the app's own origin (local mode).
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import {
  KNOWLEDGE_PACK_FORMAT,
  KNOWLEDGE_PACK_VERSION,
  type ContextCategory,
  type KnowledgePack,
  type PackChunk,
  type PackItem,
  type PackMapping,
  type PackWorkflow,
} from '../../packages/contracts/src/sdk-types.ts';
import type { CatalogRow } from '../data/types.ts';
import { extractKnowledge, slug } from './extract.ts';
import { contentHash, inferTitle, normalizeText } from './normalize.ts';
import { mappingKeyForLabel, resolveLabel } from './mapping.ts';
import { fetchDocumentationUrl, fetchYouTubeTranscript, youtubeVideoId } from './fetchers.ts';
import { v, type Infer } from '../lib/validate.ts';
import { formatIssues } from '../http/http.ts';
import { validatePack } from '../../packages/engine/src/pack.ts';

const CATEGORIES = ['route', 'pageTitle', 'headings', 'elements', 'fieldLabels', 'visibleErrors'] as const;
const navoroId = v.string({ min: 1, max: 100, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/, patternMessage: 'Use letters, numbers, dots, dashes, colons or underscores' });

const elementSchema = v.object({
  navoroId,
  label: v.string({ min: 1, max: 120 }),
  role: v.optional(v.string({ max: 40 })),
  route: v.optional(v.string({ max: 200 })),
});

export const packConfigSchema = v.object({
  $schema: v.optional(v.string({ max: 300 })),
  name: v.string({ min: 1, max: 120 }),
  /** Markdown/text files or folders (relative to the config), or public http(s) URLs. */
  docs: v.array(v.string({ min: 1, max: 500 }), { min: 1, max: 200 }),
  /**
   * Approved elements inline, or a path to a JSON file containing the array. Optional:
   * without it, any element tagged with data-navoro-id is approved (tagging is the
   * opt-in) and steps match controls by accessible name or visible text.
   */
  elements: v.optional(v.union(v.array(elementSchema, { max: 5000 }), v.string({ min: 1, max: 500 }))),
  privacy: v.optional(
    v.object({
      /** What the on-device engine may read. Default: route, page title, approved controls, visible errors. */
      observe: v.optional(v.array(v.oneOf(CATEGORIES), { max: 6, unique: true })),
      /** Regions never read: by data-navoro-id, or by CSS selector. */
      neverCollect: v.optional(
        v.array(v.union(v.object({ navoroId, reason: v.optional(v.string({ max: 200 })) }), v.object({ selector: v.string({ min: 1, max: 200, pattern: /^[^{}<>;@\\]+$/, patternMessage: 'Not an allowed CSS selector' }), reason: v.optional(v.string({ max: 200 })) })), { max: 500 }),
      ),
    }),
  ),
  launcher: v.optional(v.object({ greeting: v.optional(v.string({ max: 300 })), suggestions: v.optional(v.array(v.string({ min: 1, max: 120 }), { max: 4 })) })),
  supportUrl: v.optional(v.nullable(v.string({ max: 500, pattern: /^https?:\/\/\S+$/, patternMessage: 'Must be an http(s) URL' }))),
  /** Where unsolved problems go. The panel's "Email support" opens a pre-filled email to this address. */
  supportEmail: v.optional(v.nullable(v.string({ max: 254, pattern: /^[^\s@<>()"]+@[^\s@<>()"]+\.[^\s@<>()"]+$/, patternMessage: 'Must be an email address' }))),
  /** Output path relative to the config. Default: navoro-pack.json next to the config. */
  out: v.optional(v.string({ min: 1, max: 500 })),
});

export type PackConfig = Infer<typeof packConfigSchema>;

export interface PackReport {
  docs: Array<{ title: string; chars: number; workflows: number; items: number; warnings: string[] }>;
  workflows: number;
  steps: number;
  stepsPointing: number;
  /** Steps whose bold label doesn't match an approved element (they'll match by text, or not at all). */
  unmatchedLabels: Array<{ workflow: string; step: string; label: string; detail: string }>;
  /** Approved elements no doc refers to — candidates for new help articles. */
  unusedElements: string[];
  bytes: number;
}

export class PackConfigError extends Error {}

const DEFAULT_OBSERVE: ContextCategory[] = ['route', 'pageTitle', 'elements', 'visibleErrors'];

function listDocFiles(target: string): string[] {
  const stat = statSync(target);
  if (stat.isFile()) return [target];
  return readdirSync(target)
    .filter((name) => !name.startsWith('.'))
    .flatMap((name) => listDocFiles(path.join(target, name)))
    .filter((file) => /\.(md|markdown|txt)$/i.test(file))
    .sort();
}

async function loadDocs(config: PackConfig, baseDir: string, options: { allowPrivateUrls: boolean }): Promise<Array<{ title: string; text: string }>> {
  const docs: Array<{ title: string; text: string }> = [];
  for (const entry of config.docs) {
    if (/^https?:\/\//i.test(entry)) {
      const fetched = youtubeVideoId(entry) ? await fetchYouTubeTranscript(entry) : await fetchDocumentationUrl(entry, options.allowPrivateUrls);
      const text = normalizeText(fetched.text);
      docs.push({ title: fetched.title ?? inferTitle(text, entry), text });
      continue;
    }
    const target = path.resolve(baseDir, entry);
    if (!existsSync(target)) throw new PackConfigError(`docs: "${entry}" does not exist (looked in ${target})`);
    for (const file of listDocFiles(target)) {
      const text = normalizeText(readFileSync(file, 'utf8'));
      if (text.length < 20) continue;
      docs.push({ title: inferTitle(text, path.basename(file)), text });
    }
  }
  if (!docs.length) throw new PackConfigError('docs: no readable .md or .txt content found');
  return docs;
}

function loadElements(config: PackConfig, baseDir: string): Array<Infer<typeof elementSchema>> {
  if (config.elements === undefined) return [];
  if (Array.isArray(config.elements)) return config.elements;
  const file = path.resolve(baseDir, config.elements);
  if (!existsSync(file)) throw new PackConfigError(`elements: "${config.elements}" does not exist`);
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new PackConfigError(`elements: "${config.elements}" is not valid JSON`);
  }
  const list = Array.isArray(data) ? data : (data as { elements?: unknown })?.elements;
  const parsed = v.array(elementSchema, { max: 5000 }).parse(list);
  if (!parsed.ok) throw new PackConfigError(`elements: ${formatIssues(parsed.issues)}`);
  return parsed.value;
}

export function parsePackConfig(raw: unknown): PackConfig {
  const parsed = packConfigSchema.parse(raw);
  if (!parsed.ok) throw new PackConfigError(formatIssues(parsed.issues));
  return parsed.value;
}

export async function buildPack(config: PackConfig, baseDir: string, options: { allowPrivateUrls?: boolean; now?: Date } = {}): Promise<{ pack: KnowledgePack; report: PackReport }> {
  const docs = await loadDocs(config, baseDir, { allowPrivateUrls: options.allowPrivateUrls ?? false });
  const elements = loadElements(config, baseDir);
  const neverCollect = config.privacy?.neverCollect ?? [];
  const blockedNavoroIds = neverCollect.flatMap((rule) => ('navoroId' in rule ? [rule.navoroId] : []));
  const blockedSelectors = neverCollect.flatMap((rule) => ('selector' in rule ? [rule.selector] : []));
  const blocked = new Set(blockedNavoroIds);
  // Approved metadata = every listed element. Blocked ones can still be pointed at
  // (targeting is local) but are never read as context.
  const catalog = elements.map((element, index) => ({
    id: `el${index}`,
    org_id: 'local',
    app_id: 'local',
    navoro_id: element.navoroId,
    label: element.label,
    role: element.role ?? null,
    route: element.route ?? null,
    source: 'manual',
    approved: 1,
    first_seen_at: '',
    last_seen_at: new Date().toISOString(),
  })) as CatalogRow[];

  const workflows: PackWorkflow[] = [];
  const items: PackItem[] = [];
  const chunks: PackChunk[] = [];
  const mappings = new Map<string, PackMapping>();
  const usedIds = new Set<string>();
  const report: PackReport = { docs: [], workflows: 0, steps: 0, stepsPointing: 0, unmatchedLabels: [], unusedElements: [], bytes: 0 };
  const sources: KnowledgePack['sources'] = [];

  const mapLabel = (label: string): PackMapping => {
    const key = mappingKeyForLabel(label);
    const existing = mappings.get(key);
    if (existing) return existing;
    const resolution = resolveLabel(label, catalog);
    const mapping: PackMapping = { key, label, strategies: resolution.strategies, confidence: resolution.confidence, validation: resolution.validation };
    mappings.set(key, mapping);
    const id = resolution.strategies.find((strategy) => strategy.type === 'navoro_id')?.value;
    if (id) usedIds.add(id);
    return mapping;
  };

  docs.forEach((doc, docIndex) => {
    const extraction = extractKnowledge(doc.text);
    sources.push({ title: doc.title, hash: contentHash(doc.text) });
    report.docs.push({ title: doc.title, chars: doc.text.length, workflows: extraction.workflows.length, items: extraction.items.length, warnings: extraction.warnings });
    extraction.chunks.forEach((chunk, i) => chunks.push({ id: `c${docIndex}.${i}`, heading: chunk.heading, text: chunk.text, sourceTitle: doc.title }));
    extraction.items.forEach((item, i) => {
      const data = item.data as PackItem['data'];
      for (const label of data.labels ?? []) mapLabel(label);
      if (item.kind === 'ui_concept' && data.label) mapLabel(data.label);
      items.push({ id: `i${docIndex}.${i}`, kind: item.kind, title: item.title, body: item.body, data, sourceTitle: doc.title });
    });
    for (const workflow of extraction.workflows) {
      let id = slug(workflow.key) || `workflow-${workflows.length + 1}`;
      while (workflows.some((existing) => existing.id === id)) id = `${id}-2`;
      let resolved = 0;
      const steps = workflow.steps.map((step) => {
        report.steps += 1;
        if (!step.label) return { title: step.title, instruction: step.instruction, targetKey: null };
        const mapping = mapLabel(step.label);
        // Without an element list, steps are matched at runtime by accessible name/text.
        if (mapping.validation === 'valid' || (config.elements === undefined && mapping.validation === 'unverified')) {
          resolved += 1;
          report.stepsPointing += 1;
        } else {
          report.unmatchedLabels.push({ workflow: workflow.title, step: step.title, label: step.label, detail: resolveLabel(step.label, catalog).detail ?? '' });
        }
        return { title: step.title, instruction: step.instruction, targetKey: mapping.key };
      });
      const labelled = workflow.steps.filter((step) => step.label).length || 1;
      workflows.push({
        id,
        title: workflow.title,
        summary: workflow.summary,
        kind: workflow.kind,
        prerequisites: workflow.prerequisites,
        confidence: Math.round((0.5 + 0.45 * (resolved / labelled)) * 100) / 100,
        sourceTitle: doc.title,
        excerpt: workflow.steps.map((step) => step.excerpt).join(' ').slice(0, 400),
        steps,
      });
    }
  });
  report.workflows = workflows.length;
  report.unusedElements = elements.map((element) => element.navoroId).filter((id) => !usedIds.has(id) && !blocked.has(id));

  const body = {
    application: { name: config.name },
    launcher: {
      greeting: config.launcher?.greeting ?? `Hi! Ask how to do anything in ${config.name} — I’ll point you to the right place.`,
      suggestions: config.launcher?.suggestions ?? workflows.slice(0, 3).map((workflow) => `How do I ${workflow.title.charAt(0).toLowerCase()}${workflow.title.slice(1)}?`),
    },
    supportUrl: config.supportUrl ?? null,
    supportEmail: config.supportEmail ?? null,
    privacy: {
      observe: config.privacy?.observe ?? DEFAULT_OBSERVE,
      blockedNavoroIds,
      blockedSelectors,
      approvedNavoroIds: config.elements === undefined ? ['*'] : elements.map((element) => element.navoroId).filter((id) => !blocked.has(id)),
    },
    sources,
    workflows,
    items,
    chunks,
    mappings: [...mappings.values()].sort((a, b) => a.key.localeCompare(b.key)),
  };
  const pack: KnowledgePack = {
    format: KNOWLEDGE_PACK_FORMAT,
    version: KNOWLEDGE_PACK_VERSION,
    builtAt: (options.now ?? new Date()).toISOString(),
    hash: contentHash(JSON.stringify(body)),
    ...body,
  };
  validatePack(pack);
  report.bytes = Buffer.byteLength(JSON.stringify(pack));
  return { pack, report };
}
