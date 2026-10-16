/**
 * SDK local mode in real Chromium: script-tag install with a knowledge pack served
 * from the app's own origin, zero other network traffic, walkthroughs that start
 * where the user is, support hand-off, and privacy rules enforced on the device.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { buildPack, parsePackConfig } from '../../server/knowledge/pack-builder.ts';
import type { KnowledgePack } from '../../packages/contracts/src/sdk-types.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const APP = 'http://app.test';
let browser: Browser;
let sdk: string;
let pack: KnowledgePack;

before(async () => {
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath, [path.join(ROOT, 'sdk/scripts/build-sdk.ts')], { stdio: 'ignore' });
  sdk = readFileSync(path.join(ROOT, 'dist/sdk/navoro.js'), 'utf8');
  const demo = path.join(ROOT, 'demo');
  pack = (await buildPack(parsePackConfig(JSON.parse(readFileSync(path.join(demo, 'navoro.config.json'), 'utf8'))), demo)).pack;
  browser = await chromium.launch();
});
after(async () => browser?.close());

/** A tiny app page: sidebar, a Reports screen, a billing region with synthetic sensitive data. */
function appHtml(screen: 'dashboard' | 'reports' | 'form' | 'billing'): string {
  const main = {
    dashboard: '<h1>Dashboard</h1>',
    reports: '<h1>Reports</h1><button data-navoro-id="reports.new-button">New report</button>',
    form: `<h1>New report</h1><form data-navoro-id="report.form">
      <label for="n">Report name</label><input id="n" data-navoro-id="report.name" value="SECRET-REPORT-NAME">
      <label for="s">Data source</label><select id="s" data-navoro-id="report.source" aria-invalid="true"><option>Select a data source</option></select>
      <p data-navoro-error="REPORT_SOURCE_REQUIRED" data-navoro-error-for="report.source">Choose a data source before creating the report.</p>
      <button type="button" data-navoro-id="report.save-button">Create report</button></form>`,
    billing: `<h1>Billing</h1><section data-navoro-id="billing.payment-region" aria-label="Payment method">
      <h2>Payment method</h2><p>Account holder: Jordan Avery (synthetic)</p>
      <label for="c">Card number</label><input id="c" data-navoro-id="billing.card-number" value="4242 4242 4242 4242"></section>
      <div data-lumen-private><h2>Private notes SYNTHETIC-PRIVATE</h2></div>`,
  }[screen];
  return `<!doctype html><html lang="en"><head><title>Lumen</title></head><body>
    <nav><a href="#" data-navoro-id="nav.dashboard">Dashboard</a> <a href="#" data-navoro-id="nav.reports">Reports</a> <a href="#" data-navoro-id="nav.settings">Settings</a></nav>
    <main>${main}</main>
    <script src="/navoro/navoro.js" data-navoro-pack="/navoro/pack.json" defer></script></body></html>`;
}

async function openApp(screen: Parameters<typeof appHtml>[0]): Promise<{ page: Page; other: string[] }> {
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await context.newPage();
  const other: string[] = [];
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === APP && url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: appHtml(screen) });
    if (url.origin === APP && url.pathname === '/navoro/navoro.js') return route.fulfill({ contentType: 'text/javascript', body: sdk });
    if (url.origin === APP && url.pathname === '/navoro/pack.json') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(pack) });
    other.push(`${route.request().method()} ${route.request().url()}`);
    return route.abort();
  });
  await page.goto(`${APP}/`);
  await page.getByRole('button', { name: 'Open Navoro help' }).waitFor();
  return { page, other };
}

async function ask(page: Page, question: string): Promise<void> {
  if (!(await page.evaluate(() => (window as any).Navoro.isOpen()))) await page.getByRole('button', { name: 'Open Navoro help' }).click();
  await page.locator('navoro-root').getByRole('textbox').last().fill(question);
  await page.keyboard.press('Enter');
}

test('local mode: script tag + pack, walkthrough points at the real control, zero other network traffic', async () => {
  const { page, other } = await openApp('dashboard');
  await ask(page, 'How do I create a report?');
  const card = page.locator('[data-navoro-card]');
  await card.waitFor();
  assert.match((await card.textContent()) ?? '', /Step 1 of 7/);
  const ring = await page.locator('[data-navoro-spotlight]').boundingBox();
  const target = await page.locator('[data-navoro-id="nav.reports"]').boundingBox();
  assert.ok(ring && target && ring.x <= target.x && ring.y <= target.y && ring.x + ring.width >= target.x + target.width, 'spotlight wraps the Reports link');
  assert.deepEqual(other, [], 'local mode made no requests besides the SDK file and the pack');
  await page.context().close();
});

test('local mode: walkthrough starts where the user already is', async () => {
  const { page } = await openApp('reports');
  await ask(page, 'How do I create a report?');
  const card = page.locator('[data-navoro-card]');
  await card.waitFor();
  const text = (await card.textContent()) ?? '';
  assert.match(text, /Step 2 of 7/);
  assert.match(text, /already done step 1/);
  await page.context().close();
});

test('local mode: visible error → explanation pointing at the fix; unrelated money question → support hand-off', async () => {
  const { page, other } = await openApp('form');
  await ask(page, "what's wrong?");
  await page.locator('navoro-root .answer').waitFor();
  assert.match(await page.locator('navoro-root .answer').innerText(), /data source/i);
  await ask(page, 'I was charged twice and need a refund');
  const link = page.locator('navoro-root .handoff a');
  await link.waitFor();
  const href = (await link.getAttribute('href')) ?? '';
  assert.ok(href.startsWith('mailto:support@lumen.example?'));
  assert.match(decodeURIComponent(href), /charged twice/);
  assert.equal(await link.getAttribute('target'), null, 'mail links open in place');
  // The typed field value never reaches the engine's context.
  const payload = JSON.stringify(await page.evaluate(() => (window as any).Navoro.getLastPayload()));
  assert.ok(!payload.includes('SECRET-REPORT-NAME'));
  assert.deepEqual(other, []);
  await page.context().close();
});

test('local mode: "No" on a helpful-looking answer offers support', async () => {
  const { page } = await openApp('dashboard');
  await ask(page, 'What does Schedule mean?');
  await page.locator('navoro-root .answer').waitFor();
  assert.equal(await page.locator('navoro-root .handoff').count(), 0, 'no hand-off on a confident answer');
  await page.locator('navoro-root').getByRole('button', { name: 'No', exact: true }).click();
  await page.locator('navoro-root .handoff').waitFor();
  assert.match(await page.locator('navoro-root .handoff').innerText(), /Sorry that didn’t solve it/);
  await page.context().close();
});

test('local mode: privacy rules from the pack are enforced on the device', async () => {
  const { page, other } = await openApp('billing');
  await ask(page, 'how do I change my payment method');
  await page.locator('navoro-root .answer').waitFor();
  const payload = JSON.stringify(await page.evaluate(() => (window as any).Navoro.getLastPayload()));
  for (const secret of ['4242', 'Jordan Avery', 'SYNTHETIC-PRIVATE', 'Payment method', 'billing.']) {
    assert.ok(!payload.includes(secret), `"${secret}" must not be read`);
  }
  // The local inspector is available to anyone (it never leaves the device) and says so.
  assert.match(await page.locator('navoro-root details.inspect summary').innerText(), /never leaves this device/);
  assert.deepEqual(other, []);
  await page.context().close();
});

test('local mode: a broken or missing pack keeps Navoro hidden without breaking the page', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const warnings: string[] = [];
  page.on('console', (m) => m.type() === 'warning' && warnings.push(m.text()));
  page.on('pageerror', (e) => warnings.push(`pageerror ${e.message}`));
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: appHtml('dashboard') });
    if (url.pathname === '/navoro/navoro.js') return route.fulfill({ contentType: 'text/javascript', body: sdk });
    if (url.pathname === '/navoro/pack.json') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ format: 'navoro-pack', version: 99 }) });
    return route.abort();
  });
  await page.goto(`${APP}/`);
  await page.waitForTimeout(500);
  assert.equal(await page.locator('navoro-root').count(), 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? '', /unsupported version/);
  await context.close();
});

/** A page with a header + settings menu, a brand theme-color and Navoro told where to put its (?) button. */
async function openBranded(scriptAttrs: string, extraHead = '', header = '<button class="menu-btn" aria-label="Open menu">☰</button>'): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await context.newPage();
  const html = `<!doctype html><html lang="en"><head><title>Brand</title>${extraHead}</head><body>
    <header style="height:56px;display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:0 16px;color:#223">${header}</header>
    <nav><a href="#" data-navoro-id="nav.reports">Reports</a></nav><main><h1>Dashboard</h1></main>
    <script src="/navoro/navoro.js" data-navoro-pack="/navoro/pack.json" ${scriptAttrs} defer></script></body></html>`;
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
    if (url.pathname === '/navoro/navoro.js') return route.fulfill({ contentType: 'text/javascript', body: sdk });
    if (url.pathname === '/navoro/pack.json') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(pack) });
    return route.abort();
  });
  await page.goto(`${APP}/`);
  return page;
}

test('branding: the page theme-color becomes the highlight colour, with readable text on it', async () => {
  const page = await openBranded('', '<meta name="theme-color" content="#59b2ec">');
  await page.getByRole('button', { name: 'Open Navoro help' }).waitFor();
  const vars = await page.evaluate(() => {
    const root = document.querySelector('navoro-root')?.shadowRoot?.querySelector('.root') as HTMLElement;
    return { accent: root.style.getPropertyValue('--lime'), on: root.style.getPropertyValue('--on-accent') };
  });
  assert.equal(vars.accent, 'rgb(89, 178, 236)');
  assert.equal(vars.on, '#111210', 'dark text on a light blue');
  await page.context().close();
});

test('branding: explicit accent wins; white theme-color is ignored', async () => {
  const explicit = await openBranded('data-navoro-accent="#4338ca"', '<meta name="theme-color" content="#59b2ec">');
  await explicit.getByRole('button', { name: 'Open Navoro help' }).waitFor();
  const a = await explicit.evaluate(() => {
    const root = document.querySelector('navoro-root')?.shadowRoot?.querySelector('.root') as HTMLElement;
    return [root.style.getPropertyValue('--lime'), root.style.getPropertyValue('--on-accent')];
  });
  assert.deepEqual(a, ['rgb(67, 56, 202)', '#FAF8F3'], 'light text on a dark indigo');
  await explicit.context().close();
  const white = await openBranded('', '<meta name="theme-color" content="#ffffff">');
  await white.getByRole('button', { name: 'Open Navoro help' }).waitFor();
  const w = await white.evaluate(() => (document.querySelector('navoro-root')?.shadowRoot?.querySelector('.root') as HTMLElement).style.getPropertyValue('--lime'));
  assert.equal(w, '', 'no brand colour → Navoro default');
  await white.context().close();
});

test('help button: placed right before the app menu, no floating launcher, toggles the panel', async () => {
  const page = await openBranded('data-navoro-button=".menu-btn" data-navoro-button-placement="before"');
  const help = page.getByRole('button', { name: 'Help', exact: true });
  await help.waitFor();
  assert.equal(await page.locator('navoro-root [data-navoro-launcher]').count(), 0);
  const order = await page.evaluate(() => [...document.querySelector('header')!.children].map((el) => el.tagName.toLowerCase()));
  assert.deepEqual(order, ['navoro-help-button', 'button'], 'help icon sits to the left of the menu');
  await help.click();
  assert.equal(await page.evaluate(() => (window as any).Navoro.isOpen()), true);
  assert.equal(await help.getAttribute('aria-expanded'), 'true');
  const panelTop = await page.evaluate(() => {
    const panel = document.querySelector('navoro-root')!.shadowRoot!.querySelector('[role="dialog"], .panel') as HTMLElement;
    return panel.getBoundingClientRect().top;
  });
  assert.ok(panelTop >= 56, `panel opens under the header (top ${panelTop})`);
  await help.click();
  assert.equal(await page.evaluate(() => (window as any).Navoro.isOpen()), false);
  await page.context().close();
});

test('help button: an app-owned [data-navoro-trigger] is shown and wired up', async () => {
  const page = await openBranded('', '', '<button data-navoro-trigger hidden aria-label="Get help">?</button><button class="menu-btn">☰</button>');
  const trigger = page.getByRole('button', { name: 'Get help' });
  await trigger.waitFor({ state: 'visible' });
  assert.equal(await page.locator('navoro-root [data-navoro-launcher]').count(), 0);
  await trigger.click();
  assert.equal(await page.evaluate(() => (window as any).Navoro.isOpen()), true);
  assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
  await page.context().close();
});

test('help button: a trigger the app renders after Navoro loaded still takes over', async () => {
  const page = await openBranded('', '', '<span id="slot"></span><button class="menu-btn">☰</button>');
  await page.getByRole('button', { name: 'Open Navoro help' }).waitFor();
  await page.evaluate(() => {
    const b = document.createElement('button');
    b.setAttribute('data-navoro-trigger', '');
    b.setAttribute('aria-label', 'Late help');
    b.hidden = true;
    b.textContent = '?';
    document.getElementById('slot')!.replaceWith(b);
  });
  const trigger = page.getByRole('button', { name: 'Late help' });
  await trigger.waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('navoro-root')!.shadowRoot!.querySelectorAll('[data-navoro-launcher]').length === 0);
  await trigger.click();
  assert.equal(await page.evaluate(() => (window as any).Navoro.isOpen()), true);
  await page.context().close();
});
