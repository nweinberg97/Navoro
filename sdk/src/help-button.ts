/**
 * Help buttons: how an app decides where Navoro's entry point lives.
 *
 * 1. Placement (`button: { target, placement }`, or data-navoro-button / data-navoro-button-placement
 *    on the script tag): Navoro inserts its own (?) icon button next to, or inside, an element
 *    the app chooses — e.g. right before the settings menu. The button lives in its own shadow
 *    root so host CSS can't break it, takes the surrounding text colour, and is re-inserted if
 *    the app re-renders that area.
 * 2. Triggers: any element the app marks with `data-navoro-trigger` opens/closes Navoro.
 *    aria-expanded is kept in sync on all of them.
 *
 * With either, Navoro's floating launcher is hidden.
 */

import { svg } from './h.ts';

export type ButtonPlacement = 'before' | 'after' | 'prepend' | 'append';

export interface HelpButtonOptions {
  /** CSS selector of the element to place the button against. */
  target: string;
  placement: ButtonPlacement;
}

interface Toggle {
  open(): void;
  close(): void;
  isOpen(): boolean;
}

const TAG = 'navoro-help-button';
const ICON =
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="17" r="1.1" fill="currentColor"/></svg>';
const CSS = `:host{display:inline-flex;color:inherit}
button{all:unset;box-sizing:border-box;display:inline-grid;place-items:center;width:36px;height:36px;border-radius:10px;color:inherit;cursor:pointer;transition:background .12s}
button:hover{background:color-mix(in srgb,currentColor 9%,transparent)}
button[aria-expanded="true"]{background:color-mix(in srgb,var(--accent,#D2F53C) 22%,transparent)}
button:focus-visible{outline:2px solid var(--accent,#4338ca);outline-offset:2px}`;

export const PLACEMENTS: readonly ButtonPlacement[] = ['before', 'after', 'prepend', 'append'];

export function isPlacement(value: unknown): value is ButtonPlacement {
  return typeof value === 'string' && (PLACEMENTS as readonly string[]).includes(value);
}

export class HelpButtons {
  readonly #toggle: Toggle;
  readonly #opts: HelpButtonOptions | null;
  readonly #accent: string | null;
  #host: HTMLElement | null = null;
  #button: HTMLButtonElement | null = null;
  #observer: MutationObserver | null = null;
  #scheduled = false;
  #open = false;

  constructor(toggle: Toggle, opts: HelpButtonOptions | null, accent: string | null) {
    this.#toggle = toggle;
    this.#opts = opts;
    this.#accent = accent;
    document.addEventListener('click', this.#onTrigger, true);
    for (const el of document.querySelectorAll<HTMLElement>('[data-navoro-trigger]')) this.#prepareTrigger(el);
    if (opts) {
      this.#place();
      // Single-page apps re-render headers; put the button back when that happens.
      this.#observer = new MutationObserver(() => this.#schedule());
      this.#observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  /** True when the host page offers a trigger or asked for a placed button. */
  static wanted(opts: HelpButtonOptions | null): boolean {
    return Boolean(opts) || document.querySelector('[data-navoro-trigger]') !== null;
  }

  setOpen(open: boolean): void {
    this.#open = open;
    this.#button?.setAttribute('aria-expanded', String(open));
    for (const el of document.querySelectorAll<HTMLElement>('[data-navoro-trigger]')) el.setAttribute('aria-expanded', String(open));
  }

  /** The element the panel should sit under, for automatic offsets. */
  get anchor(): HTMLElement | null {
    return this.#host?.isConnected ? this.#host : document.querySelector<HTMLElement>('[data-navoro-trigger]');
  }

  destroy(): void {
    document.removeEventListener('click', this.#onTrigger, true);
    this.#observer?.disconnect();
    this.#host?.remove();
    this.#host = null;
  }

  #prepareTrigger(el: HTMLElement): void {
    if (!el.hasAttribute('aria-expanded')) el.setAttribute('aria-expanded', String(this.#open));
    // Apps can ship the trigger hidden so it only appears once Navoro is ready.
    if (el.hasAttribute('hidden')) el.removeAttribute('hidden');
  }

  readonly #onTrigger = (event: Event): void => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-navoro-trigger]') : null;
    if (!target) return;
    // The trigger belongs to Navoro: stop the app's own handlers from toggling it twice.
    event.preventDefault();
    event.stopPropagation();
    this.#toggleOpen();
  };

  #toggleOpen(): void {
    if (this.#toggle.isOpen()) this.#toggle.close();
    else this.#toggle.open();
  }

  #schedule(): void {
    if (this.#scheduled) return;
    this.#scheduled = true;
    requestAnimationFrame(() => {
      this.#scheduled = false;
      for (const el of document.querySelectorAll<HTMLElement>('[data-navoro-trigger][hidden]')) this.#prepareTrigger(el);
      if (!this.#host?.isConnected) this.#place();
    });
  }

  #place(): void {
    if (!this.#opts) return;
    let target: Element | null = null;
    try {
      target = document.querySelector(this.#opts.target);
    } catch {
      console.warn(`[Navoro] button target "${this.#opts.target}" is not a valid selector`);
      this.#observer?.disconnect();
      return;
    }
    if (!target) return;
    const host = this.#host ?? this.#create();
    const where: InsertPosition = { before: 'beforebegin', after: 'afterend', prepend: 'afterbegin', append: 'beforeend' }[this.#opts.placement] as InsertPosition;
    target.insertAdjacentElement(where, host);
  }

  #create(): HTMLElement {
    const host = document.createElement(TAG);
    host.setAttribute('data-navoro-ignore', '');
    if (this.#accent) host.style.setProperty('--accent', this.#accent);
    const shadow = host.attachShadow({ mode: 'open', delegatesFocus: true });
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      shadow.adoptedStyleSheets = [sheet];
    } catch {
      const style = document.createElement('style');
      style.textContent = CSS;
      shadow.append(style);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-label', 'Help');
    button.setAttribute('title', 'Help');
    button.setAttribute('aria-expanded', String(this.#open));
    button.append(svg(ICON));
    button.addEventListener('click', () => this.#toggleOpen());
    shadow.append(button);
    this.#host = host;
    this.#button = button;
    return host;
  }
}
