import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { type AdminClient, type Harness } from '../helpers/harness.ts';
import { DEV_ORIGIN, sdkFor, setupWorkspace, start } from './support.ts';

let harness: Harness;
let admin: AdminClient;
let appId: string;
let publicKey: string;
let workflowId: string;

before(async () => {
  harness = await start();
  const ws = await setupWorkspace(harness, { org: 'Publishing', publish: [] });
  admin = ws.admin;
  appId = ws.app.id;
  publicKey = ws.app.publicKey;
  workflowId = ws.workflowId;
});
after(() => harness.close());

const privacyPath = () => `/api/admin/applications/${appId}/privacy`;

function policy(patch: Record<string, unknown> = {}) {
  return {
    observe: ['route', 'pageTitle', 'headings', 'elements', 'fieldLabels', 'visibleErrors'],
    transmit: ['route', 'pageTitle', 'headings', 'elements', 'visibleErrors'],
    neverCollect: [],
    retainQuestions: false,
    retentionDays: 30,
    analyticsEnabled: true,
    discoveryInDevelopment: true,
    environments: ['development', 'production'],
    ...patch,
  };
}

describe('privacy API validation', () => {
  test('transmit must be a subset of observe', async () => {
    const response = await admin.put(privacyPath(), policy({ observe: ['route'], transmit: ['route', 'pageTitle'] }));
    assert.equal(response.status, 400);
    assert.match(response.body.error.message, /aren't observed: pageTitle/);
  });

  test('invalid selectors and navoro ids are rejected', async () => {
    for (const rule of [
      { kind: 'selector', value: 'div { color: red }', label: 'x' },
      { kind: 'selector', value: '<script>', label: 'x' },
      { kind: 'selector', value: '@import url(x)', label: 'x' },
      { kind: 'navoro_id', value: 'has space', label: 'x' },
      { kind: 'xpath', value: '//div', label: 'x' },
    ]) {
      const response = await admin.put(privacyPath(), policy({ neverCollect: [rule] }));
      assert.equal(response.status, 400, JSON.stringify(rule));
    }
  });

  test('bounds and unknown categories are rejected', async () => {
    assert.equal((await admin.put(privacyPath(), policy({ retentionDays: 0 }))).status, 400);
    assert.equal((await admin.put(privacyPath(), policy({ retentionDays: 366 }))).status, 400);
    assert.equal((await admin.put(privacyPath(), policy({ observe: ['cookies'] }))).status, 400);
    assert.equal((await admin.put(privacyPath(), policy({ environments: [] }))).status, 400);
    assert.equal((await admin.put(privacyPath(), { ...policy(), extra: true })).status, 400);
  });

  test('valid rules are saved, deduplicated and keep their ids across saves', async () => {
    const rules = [
      { kind: 'selector', value: '.billing-panel input', label: 'Billing' },
      { kind: 'selector', value: '.billing-panel input', label: 'Billing dupe' },
      { kind: 'navoro_id', value: 'projects.name', label: 'Project name' },
    ];
    const first = await admin.put(privacyPath(), policy({ neverCollect: rules }));
    assert.equal(first.status, 200);
    assert.equal(first.body.neverCollect.length, 2);
    assert.ok(first.body.builtInExclusions.length > 0);
    const second = await admin.put(privacyPath(), policy({ neverCollect: rules.slice(0, 1) }));
    assert.equal(second.body.neverCollect[0].id, first.body.neverCollect[0].id);
    await admin.put(privacyPath(), policy());
  });
});

describe('publishing', () => {
  test('unpublishedChanges flips with draft edits and publishing', async () => {
    assert.equal((await admin.put(privacyPath(), policy())).status, 200);
    assert.equal((await admin.get(privacyPath())).body.unpublishedChanges, true, 'nothing published yet');
    assert.equal((await admin.post(`/api/admin/applications/${appId}/publish`, { environment: 'development' })).status, 201);
    assert.equal((await admin.get(privacyPath())).body.unpublishedChanges, false);
    await admin.put(privacyPath(), policy({ retentionDays: 14 }));
    assert.equal((await admin.get(privacyPath())).body.unpublishedChanges, true);
    await admin.post(`/api/admin/applications/${appId}/publish`, { environment: 'development' });
    assert.equal((await admin.get(privacyPath())).body.unpublishedChanges, false);
    await admin.post(`/api/admin/applications/${appId}/publish`, { environment: 'production' });
    await admin.put(privacyPath(), policy({ retentionDays: 14, analyticsEnabled: false }));
    await admin.post(`/api/admin/applications/${appId}/publish`, { environment: 'development' });
    assert.equal((await admin.get(privacyPath())).body.unpublishedChanges, true, 'production still runs the older policy');
    await admin.post(`/api/admin/applications/${appId}/publish`, { environment: 'production' });
    assert.equal((await admin.get(privacyPath())).body.unpublishedChanges, false);
  });

  test('publishing creates incrementing versions and changes what /init returns', async () => {
    const before = (await admin.get(`/api/admin/applications/${appId}`)).body.configVersions;
    const sdk = await sdkFor(harness, publicKey);
    const initBefore = (await sdk.init(publicKey)).body.config;

    await admin.put(privacyPath(), policy({ transmit: ['route'], neverCollect: [{ kind: 'navoro_id', value: 'projects.new', label: 'New' }] }));
    assert.deepEqual((await sdk.init(publicKey)).body.config.privacy.transmit, initBefore.privacy.transmit, 'draft changes are not live');

    const published = await admin.post(`/api/admin/applications/${appId}/publish`, { environment: 'development', notes: 'Lock down' });
    assert.equal(published.status, 201);
    assert.equal(published.body.version, (before[0]?.version ?? 0) + 1);
    assert.equal(published.body.notes, 'Lock down');
    assert.deepEqual(published.body.summary.transmitCategories, ['route']);
    assert.equal(published.body.summary.blockedRegions, 1);

    const after = (await sdk.init(publicKey)).body.config;
    assert.equal(after.configVersion, published.body.version);
    assert.deepEqual(after.privacy.transmit, ['route']);
    assert.deepEqual(after.privacy.blockedNavoroIds, ['projects.new']);

    const next = await admin.post(`/api/admin/applications/${appId}/publish`, { environment: 'production' });
    assert.equal(next.body.version, published.body.version + 1, 'versions are per application, across environments');
    await admin.put(privacyPath(), policy());
  });

  test('archiving a published workflow removes it from live guidance immediately', async () => {
    await admin.put(privacyPath(), policy());
    await admin.patch(`/api/admin/workflows/${workflowId}`, { status: 'published' });
    await admin.post(`/api/admin/applications/${appId}/publish`, { environment: 'development' });
    const sdk = await sdkFor(harness, publicKey);
    assert.equal((await sdk.ask('How do I create a project?')).result.kind, 'workflow');
    await admin.patch(`/api/admin/workflows/${workflowId}`, { status: 'archived' });
    assert.notEqual((await sdk.ask('How do I create a project?')).result.kind, 'workflow', 'archived workflows stop immediately');
    await admin.patch(`/api/admin/workflows/${workflowId}`, { status: 'draft' });
    await admin.patch(`/api/admin/workflows/${workflowId}`, { status: 'published' });
  });

  test('invalid workflow transitions → 400', async () => {
    await admin.patch(`/api/admin/workflows/${workflowId}`, { status: 'archived' });
    const response = await admin.patch(`/api/admin/workflows/${workflowId}`, { status: 'published' });
    assert.equal(response.status, 400);
    await admin.patch(`/api/admin/workflows/${workflowId}`, { status: 'draft' });
  });

  test('publish with an unknown environment → 400; origins must be bare origins', async () => {
    assert.equal((await admin.post(`/api/admin/applications/${appId}/publish`, { environment: 'staging' })).status, 400);
    const bad = await admin.put(`/api/admin/applications/${appId}/environments/development`, { allowedOrigins: ['https://app.example.com/path'] });
    assert.equal(bad.status, 400);
    const ok = await admin.put(`/api/admin/applications/${appId}/environments/development`, { allowedOrigins: [`${DEV_ORIGIN}/`, DEV_ORIGIN.toUpperCase()] });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body.environments.find((env: { name: string }) => env.name === 'development').allowedOrigins, [DEV_ORIGIN]);
    assert.equal((await admin.put(`/api/admin/applications/${appId}/environments/staging`, { allowedOrigins: [] })).status, 404);
  });
});
