/**
 * Privacy-first context collector.
 *
 * Allowlist-first: the payload is BUILT field by field from permitted sources.
 * The DOM is never serialized and then redacted. Collection happens on demand
 * (when the user asks a question) — no observers, no keystrokes, no screenshots.
 *
 * A category is read only if it is in `policy.observe`, and included in the
 * outbound payload only if it is also in `policy.transmit`.
 */
import type {
  ContextCategory,
  ObservedElement,
  PublicPrivacyPolicy,
  SanitizedContext,
  VisibleError,
} from '../../packages/contracts/src/sdk-types.ts';
import {
  accessibleName,
  createBlinders,
  getRole,
  hasSensitiveName,
  isFormControl,
  isInBlockedRegion,
  isInViewport,
  isSensitiveField,
  isVisible,
  safeText,
  type Blinders,
} from './dom.ts';
import { sanitizeRoute, truncate } from './text.ts';

/** Payload bounds (plain consts so the minifier inlines them). */
const MAX_TITLE = 120;
const MAX_HEADINGS = 6;
const MAX_HEADING_CHARS = 80;
const MAX_ELEMENTS = 60;
const MAX_LABEL_CHARS = 80;
const MAX_ERRORS = 10;
const MAX_ERROR_CHARS = 160;
const MAX_FIELD_LABELS = 40;

/** Categories both observable and transmittable under the policy. */
export function effectiveCategories(policy: PublicPrivacyPolicy): Set<ContextCategory> {
  const transmit = new Set(policy.transmit);
  return new Set(policy.observe.filter((c) => transmit.has(c)));
}

interface ApprovedCandidate {
  el: Element;
  navoroId: string;
  visible: boolean;
  inView: boolean;
}

function approvedCandidates(root: Document, policy: PublicPrivacyPolicy, blinders: Blinders): ApprovedCandidate[] {
  const approved = new Set(policy.approvedNavoroIds);
  const out: ApprovedCandidate[] = [];
  const seen = new Set<string>();
  for (const el of root.querySelectorAll('[data-navoro-id]')) {
    const navoroId = el.getAttribute('data-navoro-id') ?? '';
    if (!navoroId || !approved.has(navoroId) || seen.has(navoroId)) continue;
    if (isSensitiveField(el) || isInBlockedRegion(el, blinders)) continue;
    seen.add(navoroId);
    const visible = isVisible(el);
    out.push({ el, navoroId, visible, inView: visible && isInViewport(el) });
  }
  // Prefer visible, then in-viewport elements; stable for equal ranks.
  const rank = (c: ApprovedCandidate) => (c.inView ? 0 : c.visible ? 1 : 2);
  return out.map((c, i) => ({ c, i })).sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i).map((x) => x.c);
}

function labelOf(el: Element): string | null {
  if (hasSensitiveName(el)) return null;
  const name = accessibleName(el);
  return name ? truncate(name, MAX_LABEL_CHARS) : null;
}

function observeElement(c: ApprovedCandidate): ObservedElement {
  const el = c.el;
  return {
    navoroId: c.navoroId,
    role: getRole(el),
    label: labelOf(el),
    disabled: (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true',
    invalid: el.getAttribute('aria-invalid') === 'true',
  };
}

function collectHeadings(root: Document, blinders: Blinders): string[] {
  const out: string[] = [];
  for (const h of root.querySelectorAll('h1, h2')) {
    if (out.length >= MAX_HEADINGS) break;
    if (isInBlockedRegion(h, blinders) || !isVisible(h)) continue;
    const text = truncate(safeText(h), MAX_HEADING_CHARS);
    if (text) out.push(text);
  }
  return out;
}

function collectErrors(root: Document, blinders: Blinders, approved: ReadonlySet<string>): VisibleError[] {
  const out: VisibleError[] = [];
  for (const el of root.querySelectorAll('[data-navoro-error]')) {
    if (out.length >= MAX_ERRORS) break;
    if (isInBlockedRegion(el, blinders) || !isVisible(el)) continue;
    let near: Element | null = null;
    const forId = el.getAttribute('data-navoro-error-for');
    if (forId) near = root.querySelector(`[data-navoro-id="${CSS.escape(forId)}"]`);
    near ??= el.closest('[data-navoro-id]');
    let nearNavoroId = near?.getAttribute('data-navoro-id') ?? null;
    // Only reference ids that are approved and not blocked.
    if (near && nearNavoroId && (!approved.has(nearNavoroId) || isInBlockedRegion(near, blinders))) nearNavoroId = null;
    const code = el.getAttribute('data-navoro-error')?.trim() || null;
    const message = truncate(safeText(el, MAX_ERROR_CHARS * 2), MAX_ERROR_CHARS) || null;
    out.push({ code: code ? truncate(code, 64) : null, message, nearNavoroId });
  }
  return out;
}

/**
 * Builds the sanitized, transmittable context for the given document.
 * Pure with respect to its inputs: reads the DOM, never mutates it.
 */
export function collectContext(root: Document, policy: PublicPrivacyPolicy): SanitizedContext {
  const allow = effectiveCategories(policy);
  const blinders = createBlinders(root, policy.blockedNavoroIds, policy.blockedSelectors);
  const ctx: SanitizedContext = {};
  const loc = root.defaultView?.location;

  if (allow.has('route') && loc) ctx.route = sanitizeRoute(loc.pathname, loc.hash);
  if (allow.has('pageTitle')) ctx.pageTitle = truncate(root.title || '', MAX_TITLE);
  if (allow.has('headings')) ctx.headings = collectHeadings(root, blinders);

  if (allow.has('elements') || allow.has('fieldLabels')) {
    const candidates = approvedCandidates(root, policy, blinders);
    if (allow.has('elements')) {
      ctx.elements = candidates.slice(0, MAX_ELEMENTS).map(observeElement);
    }
    if (allow.has('fieldLabels')) {
      const labels: string[] = [];
      for (const c of candidates) {
        if (labels.length >= MAX_FIELD_LABELS) break;
        if (!isFormControl(c.el)) continue;
        const label = labelOf(c.el);
        if (label && !labels.includes(label)) labels.push(label);
      }
      ctx.fieldLabels = labels;
    }
  }

  if (allow.has('visibleErrors')) {
    ctx.visibleErrors = collectErrors(root, blinders, new Set(policy.approvedNavoroIds));
  }
  return ctx;
}
