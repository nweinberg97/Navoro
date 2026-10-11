/**
 * SDK privacy in the real demo app against the real server (seeded workspace):
 * synthetic sensitive values on the billing, settings and integrations pages
 * must never appear in any request body sent to /api/sdk/v1/* — guidance,
 * discovery or events — and getLastPayload() must match what was sent.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import type { PublicSdkConfig, SanitizedContext } from '../../packages/contracts/src/sdk-types.ts';
import { askInPanel, demoUrl, DEMO_PUBLIC_KEY, eventually, launcher, newPage, panel, startEnv, withScreenshots, type Env, type Monitor } from './helpers.ts';

const SENSITIVE = [
  '4242 4242 4242 4242',
  '4242',
  'Jordan Avery',
  'Jordan Avery (synthetic)',
  'SYN-00-0000000',
  'SYNTHETIC-PASSWORD-9',
  'lum_live_SYNTHETIC',
  'Account holder',
];

let env: Env;
before(async () => {
  env = await startEnv({ seed: true });
});
after(async () => {
  await env?.close();
});

async function askAndWait(page: Page, question: string): Promise<void> {
  const response = page.waitForResponse((r) => r.url().endsWith('/api/sdk/v1/guidance') && r.request().method() === 'POST');
  await askInPanel(page, question);
  await response;
  await panel(page).getByText('Was this helpful?').waitFor();
  // Close the panel so it doesn't sit over host controls we interact with next.
  await panel(page).getByRole('button', { name: 'Close help' }).click();
  await panel(page).waitFor({ state: 'hidden' });
}

function guidanceBodies(mon: Monitor): Array<{ question: string; context: SanitizedContext }> {
  return mon.sdkRequests.filter((r) => r.path === 'guidance').map((r) => JSON.parse(r.body) as { question: string; context: SanitizedContext });
}

test('no synthetic sensitive value ever leaves the browser; payload is allowlisted and inspectable', async () => {
  await withScreenshots('sdk-privacy', async (track) => {
    const { page, mon, context } = await newPage(env);
    track(page);
    const initResponse = page.waitForResponse((r) => r.url().endsWith('/api/sdk/v1/init'));
    await page.goto(demoUrl(env, DEMO_PUBLIC_KEY, '#/settings/billing'));
    const init = (await (await initResponse).json()) as { config: PublicSdkConfig };
    const policy = init.config.privacy;
    assert.ok(policy.blockedNavoroIds.includes('billing.payment-region'), 'payment region is blocked by the published policy');
    assert.equal(init.config.discoveryEnabled, true, 'development discovery is on for the seeded app');

    await page.getByRole('heading', { name: 'Payment method' }).waitFor();
    // The synthetic values really are on the page (so the test would catch a leak).
    assert.equal(await page.locator('[data-navoro-id="billing.card-number"]').inputValue(), '4242 4242 4242 4242');
    assert.equal(await page.locator('[data-navoro-id="billing.tax-id"]').inputValue(), 'SYN-00-0000000');
    await launcher(page).waitFor();

    // Discovery for the billing route.
    await eventually(async () => mon.sdkRequests.some((r) => r.path === 'discovery'), 8_000);

    await askAndWait(page, 'How do I update my payment method?');
    let sent = guidanceBodies(mon).at(-1)!;
    let lastPayload = (await page.evaluate(() => (window as any).Navoro.getLastPayload())) as SanitizedContext;
    assert.deepEqual(lastPayload, sent.context, 'getLastPayload() equals the billing guidance context');
    assert.equal(sent.context.route, '/#/settings/billing');

    // Settings page carries the synthetic API token (blocked by policy).
    await page.evaluate(() => {
      location.hash = '#/settings';
    });
    await page.getByRole('heading', { name: 'Developer' }).waitFor();
    assert.match(await page.locator('[data-navoro-id="settings.api-token"]').inputValue(), /lum_live_SYNTHETIC/);
    await eventually(async () => mon.sdkRequests.filter((r) => r.path === 'discovery').length >= 2, 8_000);
    await askAndWait(page, 'Where do I find my API token?');

    // Integrations: type a synthetic password into the warehouse form.
    await page.evaluate(() => {
      location.hash = '#/integrations';
    });
    await page.getByRole('button', { name: 'Connect warehouse' }).click();
    await page.locator('[data-navoro-id="warehouse.username"]').fill('analyst_typed');
    await page.locator('[data-navoro-id="warehouse.password"]').fill('SYNTHETIC-PASSWORD-9');
    // A visible auth error names the username — it is app text, but the password must never appear.
    await page.getByRole('button', { name: 'Test connection' }).click();
    await page.locator('[data-navoro-error="WAREHOUSE_AUTH_FAILED"]').waitFor();
    await eventually(async () => mon.sdkRequests.filter((r) => r.path === 'discovery').length >= 3, 8_000);
    await askAndWait(page, 'Why can’t I connect my warehouse?');

    sent = guidanceBodies(mon).at(-1)!;
    lastPayload = (await page.evaluate(() => (window as any).Navoro.getLastPayload())) as SanitizedContext;
    assert.deepEqual(lastPayload, sent.context, 'getLastPayload() equals the integrations guidance context');
    assert.equal(sent.context.route, '/#/integrations');
    assert.ok(sent.context.visibleErrors?.some((e) => e.code === 'WAREHOUSE_AUTH_FAILED'), 'visible error code is transmitted');

    // Flush analytics (pagehide uses keepalive) and let them land.
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
    await eventually(async () => mon.sdkRequests.some((r) => r.path === 'events'), 5_000);

    const paths = new Set(mon.sdkRequests.map((r) => r.path));
    for (const p of ['init', 'guidance', 'discovery', 'events']) assert.ok(paths.has(p), `observed ${p} requests`);
    assert.equal(guidanceBodies(mon).length, 3);

    // Nothing sensitive in ANY SDK request body.
    for (const req of mon.sdkRequests) {
      for (const needle of SENSITIVE) {
        assert.ok(!req.body.includes(needle), `${req.path} request leaked "${needle}": ${req.body.slice(0, 400)}`);
      }
      assert.ok(!/analyst_typed/.test(req.body) || req.path === 'guidance', `${req.path} must not carry typed values`);
    }
    // Typed field values are never read as values: the username only appears inside the app's own error text.
    for (const g of guidanceBodies(mon)) {
      const json = JSON.stringify(g.context);
      for (const el of g.context.elements ?? []) assert.ok(!('value' in el), 'elements never carry values');
      assert.ok(!json.includes('SYNTHETIC'), 'no synthetic secrets in context');
    }

    // Only allowlisted categories, approved ids and never blocked ids.
    const allowed = new Set(policy.transmit.filter((c) => policy.observe.includes(c)));
    const approved = new Set(policy.approvedNavoroIds);
    const blocked = new Set([...policy.blockedNavoroIds, 'billing.card-number', 'billing.tax-id', 'warehouse.password']);
    for (const g of guidanceBodies(mon)) {
      for (const key of Object.keys(g.context)) assert.ok(allowed.has(key as never), `category "${key}" is not allowlisted for transmit`);
      for (const el of g.context.elements ?? []) {
        assert.ok(approved.has(el.navoroId), `${el.navoroId} is approved metadata`);
        assert.ok(!blocked.has(el.navoroId), `${el.navoroId} must be blocked`);
      }
      for (const e of g.context.visibleErrors ?? []) assert.ok(!e.nearNavoroId || !blocked.has(e.nearNavoroId));
    }

    // Discovery never reports blocked or sensitive fields with labels, and never values.
    for (const req of mon.sdkRequests.filter((r) => r.path === 'discovery')) {
      const body = JSON.parse(req.body) as { elements: Array<{ navoroId: string; label: string | null }> };
      const ids = body.elements.map((e) => e.navoroId);
      for (const id of ['billing.card-number', 'billing.tax-id', 'billing.payment-region', 'settings.api-token']) {
        assert.ok(!ids.includes(id), `discovery skipped blocked ${id}`);
      }
      const pw = body.elements.find((e) => e.navoroId === 'warehouse.password');
      if (pw) assert.equal(pw.label, null, 'password field label withheld from discovery');
    }

    // Events carry ids/indices only — never question text.
    for (const req of mon.sdkRequests.filter((r) => r.path === 'events')) {
      assert.ok(!/payment|token|warehouse\?|connect my/i.test(req.body), `events body contains question text: ${req.body}`);
    }

    assert.deepEqual(mon.problems(), [], 'no console errors / CSP violations in the demo');
  });
});
