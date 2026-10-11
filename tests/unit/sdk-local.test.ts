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
