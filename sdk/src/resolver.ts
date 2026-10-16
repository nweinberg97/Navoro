/**
 * Element resolver. Maps a server-provided GuidanceTarget to at most ONE visible
 * element in the host page. Server strings are never used as raw selectors or
 * evaluated; navoro ids pass through CSS.escape on an attribute value only.
 *
 * Targeting is local and transmits nothing, so sensitive-named elements may be
 * highlighted, but never elements inside the Navoro UI itself.
 */
import type { GuidanceTarget, MatchStrategy } from '../../packages/contracts/src/sdk-types.ts';
import { accessibleName, getRole, isNavoroUi, isVisible, safeText } from './dom.ts';
import { normalizeForMatch } from './text.ts';

/** Names are compared in memory and discarded, so private regions don't block pointing. */
const MATCH = { matching: true } as const;

export type ResolveReason = 'found' | 'not_found' | 'ambiguous' | 'hidden' | 'no_strategies';

export interface ResolveResult {
  element: Element | null;
  strategy: MatchStrategy['type'] | null;
  reason: ResolveReason;
}

const TEXT_CANDIDATES = 'button,a[href],label,h1,h2,h3,h4,h5,h6,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=heading],[role=option]';
const NAME_CANDIDATES = TEXT_CANDIDATES + ',input,select,textarea,[aria-label],[aria-labelledby],[role],[data-navoro-id]';

function roleMatches(el: Element, role: string | undefined): boolean {
  return !role || getRole(el) === role.toLowerCase();
}

/** Drops ancestors that merely contain another matching element (e.g. label around a button). */
function innermost(elements: Element[]): Element[] {
  return elements.filter((el) => !elements.some((other) => other !== el && el.contains(other)));
}

function byNavoroId(root: Document, value: string): { matches: Element[]; hidden: boolean } {
  const all = [...root.querySelectorAll(`[data-navoro-id="${CSS.escape(value)}"]`)].filter((el) => !isNavoroUi(el));
  const visible = all.filter(isVisible);
  return { matches: visible, hidden: all.length > 0 && visible.length === 0 };
}

function byName(root: Document, value: string, role?: string): { matches: Element[]; hidden: boolean } {
  const want = normalizeForMatch(value);
  const all = [...root.querySelectorAll(NAME_CANDIDATES)].filter(
    (el) => !isNavoroUi(el) && roleMatches(el, role) && normalizeForMatch(accessibleName(el, MATCH)) === want,
  );
  const visible = innermost(all.filter(isVisible));
  return { matches: visible, hidden: all.length > 0 && visible.length === 0 };
}

function byText(root: Document, value: string, role?: string): { matches: Element[]; hidden: boolean } {
  const want = normalizeForMatch(value);
  const candidates = [...root.querySelectorAll(TEXT_CANDIDATES)].filter((el) => !isNavoroUi(el) && roleMatches(el, role));
  const exact: Element[] = [];
  const prefix: Element[] = [];
  for (const el of candidates) {
    const text = normalizeForMatch(safeText(el, 400, MATCH));
    if (!text) continue;
    if (text === want) exact.push(el);
    else if (text.startsWith(want)) prefix.push(el);
  }
  const visibleExact = innermost(exact.filter(isVisible));
  if (visibleExact.length > 0) return { matches: visibleExact, hidden: false };
  const visiblePrefix = innermost(prefix.filter(isVisible));
  return { matches: visiblePrefix, hidden: visiblePrefix.length === 0 && exact.length + prefix.length > 0 };
}

/**
 * Tries each strategy in order and returns the first unambiguous visible match.
 * When no strategy finds exactly one element, `element` is null and `reason`
 * explains the most informative failure (ambiguous > hidden > not_found).
 */
export function resolveTarget(target: GuidanceTarget | null, root: Document = document): ResolveResult {
  if (!target || target.strategies.length === 0) return { element: null, strategy: null, reason: 'no_strategies' };
  let failure: ResolveReason = 'not_found';
  let failedStrategy: MatchStrategy['type'] | null = null;
  const RANK = 'not_found hidden ambiguous';
  const note = (reason: ResolveReason, type: MatchStrategy['type']) => {
    if (RANK.indexOf(reason) > RANK.indexOf(failure) || failedStrategy === null) {
      failure = reason;
      failedStrategy = type;
    }
  };
  for (const strategy of target.strategies) {
    const value = strategy.value.trim();
    if (!value) continue;
    let found: { matches: Element[]; hidden: boolean };
    try {
      if (strategy.type === 'navoro_id') found = byNavoroId(root, value);
      else if (strategy.type === 'aria_label') found = byName(root, value, strategy.role);
      else found = byText(root, value, strategy.role);
    } catch {
      continue;
    }
    const n = found.matches.length;
    if (n === 1) return { element: found.matches[0]!, strategy: strategy.type, reason: 'found' };
    // More than one match (even duplicate navoro ids) is ambiguous — never guess.
    note(n > 1 ? 'ambiguous' : found.hidden ? 'hidden' : 'not_found', strategy.type);
  }
  return { element: null, strategy: failedStrategy, reason: failure };
}
