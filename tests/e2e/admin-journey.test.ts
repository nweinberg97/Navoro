/**
 * The full Navoro story, entirely through the UI, on a FRESH workspace:
 * sign up → register an app → sample knowledge → publish guidance → publish a
 * configuration → open the Lumen demo (different origin) → ask → walk through
 * steps → analytics/overview → Refresh Learning → Training Mode.
 *
 * The steps run in order inside one test because each depends on the previous.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Locator, Page } from 'playwright';
import {
  askInPanel,
  cspEvents,
  demoUrl,
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
  env = await startEnv({ seed: false });
});
after(async () => {
  await env?.close();
});

const ADMIN = { name: 'Riley Admin', email: 'riley@example.test', password: 'journey-password-123', org: 'Journey Labs' };

/** Clicks a sidebar link (dashboard SPA navigation, like a user would). */
async function nav(page: Page, label: string): Promise<void> {
  await page.locator('nav[aria-label="Primary"]').getByRole('link', { name: label, exact: true }).click();
  await page.locator('main h1').first().waitFor();
}

async function box(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const b = await locator.boundingBox();
  assert.ok(b, 'element has a bounding box');
  return b;
}

test('fresh workspace: sign up → install → learn → publish → guide in the demo → analytics → refresh → training mode', async () => {
  await withScreenshots('admin-journey', async (track) => {
    const { page, mon, context } = await newPage(env);
    track(page);
    let publicKey = '';
    /* a. Sign up → overview with onboarding */
    await page.goto(`${env.navoroOrigin}/signup`);
    await page.getByRole('heading', { name: 'Create your workspace' }).waitFor();
    await page.getByLabel('Your name').fill(ADMIN.name);
    await page.getByLabel('Work email').fill(ADMIN.email);
    await page.getByLabel('Password').fill(ADMIN.password);
    await page.getByLabel('Organization name').fill(ADMIN.org);
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await page.waitForURL(`${env.navoroOrigin}/app`);
    await page.getByRole('heading', { name: 'Get Navoro running' }).waitFor();
    const onboarding = page.locator('.getstarted');
    for (const step of ['Register your application', 'Add knowledge', 'Install the SDK & publish']) {
      await onboarding.getByRole('heading', { name: step }).waitFor();
    }
    assert.match((await page.locator('main h1').textContent()) ?? '', /Riley/);
    // The signed-out probe of /api/auth/me on /signup is expected; judge the app from here on.
    mon.reset();

    /* b. Register an application whose development origin is the demo origin */
    await onboarding.getByRole('button', { name: 'Register application' }).click();
    const dialog = page.getByRole('dialog', { name: 'Register application' });
    await dialog.waitFor();
    await dialog.getByLabel('Name').fill('Lumen Analytics');
    await dialog.getByLabel('Development origins').fill(env.demoOrigin);
    await dialog.getByRole('button', { name: 'Register' }).click();
    await page.waitForURL(/\/app\/applications\/[^/]+$/);
    await page.getByRole('heading', { name: 'Lumen Analytics', level: 1 }).waitFor();
    const snippet = (await page.getByLabel('Install snippet', { exact: true }).textContent()) ?? '';
    publicKey = ((await page.locator('code.n-copy__value[aria-label="Public key"]').textContent()) ?? '').trim();
    assert.match(publicKey, /^nav_pk_[A-Za-z0-9_]+$/);
    assert.ok(snippet.includes(publicKey), 'snippet contains the public key');
    assert.ok(snippet.includes(`${env.navoroOrigin}/sdk/v1/navoro.js`), `snippet loads the SDK from the Navoro origin: ${snippet}`);
    await page.locator('.env', { hasText: 'Development' }).getByText(env.demoOrigin).waitFor();

    /* c. Knowledge: use sample knowledge → Ready */
    await nav(page, 'Knowledge');
    await page.getByRole('button', { name: 'Use sample knowledge' }).click();
    const sourceRow = page.getByRole('row', { name: /Lumen Help Center \(sample\)/ });
    await sourceRow.waitFor();
    await sourceRow.getByText('Ready', { exact: true }).waitFor({ timeout: 20_000 });

    /* d. Guidance: drafts → publish; preview a grounded workflow answer */
    await nav(page, 'Guidance');
    const wfRow = page.getByRole('row', { name: /Create a report/ });
    await wfRow.waitFor();
    await wfRow.getByText('Draft', { exact: true }).waitFor();
    const draftCount = await page.getByRole('row').filter({ hasText: 'Draft' }).count();
    assert.ok(draftCount >= 4, `all extracted workflows start as drafts (${draftCount})`);

    // Publish every draft via its detail page (Create a report first).
    const titles = await page.getByRole('row').filter({ hasText: 'Draft' }).locator('.cell-title').allTextContents();
    assert.ok(titles.includes('Create a report'));
    const ordered = ['Create a report', ...titles.filter((t) => t !== 'Create a report')];
    for (const title of ordered) {
      await page.getByRole('row', { name: new RegExp(title) }).getByRole('link', { name: title }).click();
      await page.getByRole('heading', { name: title, level: 1 }).waitFor();
      await page.getByRole('button', { name: 'Publish', exact: true }).click();
      await page.getByRole('button', { name: 'Unpublish' }).waitFor();
      await page.locator('.n-page-header').getByText('Published', { exact: true }).waitFor();
      await page.getByRole('link', { name: 'Guidance' }).first().click();
      await page.getByRole('heading', { name: 'Guidance', level: 1 }).waitFor();
      await page.getByRole('row', { name: new RegExp(title) }).getByText('Published', { exact: true }).waitFor();
    }

    await page.getByRole('tab', { name: 'Preview' }).click();
    await page.getByLabel('Question').fill('How do I create a report?');
    await page.locator('.preview-form').getByRole('button', { name: 'Ask' }).click();
    const preview = page.locator('.preview-result');
    await preview.waitFor();
    await preview.locator('.widget__wf', { hasText: 'Create a report' }).waitFor();
    await preview.getByText('Workflow', { exact: true }).waitFor();
    await preview.getByText('Yes — backed by sources').waitFor();
    assert.equal(await preview.locator('.widget-step').count(), 7, 'seven grounded steps');
    assert.ok((await preview.locator('.cites li').count()) >= 1, 'answer cites a source');

    /* e. Publish a configuration to development */
    await nav(page, 'Applications');
    await page.getByRole('link', { name: 'Lumen Analytics' }).click();
    await page.getByRole('heading', { name: 'Lumen Analytics', level: 1 }).waitFor();
    await page.getByRole('button', { name: 'Publish configuration' }).click();
    const pub = page.getByRole('dialog', { name: 'Publish configuration' });
    await pub.waitFor();
    assert.equal(await pub.getByLabel('Environment').inputValue(), 'development');
    await pub.getByLabel('Release notes').fill('First guidance release');
    await pub.getByRole('button', { name: 'Publish to development' }).click();
    await pub.waitFor({ state: 'detached' });
    const versionRow = page.getByRole('row', { name: /v1/ });
    await versionRow.getByText('Live').waitFor();
    await versionRow.getByText(/4 workflows|[1-9]\d* workflows/).waitFor();

    /* f. Open the demo on its own origin; ask; spotlight lands on the Reports link */
    const demo = await context.newPage();
    track(demo);
    const demoProblems: string[] = [];
    demo.on('console', (m) => {
      if (m.type() === 'error') demoProblems.push(m.text());
    });
    demo.on('pageerror', (e) => demoProblems.push(`pageerror: ${e.message}`));
    // Opening the app once in development lets the SDK capture this route's blueprint (debounced ~1.5s).
    const discovery = demo.waitForRequest((r) => r.url().endsWith('/api/sdk/v1/discovery'), { timeout: 10_000 });
    await demo.goto(demoUrl(env, publicKey, '#/dashboard'));
    await demo.locator('main h1').waitFor();
    await launcher(demo).waitFor({ timeout: 15_000 });
    const discovered = JSON.parse((await discovery).postData() ?? '{}') as { route: string; elements: Array<{ navoroId: string }> };
    assert.equal(discovered.route, '/#/dashboard');
    assert.ok(discovered.elements.some((e) => e.navoroId === 'nav.reports'));
    assert.equal(await demo.getByRole('button', { name: 'Open Navoro help' }).count(), 1, 'launcher has its accessible name');
    await askInPanel(demo, 'How do I create a report?');
    // The answer renders in the panel, which then gives way to the step card (workflow answers auto-start).
    await panel(demo).locator('.badge', { hasText: 'Demo mode' }).waitFor({ state: 'attached', timeout: 15_000 });
    assert.match((await panel(demo).locator('.answer').textContent()) ?? '', /\S/, 'answer text rendered');
    await startWalkthrough(demo);
    await stepCard(demo).getByText('Step 1 of 7').waitFor();
    await spotlight(demo).waitFor();
    const reportsLink = demo.locator('[data-navoro-id="nav.reports"]');
    // Ring = target rect + 4px padding on each side; allow a few px for subpixel/transition.
    await eventually(async () => {
      const [ring, target] = await Promise.all([box(spotlight(demo)), box(reportsLink)]);
      return Math.abs(ring.x + 4 - target.x) <= 3 && Math.abs(ring.y + 4 - target.y) <= 3 && Math.abs(ring.width - 8 - target.width) <= 3 && Math.abs(ring.height - 8 - target.height) <= 3;
    }, 3_000);

    /* g. Follow-along, Next/Back, Escape */
    await reportsLink.click();
    await stepCard(demo).getByText('Step 2 of 7').waitFor();
    await demo.getByRole('heading', { name: 'Reports', level: 1 }).waitFor();
    // Step 2 targets the "New report" button (resolved by accessible name on a fresh app).
    await eventually(async () => {
      const [ring, target] = await Promise.all([box(spotlight(demo)), box(demo.getByRole('button', { name: 'New report' }))]);
      return Math.abs(ring.x + 4 - target.x) <= 3 && Math.abs(ring.y + 4 - target.y) <= 3;
    }, 3_000);
    await stepCard(demo).getByRole('button', { name: 'Next' }).click();
    await stepCard(demo).getByText('Step 3 of 7').waitFor();
    await stepCard(demo).getByRole('button', { name: 'Back' }).click();
    await stepCard(demo).getByText('Step 2 of 7').waitFor();
    await demo.keyboard.press('Escape');
    await stepCard(demo).waitFor({ state: 'detached' });
    assert.equal(await spotlight(demo).count(), 0, 'spotlight removed');
    // Nothing from Navoro's overlay remains: the layer is empty and click-through.
    const layer = await demo.evaluate(() => {
      const l = document.querySelector('navoro-root')?.shadowRoot?.querySelector('[data-navoro-layer]') as HTMLElement | null;
      return { children: l?.childElementCount ?? -1, pointer: l ? getComputedStyle(l).pointerEvents : '' };
    });
    assert.deepEqual(layer, { children: 0, pointer: 'none' });
    assert.equal(await navoroNodeCount(demo), 1, 'only the single Navoro host element remains');
    // The previously highlighted host button is the hit-test target and clickable.
    const intercept = await demo.evaluate(() => {
      const btn = document.querySelector('[data-navoro-id="reports.new-button"]')!;
      const r = btn.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return top && (btn === top || btn.contains(top)) ? 'ok' : `${top?.tagName}`;
    });
    assert.equal(intercept, 'ok', 'host button is the hit-test target');
    await demo.getByRole('button', { name: 'New report' }).click({ timeout: 3_000 });
    await demo.getByRole('heading', { name: 'New report', level: 1 }).waitFor();
    // Flush analytics.
    await demo.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
    assert.deepEqual(demoProblems, [], 'demo had no console errors / CSP violations');
    assert.deepEqual(await cspEvents(demo).catch(() => []), []);

    /* h. Analytics + Overview */
    await page.bringToFront();
    await nav(page, 'Analytics');
    const total = page.locator('.metric--lead .metric__value');
    await eventually(async () => {
      await page.reload();
      await total.waitFor();
      return Number((await total.textContent())?.replace(/\D/g, '') || '0') >= 1;
    }, 10_000, 300);
    await page.getByLabel('Top topics').getByText('Create a report').waitFor();
    await nav(page, 'Overview');
    const conn = page.locator('.conn-row', { hasText: 'Lumen Analytics' });
    await conn.getByText('Connected', { exact: true }).waitFor();
    await conn.getByText('v1 live').waitFor();

    /* i. Refresh Learning after editing a source */
    await nav(page, 'Knowledge');
    await page.getByRole('link', { name: 'Lumen Help Center (sample)' }).click();
    await page.getByRole('heading', { name: 'Lumen Help Center (sample)', level: 1 }).waitFor();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    const content = page.getByLabel('Content');
    const before = await content.inputValue();
    const original = 'Click **New report** in the top right of the Reports page.';
    assert.ok(before.includes(original), 'sample doc contains the step to change');
    await content.fill(before.replace(original, 'Click **New report** at the top of the Reports page.'));
    await page.getByRole('button', { name: 'Save & re-process' }).click();
    await page.locator('.n-page-header').getByText('Ready', { exact: true }).waitFor({ timeout: 20_000 });

    await nav(page, 'Knowledge');
    // Record whether "Cancel refresh" is ever rendered (the job can finish within a poll or two).
    await page.evaluate(() => {
      const w = window as unknown as { __sawCancel: boolean };
      w.__sawCancel = false;
      const check = () => {
        if ([...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Cancel refresh')) w.__sawCancel = true;
      };
      new MutationObserver(check).observe(document.body, { childList: true, subtree: true, characterData: true });
    });
    await page.getByRole('button', { name: 'Refresh Learning' }).click();
    const sheet = page.getByRole('dialog', { name: 'Refresh Learning' });
    await sheet.waitFor();
    await sheet.getByRole('button', { name: 'Done' }).waitFor({ timeout: 20_000 });
    // Cancel is offered while the job is queued/running (the sheet opens on the queued job before it finishes).
    assert.equal(await page.evaluate(() => (window as unknown as { __sawCancel: boolean }).__sawCancel), true, 'Cancel refresh was rendered while running');
    assert.equal(await sheet.getByRole('button', { name: 'Cancel refresh' }).count(), 0, 'Cancel disappears once finished');
    const steps = sheet.locator('.job__step');
    assert.equal(await steps.count(), 7);
    assert.equal(await sheet.locator('.job__step--done').count(), 7, 'every step completed');
    const report = sheet.locator('.report');
    await report.waitFor();
    const changed = report.locator('.report__stats > div', { hasText: /^\d+Changed$/ }).locator('span');
    assert.equal((await changed.textContent())?.trim(), '1', '1 changed source');
    const reportText = (await report.locator('section[aria-label="Workflows"]').textContent()) ?? '';
    assert.match(reportText, /Create a report/, 'workflow listed in the report');
    assert.match(reportText, /(Updated|Needs review) · [1-9]/);
    const needsReview = report.locator('.report__grid > div', { hasText: 'Needs review' });
    await needsReview.getByText('Create a report').waitFor();
    await sheet.getByRole('button', { name: 'Done' }).click();
    await sheet.waitFor({ state: 'detached' });

    /* j. Training Mode: blueprint for the dashboard route → mark sensitive → Never collect */
    await nav(page, 'Privacy & Security');
    const training = page.locator('.training');
    await training.waitFor();
    const routeSelect = training.getByLabel('Page');
    const routes = await routeSelect.locator('option').allTextContents();
    assert.ok(routes.includes('/#/dashboard'), `dashboard blueprint captured: ${routes.join(', ')}`);
    await routeSelect.selectOption({ label: '/#/dashboard' });
    const element = training.getByRole('button', { name: /^Date range \(dashboard\.date-range/ });
    await element.waitFor();
    assert.equal(await element.getAttribute('aria-pressed'), 'false');
    await element.click();
    assert.equal(await element.getAttribute('aria-pressed'), 'true');
    await page.locator('.review').getByText('dashboard.date-range').waitFor();
    await page.locator('.n-page-header').getByRole('button', { name: 'Save draft' }).click();
    await page.getByText('Saved, not yet published').waitFor();
    const rules = page.locator('.rules');
    await rules.locator('.rule', { hasText: 'dashboard.date-range' }).waitFor();
    // Persisted: survives a reload.
    await page.reload();
    await page.locator('.rules .rule', { hasText: 'dashboard.date-range' }).waitFor();
    await page.locator('.training').getByLabel('Page').selectOption({ label: '/#/dashboard' });
    assert.equal(await page.locator('.training').getByRole('button', { name: /^Date range \(dashboard\.date-range.*never collect/ }).count(), 1);

    assert.deepEqual(mon.problems(), [], 'dashboard had no console errors / CSP violations');
    assert.deepEqual(await cspEvents(page), []);
  });
});
