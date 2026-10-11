import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AdminClient, SdkClient, type Harness } from '../helpers/harness.ts';
import { newId, now } from '../../server/db/database.ts';
import { signSdkToken } from '../../server/security/crypto.ts';
import { DEV_ORIGIN, sdkFor, setupWorkspace, start } from './support.ts';

let harness: Harness;
let a: Awaited<ReturnType<typeof setupWorkspace>>;
let b: Awaited<ReturnType<typeof setupWorkspace>>;
let aJobId: string;
let aOrgId: string;
let bOrgId: string;

before(async () => {
  harness = await start();
  a = await setupWorkspace(harness, { org: 'Tenant A' });
  b = await setupWorkspace(harness, { org: 'Tenant B' });
  aJobId = (await a.admin.get('/api/admin/jobs')).body.jobs[0].id;
  aOrgId = (await a.admin.get('/api/auth/me')).body.organization.id;
  bOrgId = (await b.admin.get('/api/auth/me')).body.organization.id;
});
after(() => harness.close());

function assertNoLeak(body: unknown): void {
  const text = JSON.stringify(body);
  for (const id of [a.app.id, a.workflowId, a.source.id, a.app.publicKey, aJobId]) assert.ok(!text.includes(id), `response leaked ${id}`);
}

describe('admin API isolation', () => {
  test("B cannot read A's resources (404, no data)", async () => {
    const appPath = `/api/admin/applications/${a.app.id}`;
    for (const path of [
      appPath,
      `${appPath}/sources`,
      `${appPath}/workflows`,
      `${appPath}/mappings`,
      `${appPath}/knowledge`,
      `${appPath}/catalog`,
      `${appPath}/blueprints`,
      `${appPath}/privacy`,
      `${appPath}/analytics`,
      `/api/admin/jobs?applicationId=${a.app.id}`,
      `/api/admin/jobs/${aJobId}`,
      `/api/admin/workflows/${a.workflowId}`,
      `/api/admin/sources/${a.source.id}`,
    ]) {
      const response = await b.admin.get(path);
      assert.equal(response.status, 404, path);
      assertNoLeak(response.body);
    }
  });

  test("B cannot modify or delete A's resources (404) and A's data is unchanged", async () => {
    const appPath = `/api/admin/applications/${a.app.id}`;
    const privacy = (await a.admin.get(`${appPath}/privacy`)).body;
    const workflow = (await a.admin.get(`/api/admin/workflows/${a.workflowId}`)).body;
    const mutations: Array<[string, string, unknown]> = [
      ['PATCH', appPath, { name: 'Pwned' }],
      ['PUT', `${appPath}/environments/development`, { allowedOrigins: ['https://evil.test'] }],
      ['POST', `${appPath}/publish`, { environment: 'development' }],
      ['POST', `${appPath}/catalog`, { elements: [{ navoroId: 'evil' }] }],
      ['PUT', `${appPath}/privacy`, { ...pick(privacy), retainQuestions: true }],
      ['POST', `${appPath}/sources`, { type: 'manual', content: 'Injected documentation from another tenant.' }],
      ['PATCH', `/api/admin/sources/${a.source.id}`, { content: 'Overwritten by tenant B, which should never happen.' }],
      ['DELETE', `/api/admin/sources/${a.source.id}`, undefined],
      ['POST', `${appPath}/refresh`, {}],
      ['PATCH', `/api/admin/workflows/${a.workflowId}`, { status: 'archived' }],
      ['PATCH', `/api/admin/workflows/${a.workflowId}/steps/${workflow.steps[0].id}`, { title: 'Pwned' }],
      ['PUT', `${appPath}/mappings/new-project`, { label: 'New project', navoroId: 'evil' }],
      ['POST', `${appPath}/preview`, { question: 'How do I create a project?' }],
      ['POST', `/api/admin/jobs/${aJobId}/cancel`, {}],
    ];
    for (const [method, path, body] of mutations) {
      const response = await b.admin.request(method, path, body);
      assert.equal(response.status, 404, `${method} ${path}`);
      assertNoLeak(response.body);
    }
    const after = (await a.admin.get(appPath)).body;
    assert.equal(after.name, 'Acme');
    assert.deepEqual(after.environments[0].allowedOrigins, [DEV_ORIGIN]);
    assert.equal((await a.admin.get(`/api/admin/workflows/${a.workflowId}`)).body.status, 'published');
    assert.equal((await a.admin.get(`/api/admin/sources/${a.source.id}`)).body.status, 'ready');
    assert.equal((await a.admin.get(`${appPath}/privacy`)).body.retainQuestions, false);
  });

  test("listing endpoints never include A's rows", async () => {
    for (const path of ['/api/admin/applications', '/api/admin/jobs', '/api/admin/overview', '/api/admin/audit', '/api/admin/settings']) {
      const response = await b.admin.get(path);
      assert.equal(response.status, 200, path);
      assertNoLeak(response.body);
    }
    const apps = (await b.admin.get('/api/admin/applications')).body.applications;
    assert.deepEqual(apps.map((app: { id: string }) => app.id), [b.app.id]);
    const members = (await b.admin.get('/api/admin/settings')).body.members;
    assert.equal(members.length, 1);
  });
});

function pick(privacy: Record<string, unknown>) {
  const { observe, transmit, neverCollect, retainQuestions, retentionDays, analyticsEnabled, discoveryInDevelopment, environments } = privacy as any;
  return { observe, transmit, neverCollect: neverCollect.map((rule: any) => ({ kind: rule.kind, value: rule.value, label: rule.label })), retainQuestions, retentionDays, analyticsEnabled, discoveryInDevelopment, environments };
}

describe('database triggers', () => {
  test('reject cross-tenant inserts', () => {
    const db = harness.app.context.db;
    assert.throws(
      () => db.run(
        `INSERT INTO knowledge_sources (id, org_id, app_id, type, title, reference, content, content_hash, status, metadata, created_at, updated_at)
         VALUES (?, ?, ?, 'manual', 'x', NULL, 'x', NULL, 'pending', '{}', ?, ?)`,
        [newId('src'), bOrgId, a.app.id, now(), now()],
      ),
      /tenant_mismatch/,
    );
    assert.throws(
      () => db.run(
        `INSERT INTO workflows (id, org_id, app_id, source_id, key, title, summary, kind, status, confidence, origin, edited, prerequisites, source_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'k', 't', 's', 'task', 'draft', 0.5, 'manual', 0, '[]', NULL, ?, ?)`,
        [newId('wf'), bOrgId, b.app.id, a.source.id, now(), now()],
      ),
      /tenant_mismatch/,
      'a workflow in B cannot reference a source of A',
    );
    assert.throws(
      () => db.run('INSERT INTO element_mappings (id, org_id, app_id, key, label, strategies, provenance, confidence, validation, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
        newId('map'), bOrgId, a.app.id, 'k', 'l', '[]', 'admin', 1, 'valid', now(),
      ]),
      /tenant_mismatch/,
    );
    assert.throws(
      () => db.run("INSERT INTO jobs (id, org_id, app_id, type, status, payload, steps, created_at) VALUES (?, ?, ?, 'refresh', 'queued', '{}', '[]', ?)", [newId('job'), bOrgId, a.app.id, now()]),
      /tenant_mismatch/,
    );
  });

  test('org_id is immutable', () => {
    assert.throws(() => harness.app.context.db.run('UPDATE applications SET org_id = ? WHERE id = ?', [bOrgId, a.app.id]), /org_id_immutable/);
    assert.throws(() => harness.app.context.db.run('UPDATE workflows SET org_id = ? WHERE id = ?', [bOrgId, a.workflowId]), /org_id_immutable/);
    assert.equal(aOrgId.startsWith('org_'), true);
  });
});

describe('SDK isolation', () => {
  test("a token for A's app only ever returns A's knowledge", async () => {
    const sdkA = await sdkFor(harness, a.app.publicKey);
    const answer = await sdkA.ask('How do I create a project?');
    assert.equal(answer.status, 200);
    assert.equal(answer.result.workflow.id, a.workflowId);
    assert.notEqual(answer.result.workflow.id, b.workflowId);
  });

  test("a forged token claiming B's org with A's app is rejected (signature)", async () => {
    const sdkA = await sdkFor(harness, a.app.publicKey);
    const [body] = sdkA.token.split('.');
    const claims = JSON.parse(Buffer.from(body as string, 'base64url').toString('utf8'));
    const forgedBody = Buffer.from(JSON.stringify({ ...claims, org: bOrgId, app: b.app.id })).toString('base64url');
    const tampered = new SdkClient(harness.baseUrl, DEV_ORIGIN);
    tampered.token = `${forgedBody}.${sdkA.token.split('.')[1]}`;
    const response = await tampered.post('guidance', { question: 'How do I create a project?', context: {}, requestId: 'r1' });
    assert.equal(response.status, 401);
  });

  test('a validly signed token mixing org B with app A finds no application', async () => {
    const token = signSdkToken({ app: a.app.id, org: bOrgId, env: 'development', origin: DEV_ORIGIN, exp: Math.floor(Date.now() / 1000) + 60 }, harness.config.sessionSecret);
    const client = new SdkClient(harness.baseUrl, DEV_ORIGIN);
    client.token = token;
    const response = await client.post('guidance', { question: 'How do I create a project?', context: {}, requestId: 'r1' });
    assert.equal(response.status, 401);
  });

  test('sessions from another tenant are ignored for guidance and events', async () => {
    const sdkA = await sdkFor(harness, a.app.publicKey);
    const sdkB = await sdkFor(harness, b.app.publicKey);
    const first = await sdkA.ask('How do I create a project?');
    const sessionA = first.result.sessionId;
    const reuse = await sdkB.ask('How do I create a project?', {}, sessionA);
    assert.notEqual(reuse.result.sessionId, sessionA, 'B gets a fresh session instead of joining A\'s');
    const events = await sdkB.post('events', { events: [{ type: 'workflow_completed', sessionId: sessionA }] });
    assert.equal(((await events.json()) as any).accepted, 0);
    const row = harness.app.context.db.get<{ outcome: string }>('SELECT outcome FROM guidance_sessions WHERE id = ?', [sessionA]);
    assert.equal(row?.outcome, 'answered');
  });
});

describe('cross-tenant admin session', () => {
  test("a user from B logging in never lands in A's workspace", async () => {
    const me = await b.admin.get('/api/auth/me');
    assert.equal(me.body.organization.id, bOrgId);
    assert.notEqual(bOrgId, aOrgId);
    const fresh = new AdminClient(harness.baseUrl);
    assert.equal((await fresh.get(`/api/admin/applications/${a.app.id}`)).status, 401);
  });
});
