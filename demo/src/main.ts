import './styles.css';
import { h, icon } from './ui.ts';
import { installNavoro, resetConfig, resolveConfig, saveKey } from './navoro-install.ts';
import { dashboardView } from './views/dashboard.ts';
import { reportsView } from './views/reports.ts';
import { newReportView } from './views/new-report.ts';
import { integrationsView } from './views/integrations.ts';
import { settingsView } from './views/settings.ts';
import { billingView } from './views/billing.ts';

interface Route {
  path: string;
  nav: string;
  title: string;
  view: () => HTMLElement;
}

const ROUTES: Route[] = [
  { path: '/dashboard', nav: 'dashboard', title: 'Dashboard', view: dashboardView },
  { path: '/reports', nav: 'reports', title: 'Reports', view: reportsView },
  { path: '/reports/new', nav: 'reports', title: 'New report', view: newReportView },
  { path: '/integrations', nav: 'integrations', title: 'Integrations', view: integrationsView },
  { path: '/settings', nav: 'settings', title: 'Settings', view: settingsView },
  { path: '/settings/billing', nav: 'settings', title: 'Billing', view: billingView },
];

const NAV = [
  { id: 'dashboard', label: 'Dashboard', href: '#/dashboard' },
  { id: 'reports', label: 'Reports', href: '#/reports' },
  { id: 'integrations', label: 'Integrations', href: '#/integrations' },
  { id: 'settings', label: 'Settings', href: '#/settings' },
];

const config = resolveConfig();

// ---- Shell -----------------------------------------------------------------

const navLinks = NAV.map((n) => h('a', { href: n.href, class: 'nav-link', 'data-navoro-id': `nav.${n.id}`, 'data-nav': n.id }, icon(n.id, 18), n.label));
const sidebar = h(
  'aside',
  { class: 'sidebar', id: 'sidebar' },
  h('a', { href: '#/dashboard', class: 'brand', 'aria-label': 'Lumen Analytics home' }, h('span', { class: 'brand-mark', 'aria-hidden': 'true' }), 'Lumen'),
  h('nav', { class: 'nav', 'aria-label': 'Main' }, navLinks),
  h('div', { class: 'sidebar-foot' }, h('span', { class: 'avatar', 'aria-hidden': 'true' }, 'NO'), h('div', { class: 'ws' }, h('span', { class: 'ws-name' }, 'Northwind Ops'), h('span', { class: 'muted small' }, 'Team plan'))),
);

const scrim = h('div', { class: 'scrim', onclick: () => setDrawer(false) });
const menuBtn = h('button', { type: 'button', class: 'icon-btn menu-btn', 'aria-label': 'Open navigation', 'aria-controls': 'sidebar', 'aria-expanded': 'false', onclick: () => setDrawer(!document.body.classList.contains('drawer-open')) }, icon('menu', 20));
function setDrawer(open: boolean): void {
  document.body.classList.toggle('drawer-open', open);
  menuBtn.setAttribute('aria-expanded', String(open));
}

// Demo controls popover (Navoro install details)
const keyInput = h('input', { id: 'demo-key', class: 'input', value: config.key, spellcheck: false, autocomplete: 'off' });
const popover = h(
  'div',
  { class: 'popover', id: 'demo-pop', hidden: true, role: 'dialog', 'aria-label': 'Demo controls' },
  h('h2', { class: 'pop-title' }, 'Navoro install'),
  h('p', { class: 'muted small' }, 'This demo app embeds the Navoro SDK with a single script tag. Nothing else is shared with it.'),
  config.mode === 'local'
    ? h('dl', { class: 'kv' }, h('dt', {}, 'Mode'), h('dd', {}, 'Local: SDK and knowledge pack served by this site, no Navoro server'))
    : h('dl', { class: 'kv' }, h('dt', {}, 'Origin'), h('dd', {}, config.origin), h('dt', {}, 'Environment'), h('dd', {}, config.env)),
  h('label', { for: 'demo-key', class: 'label' }, 'Public key'),
  keyInput,
  h(
    'div',
    { class: 'form-actions' },
    h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => resetConfig() }, 'Reset defaults'),
    h('button', { type: 'button', class: 'btn btn-primary', onclick: () => { const k = keyInput.value.trim(); if (k) saveKey(k); } }, 'Apply & reload'),
  ),
);
const demoBtn = h('button', { type: 'button', class: 'btn btn-sm', 'aria-expanded': 'false', 'aria-controls': 'demo-pop', onclick: () => togglePop() }, icon('sliders', 15), h('span', { class: 'btn-label' }, 'Demo controls'));
function togglePop(force?: boolean): void {
  const open = force ?? popover.hidden === true;
  popover.hidden = !open;
  demoBtn.setAttribute('aria-expanded', String(open));
  if (open) keyInput.focus();
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!popover.hidden) { togglePop(false); demoBtn.focus(); }
    setDrawer(false);
  }
});
document.addEventListener('click', (e) => {
  const t = e.target as Node;
  if (!popover.hidden && !popover.contains(t) && !demoBtn.contains(t)) togglePop(false);
});

// Local mode: Navoro wires this button up (data-navoro-trigger) and un-hides it once it's ready.
const helpBtn = h('button', { type: 'button', class: 'icon-btn help-btn', 'aria-label': 'Help', title: 'Help', hidden: true, ...(config.mode === 'local' ? { 'data-navoro-trigger': '' } : {}) }, icon('help', 20));

const crumb = h('span', { class: 'crumb' });
const topbar = h('header', { class: 'topbar' }, menuBtn, crumb, h('div', { class: 'topbar-end' }, helpBtn, h('div', { class: 'pop-wrap' }, demoBtn, popover), h('span', { class: 'avatar avatar-me', role: 'img', 'aria-label': 'Signed in as Jordan Avery (synthetic)' }, 'JA')));

const banner = h('div', { class: 'banner', role: 'status', hidden: true }, h('span', {}, config.mode === 'local' ? 'Navoro couldn’t be loaded from this site (navoro/navoro.js).' : `Navoro SDK couldn't be loaded from ${config.origin} — is the Navoro server running?`), h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Dismiss', onclick: () => { banner.hidden = true; } }, icon('close', 16)));
const outlet = h('main', { class: 'main', id: 'main' });
const root = document.getElementById('app');
root?.append(h('a', { href: '#main', class: 'skip', onclick: (e: Event) => { e.preventDefault(); outlet.querySelector<HTMLElement>('h1')?.focus(); } }, 'Skip to content'), sidebar, scrim, h('div', { class: 'content' }, banner, topbar, outlet));

// ---- Router ----------------------------------------------------------------

let first = true;
function render(): void {
  const path = (location.hash.replace(/^#/, '') || '/dashboard').split('?')[0] ?? '/dashboard';
  const route = ROUTES.find((r) => r.path === path) ?? ROUTES[0]!;
  if (!ROUTES.some((r) => r.path === path)) history.replaceState(null, '', '#/dashboard');
  outlet.replaceChildren(route.view());
  crumb.textContent = route.title;
  document.title = `${route.title} · Lumen Analytics`;
  for (const a of navLinks) {
    const active = a.dataset.nav === route.nav;
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  setDrawer(false);
  window.scrollTo(0, 0);
  if (!first) outlet.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
  first = false;
}
window.addEventListener('hashchange', render);
render();

// ---- Navoro SDK (installed exactly like a customer would) ---------------------

installNavoro(config, () => { banner.hidden = false; });
