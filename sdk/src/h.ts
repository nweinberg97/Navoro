/**
 * Minimal element builder. Text is always assigned via textContent; there is no
 * code path that turns server data into HTML. The only innerHTML use in the SDK
 * is `svg()` with compile-time constant markup.
 */
type Child = Node | string | null | undefined | false;
type Attrs = Record<string, string | number | boolean | null | undefined | ((ev: Event) => void)>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (typeof value === 'function') el.addEventListener(key.replace(/^on/, '').toLowerCase(), value);
    else if (key === 'class') el.className = String(value);
    // CSSOM assignment works under strict host CSPs (style-src without 'unsafe-inline'); a style attribute would not.
    else if (key === 'style') el.style.cssText = String(value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
}

/** A type="button" control. `cls` is a class list; `label` is plain text or a node. */
export function btn(cls: string, label: Child, onclick: () => void, attrs: Attrs = {}): HTMLButtonElement {
  return h('button', { class: cls, type: 'button', onclick, ...attrs }, label);
}

/** Close (✕) icon button with an accessible name. */
export function closeBtn(name: string, onclick: () => void): HTMLButtonElement {
  return btn('icon-btn', svg(ICON_CLOSE), onclick, { 'aria-label': name });
}

/** Wraps constant, SDK-authored SVG markup. Never pass server data here. */
export function svg(markup: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.style.display = 'contents';
  span.innerHTML = markup;
  return span;
}

export const ICON_CLOSE =
  '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
export const ICON_CHECK =
  '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M2.5 6.2l2.3 2.3 4.7-5" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
