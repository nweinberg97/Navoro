/**
 * Knowledge pack validation and walkthrough positioning. Pure functions shared by
 * the pack builder (Node) and the SDK (browser).
 */
import {
  KNOWLEDGE_PACK_FORMAT,
  KNOWLEDGE_PACK_VERSION,
  type ContextCategory,
  type KnowledgePack,
  type MatchStrategy,
} from '../../contracts/src/sdk-types.ts';

const CATEGORIES: ContextCategory[] = ['route', 'pageTitle', 'headings', 'elements', 'fieldLabels', 'visibleErrors'];
const MAX_TEXT = 20_000;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown, max = MAX_TEXT): v is string => typeof v === 'string' && v.length <= max;
const isStrOrNull = (v: unknown, max = MAX_TEXT): v is string | null => v === null || isStr(v, max);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const strArray = (v: unknown, maxItems = 2000, max = 500): v is string[] => Array.isArray(v) && v.length <= maxItems && v.every((s) => isStr(s, max));

function isStrategy(v: unknown): v is MatchStrategy {
  if (!isObj(v) || !isStr(v.value, 200)) return false;
  if (v.role !== undefined && !isStr(v.role, 40)) return false;
  return v.type === 'navoro_id' || v.type === 'aria_label' || v.type === 'text';
}

export class PackError extends Error {}

/**
 * Validates an untrusted value as a KnowledgePack. Throws PackError naming the
 * first problem. Text is never rendered as HTML anywhere, so validation is about
 * shape and size, not escaping.
 */
export function validatePack(value: unknown): KnowledgePack {
  const fail = (where: string): never => {
    throw new PackError(`Invalid knowledge pack: ${where}`);
  };
  if (!isObj(value)) fail('not an object');
  const v = value as Record<string, unknown>;
  if (v.format !== KNOWLEDGE_PACK_FORMAT) fail('format');
  if (v.version !== KNOWLEDGE_PACK_VERSION) fail(`unsupported version ${String(v.version)}`);
  if (!isStr(v.builtAt, 40) || !isStr(v.hash, 80)) fail('builtAt/hash');
  if (!isObj(v.application) || !isStr(v.application.name, 120)) fail('application.name');
  if (!isObj(v.launcher) || !isStr(v.launcher.greeting, 300) || !strArray(v.launcher.suggestions, 6, 120)) fail('launcher');
  if (!isStrOrNull(v.supportUrl, 500)) fail('supportUrl');
  if (!isStrOrNull(v.supportEmail, 254)) fail('supportEmail');
  if (v.theme !== undefined && (!isObj(v.theme) || !isStrOrNull(v.theme.accent, 64))) fail('theme');
  const p = v.privacy;
  if (!isObj(p)) fail('privacy');
  const privacy = p as Record<string, unknown>;
  if (!Array.isArray(privacy.observe) || !privacy.observe.every((c) => CATEGORIES.includes(c as ContextCategory))) fail('privacy.observe');
  if (!strArray(privacy.blockedNavoroIds, 2000, 100) || !strArray(privacy.blockedSelectors, 500, 200) || !strArray(privacy.approvedNavoroIds, 5000, 100)) fail('privacy lists');
  if (!Array.isArray(v.sources) || !v.sources.every((s) => isObj(s) && isStr(s.title, 300) && isStr(s.hash, 80))) fail('sources');
  if (!Array.isArray(v.workflows) || v.workflows.length > 2000) fail('workflows');
  (v.workflows as unknown[]).forEach((w, i) => {
    if (!isObj(w) || !isStr(w.id, 120) || !isStr(w.title, 300) || !isStr(w.summary) || !isStr(w.sourceTitle, 300) || !isStr(w.excerpt) || !isNum(w.confidence)) fail(`workflows[${i}]`);
    const wf = w as Record<string, unknown>;
    if (wf.kind !== 'task' && wf.kind !== 'onboarding' && wf.kind !== 'troubleshooting') fail(`workflows[${i}].kind`);
    if (!strArray(wf.prerequisites, 20, 500)) fail(`workflows[${i}].prerequisites`);
    if (!Array.isArray(wf.steps) || wf.steps.length > 50) fail(`workflows[${i}].steps`);
    (wf.steps as unknown[]).forEach((s, j) => {
      if (!isObj(s) || !isStr(s.title, 300) || !isStr(s.instruction, 2000) || !isStrOrNull(s.targetKey, 120)) fail(`workflows[${i}].steps[${j}]`);
    });
  });
  if (!Array.isArray(v.items) || v.items.length > 5000) fail('items');
  (v.items as unknown[]).forEach((item, i) => {
    if (!isObj(item) || !isStr(item.id, 120) || !isStr(item.title, 500) || !isStr(item.body) || !isStr(item.sourceTitle, 300) || !isObj(item.data)) fail(`items[${i}]`);
    const it = item as Record<string, unknown>;
    if (!['feature', 'ui_concept', 'known_error', 'troubleshooting'].includes(it.kind as string)) fail(`items[${i}].kind`);
    const data = it.data as Record<string, unknown>;
    if (data.code !== undefined && !isStrOrNull(data.code, 80)) fail(`items[${i}].data.code`);
    if (data.resolution !== undefined && !isStrOrNull(data.resolution)) fail(`items[${i}].data.resolution`);
    if (data.labels !== undefined && !strArray(data.labels, 20, 120)) fail(`items[${i}].data.labels`);
    if (data.label !== undefined && !isStr(data.label, 120)) fail(`items[${i}].data.label`);
  });
  if (!Array.isArray(v.chunks) || v.chunks.length > 20_000) fail('chunks');
  (v.chunks as unknown[]).forEach((c, i) => {
    if (!isObj(c) || !isStr(c.id, 120) || !isStrOrNull(c.heading, 500) || !isStr(c.text) || !isStr(c.sourceTitle, 300)) fail(`chunks[${i}]`);
  });
  if (!Array.isArray(v.mappings) || v.mappings.length > 5000) fail('mappings');
  (v.mappings as unknown[]).forEach((m, i) => {
    if (!isObj(m) || !isStr(m.key, 120) || !isStr(m.label, 200) || !isNum(m.confidence)) fail(`mappings[${i}]`);
    const mp = m as Record<string, unknown>;
    if (!Array.isArray(mp.strategies) || mp.strategies.length > 5 || !mp.strategies.every(isStrategy)) fail(`mappings[${i}].strategies`);
    if (!['valid', 'unverified', 'uncertain', 'broken'].includes(mp.validation as string)) fail(`mappings[${i}].validation`);
  });
  return v as unknown as KnowledgePack;
}

/**
 * "Start where you are": given which steps' targets are visible right now, pick the
 * step the user has actually reached. `null` means the step has no control to point
 * at (pure instruction); those steps don't count either way.
 *
 *  - If some step's control is missing but a later one is visible, the user has moved
 *    past it (e.g. they're on the form, so "Click New report" is gone but the form
 *    fields are here) → start at the first visible step after the last such gap.
 *  - Otherwise, if the first few controls are visible and the rest aren't, start at the
 *    last visible one (on the Reports page "Open Reports" and "New report" are both
 *    visible → start at "New report").
 *  - If everything or nothing is visible, there's no evidence of progress → step 0.
 */
export function chooseStartStep(visible: Array<boolean | null>): number {
  const targeted = visible.map((state, index) => ({ state, index })).filter((entry) => entry.state !== null) as Array<{ state: boolean; index: number }>;
  if (targeted.length === 0) return 0;
  let gap = -1;
  targeted.forEach((entry, i) => {
    if (!entry.state && targeted.slice(i + 1).some((later) => later.state)) gap = i;
  });
  if (gap >= 0) {
    const next = targeted.find((entry, i) => i > gap && entry.state);
    return next ? next.index : 0;
  }
  let run = -1;
  while (run + 1 < targeted.length && targeted[run + 1]?.state) run += 1;
  if (run < 0 || run === targeted.length - 1) return 0;
  return targeted[run]?.index ?? 0;
}
