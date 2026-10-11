/**
 * End-to-end helpers: boots the real Navoro server (harness) plus the Lumen demo
 * app on a DIFFERENT ephemeral origin, launches Chromium, and records console
 * errors, CSP violations, page errors and every request sent to /api/sdk/v1/*.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type http from 'node:http';
import { chromium, type Browser, type BrowserContext, type Page, type Locator } from 'playwright';
import { startHarness, AdminClient, type Harness } from '../helpers/harness.ts';
import { createDemoServer } from '../../server/demo-server.ts';
import { seedDemoWorkspace, DEMO_EMAIL, DEMO_PASSWORD, DEMO_PUBLIC_KEY } from '../../server/seed/seed.ts';
import { ROOT_DIR } from '../../server/config/env.ts';

export { DEMO_EMAIL, DEMO_PASSWORD, DEMO_PUBLIC_KEY, AdminClient };

export const RESULTS_DIR = path.join(ROOT_DIR, 'test-results');

export interface Env {
  harness: Harness;
  navoroOrigin: string;
  demoOrigin: string;
  demoPort: number;
  browser: Browser;
  seeded: { orgId: string; appId: string } | null;
  close(): Promise<void>;
}

/** Starts Navoro + the demo server (+ optionally the seeded workspace) and a browser. */
export async function startEnv(options: { seed?: boolean } = {}): Promise<Env> {
  const harness = await startHarness();
  const navoroOrigin = harness.baseUrl;
  // The demo CSP must name the Navoro origin, which is only known after listen().
  const demo = createDemoServer({ navoroOrigin });
  await new Promise<void>((resolve) => demo.listen(0, '127.0.0.1', resolve));
  const demoPort = (demo.address() as AddressInfo).port;
  const demoOrigin = `http://127.0.0.1:${demoPort}`;
  let seeded: Env['seeded'] = null;
  if (options.seed) {
    const result = await seedDemoWorkspace(harness.app, { demoPort });
    seeded = { orgId: result.orgId, appId: result.appId };
  }
  const browser = await chromium.launch();
  return {
    harness,
    navoroOrigin,
    demoOrigin,
    demoPort,
    browser,
    seeded,
    async close() {
      await browser.close().catch(() => undefined);
      await closeServer(demo);
      await harness.close();
    },
  };
}

function closeServer(server: http.Server): Promise<void> {
  server.closeAllConnections?.();
  return new Promise((resolve) => server.close(() => resolve()));
}

export interface SdkRequest {
  url: string;
  path: string;
  method: string;
  body: string;
}

export interface Monitor {
  consoleErrors: string[];
  warnings: string[];
  cspViolations: string[];
  pageErrors: string[];
  sdkRequests: SdkRequest[];
  /** All problems that should never happen on a healthy page. */
  problems(): string[];
  /** Forgets everything recorded so far. */
  reset(): void;
}

/** Attaches listeners that record console/CSP/page errors and SDK API traffic. */
export function monitor(page: Page): Monitor {
  const m: Monitor = {
    consoleErrors: [],
    warnings: [],
    cspViolations: [],
    pageErrors: [],
    sdkRequests: [],
    problems() {
      return [...m.consoleErrors, ...m.cspViolations, ...m.pageErrors.map((e) => `pageerror: ${e}`)];
    },
    reset() {
      for (const list of [m.consoleErrors, m.warnings, m.cspViolations, m.pageErrors, m.sdkRequests]) list.length = 0;
    },
  };
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error') {
      if (/Content Security Policy/i.test(text)) m.cspViolations.push(text);
      else m.consoleErrors.push(text);
    } else if (msg.type() === 'warning') {
      m.warnings.push(text);
    }
  });
  page.on('pageerror', (err) => m.pageErrors.push(err.message));
  page.on('request', (req) => {
    const url = req.url();
    const idx = url.indexOf('/api/sdk/v1/');
    if (idx === -1 || req.method() === 'OPTIONS') return;
    m.sdkRequests.push({ url, path: url.slice(idx + '/api/sdk/v1/'.length).split('?')[0] ?? '', method: req.method(), body: req.postData() ?? '' });
  });
  return m;
}

/** Records `securitypolicyviolation` events in the page (catches violations that don't hit the console). */
export async function trackCspEvents(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
}

export async function cspEvents(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []).catch(() => []);
}

export async function newPage(env: Env, options: { viewport?: { width: number; height: number }; reducedMotion?: 'reduce' | 'no-preference'; context?: BrowserContext } = {}): Promise<{ page: Page; mon: Monitor; context: BrowserContext }> {
  const context =
    options.context ??
    (await env.browser.newContext({ viewport: options.viewport ?? { width: 1280, height: 860 }, reducedMotion: options.reducedMotion ?? 'no-preference' }));
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const mon = monitor(page);
  await trackCspEvents(page);
  return { page, mon, context };
}

export function demoUrl(env: Env, publicKey: string, hash = '#/dashboard', environment = 'development'): string {
  const q = new URLSearchParams({ navoroOrigin: env.navoroOrigin, navoroKey: publicKey, navoroEnv: environment });
  return `${env.demoOrigin}/?${q.toString()}${hash}`;
}

/** Signs a browser context into the dashboard via the real login form. */
export async function loginUi(page: Page, env: Env, email = DEMO_EMAIL, password = DEMO_PASSWORD): Promise<void> {
  await page.goto(`${env.navoroOrigin}/login`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/app(\/|$|\?)/);
  await page.locator('h1').first().waitFor();
}

export async function adminLogin(env: Env, email = DEMO_EMAIL, password = DEMO_PASSWORD): Promise<AdminClient> {
  const admin = new AdminClient(env.navoroOrigin);
  const res = await admin.post('/api/auth/login', { email, password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
  return admin;
}

/* ───────── SDK (shadow DOM) helpers ───────── */

export const launcher = (page: Page): Locator => page.locator('navoro-root [data-navoro-launcher]');
export const panel = (page: Page): Locator => page.locator('navoro-root [data-navoro-panel]');
export const stepCard = (page: Page): Locator => page.locator('navoro-root [data-navoro-card]');
export const spotlight = (page: Page): Locator => page.locator('navoro-root [data-navoro-spotlight]');

/** Opens the launcher panel and asks a question through the real input. */
export async function askInPanel(page: Page, question: string): Promise<void> {
  await launcher(page).waitFor({ timeout: 15_000 });
  if (!(await panel(page).isVisible())) await launcher(page).click();
  const input = panel(page).getByRole('textbox', { name: 'Your question' });
  await input.waitFor();
  await input.fill(question);
  await input.press('Enter');
}

/**
 * Waits for a workflow answer to reach the walkthrough. Workflow results start at
 * step 1 automatically; when the panel instead offers "Start walkthrough" (e.g.
 * after completion), click it.
 */
export async function startWalkthrough(page: Page): Promise<void> {
  const start = panel(page).getByRole('button', { name: /Start walkthrough|Show me|Walk me through/ });
  await stepCard(page).or(start).first().waitFor({ timeout: 15_000 });
  if (!(await stepCard(page).isVisible())) await start.click();
  await stepCard(page).waitFor();
}

export async function navoroNodeCount(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelectorAll('navoro-root, [data-navoro-host]').length);
}

/* ───────── misc ───────── */

/** Saves a screenshot under test-results/ (best effort). */
export async function screenshot(page: Page | null | undefined, name: string): Promise<void> {
  if (!page || page.isClosed()) return;
  try {
    mkdirSync(RESULTS_DIR, { recursive: true });
    await page.screenshot({ path: path.join(RESULTS_DIR, `${name.replace(/[^a-z0-9-]+/gi, '_')}.png`), fullPage: true });
  } catch {
    // best effort
  }
}

/**
 * Runs a test body with failure screenshots: every page registered through
 * `track` is captured to test-results/ if the body throws. The browser contexts
 * of tracked pages are closed afterwards (after any screenshot was taken).
 */
export async function withScreenshots(name: string, body: (track: (page: Page) => Page) => Promise<void>): Promise<void> {
  const pages: Page[] = [];
  try {
    await body((page) => {
      pages.push(page);
      return page;
    });
  } catch (error) {
    await Promise.all(pages.map((page, i) => screenshot(page, `${name}-${i}`)));
    throw error;
  } finally {
    for (const ctx of new Set(pages.map((page) => page.context()))) await ctx.close().catch(() => undefined);
  }
}

/** Polls `fn` until truthy (for server-side or cross-page conditions). */
export async function eventually<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs = 10_000, intervalMs = 100): Promise<T> {
  const started = Date.now();
  let last: unknown;
  for (;;) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      last = error;
    }
    if (Date.now() - started > timeoutMs) throw new Error(`eventually timed out${last ? `: ${(last as Error).message}` : ''}`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** Horizontal overflow check used for the mobile-layout assertions. */
export async function horizontalOverflow(page: Page): Promise<{ scrollWidth: number; innerWidth: number }> {
  return page.evaluate(() => ({ scrollWidth: (document.scrollingElement ?? document.documentElement).scrollWidth, innerWidth: window.innerWidth }));
}
