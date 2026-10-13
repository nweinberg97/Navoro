/**
 * Browser-level SDK tests: real Chromium (Playwright), real bundle, mocked Navoro API.
 * Covers the privacy collector, resolver, overlay isolation and full teardown.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page, type Route } from 'playwright';
import { buildSdk } from '../../sdk/scripts/build-sdk.ts';
import type { GuidanceResult, PublicSdkConfig, SanitizedContext } from '../../packages/contracts/src/sdk-types.ts';

const APP = 'https://app.lumen.test';
const API = 'https://api.navoro.test';
const SENSITIVE = ['SYNTHETIC-PW-123', 'Jordan Avery', 'SYNTHETIC', '4111 1111', 'typed-by-user', 'ssn-secret-hint', 'Token label'];

const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><title>Reports · Lumen</title>
<style>body{font-family:sans-serif;margin:0;padding:20px} .gone{display:none} .tall{height:1800px}</style></head>
<body>
  <h1>Reports</h1>
  <h2>Quarterly overview</h2>
  <h2 class="gone">Hidden heading</h2>
  <nav><a href="#/reports" data-navoro-id="nav.reports">Reports</a></nav>
  <button data-navoro-id="reports.new" type="button">New report</button>
  <button data-navoro-id="reports.export" aria-label="Export CSV" type="button" disabled>⇩</button>
  <button data-navoro-id="reports.unapproved" type="button">Unapproved action</button>
  <label for="name">Report name</label>
  <input id="name" data-navoro-id="reports.name" value="typed-by-user" placeholder="typed-by-user" aria-invalid="true">
  <div data-navoro-error="name_required" data-navoro-error-for="reports.name">Report name is required</div>
  <label>Password <input type="password" data-navoro-id="login.password" value="SYNTHETIC-PW-123"></label>
  <label>Card <input data-navoro-id="billing.number" autocomplete="cc-number" value="4111 1111 1111 1111"></label>
  <label>Token label <input name="api_token" data-navoro-id="settings.token" value="abc"></label>
  <section data-navoro-sensitive>
    <h2>Jordan Avery SYNTHETIC</h2>
    <button data-navoro-id="profile.edit" type="button">Edit Jordan Avery SYNTHETIC</button>
    <div data-navoro-error="x">Jordan Avery SYNTHETIC has an error</div>
  </section>
  <div class="admin-blocked"><button data-navoro-id="admin.secret" type="button">ssn-secret-hint</button></div>
  <div data-navoro-id="blocked.region"><button data-navoro-id="blocked.child" type="button">Blocked child</button></div>
  <button type="button">Save</button>
  <button type="button">Save</button>
  <button type="button" aria-label="Archive">🗄</button>
  <button type="button" data-navoro-id="share.btn" aria-labelledby="who">Share</button>
  <span data-navoro-sensitive><span id="who">Jordan Avery SYNTHETIC</span></span>
  <button type="button" data-navoro-id="hidden.btn" style="visibility:hidden">Hidden action</button>
  <details><summary>More</summary><button type="button" data-navoro-id="details.btn">Inside details</button></details>
  <div class="tall"></div>
  <button type="button" data-navoro-id="far.btn">Far away</button>
</body></html>`;

const POLICY: PublicSdkConfig['privacy'] = {
  observe: ['route', 'pageTitle', 'headings', 'elements', 'fieldLabels', 'visibleErrors'],
  transmit: ['route', 'pageTitle', 'headings', 'elements', 'fieldLabels', 'visibleErrors'],
  blockedNavoroIds: ['blocked.region'],
  blockedSelectors: ['.admin-blocked', ':::not a selector'],
  approvedNavoroIds: [
    'nav.reports',
    'reports.new',
    'reports.export',
    'reports.name',
    'login.password',
    'billing.number',
    'settings.token',
    'profile.edit',
    'admin.secret',
    'blocked.child',
    'hidden.btn',
    'far.btn',
    'share.btn',
  ],
  allowlistOnly: true,
};

function config(overrides: Partial<PublicSdkConfig> = {}): PublicSdkConfig {
  return {
    applicationName: 'Lumen',
    environment: 'development',
    configVersion: 3,
    privacy: POLICY,
    analyticsEnabled: true,
    discoveryEnabled: false,
    launcher: { position: 'bottom-right', greeting: 'What are you trying to do?', suggestions: ['Create a report'] },
    supportUrl: null,
    ...overrides,
  };
}

function workflowResult(requestId: string): GuidanceResult {
  return {
    sessionId: 'sess_test',
    requestId,
    kind: 'workflow',
    answer: '<img src=x onerror="window.__xss=1">Click New report, then name it.',
    grounded: true,
    confidence: 0.92,
    workflow: { id: 'wf_new_report', title: 'Create a report' },
    steps: [
      {
        index: 0,
        title: 'Open the report builder',
        instruction: 'Click “New report”.',
        target: { key: 'reports.new', label: 'New report', strategies: [{ type: 'navoro_id', value: 'reports.new' }], confidence: 1, validation: 'valid' },
        targetNote: null,
      },
      {
        index: 1,
        title: 'Find the scheduler',
        instruction: 'Open the scheduler.',
        target: { key: 'reports.schedule', label: 'Schedule', strategies: [{ type: 'navoro_id', value: 'reports.schedule' }], confidence: 0.6, validation: 'unverified' },
        targetNote: 'It may be under More.',
      },
    ],
    citations: [{ sourceId: 'doc1', sourceTitle: 'Reports guide', excerpt: 'Use New report to start.' }],
    mode: 'demo',
    fallback: { label: 'Read the guide', url: 'javascript:alert(1)' },
  };
}

let browser: Browser;
let bundle: string;
let tmp: string;

before(async () => {
  tmp = mkdtempSync(path.join(tmpdir(), 'navoro-sdk-'));
  bundle = readFileSync(await buildSdk(path.join(tmp, 'navoro.js')), 'utf8');
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  rmSync(tmp, { recursive: true, force: true });
});

interface ApiLog {
  bodies: { url: string; body: string; auth: string | null }[];
}

/** Serves the fixture page, the SDK bundle and a mock Navoro API. */
async function openPage(
  opts: { scriptAttrs?: string; initStatus?: number; cfg?: PublicSdkConfig; guidance?: (req: { requestId: string }) => string; guidanceDelayMs?: number; reducedMotion?: boolean } = {},
): Promise<{ page: Page; log: ApiLog; warnings: string[] }> {
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, reducedMotion: opts.reducedMotion ? 'reduce' : 'no-preference' });
  const page = await context.newPage();
  const log: ApiLog = { bodies: [] };
  const warnings: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'warning') warnings.push(m.text());
  });
  page.on('pageerror', (e) => warnings.push(`pageerror: ${e.message}`));
  const cors = { 'access-control-allow-origin': APP, 'access-control-allow-headers': 'content-type, authorization' };
  await page.route(`${API}/**`, async (route: Route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const url = req.url();
    log.bodies.push({ url, body: req.postData() ?? '', auth: (await req.allHeaders()).authorization ?? null });
    if (url.endsWith('/sdk/v1/navoro.js')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: bundle, headers: cors });
    if (url.endsWith('/api/sdk/v1/init')) {
      if (opts.initStatus && opts.initStatus !== 200) return route.fulfill({ status: opts.initStatus, headers: cors, contentType: 'application/json', body: '{"error":"origin_not_allowed"}' });
      return route.fulfill({
        status: 200,
        headers: cors,
        contentType: 'application/json',
        body: JSON.stringify({ apiVersion: 1, sessionToken: 'tok_1', expiresAt: new Date(Date.now() + 600_000).toISOString(), config: opts.cfg ?? config() }),
      });
    }
    if (url.endsWith('/api/sdk/v1/guidance')) {
      const body = JSON.parse(req.postData() ?? '{}') as { requestId: string };
      if (opts.guidanceDelayMs) await new Promise((r) => setTimeout(r, opts.guidanceDelayMs));
      const ndjson = opts.guidance
        ? opts.guidance(body)
        : [JSON.stringify({ type: 'status', phase: 'retrieving' }), JSON.stringify({ type: 'result', result: workflowResult(body.requestId) })].join('\n') + '\n';
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/x-ndjson', body: ndjson }).catch(() => undefined);
    }
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{"ok":true}' });
  });
  await page.route(`${APP}/**`, (route) => {
    const html = FIXTURE.replace(
      '</body>',
      opts.scriptAttrs === undefined ? '</body>' : `<script src="${API}/sdk/v1/navoro.js" ${opts.scriptAttrs}></script></body>`,
    );
    return route.fulfill({ status: 200, contentType: 'text/html', body: html });
  });
  await page.goto(`${APP}/customers/123456/reports?token=SECRET-QUERY#/list?q=jordan`);
  if (opts.scriptAttrs === undefined) await page.addScriptTag({ content: bundle });
  return { page, log, warnings };
}

function assertNoSensitive(serialized: string, where: string): void {
  for (const s of SENSITIVE) assert.ok(!serialized.includes(s), `${where} leaked "${s}": ${serialized}`);
  assert.ok(!serialized.includes('SECRET-QUERY'), `${where} leaked query string`);
}

test('collector: allowlist-only payload with privacy blinders', async () => {
  const { page } = await openPage();
  const ctx = (await page.evaluate((policy) => (window as any).NavoroSDK.__test.collectContext(document, policy), POLICY)) as SanitizedContext;
  const json = JSON.stringify(ctx);
  assertNoSensitive(json, 'collectContext');

  assert.equal(ctx.route, '/customers/:id/reports#/list');
  assert.equal(ctx.pageTitle, 'Reports · Lumen');
  assert.deepEqual(ctx.headings, ['Reports', 'Quarterly overview']);
  const ids = (ctx.elements ?? []).map((e) => e.navoroId);
  assert.ok(ids.includes('reports.new'));
  assert.ok(!ids.includes('reports.unapproved'), 'unapproved elements are excluded');
  for (const blocked of ['login.password', 'billing.number', 'profile.edit', 'admin.secret', 'blocked.child']) {
    assert.ok(!ids.includes(blocked), `${blocked} must be blocked`);
  }
  // Visible elements are preferred: in-viewport first, hidden ones last.
  assert.ok(ids.indexOf('far.btn') > ids.indexOf('reports.new'));
  assert.equal(ids.at(-1), 'hidden.btn');

  const name = ctx.elements?.find((e) => e.navoroId === 'reports.name');
  assert.deepEqual(name, { navoroId: 'reports.name', role: 'textbox', label: 'Report name', disabled: false, invalid: true });
  const exp = ctx.elements?.find((e) => e.navoroId === 'reports.export');
  assert.equal(exp?.label, 'Export CSV');
  assert.equal(exp?.disabled, true);
  const token = ctx.elements?.find((e) => e.navoroId === 'settings.token');
  assert.equal(token?.label, null, 'sensitive-named field label is withheld');
  assert.equal(ctx.elements?.find((e) => e.navoroId === 'nav.reports')?.role, 'link');
  // aria-labelledby into a sensitive region yields no label text, falling back to own text.
  assert.equal(ctx.elements?.find((e) => e.navoroId === 'share.btn')?.label, 'Share');

  assert.deepEqual(ctx.fieldLabels, ['Report name']);
  assert.deepEqual(ctx.visibleErrors, [{ code: 'name_required', message: 'Report name is required', nearNavoroId: 'reports.name' }]);
  await page.context().close();
});

test('collector: only categories in both observe and transmit are included', async () => {
  const { page } = await openPage();
  const ctx = (await page.evaluate(
    (policy) => (window as any).NavoroSDK.__test.collectContext(document, policy),
    { ...POLICY, observe: ['route', 'headings', 'elements'], transmit: ['route', 'pageTitle', 'elements'] },
  )) as SanitizedContext;
  assert.deepEqual(Object.keys(ctx).sort(), ['elements', 'route']);
  await page.context().close();
});

test('resolver: navoro id, aria label, text, ambiguity and visibility rules', async () => {
  const { page } = await openPage();
  const r = await page.evaluate(() => {
    const { resolveTarget } = (window as any).NavoroSDK.__test;
    const t = (strategies: unknown[]) => ({ key: 'k', label: 'L', strategies, confidence: 1, validation: 'valid' });
    const describe = (res: { element: Element | null; strategy: string | null; reason: string }) => ({
      id: res.element?.getAttribute('data-navoro-id') ?? res.element?.textContent ?? null,
      strategy: res.strategy,
      reason: res.reason,
    });
    return {
      byId: describe(resolveTarget(t([{ type: 'navoro_id', value: 'reports.new' }]))),
      injection: describe(resolveTarget(t([{ type: 'navoro_id', value: '"], body, [x="' }]))),
      fallback: describe(resolveTarget(t([{ type: 'navoro_id', value: 'missing' }, { type: 'aria_label', value: 'export csv', role: 'button' }]))),
      ariaWrongRole: describe(resolveTarget(t([{ type: 'aria_label', value: 'Export CSV', role: 'link' }]))),
      text: describe(resolveTarget(t([{ type: 'text', value: 'new  REPORT' }]))),
      prefix: describe(resolveTarget(t([{ type: 'text', value: 'Unapproved' }]))),
      ambiguous: describe(resolveTarget(t([{ type: 'text', value: 'Save' }]))),
      hidden: describe(resolveTarget(t([{ type: 'navoro_id', value: 'hidden.btn' }]))),
      closedDetails: describe(resolveTarget(t([{ type: 'navoro_id', value: 'details.btn' }]))),
      cssHidden: describe(resolveTarget(t([{ type: 'text', value: 'Hidden heading' }]))),
      faded: (() => {
        const menu = document.createElement('div');
        menu.style.opacity = '0';
        menu.innerHTML = '<button data-navoro-id="menu.faded">Timely</button>';
        document.body.append(menu);
        const before = describe(resolveTarget(t([{ type: 'navoro_id', value: 'menu.faded' }]))).reason;
        menu.style.opacity = '1';
        const after = describe(resolveTarget(t([{ type: 'navoro_id', value: 'menu.faded' }]))).reason;
        menu.remove();
        return { before, after };
      })(),
      none: describe(resolveTarget(null)),
      aria: describe(resolveTarget(t([{ type: 'aria_label', value: 'Archive' }]))),
    };
  });
  assert.deepEqual(r.byId, { id: 'reports.new', strategy: 'navoro_id', reason: 'found' });
  assert.equal(r.injection.reason, 'not_found', 'server strings are escaped, never used as selectors');
  assert.deepEqual(r.fallback, { id: 'reports.export', strategy: 'aria_label', reason: 'found' });
  assert.equal(r.ariaWrongRole.reason, 'not_found');
  assert.deepEqual(r.text, { id: 'reports.new', strategy: 'text', reason: 'found' });
  assert.equal(r.prefix.id, 'reports.unapproved');
  assert.deepEqual(r.ambiguous, { id: null, strategy: 'text', reason: 'ambiguous' });
  assert.equal(r.hidden.reason, 'hidden');
  assert.equal(r.closedDetails.reason, 'hidden');
  assert.equal(r.cssHidden.id, null);
  assert.deepEqual(r.faded, { before: 'hidden', after: 'found' }, 'a faded-out menu is not a visible target');
  assert.equal(r.none.reason, 'no_strategies');
  assert.equal(r.aria.reason, 'found');
  await page.context().close();
});

test('end-to-end: script-tag install, guidance stream, shadow overlay, safe rendering, destroy()', async () => {
  const { page, log, warnings } = await openPage({ scriptAttrs: 'data-navoro-key="nav_pk_test" data-navoro-env="development" defer' });
  await page.waitForFunction(() => document.querySelector('navoro-root')?.shadowRoot?.querySelector('[data-navoro-launcher]'));
  const initCall = log.bodies.find((b) => b.url.endsWith('/init'));
  assert.ok(initCall, 'init was called on the API origin derived from the script src');
  assert.deepEqual(JSON.parse(initCall.body), { publicKey: 'nav_pk_test', environment: 'development', sdkVersion: '0.1.0' });

  // Launcher lives in the shadow root and has the right accessible name.
  const launcher = page.getByRole('button', { name: 'Open Navoro help' });
  await launcher.click();
  const dialog = page.getByRole('dialog');
  assert.equal(await dialog.getAttribute('aria-modal'), 'false');

  // Type into the HOST input first — the SDK must never read it.
  await page.fill('#name', 'typed-by-user');
  await page.getByRole('textbox', { name: 'Your question' }).fill('How do I create a report?');
  await page.keyboard.press('Enter');

  await page.waitForFunction(() => document.querySelector('navoro-root')?.shadowRoot?.querySelector('[data-navoro-spotlight]'));
  const guidanceCall = log.bodies.find((b) => b.url.endsWith('/guidance'));
  assert.ok(guidanceCall);
  assert.equal(guidanceCall.auth, 'Bearer tok_1');
  assertNoSensitive(guidanceCall.body, 'guidance request');
  const sent = JSON.parse(guidanceCall.body) as { question: string; context: SanitizedContext };
  assert.equal(sent.question, 'How do I create a report?');
  assert.ok(sent.context.elements?.some((e) => e.navoroId === 'reports.new'));

  const payload = await page.evaluate(() => (window as any).Navoro.getLastPayload());
  assert.deepEqual(payload, sent.context);

  const overlay = await page.evaluate(() => {
    const host = document.querySelector('navoro-root')!;
    const shadow = host.shadowRoot!;
    const spot = shadow.querySelector('[data-navoro-spotlight]') as HTMLElement;
    const layer = shadow.querySelector('[data-navoro-layer]') as HTMLElement;
    const target = document.querySelector('[data-navoro-id="reports.new"]')!.getBoundingClientRect();
    const ring = spot.getBoundingClientRect();
    return {
      hostInBody: host.parentElement === document.body,
      openShadow: host.shadowRoot !== null,
      spotPointer: getComputedStyle(spot).pointerEvents,
      layerPointer: getComputedStyle(layer).pointerEvents,
      ringWraps: ring.left <= target.left && ring.right >= target.right && ring.top <= target.top && ring.bottom >= target.bottom,
      card: shadow.querySelector('[data-navoro-card]')?.textContent ?? '',
      xss: (window as any).__xss ?? null,
      imgInShadow: shadow.querySelectorAll('img').length,
      panelText: shadow.querySelector('[data-navoro-panel]')?.textContent ?? '',
      links: [...shadow.querySelectorAll('a')].map((a) => a.getAttribute('href')),
    };
  });
  assert.equal(overlay.hostInBody, true);
  assert.equal(overlay.openShadow, true);
  assert.equal(overlay.spotPointer, 'none');
  assert.equal(overlay.layerPointer, 'none');
  assert.equal(overlay.ringWraps, true);
  assert.match(overlay.card, /Step 1 of 2/);
  assert.match(overlay.card, /Open the report builder/);
  assert.equal(overlay.xss, null, 'server text is never parsed as HTML');
  assert.equal(overlay.imgInShadow, 0);
  assert.match(overlay.panelText, /Demo mode/);
  assert.ok(!overlay.links.includes('javascript:alert(1)'), 'non-http fallback URLs are not linked');

  // The host page stays usable underneath the overlay.
  await page.evaluate(() => {
    (window as any).__clicked = 0;
    document.querySelector('[data-navoro-id="reports.new"]')!.addEventListener('click', () => (window as any).__clicked++);
  });
  await page.mouse.click(...(await page.evaluate(() => {
    const r = document.querySelector('[data-navoro-id="reports.new"]')!.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2] as [number, number];
  })));
  assert.equal(await page.evaluate(() => (window as any).__clicked), 1);

  // Follow-along: activating the highlighted control advances to the next step on its own.
  // Step 2 has no resolvable target → docked card with explanation.
  await page.waitForFunction(() => /couldn’t find “Schedule”/.test(document.querySelector('navoro-root')!.shadowRoot!.querySelector('[data-navoro-card]')?.textContent ?? ''));
  assert.equal(await page.evaluate(() => document.querySelector('navoro-root')!.shadowRoot!.querySelector('[data-navoro-spotlight]')), null);
  await page.getByRole('button', { name: 'Done' }).click();
  await page.waitForFunction(() => /back on track/.test(document.querySelector('navoro-root')!.shadowRoot!.textContent ?? ''));

  // Analytics never contain question text.
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  await page.waitForTimeout(100);
  const events = log.bodies.filter((b) => b.url.endsWith('/events'));
  assert.ok(events.length > 0, 'events were flushed');
  for (const e of events) assert.ok(!e.body.includes('create a report'), 'no question text in events');
  assert.ok(events.some((e) => e.body.includes('step_target_missing')));

  await page.evaluate(() => (window as any).Navoro.destroy());
  const leftovers = await page.evaluate(() => document.querySelectorAll('navoro-root, [data-navoro-host]').length);
  assert.equal(leftovers, 0, 'destroy() removes every Navoro node');
  // A second destroy and a re-init are safe.
  await page.evaluate(() => (window as any).Navoro.destroy());
  assert.deepEqual(warnings.filter((w) => w.startsWith('pageerror')), []);
  await page.context().close();
});

test('Escape stops an in-flight request; stale results are ignored', async () => {
  const { page, log } = await openPage({ scriptAttrs: 'data-navoro-key="nav_pk_test"', guidanceDelayMs: 600 });
  await page.waitForFunction(() => document.querySelector('navoro-root')?.shadowRoot?.querySelector('[data-navoro-launcher]'));
  const states: string[] = [];
  await page.exposeFunction('__state', (s: string) => states.push(s));
  await page.evaluate(() => (window as any).Navoro.on('state', (s: { status: string }) => (window as any).__state(s.status)));
  await page.evaluate(() => void (window as any).Navoro.ask('How do I export?'));
  await page.waitForFunction(() => /Looking through the docs|Stop/.test(document.querySelector('navoro-root')!.shadowRoot!.textContent ?? ''));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(900);
  assert.ok(states.includes('cancelled'), `states: ${states.join(',')}`);
  assert.ok(!states.includes('showing_guidance'), 'late result after cancel is dropped');
  assert.equal(await page.evaluate(() => document.querySelector('navoro-root')!.shadowRoot!.querySelector('[data-navoro-spotlight]')), null);
  assert.ok(log.bodies.some((b) => b.url.endsWith('/guidance')));
  await page.context().close();
});

test('host launcher mode: no floating launcher, top-anchored panel, panel events, focus returns to the host trigger', async () => {
  const { page } = await openPage({ scriptAttrs: 'data-navoro-key="nav_pk_test" data-navoro-launcher="hidden" data-navoro-panel="top-right" data-navoro-panel-offset="64"' });
  await page.waitForFunction(() => document.querySelector('navoro-root')?.shadowRoot?.querySelector('[data-navoro-panel]'));
  assert.equal(await page.evaluate(() => document.querySelector('navoro-root')!.shadowRoot!.querySelector('[data-navoro-launcher]')), null, 'no floating launcher');
  await page.evaluate(() => {
    const trigger = document.createElement('button');
    trigger.id = 'host-help';
    trigger.textContent = 'Help';
    trigger.addEventListener('click', () => ((window as any).Navoro.isOpen() ? (window as any).Navoro.close() : (window as any).Navoro.open()));
    document.body.prepend(trigger);
    (window as any).__panelEvents = [];
    (window as any).Navoro.on('panel', (open: boolean) => (window as any).__panelEvents.push(open));
  });
  await page.locator('#host-help').focus();
  await page.locator('#host-help').click();
  const geometry = await page.evaluate(() => {
    const panel = document.querySelector('navoro-root')!.shadowRoot!.querySelector('[data-navoro-panel]') as HTMLElement;
    const r = panel.getBoundingClientRect();
    // Computed `top` (not the box) so the entrance animation's transform doesn't skew the reading.
    return { top: parseFloat(getComputedStyle(panel).top), rightGap: innerWidth - r.right, open: (window as any).Navoro.isOpen() };
  });
  assert.equal(geometry.open, true);
  assert.equal(Math.round(geometry.top), 64, 'panel sits under the host header');
  assert.ok(geometry.rightGap >= 0 && geometry.rightGap <= 24, 'panel is anchored right');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !(window as any).Navoro.isOpen());
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'host-help', 'focus returns to the host trigger');
  assert.deepEqual(await page.evaluate(() => (window as any).__panelEvents), [true, false]);
  await page.context().close();
});

test('403 origin-not-allowed renders nothing and warns once', async () => {
  const { page, warnings } = await openPage({ scriptAttrs: 'data-navoro-key="nav_pk_test"', initStatus: 403 });
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.querySelectorAll('navoro-root').length), 0);
  const navoroWarnings = warnings.filter((w) => w.includes('[Navoro]'));
  assert.equal(navoroWarnings.length, 1, navoroWarnings.join('\n'));
  await page.context().close();
});

test('data-navoro-auto="false" disables auto-init; double init is safe', async () => {
  const { page, log } = await openPage({ scriptAttrs: 'data-navoro-key="nav_pk_test" data-navoro-auto="false"' });
  await page.waitForTimeout(200);
  assert.equal(log.bodies.filter((b) => b.url.endsWith('/init')).length, 0);
  await page.evaluate(async (api) => {
    const N = (window as any).Navoro;
    await Promise.all([N.init({ publicKey: 'nav_pk_x', environment: 'production', apiOrigin: api }), N.init({ publicKey: 'nav_pk_x', environment: 'production', apiOrigin: api })]);
    await N.init({ publicKey: 'nav_pk_y', environment: 'production', apiOrigin: api });
  }, API);
  assert.equal(await page.evaluate(() => document.querySelectorAll('navoro-root').length), 1);
  assert.equal(log.bodies.filter((b) => b.url.endsWith('/init')).length, 2);
  // Production: payload inspector is unavailable.
  assert.equal(await page.evaluate(() => (window as any).Navoro.getLastPayload()), null);
  await page.context().close();
});

test('discovery (development) sends structure only — no values', async () => {
  const { page, log } = await openPage({ scriptAttrs: 'data-navoro-key="nav_pk_test"', cfg: config({ discoveryEnabled: true }) });
  await page.waitForTimeout(1900);
  const call = log.bodies.find((b) => b.url.endsWith('/discovery'));
  assert.ok(call, 'discovery posted');
  assertNoSensitive(call.body, 'discovery');
  const req = JSON.parse(call.body) as { route: string; elements: { navoroId: string; label: string | null; inputType: string | null }[] };
  assert.equal(req.route, '/customers/:id/reports#/list');
  const ids = req.elements.map((e) => e.navoroId);
  assert.ok(ids.includes('reports.unapproved'), 'discovery includes unapproved (training) elements');
  assert.ok(!ids.includes('profile.edit') && !ids.includes('blocked.child') && !ids.includes('admin.secret'));
  assert.equal(req.elements.find((e) => e.navoroId === 'login.password')?.label ?? null, null);
  await page.context().close();
});
