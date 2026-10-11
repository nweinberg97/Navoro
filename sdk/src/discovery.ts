/**
 * Training-mode discovery (development environments only). Sends a structural
 * blueprint of annotated elements: ids, roles, labels, tags and rects. Never
 * values, placeholders or free text beyond accessible names.
 */
import type { DiscoveredElement, DiscoveryRequest, PublicPrivacyPolicy } from '../../packages/contracts/src/sdk-types.ts';
import { accessibleName, createBlinders, getRole, hasSensitiveName, isInBlockedRegion, isSensitiveField, isVisible } from './dom.ts';
import { sanitizeRoute, truncate } from './text.ts';

const MAX_ELEMENTS = 300;

/** Builds the discovery payload for the current document. */
export function buildDiscovery(root: Document, policy: PublicPrivacyPolicy): DiscoveryRequest {
  const view = root.defaultView;
  const blinders = createBlinders(root, policy.blockedNavoroIds, policy.blockedSelectors);
  const elements: DiscoveredElement[] = [];
  const scrollX = view?.scrollX ?? 0;
  const scrollY = view?.scrollY ?? 0;
  for (const el of root.querySelectorAll('[data-navoro-id]')) {
    if (elements.length >= MAX_ELEMENTS) break;
    const navoroId = el.getAttribute('data-navoro-id');
    if (!navoroId || isInBlockedRegion(el, blinders) || !isVisible(el)) continue;
    const sensitive = isSensitiveField(el) || hasSensitiveName(el);
    const r = el.getBoundingClientRect();
    const name = sensitive ? '' : accessibleName(el);
    const tag = el.tagName.toLowerCase();
    elements.push({
      navoroId: truncate(navoroId, 200),
      role: getRole(el),
      label: name ? truncate(name, 80) : null,
      tag,
      inputType: tag === 'input' ? ((el as HTMLInputElement).type || 'text').toLowerCase() : null,
      rect: {
        x: Math.round(r.left + scrollX),
        y: Math.round(r.top + scrollY),
        width: Math.round(r.width),
        height: Math.round(r.height),
      },
    });
  }
  return {
    route: sanitizeRoute(view?.location.pathname ?? '/', view?.location.hash ?? ''),
    viewport: { width: view?.innerWidth ?? 0, height: view?.innerHeight ?? 0 },
    documentHeight: Math.round(root.documentElement.scrollHeight),
    elements,
  };
}

/** Schedules discovery once after init and on route changes (debounced, once per route per load). */
export class DiscoveryScheduler {
  readonly #sent = new Set<string>();
  #timer: ReturnType<typeof setTimeout> | null = null;
  readonly #onRoute = () => this.schedule();
  readonly #send: (req: DiscoveryRequest) => void;
  readonly #policy: () => PublicPrivacyPolicy;

  constructor(policy: () => PublicPrivacyPolicy, send: (req: DiscoveryRequest) => void) {
    this.#policy = policy;
    this.#send = send;
    window.addEventListener('hashchange', this.#onRoute);
    window.addEventListener('popstate', this.#onRoute);
    this.schedule();
  }

  schedule(delayMs = 1500): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = null;
      const route = sanitizeRoute(location.pathname, location.hash);
      if (this.#sent.has(route)) return;
      this.#sent.add(route);
      const req = buildDiscovery(document, this.#policy());
      if (req.elements.length > 0) this.#send(req);
    }, delayMs);
  }

  dispose(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    window.removeEventListener('hashchange', this.#onRoute);
    window.removeEventListener('popstate', this.#onRoute);
  }
}
