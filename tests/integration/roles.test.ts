import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AdminClient, type Harness } from '../helpers/harness.ts';
import { setupWorkspace, start, uniqueEmail } from './support.ts';

let harness: Harness;
let owner: AdminClient;
let appId: string;
let workflowId: string;
let sourceId: string;

const PASSWORD = 'member-password-123';

async function addMember(role: 'member' | 'admin' | 'owner', as: AdminClient = owner): Promise<{ status: number; email: string; userId?: string; body: any }> {
  const email = uniqueEmail(role);
  const response = await as.post('/api/admin/members', { email, name: `A ${role}`, role, password: PASSWORD });
  const userId = response.body?.members?.find((member: { email: string }) => member.email === email)?.userId;
  return { status: response.status, email, userId, body: response.body };
}

async function loginAs(email: string): Promise<AdminClient> {
  const client = new AdminClient(harness.baseUrl);
  const response = await client.post('/api/auth/login', { email, password: PASSWORD });
  assert.equal(response.status, 200);
  return client;
}

before(async () => {
  harness = await start();
  const workspace = await setupWorkspace(harness, { org: 'Roles Org' });
  owner = workspace.admin;
  appId = workspace.app.id;
  workflowId = workspace.workflowId;
  sourceId = workspace.source.id;
});
after(() => harness.close());

describe('member role (read-only)', () => {
  let member: AdminClient;
  before(async () => {
    const added = await addMember('member');
    assert.equal(added.status, 201);
    member = await loginAs(added.email);
  });

  test('can read workspace data', async () => {
    const me = await member.get('/api/auth/me');
    assert.equal(me.body.role, 'member');
    for (const path of [
      '/api/admin/applications',
      `/api/admin/applications/${appId}`,
      `/api/admin/applications/${appId}/sources`,
      `/api/admin/applications/${appId}/workflows`,
      `/api/admin/applications/${appId}/mappings`,
      `/api/admin/applications/${appId}/privacy`,
      `/api/admin/applications/${appId}/analytics`,
      `/api/admin/workflows/${workflowId}`,
      `/api/admin/sources/${sourceId}`,
      '/api/admin/overview',
      '/api/admin/settings',
      '/api/admin/audit',
    ]) {
      assert.equal((await member.get(path)).status, 200, path);
    }
  });

  test('every mutation is refused with 403', async () => {
    const privacy = (await owner.get(`/api/admin/applications/${appId}/privacy`)).body;
    const mutations: Array<[string, string, unknown]> = [
      ['POST', '/api/admin/applications', { name: 'X', developmentOrigins: [], productionOrigins: [] }],
      ['PATCH', `/api/admin/applications/${appId}`, { name: 'Renamed' }],
      ['PUT', `/api/admin/applications/${appId}/environments/development`, { allowedOrigins: [] }],
      ['POST', `/api/admin/applications/${appId}/publish`, { environment: 'development' }],
      ['POST', `/api/admin/applications/${appId}/catalog`, { elements: [{ navoroId: 'x' }] }],
      ['PUT', `/api/admin/applications/${appId}/privacy`, { observe: privacy.observe, transmit: privacy.transmit, neverCollect: [], retainQuestions: true, retentionDays: 30, analyticsEnabled: true, discoveryInDevelopment: true, environments: ['development'] }],
      ['POST', `/api/admin/applications/${appId}/sources`, { type: 'manual', content: 'A long enough piece of documentation text.' }],
      ['POST', `/api/admin/applications/${appId}/sources/sample`, {}],
      ['PATCH', `/api/admin/sources/${sourceId}`, { title: 'x' }],
      ['DELETE', `/api/admin/sources/${sourceId}`, undefined],
      ['POST', `/api/admin/applications/${appId}/refresh`, {}],
      ['PATCH', `/api/admin/workflows/${workflowId}`, { status: 'draft' }],
      ['PUT', `/api/admin/applications/${appId}/mappings/new-project`, { label: 'New project', navoroId: 'projects.new' }],
      ['PATCH', '/api/admin/settings', { approvalPolicy: 'auto' }],
      ['POST', '/api/admin/members', { email: uniqueEmail('m'), name: 'M', role: 'member', password: PASSWORD }],
    ];
    for (const [method, path, body] of mutations) {
      const response = await member.request(method, path, body);
      assert.equal(response.status, 403, `${method} ${path}`);
      assert.equal(response.body.error.code, 'forbidden');
    }
    // Nothing changed.
    assert.equal((await owner.get(`/api/admin/workflows/${workflowId}`)).body.status, 'published');
    assert.equal((await owner.get(`/api/admin/sources/${sourceId}`)).status, 200);
  });

  test('preview is a read and is allowed', async () => {
    const preview = await member.post(`/api/admin/applications/${appId}/preview`, { question: 'How do I create a project?' });
    assert.equal(preview.status, 200);
  });
});

describe('admin vs owner privileges', () => {
  let admin: AdminClient;
  let adminUserId: string;
  before(async () => {
    const added = await addMember('admin');
    assert.equal(added.status, 201);
    adminUserId = added.userId as string;
    admin = await loginAs(added.email);
  });

  test('admins can mutate content', async () => {
    const response = await admin.patch(`/api/admin/applications/${appId}`, { greeting: 'Hello from admin' });
    assert.equal(response.status, 200);
  });

  test('admins cannot add owners or promote anyone to owner', async () => {
    const added = await addMember('owner', admin);
    assert.equal(added.status, 403);
    const member = await addMember('member', admin);
    assert.equal(member.status, 201);
    const promote = await admin.patch(`/api/admin/members/${member.userId}`, { role: 'owner' });
    assert.equal(promote.status, 403);
  });

  test('admins cannot demote an owner', async () => {
    const ownerId = (await owner.get('/api/auth/me')).body.user.id;
    const response = await admin.patch(`/api/admin/members/${ownerId}`, { role: 'member' });
    assert.equal(response.status, 403);
  });

  test('nobody can change their own role', async () => {
    const response = await admin.patch(`/api/admin/members/${adminUserId}`, { role: 'member' });
    assert.equal(response.status, 400);
  });

  test('the last owner cannot be demoted; with two owners one can be', async () => {
    const ownerId = (await owner.get('/api/auth/me')).body.user.id;
    const self = await owner.patch(`/api/admin/members/${ownerId}`, { role: 'admin' });
    assert.equal(self.status, 400);
    const second = await addMember('owner');
    assert.equal(second.status, 201);
    const secondOwner = await loginAs(second.email);
    const demoteFirst = await secondOwner.patch(`/api/admin/members/${ownerId}`, { role: 'admin' });
    assert.equal(demoteFirst.status, 200);
    const settings = (await secondOwner.get('/api/admin/settings')).body;
    assert.equal(settings.members.filter((m: { role: string }) => m.role === 'owner').length, 1);
    // The former owner is now an admin and cannot remove the remaining (last) owner.
    const back = await owner.patch(`/api/admin/members/${second.userId}`, { role: 'admin' });
    assert.equal(back.status, 403);
  });

  test('duplicate membership → 409; unknown member → 404', async () => {
    // `owner` was demoted to admin above; admins may still manage members.
    const added = await addMember('member');
    assert.equal(added.status, 201);
    const again = await owner.post('/api/admin/members', { email: added.email, name: 'Again', role: 'member', password: PASSWORD });
    assert.equal(again.status, 409);
    const unknown = await owner.patch('/api/admin/members/usr_doesnotexist', { role: 'admin' });
    assert.equal(unknown.status, 404);
  });
});
