import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SdkClient, type Harness } from '../helpers/harness.ts';
import { DEV_ORIGIN, PROD_ORIGIN, createApp, newAdmin, sdkFor, setupWorkspace, start } from './support.ts';

let harness: Harness;
let ws: Awaited<ReturnType<typeof setupWorkspace>>;

const BLOCK_RULE = { kind: 'navoro_id', value: 'projects.name', label: 'Project name field' };

before(async () => {
  harness = await start();
  ws = await setupWorkspace(harness, { org: 'Sdk Org', publish: [] });
  const privacy = (await ws.admin.get(`/api/admin/applications/${ws.app.id}/privacy`)).body;
  const saved = await ws.admin.put(`/api/admin/applications/${ws.app.id}/privacy`, {
    observe: privacy.observe,
    transmit: privacy.transmit,
    neverCollect: [BLOCK_RULE],
    retainQuestions: false,
    retentionDays: 30,
    analyticsEnabled: true,
    discoveryInDevelopment: true,
    environments: ['development', 'production'],
  });
  assert.equal(saved.status, 200);
  for (const environment of ['development', 'production']) {
    assert.equal((await ws.admin.post(`/api/admin/applications/${ws.app.id}/publish`, { environment })).status, 201);
  }
});
after(() => harness.close());

function rawInit(origin: string | null, publicKey: string, environment = 'development'): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (origin) headers.origin = origin;
  return fetch(`${harness.baseUrl}/api/sdk/v1/init`, { method: 'POST', headers, body: JSON.stringify({ publicKey, environment, sdkVersion: '0.1.0' }) });
}

describe('/init and config delivery', () => {
  test('registered origin → 200, CORS echoes the origin, config comes from the published snapshot', async () => {
    const sdk = new SdkClient(harness.baseUrl, DEV_ORIGIN);
    const init = await sdk.init(ws.app.publicKey);
    assert.equal(init.status, 200);
    assert.equal(init.headers.get('access-control-allow-origin'), DEV_ORIGIN);
    assert.equal(init.headers.get('vary'), 'Origin');
    const { config } = init.body;
    assert.equal(init.body.apiVersion, 1);
    assert.equal(config.applicationName, 'Acme');
    assert.equal(config.environment, 'development');
    assert.ok(config.configVersion >= 1);
    assert.deepEqual(config.privacy.approvedNavoroIds, ['projects.name', 'projects.nav', 'projects.new', 'projects.save']);
    assert.deepEqual(config.privacy.blockedNavoroIds, ['projects.name']);
    assert.equal(config.privacy.allowlistOnly, true);
    assert.equal(config.discoveryEnabled, true);
    // Nothing admin-only leaks into the public config.
    const text = JSON.stringify(init.body);
    for (const secret of [harness.config.sessionSecret, 'workflowIds', 'retainQuestions', 'csrf', ws.app.id]) assert.ok(!text.includes(secret), secret);
  });

  test('production init gets production config with discovery disabled', async () => {
    const init = await new SdkClient(harness.baseUrl, PROD_ORIGIN).init(ws.app.publicKey, 'production');
    assert.equal(init.status, 200);
    assert.equal(init.body.config.environment, 'production');
    assert.equal(init.body.config.discoveryEnabled, false);
  });

  test('unregistered origin → 403 and no CORS allow-origin header', async () => {
    const response = await rawInit('https://evil.example', ws.app.publicKey);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    const body = (await response.json()) as any;
    assert.equal(body.error.code, 'origin_not_allowed');
    assert.ok(!('sessionToken' in body));
  });

  test('an origin registered only for production cannot init development', async () => {
    const response = await rawInit(PROD_ORIGIN, ws.app.publicKey, 'development');
    assert.equal(response.status, 403);
    assert.equal(((await response.json()) as any).error.code, 'origin_not_allowed');
  });

  test('missing Origin → 403', async () => {
    assert.equal((await rawInit(null, ws.app.publicKey)).status, 403);
  });

  test('unknown key gives the same 403 as a wrong origin (no key oracle)', async () => {
    const unknown = await rawInit(DEV_ORIGIN, 'nav_pk_doesnotexist123');
    const wrongOrigin = await rawInit('https://evil.example', ws.app.publicKey);
    assert.equal(unknown.status, 403);
    assert.deepEqual(await unknown.json(), await wrongOrigin.json());
    assert.equal((await rawInit(DEV_ORIGIN, 'not-a-key')).status, 400);
  });

  test('production environment with no registered origins → 403', async () => {
    const admin = await newAdmin(harness, 'No Prod Origins');
    const app = await createApp(admin, 'NoProd', [DEV_ORIGIN], []);
    assert.equal((await rawInit(PROD_ORIGIN, app.publicKey, 'production')).status, 403);
    assert.equal((await rawInit(DEV_ORIGIN, app.publicKey, 'production')).status, 403);
    assert.equal((await rawInit(DEV_ORIGIN, app.publicKey, 'development')).status, 200);
  });

  test('environment disabled by the published privacy policy → 403 environment_disabled', async () => {
    const { admin, app } = await setupWorkspace(harness, { org: 'Env Disabled', publish: ['production'] });
    const privacy = (await admin.get(`/api/admin/applications/${app.id}/privacy`)).body;
    const body = {
      observe: privacy.observe, transmit: privacy.transmit, neverCollect: [], retainQuestions: false, retentionDays: 30,
      analyticsEnabled: true, discoveryInDevelopment: true, environments: ['development'],
    };
    assert.equal((await admin.put(`/api/admin/applications/${app.id}/privacy`, body)).status, 200);
    // Publishing production is refused by the policy itself.
    assert.equal((await admin.post(`/api/admin/applications/${app.id}/publish`, { environment: 'production' })).status, 400);
    assert.equal((await rawInit(PROD_ORIGIN, app.publicKey, 'production')).status, 200, 'still running the earlier production snapshot');
    // Publishing the restricted policy to development must also switch production off.
    assert.equal((await admin.post(`/api/admin/applications/${app.id}/publish`, { environment: 'development' })).status, 201);
    const response = await rawInit(PROD_ORIGIN, app.publicKey, 'production');
    assert.equal(response.status, 403);
    assert.equal(((await response.json()) as any).error.code, 'environment_disabled');
    assert.equal((await rawInit(DEV_ORIGIN, app.publicKey, 'development')).status, 200);
  });

  test('removing an origin revokes existing tokens for it', async () => {
    const { admin, app } = await setupWorkspace(harness, { org: 'Revoke', publish: ['development'] });
    const sdk = await sdkFor(harness, app.publicKey);
    assert.equal((await sdk.ask('How do I create a project?')).status, 200);
    await admin.put(`/api/admin/applications/${app.id}/environments/development`, { allowedOrigins: ['http://localhost:4000'] });
    assert.equal((await sdk.ask('How do I create a project?')).status, 403);
  });
});

describe('CORS preflight', () => {
  function preflight(origin: string): Promise<Response> {
    return fetch(`${harness.baseUrl}/api/sdk/v1/guidance`, { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization, content-type' } });
  }

  test('registered origin → 204 with CORS headers', async () => {
    const response = await preflight(DEV_ORIGIN);
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), DEV_ORIGIN);
    assert.match(response.headers.get('access-control-allow-headers') ?? '', /authorization/);
    assert.match(response.headers.get('access-control-allow-methods') ?? '', /POST/);
  });

  test('unregistered origin → 403 without CORS headers', async () => {
    const response = await preflight('https://evil.example');
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  });
});

describe('guidance', () => {
  test('published workflow question → NDJSON status events then a result with targeted steps', async () => {
    const response = await (await sdkFor(harness, ws.app.publicKey)).post('guidance', { question: 'How do I create a project?', context: { route: '/projects' }, requestId: 'req-1' });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /application\/x-ndjson/);
    assert.equal(response.headers.get('access-control-allow-origin'), DEV_ORIGIN);
    const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line));
    assert.deepEqual(events.slice(0, -1).map((event) => [event.type, event.phase]), [['status', 'retrieving'], ['status', 'reasoning'], ['status', 'validating']]);
    const result = events.at(-1).result;
    assert.equal(events.at(-1).type, 'result');
    assert.equal(result.kind, 'workflow');
    assert.equal(result.grounded, true);
    assert.equal(result.mode, 'demo');
    assert.equal(result.requestId, 'req-1');
    assert.match(result.sessionId, /^gs_/);
    assert.equal(result.workflow.id, ws.workflowId);
    assert.equal(result.steps.length, 4);
    assert.deepEqual(result.steps[1].target.strategies[0], { type: 'navoro_id', value: 'projects.new' });
    assert.ok(result.steps.every((step: { target: unknown }) => step.target !== null));
  });

  test('draft workflows are not used for end users but are used by admin preview', async () => {
    const { admin, app, workflowId } = await setupWorkspace(harness, { org: 'Drafts', publishWorkflow: false, publish: ['development'] });
    const sdk = await sdkFor(harness, app.publicKey);
    const user = await sdk.ask('How do I create a project?');
    assert.notEqual(user.result.kind, 'workflow');
    assert.equal(user.result.workflow, null);
    const preview = await admin.post(`/api/admin/applications/${app.id}/preview`, { question: 'How do I create a project?', route: '/projects' });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.result.kind, 'workflow');
    assert.equal(preview.body.result.workflow.id, workflowId);
    assert.deepEqual(preview.body.context, { route: '/projects' });
  });

  test('published but not yet in a published config is not used either', async () => {
    const { admin, app, workflowId } = await setupWorkspace(harness, { org: 'Unpublished Config', publishWorkflow: false, publish: ['development'] });
    await admin.patch(`/api/admin/workflows/${workflowId}`, { status: 'published' });
    const sdk = await sdkFor(harness, app.publicKey);
    assert.notEqual((await sdk.ask('How do I create a project?')).result.kind, 'workflow');
    await admin.post(`/api/admin/applications/${app.id}/publish`, { environment: 'development' });
    assert.equal((await sdk.ask('How do I create a project?')).result.kind, 'workflow');
  });

  test('unresolved question → kind unresolved, grounded false, fallback present', async () => {
    const { result } = await (await sdkFor(harness, ws.app.publicKey)).ask('What is the meaning of quantum chromodynamics?');
    assert.equal(result.kind, 'unresolved');
    assert.equal(result.grounded, false);
    assert.deepEqual(result.steps, []);
    assert.deepEqual(result.fallback, { label: 'Ask your workspace admin', url: null });
  });

  test('visible error context → troubleshooting', async () => {
    const { result } = await (await sdkFor(harness, ws.app.publicKey)).ask('Why can’t I save?', { visibleErrors: [{ code: 'PROJECT_NAME_REQUIRED', message: 'Project name is required', nearNavoroId: null }] });
    assert.equal(result.kind, 'troubleshooting');
    assert.match(result.answer, /Type a name into Project name/);
  });

  test('validation: question >500 chars → 400; unknown fields → 400', async () => {
    const sdk = await sdkFor(harness, ws.app.publicKey);
    const long = await sdk.post('guidance', { question: 'x'.repeat(501), context: {}, requestId: 'r' });
    assert.equal(long.status, 400);
    assert.equal(long.headers.get('access-control-allow-origin'), DEV_ORIGIN, 'error responses keep CORS for registered origins');
    const extra = await sdk.post('guidance', { question: 'hi', context: { cookies: 'x' }, requestId: 'r' });
    assert.equal(extra.status, 400);
  });

  test('a token issued to origin A cannot be used from origin B', async () => {
    const sdk = await sdkFor(harness, ws.app.publicKey);
    const other = new SdkClient(harness.baseUrl, PROD_ORIGIN);
    other.token = sdk.token;
    const response = await other.post('guidance', { question: 'How do I create a project?', context: {}, requestId: 'r' });
    assert.equal(response.status, 403);
    assert.equal(((await response.json()) as any).error.code, 'origin_not_allowed');
  });

  test('missing, garbage or tampered tokens → 401', async () => {
    const sdk = await sdkFor(harness, ws.app.publicKey);
    for (const token of ['', 'garbage', `${sdk.token.slice(0, -2)}xx`]) {
      const client = new SdkClient(harness.baseUrl, DEV_ORIGIN);
      client.token = token;
      assert.equal((await client.post('guidance', { question: 'hi', context: {}, requestId: 'r' })).status, 401, token);
    }
  });

  test('context with blocked and unapproved elements is accepted and still answered', async () => {
    const response = await (await sdkFor(harness, ws.app.publicKey)).ask('How do I create a project?', {
      elements: [
        { navoroId: 'projects.name', role: 'textbox', label: 'Project name', disabled: false, invalid: true },
        { navoroId: 'not.approved', role: 'button', label: 'Secret', disabled: false, invalid: false },
      ],
    });
    assert.equal(response.status, 200);
    assert.equal(response.result.kind, 'workflow');
  });
});

describe('discovery (Training Mode)', () => {
  const discovery = (elements: unknown[]) => ({ route: '/projects', viewport: { width: 1280, height: 800 }, documentHeight: 2400.6, elements });
  const el = (navoroId: string, label: string) => ({ navoroId, role: 'button', label, tag: 'button', inputType: null, rect: { x: 1.4, y: 2.6, width: 100, height: 30 } });

  test('accepted in development: unapproved catalog entries, stored blueprint, blocked labels nulled', async () => {
    const sdk = await sdkFor(harness, ws.app.publicKey);
    const response = await sdk.post('discovery', discovery([el('projects.archive', 'Archive project'), el('projects.name', 'Project name SECRET')]));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, accepted: 2 });
    const catalog = (await ws.admin.get(`/api/admin/applications/${ws.app.id}/catalog`)).body.elements;
    const archive = catalog.find((entry: { navoroId: string }) => entry.navoroId === 'projects.archive');
    assert.equal(archive.approved, false, 'discovery never auto-approves');
    assert.equal(archive.source, 'sdk_discovery');
    const name = catalog.find((entry: { navoroId: string }) => entry.navoroId === 'projects.name');
    assert.equal(name.approved, true, 'existing approval is preserved');
    assert.equal(name.label, 'Project name', 'blocked label was not overwritten');
    const blueprints = (await ws.admin.get(`/api/admin/applications/${ws.app.id}/blueprints`)).body.blueprints;
    assert.equal(blueprints.length, 1);
    assert.equal(blueprints[0].route, '/projects');
    assert.equal(blueprints[0].documentHeight, 2401);
    const blocked = blueprints[0].elements.find((entry: { navoroId: string }) => entry.navoroId === 'projects.name');
    assert.equal(blocked.label, null);
    assert.deepEqual(blocked.rect, { x: 1, y: 3, width: 100, height: 30 });
    assert.ok(!JSON.stringify(blueprints).includes('SECRET'));
  });

  test('refused in production', async () => {
    const sdk = await sdkFor(harness, ws.app.publicKey, PROD_ORIGIN, 'production');
    const response = await sdk.post('discovery', discovery([el('projects.prod', 'Prod')]));
    assert.equal(response.status, 403);
    const catalog = (await ws.admin.get(`/api/admin/applications/${ws.app.id}/catalog`)).body.elements;
    assert.ok(!catalog.some((entry: { navoroId: string }) => entry.navoroId === 'projects.prod'));
  });

  test('invalid navoro ids are rejected', async () => {
    const sdk = await sdkFor(harness, ws.app.publicKey);
    assert.equal((await sdk.post('discovery', discovery([el('<script>', 'x')]))).status, 400);
  });
});
