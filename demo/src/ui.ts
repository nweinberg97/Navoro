/** Tiny DOM helpers. Everything is built with createElement/textContent — no innerHTML. */

export type Child = Node | string | number | null | undefined | false;
export type AttrValue = string | number | boolean | null | undefined | ((event: Event) => void);
export type Attrs = Record<string, AttrValue>;

const PROPS = new Set(['value', 'checked', 'disabled', 'readOnly', 'selected']);

function applyAttrs(el: Element, attrs: Attrs): void {
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'class') {
      el.setAttribute('class', String(value));
    } else if (PROPS.has(key)) {
      (el as unknown as Record<string, unknown>)[key] = value;
    } else if (value === true) {
      el.setAttribute(key, '');
    } else {
      el.setAttribute(key, String(value));
    }
  }
}

function appendChildren(el: Element, children: Array<Child | Child[]>): void {
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Array<Child | Child[]>
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  applyAttrs(el, attrs);
  appendChildren(el, children);
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
export function s(tag: string, attrs: Attrs = {}, ...children: Array<Child | Child[]>): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  applyAttrs(el, attrs);
  appendChildren(el, children);
  return el as SVGElement;
}

const ICONS: Record<string, string[]> = {
  dashboard: ['M3 3h7v9H3z', 'M14 3h7v5h-7z', 'M14 12h7v9h-7z', 'M3 16h7v5H3z'],
  reports: ['M4 20V10', 'M10 20V4', 'M16 20v-7', 'M22 20H2'],
  integrations: ['M9 2v6', 'M15 2v6', 'M6 8h12v4a6 6 0 0 1-12 0z', 'M12 18v4'],
  settings: ['M4 6h10', 'M18 6h2', 'M4 12h2', 'M10 12h10', 'M4 18h12', 'M20 18h0', 'M16 4v4', 'M6 10v4', 'M18 16v4'],
  menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  plus: ['M12 5v14', 'M5 12h14'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  copy: ['M9 9h11v11H9z', 'M5 15V5a1 1 0 0 1 1-1h10'],
  slack: ['M5 12h14', 'M12 5v14', 'M7 7l10 10', 'M17 7L7 17'],
  upload: ['M12 16V4', 'M7 9l5-5 5 5', 'M4 20h16'],
  database: ['M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z', 'M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6', 'M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6'],
  sliders: ['M4 7h8', 'M16 7h4', 'M4 17h4', 'M12 17h8', 'M14 5v4', 'M10 15v4'],
  alert: ['M12 8v5', 'M12 17h0', 'M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'],
  external: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
};

export function icon(name: string, size = 18): SVGElement {
  const svg = s('svg', {
    viewBox: '0 0 24 24',
    width: size,
    height: size,
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 1.8,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    focusable: 'false',
  });
  for (const d of ICONS[name] ?? []) svg.append(s('path', { d }));
  return svg;
}

// ---- Toasts ----------------------------------------------------------------

let toastHost: HTMLElement | null = null;
export function toast(message: string, tone: 'success' | 'info' = 'success'): void {
  if (!toastHost) {
    toastHost = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  const el = h('div', { class: `toast toast-${tone}` }, icon('check', 16), h('span', {}, message));
  toastHost.append(el);
  window.setTimeout(() => {
    el.classList.add('toast-out');
    window.setTimeout(() => el.remove(), 250);
  }, 3600);
}

// ---- Form fields -----------------------------------------------------------

let uid = 0;
export function nextId(prefix: string): string {
  uid += 1;
  return `${prefix}-${uid}`;
}

export interface FieldOptions {
  label: string;
  navoroId: string;
  type?: string;
  value?: string;
  placeholder?: string;
  autocomplete?: string;
  readOnly?: boolean;
  hint?: string;
  name?: string;
}

export interface Field<T extends HTMLElement> {
  root: HTMLElement;
  control: T;
  /** Container for inline errors, placed right under the control. */
  errorSlot: HTMLElement;
}

export function textField(opts: FieldOptions): Field<HTMLInputElement> {
  const id = nextId('f');
  const control = h('input', {
    id,
    type: opts.type ?? 'text',
    name: opts.name ?? opts.navoroId,
    class: 'input',
    value: opts.value ?? '',
    placeholder: opts.placeholder,
    autocomplete: opts.autocomplete ?? 'off',
    readOnly: opts.readOnly,
    'data-navoro-id': opts.navoroId,
  });
  const errorSlot = h('div', { class: 'error-slot' });
  const hint = opts.hint ? h('p', { class: 'hint', id: `${id}-hint` }, opts.hint) : null;
  if (hint) control.setAttribute('aria-describedby', hint.id);
  const root = h('div', { class: 'field' }, h('label', { for: id, class: 'label' }, opts.label), control, hint, errorSlot);
  return { root, control, errorSlot };
}

export function selectField(
  opts: Omit<FieldOptions, 'type' | 'value' | 'placeholder'> & { options: Array<{ value: string; label: string }>; value?: string },
): Field<HTMLSelectElement> {
  const id = nextId('f');
  const control = h(
    'select',
    { id, name: opts.name ?? opts.navoroId, class: 'input select', 'data-navoro-id': opts.navoroId },
    opts.options.map((o) => h('option', { value: o.value, selected: o.value === (opts.value ?? opts.options[0]?.value) }, o.label)),
  );
  const errorSlot = h('div', { class: 'error-slot' });
  const hint = opts.hint ? h('p', { class: 'hint', id: `${id}-hint` }, opts.hint) : null;
  if (hint) control.setAttribute('aria-describedby', hint.id);
  const root = h('div', { class: 'field' }, h('label', { for: id, class: 'label' }, opts.label), control, hint, errorSlot);
  return { root, control, errorSlot };
}

/** Show an inline error under a control (and flag it invalid). */
export function showError(field: Field<HTMLElement>, code: string, message: string, navoroFor: string): void {
  clearError(field);
  const p = h('p', { class: 'error', 'data-navoro-error': code, role: 'alert' }, message);
  if (navoroFor) p.setAttribute('data-navoro-error-for', navoroFor);
  p.id = `${field.control.id}-error`;
  field.errorSlot.append(p);
  field.control.setAttribute('aria-invalid', 'true');
  const described = field.control.getAttribute('aria-describedby');
  field.control.setAttribute('aria-describedby', [described, p.id].filter(Boolean).join(' '));
}

export function clearError(field: Field<HTMLElement>): void {
  field.errorSlot.replaceChildren();
  field.control.removeAttribute('aria-invalid');
  const errId = `${field.control.id}-error`;
  const described = (field.control.getAttribute('aria-describedby') ?? '').split(' ').filter((x) => x && x !== errId);
  if (described.length) field.control.setAttribute('aria-describedby', described.join(' '));
  else field.control.removeAttribute('aria-describedby');
}

export function pageHeader(title: string, subtitle: string, action?: Node): HTMLElement {
  return h(
    'header',
    { class: 'page-header' },
    h('div', {}, h('h1', { class: 'page-title', tabindex: '-1' }, title), h('p', { class: 'page-sub' }, subtitle)),
    action ? h('div', { class: 'page-actions' }, action) : null,
  );
}
