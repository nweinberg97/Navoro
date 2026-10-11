/**
 * Dashboard smoke + accessibility basics for the seeded demo user: every page
 * loads without console errors / CSP violations, has one h1 and one main
 * landmark, the sidebar is keyboard reachable, and nothing scrolls sideways at
 * phone width (also checked for the public site and the Lumen demo app).
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { BrowserContext } from 'playwright';
import { cspEvents, demoUrl, DEMO_PUBLIC_KEY, horizontalOverflow, loginUi, newPage, startEnv, withScreenshots, type Env } from './helpers.ts';

const PAGES = ['/app', '/app/applications', '/app/knowledge', '/app/guidance', '/app/privacy', '/app/analytics', '/app/settings'];

let env: Env;
before(async () => {
  env = await startEnv({ seed: true });
});
after(async () => {
  await env?.close();
});

async function waitForPageReady(page: import('playwright').Page): Promise<void> {
  await page.locator('main h1').first().waitFor();
  // Let data fetches settle (skeletons replaced) before checking errors/layout.
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForFunction(() => !document.querySelector('.n-skeleton, [aria-busy="true"] .n-skeleton'), null, { timeout: 5_000 }).catch(() => undefined);
}

test('every dashboard page loads cleanly with one h1/main and a keyboard-reachable sidebar', async () => {
  await withScreenshots('dashboard-a11y-desktop', async (track) => {
    const { page, mon, context } = await newPage(env);
    track(page);
    await loginUi(page, env);
    // The signed-out /login page probes /api/auth/me (401 by design); only judge signed-in pages.
    mon.reset();
    for (const pathname of PAGES) {
      await page.goto(`${env.navoroOrigin}${pathname}`);
      await waitForPageReady(page);
      const counts = await page.evaluate(() => ({
        h1: document.querySelectorAll('h1').length,
        main: document.querySelectorAll('main, [role="main"]').length,
      }));
      assert.equal(counts.h1, 1, `${pathname}: exactly one h1`);
      assert.equal(counts.main, 1, `${pathname}: exactly one main landmark`);

      // Keyboard: Tab from the top of the document reaches a sidebar nav link.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.locator('body').focus().catch(() => undefined);
      let reached = false;
      for (let i = 0; i < 25 && !reached; i++) {
        await page.keyboard.press('Tab');
        reached = await page.evaluate(() => {
          const el = document.activeElement;
          return !!el && el.tagName === 'A' && !!el.closest('nav[aria-label="Primary"]');
        });
      }
      assert.ok(reached, `${pathname}: Tab reaches the sidebar navigation`);

      const csp = await cspEvents(page);
      assert.deepEqual(csp, [], `${pathname}: no CSP violations`);
      assert.deepEqual(mon.problems(), [], `${pathname}: no console errors / page errors`);
    }
  });
});

test('no horizontal scroll at 390×844 on dashboard pages, the public site and the demo app', async () => {
  await withScreenshots('dashboard-a11y-mobile', async (track) => {
    const { page, mon, context } = await newPage(env, { viewport: { width: 390, height: 844 } });
    track(page);
    let ctx2: BrowserContext | null = null;
    // Public site.
    await page.goto(`${env.navoroOrigin}/`);
    await page.locator('h1').first().waitFor();
    // The final period is screen-reader text next to a decorative dot.
    const hero = (await page.locator('h1').first().textContent()) ?? '';
    assert.match(hero.replace(/\s+/g, ' '), /Less searching\.\s*More doing\./, `public site hero copy: ${hero}`);
    assert.deepEqual(mon.problems(), [], 'public site has no console errors');
    let o = await horizontalOverflow(page);
    assert.ok(o.scrollWidth <= o.innerWidth, `public site overflows: ${o.scrollWidth} > ${o.innerWidth}`);

    await loginUi(page, env);
    mon.reset();
    for (const pathname of PAGES) {
      await page.goto(`${env.navoroOrigin}${pathname}`);
      await waitForPageReady(page);
      o = await horizontalOverflow(page);
      assert.ok(o.scrollWidth <= o.innerWidth, `${pathname} overflows at 390px: ${o.scrollWidth} > ${o.innerWidth}`);
    }
    assert.deepEqual(mon.problems(), [], 'no console errors on mobile');
    assert.deepEqual(await cspEvents(page), []);

    // Demo app (separate origin, real SDK).
    const demo = await newPage(env, { viewport: { width: 390, height: 844 } });
    ctx2 = demo.context;
    track(demo.page);
    for (const hash of ['#/dashboard', '#/reports', '#/integrations', '#/settings']) {
      await demo.page.goto(demoUrl(env, DEMO_PUBLIC_KEY, hash));
      await demo.page.locator('main h1').waitFor();
      await demo.page.locator('navoro-root [data-navoro-launcher]').waitFor();
      o = await horizontalOverflow(demo.page);
      assert.ok(o.scrollWidth <= o.innerWidth, `demo ${hash} overflows at 390px: ${o.scrollWidth} > ${o.innerWidth}`);
    }
    assert.deepEqual(demo.mon.problems(), [], 'demo app has no console errors / CSP violations');
  });
});
