/**
 * Read-only DOM helpers: visibility, implicit roles, accessible names and the
 * always-on "Privacy Blinders". Nothing here ever reads an input's value,
 * placeholder or the text of a form control.
 */
import { normalizeSpace } from './text.ts';

/** Attribute placed on the Navoro shadow host; everything under it is ignored. */
export const HOST_ATTR = 'data-navoro-host';

/** Names/ids that indicate secrets or payment data. Labels of such elements are never collected. */
export const SENSITIVE_NAME_RE = /pass(word)?|secret|token|api[-_]?key|card|cvv|cvc|ssn|iban/i;

const SENSITIVE_AUTOCOMPLETE = new Set(['current-password', 'new-password', 'one-time-code']);
const ALWAYS_BLOCKED_REGION = '[data-navoro-sensitive],[data-navoro-ignore]';
const SKIP_TEXT_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'SVG']);

/** Policy-dependent blinders (blocked ids and admin selectors) plus the always-on rules. */
export interface Blinders {
  blockedIds: ReadonlySet<string>;
  /** Selectors that parsed successfully; invalid ones are dropped at construction. */
  selectors: string[];
}

export function createBlinders(doc: Document, blockedNavoroIds: readonly string[], blockedSelectors: readonly string[]): Blinders {
  const selectors: string[] = [];
  for (const selector of blockedSelectors) {
    try {
      doc.querySelector(selector); // throws SyntaxError on invalid selectors
      selectors.push(selector);
    } catch {
      // ignore invalid admin selector
    }
  }
  return { blockedIds: new Set(blockedNavoroIds), selectors };
}

/**
 * True for fields that must never contribute anything (password, payment, OTP).
 * Such fields are excluded from collection entirely.
 */
export function isSensitiveField(el: Element): boolean {
  if (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'password') return true;
  const ac = (el.getAttribute('autocomplete') ?? '').toLowerCase().trim();
  if (ac) {
    for (const token of ac.split(/\s+/)) {
      if (token.startsWith('cc-') || SENSITIVE_AUTOCOMPLETE.has(token)) return true;
    }
  }
  return false;
}

/** True when an element's name/id/navoro-id suggests sensitive data (label is then withheld). */
export function hasSensitiveName(el: Element): boolean {
  for (const attr of ['name', 'id', 'data-navoro-id']) {
    const v = el.getAttribute(attr);
    if (v && SENSITIVE_NAME_RE.test(v)) return true;
  }
  return false;
}

/** True when the element or any ancestor is a blocked region or the Navoro host. */
export function isInBlockedRegion(el: Element, blinders: Blinders): boolean {
  if (el.closest(ALWAYS_BLOCKED_REGION) || el.closest(`[${HOST_ATTR}]`)) return true;
  for (let node: Element | null = el; node; node = node.parentElement) {
    const id = node.getAttribute('data-navoro-id');
    if (id !== null && blinders.blockedIds.has(id)) return true;
  }
  for (const selector of blinders.selectors) {
    try {
      if (el.closest(selector)) return true;
    } catch {
      // selector became invalid in this context; ignore
    }
  }
  return false;
}

/** True when the element is part of the Navoro UI itself. */
export function isNavoroUi(el: Element): boolean {
  return el.closest(`[${HOST_ATTR}]`) !== null || el.getRootNode() instanceof ShadowRoot;
}

/**
 * Rendered, non-zero size, not hidden by CSS, aria-hidden, or a closed <details>.
 * Faded-out containers (opacity ≈ 0, a common way to hide menus that animate open)
 * count as hidden, so a walkthrough never points at, or starts from, an invisible control.
 */
export function isVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (!el.isConnected || rect.width <= 0 || rect.height <= 0) return false;
  const view = el.ownerDocument.defaultView;
  if (!view) return false;
  for (let node: Element | null = el; node; node = node.parentElement) {
    const style = view.getComputedStyle(node);
    if (style.display === 'none' || style.contentVisibility === 'hidden') return false;
    if (Number.parseFloat(style.opacity) < 0.05) return false;
    if (node === el && (style.visibility === 'hidden' || style.visibility === 'collapse')) return false;
    if (node.getAttribute('aria-hidden') === 'true') return false;
    if (node.hasAttribute('hidden')) return false;
    const parent = node.parentElement;
    if (parent && parent.tagName === 'DETAILS' && !(parent as HTMLDetailsElement).open && node.tagName !== 'SUMMARY') {
      return false;
    }
  }
  return true;
}

/** True when the element's rect intersects the viewport. */
export function isInViewport(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  const view = el.ownerDocument.defaultView;
  if (!view) return false;
  return rect.bottom > 0 && rect.right > 0 && rect.top < view.innerHeight && rect.left < view.innerWidth;
}

/** Implicit roles for the input types and tags guidance targets realistically use. */
const INPUT_ROLES: Record<string, string> = {
  checkbox: 'checkbox',
  radio: 'radio',
  range: 'slider',
  number: 'spinbutton',
  search: 'searchbox',
  button: 'button',
  submit: 'button',
  reset: 'button',
};
const TAG_ROLES: Record<string, string> = {
  BUTTON: 'button',
  SUMMARY: 'button',
  TEXTAREA: 'textbox',
  NAV: 'navigation',
  DIALOG: 'dialog',
  LI: 'listitem',
  IMG: 'img',
  FORM: 'form',
};

/** Explicit role (first token) or the implicit ARIA role of the tag. */
export function getRole(el: Element): string | null {
  const explicit = el.getAttribute('role')?.trim().split(/\s+/)[0];
  if (explicit) return explicit.toLowerCase();
  const tag = el.tagName;
  if (tag === 'A' || tag === 'AREA') return el.hasAttribute('href') ? 'link' : null;
  if (/^H[1-6]$/.test(tag)) return 'heading';
  if (tag === 'INPUT') {
    const type = ((el as HTMLInputElement).type || 'text').toLowerCase();
    if (type === 'hidden') return null;
    return INPUT_ROLES[type] ?? 'textbox';
  }
  if (tag === 'SELECT') {
    const select = el as HTMLSelectElement;
    return select.multiple || select.size > 1 ? 'listbox' : 'combobox';
  }
  return TAG_ROLES[tag] ?? null;
}

/** True for elements that hold user-entered data. */
export function isFormControl(el: Element): boolean {
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  const role = el.getAttribute('role');
  return role === 'textbox' || role === 'combobox' || role === 'searchbox' || role === 'spinbutton';
}

/**
 * Visible text of an element, skipping form controls, scripts, hidden subtrees and
 * blocked regions. Never reads `value`.
 */
export function safeText(el: Element, max = 400): string {
  const doc = el.ownerDocument;
  const view = doc.defaultView;
  let out = '';
  const walker = doc.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
      const child = node as Element;
      if (SKIP_TEXT_TAGS.has(child.tagName.toUpperCase())) return NodeFilter.FILTER_REJECT;
      if ((child as HTMLElement).isContentEditable && child !== el) return NodeFilter.FILTER_REJECT;
      if (child.matches(ALWAYS_BLOCKED_REGION) || child.getAttribute('aria-hidden') === 'true' || child.hasAttribute('hidden')) {
        return NodeFilter.FILTER_REJECT;
      }
      if (view && child !== el) {
        const style = view.getComputedStyle(child);
        if (style.display === 'none' || style.visibility === 'hidden') return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_SKIP;
    },
  });
  // Also covers label/aria-labelledby references that point INTO a sensitive region.
  if ((el as HTMLElement).isContentEditable || el.closest(ALWAYS_BLOCKED_REGION)) return '';
  while (walker.nextNode() && out.length < max * 2) {
    const node = walker.currentNode;
    if (node.nodeType === Node.TEXT_NODE) out += ' ' + (node.nodeValue ?? '');
  }
  return normalizeSpace(out).slice(0, max);
}

function labelsFor(el: Element): string {
  const doc = el.ownerDocument;
  const parts: string[] = [];
  const id = el.getAttribute('id');
  if (id) {
    for (const label of doc.querySelectorAll(`label[for="${CSS.escape(id)}"]`)) parts.push(safeText(label));
  }
  const wrapping = el.parentElement?.closest('label');
  if (wrapping && !wrapping.hasAttribute('for')) parts.push(safeText(wrapping));
  return normalizeSpace(parts.join(' '));
}

/**
 * Simplified accessible-name computation:
 * aria-labelledby → aria-label → <label for>/wrapping <label> (form controls) →
 * own visible text (buttons, links, headings, etc.) → alt/title.
 * Never uses an input's value or placeholder.
 */
export function accessibleName(el: Element): string {
  const doc = el.ownerDocument;
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => {
        const ref = id ? doc.getElementById(id) : null;
        return ref && !isFormControl(ref) ? safeText(ref) : '';
      })
      .join(' ');
    if (normalizeSpace(text)) return normalizeSpace(text);
  }
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.trim()) return normalizeSpace(ariaLabel);
  if (isFormControl(el)) {
    const label = labelsFor(el);
    if (label) return label;
    return normalizeSpace(el.getAttribute('title') ?? '');
  }
  if (el.tagName === 'IMG') return normalizeSpace(el.getAttribute('alt') ?? '');
  const text = safeText(el);
  if (text) return text;
  const img = el.querySelector('img[alt]');
  if (img) return normalizeSpace(img.getAttribute('alt') ?? '');
  return normalizeSpace(el.getAttribute('title') ?? '');
}
