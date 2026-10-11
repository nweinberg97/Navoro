/**
 * SDK resilience in the real demo app against the real (seeded) server:
 * loading/stop, server errors, unregistered origins, keyboard access, reduced
 * motion, destroy(), and invalid element mappings that must fail safely.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Page, Route } from 'playwright';
import { createDemoServer } from '../../server/demo-server.ts';
import {
  adminLogin,
  askInPanel,
  demoUrl,
  DEMO_PUBLIC_KEY,
  eventually,
  launcher,
  navoroNodeCount,
  newPage,
  panel,
  spotlight,
  startEnv,
  startWalkthrough,
  stepCard,
  withScreenshots,
  type Env,
} from './helpers.ts';

let env: Env;
before(async () => {
  env = await startEnv({ seed: true });
});
after(async () => {
  await env?.close();
});

/** Active element inside the Navoro shadow root (or null when focus is in the host page). */
async function shadowFocus(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const host = document.querySelector('navoro-root');
    if (!host || document.activeElement !== host) return null;
    const el = host.shadowRoot?.activeElement as HTMLElement | null | undefined;
    if (!el) return null;
    if (el.hasAttribute('data-navoro-launcher')) return 'launcher';
    return el.getAttribute('aria-label') ?? el.textContent ?? el.tagName;
  });
}

async function openDemo(page: Page, hash = '#/dashboard'): Promise<void> {
  await page.goto(demoUrl(env, DEMO_PUBLIC_KEY, hash));
  await page.locator('main h1').waitFor();
  await launcher(page).waitFor({ timeout: 15_000 });
}

test('loading state shows Stop; Stop and Escape cancel; Ask again retries', async () => {
  await withScreenshots('resilience-loading', async (track) => {
    const { page, mon, context } = await newPage(env);
    track(page);
    let delayMs = 2_500;
    await page.route('**/api/sdk/v1/guidance', async (route: Route) => {
      await new Promise((r) => setTimeout(r, delayMs));
      await route.continue().catch(() => undefined); // aborted by the SDK → ignore
    });
    await openDemo(page);

    // Stop button.
    await askInPanel(page, 'How do I create a report?');
    const loading = panel(page).locator('.loading[aria-busy="true"]');
    await loading.waitFor();
    assert.match((await loading.textContent()) ?? '', /Looking through the docs|Working out the steps|Checking it against/);
    const input = panel(page).getByRole('textbox', { name: 'Your question' });
    assert.equal(await input.isDisabled(), true, 'input is disabled while in flight');
    await panel(page).getByRole('button', { name: 'Stop' }).click();
    await panel(page).locator('.note', { hasText: 'Stopped.' }).waitFor();
    await loading.waitFor({ state: 'detached' });
    assert.equal(await input.isDisabled(), false, 'input is re-enabled after stopping');

    // Escape while in flight.
    await panel(page).getByRole('button', { name: 'Ask again' }).click();
    await loading.waitFor();
    await page.keyboard.press('Escape');
    await panel(page).locator('.note', { hasText: 'Stopped.' }).waitFor();
    assert.equal(await panel(page).isVisible(), true, 'Escape during a request only stops it');

    // Retry completes once the request is fast again.
    delayMs = 0;
    await panel(page).getByRole('button', { name: 'Ask again' }).click();
    await startWalkthrough(page);
    assert.match((await stepCard(page).textContent()) ?? '', /Step 1 of 7/);
    assert.deepEqual(mon.pageErrors, []);
  });
});

test('server error event shows an error with Try again, which recovers', async () => {
  await withScreenshots('resilience-error', async (track) => {
    const { page, mon, context } = await newPage(env);
    track(page);
    let fail = true;
    await page.route('**/api/sdk/v1/guidance', async (route: Route) => {
      if (!fail) return route.continue();
      const origin = route.request().headers().origin ?? env.demoOrigin;
      return route.fulfill({
        status: 200,
        headers: { 'access-control-allow-origin': origin, 'content-type': 'application/x-ndjson' },
        body: `${JSON.stringify({ type: 'status', phase: 'retrieving' })}\n${JSON.stringify({ type: 'error', code: 'internal', message: 'Navoro hit a problem answering that. Please try again.', retryable: true })}\n`,
      });
    });
    await openDemo(page);
    await askInPanel(page, 'How do I create a report?');
    const alert = panel(page).getByRole('alert');
    await alert.waitFor();
    assert.match((await alert.textContent()) ?? '', /Navoro hit a problem/);
    fail = false;
    await alert.getByRole('button', { name: 'Try again' }).click();
    await startWalkthrough(page);
    assert.equal(await panel(page).getByRole('alert').count(), 0, 'error cleared after retry');
    assert.deepEqual(mon.pageErrors, []);
  });
});

test('unregistered origin: no launcher and exactly one Navoro console warning', async () => {
  await withScreenshots('resilience-origin', async (track) => {
    // A second copy of the demo on an origin that is not registered for the key.
    const stranger = createDemoServer({ navoroOrigin: env.navoroOrigin });
    await new Promise<void>((resolve) => stranger.listen(0, '127.0.0.1', resolve));
    const port = (stranger.address() as AddressInfo).port;
    const { page, mon, context } = await newPage(env);
    track(page);
    try {
      const q = new URLSearchParams({ navoroOrigin: env.navoroOrigin, navoroKey: DEMO_PUBLIC_KEY, navoroEnv: 'development' });
      await page.goto(`http://127.0.0.1:${port}/?${q.toString()}#/dashboard`);
      await page.locator('main h1').waitFor();
      await eventually(async () => mon.warnings.some((w) => w.includes('[Navoro]')), 8_000);
      await page.waitForTimeout(500);
      assert.equal(await navoroNodeCount(page), 0, 'nothing rendered');
      assert.equal(await page.evaluate(() => typeof (window as any).Navoro), 'object', 'SDK script itself loaded');
      const navoroWarnings = mon.warnings.filter((w) => w.includes('[Navoro]'));
      assert.equal(navoroWarnings.length, 1, navoroWarnings.join('\n'));
      assert.ok(!mon.sdkRequests.some((r) => r.path !== 'init'), 'only init was attempted');
      assert.deepEqual(mon.pageErrors, []);
    } finally {
      stranger.closeAllConnections?.();
      await new Promise<void>((resolve) => stranger.close(() => resolve()));
    }
  });
});

test('keyboard: Tab reaches the launcher, Enter opens, focus moves in, Escape closes and restores focus', async () => {
  await withScreenshots('resilience-keyboard', async (track) => {
    const { page, context } = await newPage(env);
    track(page);
    await openDemo(page);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    let reached = false;
    for (let i = 0; i < 80 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = (await shadowFocus(page)) === 'launcher';
    }
    assert.ok(reached, 'launcher is reachable with Tab');
    assert.equal(await launcher(page).getAttribute('aria-expanded'), 'false');
    await page.keyboard.press('Enter');
    await panel(page).waitFor();
    assert.equal(await launcher(page).getAttribute('aria-expanded'), 'true');
    assert.equal(await shadowFocus(page), 'Your question', 'focus moved into the panel input');
    await page.keyboard.press('Escape');
    await panel(page).waitFor({ state: 'hidden' });
    assert.equal(await shadowFocus(page), 'launcher', 'focus returned to the launcher');
    assert.equal(await launcher(page).getAttribute('aria-expanded'), 'false');
  });
});

test('reduced motion: spotlight has no pulse or "Found it." animation; destroy() removes everything', async () => {
  await withScreenshots('resilience-motion', async (track) => {
    const { page, mon, context } = await newPage(env, { reducedMotion: 'reduce' });
    track(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openDemo(page);
    await askInPanel(page, 'How do I create a report?');
    await startWalkthrough(page);
    await spotlight(page).waitFor();
    const ring = await spotlight(page).evaluate((el) => ({ pulse: el.classList.contains('pulse'), found: !!el.querySelector('.found'), text: el.textContent }));
    assert.equal(ring.pulse, false, 'no pulse class under reduced motion');
    assert.equal(ring.found, false, 'no "Found it." tag under reduced motion');

    await page.evaluate(() => (window as any).Navoro.destroy());
    assert.equal(await navoroNodeCount(page), 0, 'destroy() leaves no navoro-root');
    assert.equal(await page.locator('navoro-root').count(), 0);
    // Host page still works and a second destroy is harmless.
    await page.evaluate(() => (window as any).Navoro.destroy());
    await page.getByRole('link', { name: 'Reports' }).click();
    await page.getByRole('heading', { name: 'Reports', level: 1 }).waitFor();
    assert.equal(await navoroNodeCount(page), 0);
    assert.deepEqual(mon.pageErrors, []);
  });
});

test('invalid mappings fail safely: no arbitrary spotlight, docked explanation, step_target_missing reported', async () => {
  await withScreenshots('resilience-mapping', async (track) => {
    const admin = await adminLogin(env);
    const appId = env.seeded!.appId;
    const original = (await admin.get(`/api/admin/applications/${appId}/mappings`)).body.mappings.find((m: { key: string }) => m.key === 'new-report');
    assert.ok(original, 'seeded new-report mapping exists');
    const { page, mon, context } = await newPage(env);
    track(page);
    try {
      // 1) A navoro id that doesn't exist anywhere, no text fallback → server flags it broken and withholds the target.
      let put = await admin.put(`/api/admin/applications/${appId}/mappings/new-report`, { label: 'New report', navoroId: 'reports.renamed-button' });
      assert.equal(put.status, 200);
      assert.equal(put.body.validation, 'broken');

      await openDemo(page);
      await askInPanel(page, 'How do I create a report?');
      await startWalkthrough(page);
      await stepCard(page).getByText('Step 1 of 7').waitFor();
      await page.getByRole('link', { name: 'Reports' }).click(); // follow-along → step 2 on the Reports page
      await stepCard(page).getByText('Step 2 of 7').waitFor();
      await page.getByRole('heading', { name: 'Reports', level: 1 }).waitFor();
      await assertDockedWithoutSpotlight(page, /changed and is awaiting review/);
      assert.ok(!/doesn’t point at a specific control/.test((await stepCard(page).textContent()) ?? ''), 'no contradictory copy');
      await page.keyboard.press('Escape');
      await stepCard(page).waitFor({ state: 'detached' });

      // 2) The id is in approved metadata but no longer in the DOM (renamed after capture) → the SDK can't find it.
      const imported = await admin.post(`/api/admin/applications/${appId}/catalog`, { elements: [{ navoroId: 'reports.renamed-button', label: 'New report', role: 'button', route: '/#/reports' }] });
      assert.equal(imported.status, 200);
      put = await admin.put(`/api/admin/applications/${appId}/mappings/new-report`, { label: 'New report', navoroId: 'reports.renamed-button' });
      assert.notEqual(put.body.validation, 'broken');
      assert.deepEqual(put.body.strategies, [{ type: 'navoro_id', value: 'reports.renamed-button' }], 'no text fallback');

      await openDemo(page, '#/reports');
      mon.reset();
      await askInPanel(page, 'How do I create a report?');
      await startWalkthrough(page);
      await stepCard(page).getByText('Step 1 of 7').waitFor();
      await stepCard(page).getByRole('button', { name: 'Next' }).click();
      await stepCard(page).getByText('Step 2 of 7').waitFor();
      // The real "New report" button is on screen, but must NOT be highlighted via a guess.
      assert.equal(await page.locator('[data-navoro-id="reports.new-button"]').isVisible(), true);
      await assertDockedWithoutSpotlight(page, /couldn’t find “New report” on this page/);

      // The SDK reports the missing target (after its short grace period) with ids only.
      await page.waitForTimeout(2_800);
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
      const missing = await eventually(async () => {
        for (const req of mon.sdkRequests.filter((r) => r.path === 'events')) {
          const ev = (JSON.parse(req.body) as { events: Array<{ type: string; stepIndex?: number; mappingKey?: string }> }).events.find((e) => e.type === 'step_target_missing');
          if (ev) return ev;
        }
        return null;
      }, 6_000);
      assert.equal(missing.stepIndex, 1);
      assert.equal(missing.mappingKey, 'new-report');
      assert.deepEqual(mon.pageErrors, []);
    } finally {
      // Restore the seeded mapping for anything that runs afterwards.
      await admin.put(`/api/admin/applications/${appId}/mappings/new-report`, { label: 'New report', navoroId: 'reports.new-button', ariaLabel: 'New report', text: 'New report', role: 'button' });
    }
  });
});

async function assertDockedWithoutSpotlight(page: Page, explanation: RegExp): Promise<void> {
  const card = stepCard(page);
  await card.locator('.miss').waitFor();
  assert.match((await card.locator('.miss').textContent()) ?? '', explanation);
  assert.equal(await card.evaluate((el) => el.classList.contains('docked')), true, 'card is docked');
  // Give the resolver time to (wrongly) attach, then confirm nothing was highlighted.
  await page.waitForTimeout(400);
  assert.equal(await spotlight(page).count(), 0, 'no spotlight drawn on an arbitrary element');
}
