/**
 * Element mapping resolution and validation against approved application
 * metadata (the element catalog captured by the SDK or imported by an admin).
 *
 * Mapping hierarchy, most stable first:
 *   1. data-navoro-id (developer-provided identifier)
 *   2. accessible name (aria-label / label) + role
 *   3. visible text + role
 * We never produce or accept raw CSS selectors for targeting.
 */
import type { MatchStrategy } from '../../packages/contracts/src/sdk-types.ts';
import type { CatalogRow, MappingRow } from '../data/types.ts';
import { parseJson } from '../db/database.ts';
import { slug } from './extract.ts';

const STALE_AFTER_DAYS = 30;

export function normalizeLabel(label: string): string {
  return label.toLowerCase().replace(/[“”"'’]/g, '').replace(/\s+/g, ' ').trim();
}

export function mappingKeyForLabel(label: string): string {
  return slug(label) || 'element';
}

export interface Resolution {
  strategies: MatchStrategy[];
  provenance: MappingRow['provenance'];
  confidence: number;
  validation: MappingRow['validation'];
  detail: string | null;
}

/** Resolves a UI label from documentation to an approved catalog element. */
export function resolveLabel(label: string, catalog: CatalogRow[], routeHint?: string | null): Resolution {
  const approved = catalog.filter((element) => element.approved === 1);
  const target = normalizeLabel(label);
  let matches = approved.filter((element) => element.label && normalizeLabel(element.label) === target);
  if (matches.length > 1 && routeHint) {
    const onRoute = matches.filter((element) => element.route === routeHint);
    if (onRoute.length) matches = onRoute;
  }
  // Prefer interactive roles when a label is shared with a container (e.g. a heading).
  if (matches.length > 1) {
    const interactive = matches.filter((element) => ['button', 'link', 'textbox', 'combobox', 'radiogroup', 'checkbox', 'tab'].includes(element.role ?? ''));
    if (interactive.length === 1) matches = interactive;
  }
  const textStrategy: MatchStrategy = { type: 'text', value: label };
  if (matches.length === 1 && matches[0]) {
    const element = matches[0];
    return {
      strategies: [
        { type: 'navoro_id', value: element.navoro_id },
        { type: 'aria_label', value: label, ...(element.role ? { role: element.role } : {}) },
        { ...textStrategy, ...(element.role ? { role: element.role } : {}) },
      ],
      provenance: 'developer_id',
      confidence: 0.95,
      validation: 'valid',
      detail: `Matched approved element ${element.navoro_id}${element.route ? ` on ${element.route}` : ''}.`,
    };
  }
  if (matches.length > 1) {
    return {
      strategies: [textStrategy],
      provenance: 'extracted',
      confidence: 0.4,
      validation: 'uncertain',
      detail: `${matches.length} approved elements are labelled "${label}" (${matches.map((m) => m.navoro_id).join(', ')}). Choose one.`,
    };
  }
  if (approved.length === 0) {
    return {
      strategies: [{ type: 'aria_label', value: label }, textStrategy],
      provenance: 'extracted',
      confidence: 0.55,
      validation: 'unverified',
      detail: 'No approved application metadata yet. The SDK will match by accessible name or visible text.',
    };
  }
  return {
    strategies: [{ type: 'aria_label', value: label }, textStrategy],
    provenance: 'extracted',
    confidence: 0.45,
    validation: 'uncertain',
    detail: `No approved element is labelled "${label}". The SDK will try accessible name and visible text.`,
  };
}

/**
 * Revalidates an existing mapping against the current catalog. Admin-authored
 * navoro ids are checked, not replaced; extracted mappings may be upgraded to a
 * stable identifier when one becomes available.
 */
export function revalidateMapping(mapping: MappingRow, catalog: CatalogRow[]): Resolution {
  const strategies = parseJson<MatchStrategy[]>(mapping.strategies, []);
  const navoroStrategy = strategies.find((strategy) => strategy.type === 'navoro_id');
  const approved = catalog.filter((element) => element.approved === 1);
  if (navoroStrategy) {
    const element = catalog.find((entry) => entry.navoro_id === navoroStrategy.value);
    if (!element) {
      if (approved.length === 0) {
        return { strategies, provenance: mapping.provenance, confidence: mapping.confidence, validation: 'unverified', detail: 'No application metadata captured yet to verify this identifier.' };
      }
      return {
        strategies,
        provenance: mapping.provenance,
        confidence: 0.1,
        validation: 'broken',
        detail: `data-navoro-id "${navoroStrategy.value}" is not present in the latest application metadata. The control may have been renamed or removed.`,
      };
    }
    if (element.approved !== 1) {
      return { strategies, provenance: mapping.provenance, confidence: 0.5, validation: 'uncertain', detail: `${element.navoro_id} exists but is not approved metadata yet.` };
    }
    const ageDays = (Date.now() - new Date(element.last_seen_at).getTime()) / 86_400_000;
    if (element.label && normalizeLabel(element.label) !== normalizeLabel(mapping.label)) {
      return {
        strategies,
        provenance: mapping.provenance,
        confidence: 0.6,
        validation: 'uncertain',
        detail: `The element is now labelled "${element.label}" (documentation says "${mapping.label}"). Confirm the guidance still matches.`,
      };
    }
    if (ageDays > STALE_AFTER_DAYS) {
      return { strategies, provenance: mapping.provenance, confidence: 0.7, validation: 'uncertain', detail: `Not seen by the SDK for ${Math.round(ageDays)} days.` };
    }
    return { strategies, provenance: mapping.provenance, confidence: Math.max(mapping.confidence, 0.9), validation: 'valid', detail: `Verified against ${element.navoro_id}.` };
  }
  if (mapping.provenance === 'admin') {
    return { strategies, provenance: 'admin', confidence: mapping.confidence, validation: approved.length ? 'uncertain' : 'unverified', detail: 'Admin mapping without a stable identifier; matched by name or text at runtime.' };
  }
  return resolveLabel(mapping.label, catalog);
}

export function strategiesFromAdmin(input: { navoroId?: string; ariaLabel?: string; text?: string; role?: string }): MatchStrategy[] {
  const strategies: MatchStrategy[] = [];
  const role = input.role?.trim() || undefined;
  if (input.navoroId?.trim()) strategies.push({ type: 'navoro_id', value: input.navoroId.trim() });
  if (input.ariaLabel?.trim()) strategies.push({ type: 'aria_label', value: input.ariaLabel.trim(), ...(role ? { role } : {}) });
  if (input.text?.trim()) strategies.push({ type: 'text', value: input.text.trim(), ...(role ? { role } : {}) });
  return strategies;
}
