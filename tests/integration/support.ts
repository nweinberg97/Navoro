/**
 * Shared helpers for integration tests (not a test file itself).
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { RateLimiter } from '../../server/security/rate-limit.ts';
import { AdminClient, SAMPLE_DOC, SdkClient, startHarness, waitFor, type Harness } from '../helpers/harness.ts';
import type { ModelProvider } from '../../server/ai/provider.ts';
import type { AppConfig } from '../../server/config/env.ts';

export const DEV_ORIGIN = 'http://localhost:3000';
export const PROD_ORIGIN = 'https://app.acme.test';

/**
 * Many tests sign up several workspaces from 127.0.0.1. Give the test server
 * roomy limits; tests that exercise a specific limiter restore a strict one.
 */
export function relaxLimits(harness: Harness): void {
  const roomy = () => new RateLimiter({ capacity: 10_000, refillPerSecond: 1_000 });
  const limits = harness.app.context.limits;
  limits.signup = roomy();
  limits.sdkInit = roomy();
  limits.guidanceByApp = roomy();
  limits.guidanceByIp = roomy();
  limits.sdkEvents = roomy();
  limits.aiByOrg = roomy();
}

export async function start(options: { provider?: ModelProvider | null; config?: Partial<AppConfig> } = {}): Promise<Harness> {
  const harness = await startHarness(options);
  relaxLimits(harness);
  return harness;
}

let counter = 0;
export function uniqueEmail(prefix = 'user'): string {
  counter += 1;
  return `${prefix}-${counter}-${Date.now()}@example.com`;
}

export async function newAdmin(harness: Harness, org = 'Org'): Promise<AdminClient> {
  return new AdminClient(harness.baseUrl).signup(uniqueEmail(org.toLowerCase().replace(/\W+/g, '-')), org);
}

export async function createApp(admin: AdminClient, name = 'Acme', dev: string[] = [DEV_ORIGIN], prod: string[] = [PROD_ORIGIN]): Promise<{ id: string; publicKey: string }> {
  const response = await admin.post('/api/admin/applications', { name, developmentOrigins: dev, productionOrigins: prod });
  if (response.status !== 201) throw new Error(`create app failed: ${response.status} ${JSON.stringify(response.body)}`);
  return { id: response.body.id, publicKey: response.body.publicKey };
}

export async function waitForJob(admin: AdminClient, jobId: string, timeoutMs = 10_000): Promise<any> {
  return waitFor(async () => {
    const job = await admin.get(`/api/admin/jobs/${jobId}`);
    return ['succeeded', 'failed', 'cancelled'].includes(job.body?.status) ? job.body : null;
  }, timeoutMs);
}

export async function waitForSource(admin: AdminClient, sourceId: string, statuses = ['ready', 'needs_attention', 'failed']): Promise<any> {
  return waitFor(async () => {
    const source = await admin.get(`/api/admin/sources/${sourceId}`);
    return statuses.includes(source.body?.status) ? source.body : null;
  });
}

export async function addSource(harness: Harness, admin: AdminClient, appId: string, body: Record<string, unknown>): Promise<any> {
  const response = await admin.post(`/api/admin/applications/${appId}/sources`, body);
  if (response.status !== 201) throw new Error(`add source failed: ${response.status} ${JSON.stringify(response.body)}`);
  await harness.app.context.runner.drain();
  return waitForSource(admin, response.body.id);
}

export const CATALOG = [
  { navoroId: 'projects.nav', label: 'Projects', role: 'link', route: '/' },
  { navoroId: 'projects.new', label: 'New project', role: 'button', route: '/projects' },
  { navoroId: 'projects.name', label: 'Project name', role: 'textbox', route: '/projects/new' },
  { navoroId: 'projects.save', label: 'Save project', role: 'button', route: '/projects/new' },
];

/**
 * A workspace with one app: approved catalog, SAMPLE_DOC ingested, its
 * workflow published, and (optionally) a configuration published.
 */
export async function setupWorkspace(harness: Harness, options: { org?: string; publish?: Array<'development' | 'production'>; publishWorkflow?: boolean } = {}) {
  const admin = await newAdmin(harness, options.org ?? 'Org');
  const app = await createApp(admin);
  await admin.post(`/api/admin/applications/${app.id}/catalog`, { elements: CATALOG });
  const source = await addSource(harness, admin, app.id, { type: 'manual', title: 'Acme Help', content: SAMPLE_DOC });
  const workflows = (await admin.get(`/api/admin/applications/${app.id}/workflows`)).body.workflows;
  const workflow = workflows[0];
  if (options.publishWorkflow !== false) await admin.patch(`/api/admin/workflows/${workflow.id}`, { status: 'published' });
  for (const env of options.publish ?? ['development', 'production']) {
    const published = await admin.post(`/api/admin/applications/${app.id}/publish`, { environment: env });
    if (published.status !== 201) throw new Error(`publish failed: ${published.status} ${JSON.stringify(published.body)}`);
  }
  return { admin, app, source, workflowId: workflow.id as string };
}

export async function sdkFor(harness: Harness, publicKey: string, origin = DEV_ORIGIN, env: 'development' | 'production' = 'development'): Promise<SdkClient> {
  const sdk = new SdkClient(harness.baseUrl, origin);
  const init = await sdk.init(publicKey, env);
  if (init.status !== 200) throw new Error(`sdk init failed: ${init.status} ${JSON.stringify(init.body)}`);
  return sdk;
}

export async function sendEvents(sdk: SdkClient, events: unknown[]): Promise<{ status: number; body: any }> {
  const response = await sdk.post('events', { events });
  return { status: response.status, body: await response.json().catch(() => null) };
}

/** A tiny local documentation server whose routes the test controls. */
export interface DocServer {
  url: string;
  routes: Map<string, { status?: number; type?: string; body: string; delayMs?: number }>;
  /** Paths requested so far, in order. */
  requests: string[];
  close(): Promise<void>;
}

export async function startDocServer(): Promise<DocServer> {
  const routes: DocServer['routes'] = new Map();
  const timers = new Set<NodeJS.Timeout>();
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url ?? '/');
    const route = routes.get(req.url ?? '/');
    const reply = () => {
      if (!route) {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('missing');
        return;
      }
      res.writeHead(route.status ?? 200, { 'content-type': route.type ?? 'text/html; charset=utf-8' }).end(route.body);
    };
    if (route?.delayMs) {
      const timer = setTimeout(() => {
        timers.delete(timer);
        reply();
      }, route.delayMs);
      timers.add(timer);
    } else reply();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    routes,
    requests,
    async close() {
      for (const timer of timers) clearTimeout(timer);
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
