import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { type AdminClient, type Harness } from '../helpers/harness.ts';
import { tenant } from '../../server/data/tenant.ts';
import { sdkFor, sendEvents, setupWorkspace, start } from './support.ts';

let harness: Harness;

before(async () => {
  harness = await start();
});
after(() => harness.close());

async function setPolicy(admin: AdminClient, appId: string, patch: Record<string, unknown>, publishTo: Array<'development' | 'production'> = ['development']): Promise<void> {
  const current = (await admin.get(`/api/admin/applications/${appId}/privacy`)).body;
  const body = {
    observe: current.observe,
    transmit: current.transmit,
    neverCollect: current.neverCollect.map((rule: { kind: string; value: string; label: string }) => ({ kind: rule.kind, value: rule.value, label: rule.label })),
    retainQuestions: current.retainQuestions,
    retentionDays: current.retentionDays,
    analyticsEnabled: current.analyticsEnabled,
    discoveryInDevelopment: current.discoveryInDevelopment,
    environments: current.environments,
    ...patch,
  };
  assert.equal((await admin.put(`/api/admin/applications/${appId}/privacy`, body)).status, 200);
  for (const environment of publishTo) assert.equal((await admin.post(`/api/admin/applications/${appId}/publish`, { environment })).status, 201);
}

function questionRows(appId: string): Array<{ text: string | null; topic: string; grounded: number; expires_at: string | null }> {
  return harness.app.context.db.all('SELECT text, topic, grounded, expires_at FROM questions WHERE app_id = ? ORDER BY created_at', [appId]);
}

describe('analytics', () => {
  test('guidance + events produce sessions, outcomes, topics, missing targets, feedback and step abandonment', async () => {
    const { admin, app, workflowId } = await setupWorkspace(harness, { org: 'Analytics', publish: ['development'] });
    const sdk = await sdkFor(harness, app.publicKey);

    const completed = await sdk.ask('How do I create a project?');
    const dismissed = await sdk.ask('How do I create a project?');
    const unresolved = await sdk.ask('Tell me about quantum chromodynamics');
    assert.equal(unresolved.result.kind, 'unresolved');
    const s1 = completed.result.sessionId;
    const s2 = dismissed.result.sessionId;

    const accepted = await sendEvents(sdk, [
      { type: 'launcher_opened' },
      { type: 'step_viewed', sessionId: s1, stepIndex: 0 },
      { type: 'step_viewed', sessionId: s1, stepIndex: 1 },
      { type: 'workflow_completed', sessionId: s1 },
      { type: 'feedback_helpful', sessionId: s1 },
      { type: 'step_viewed', sessionId: s2, stepIndex: 0 },
      { type: 'step_viewed', sessionId: s2, stepIndex: 1 },
      { type: 'step_target_missing', sessionId: s2, stepIndex: 1, mappingKey: 'new-project' },
      { type: 'guidance_dismissed', sessionId: s2 },
      { type: 'feedback_not_helpful', sessionId: s2 },
    ]);
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.accepted, 10);

    const analytics = (await admin.get(`/api/admin/applications/${app.id}/analytics?days=7`)).body;
    assert.equal(analytics.days, 7);
    assert.equal(analytics.daily.length, 7);
    assert.deepEqual(analytics.sessions, { total: 3, answered: 2, unresolved: 1, completed: 1, dismissed: 1, cancelled: 0, errors: 0 });
    const topics = Object.fromEntries(analytics.topTopics.map((topic: { topic: string; count: number; unresolved: number }) => [topic.topic, [topic.count, topic.unresolved]]));
    assert.deepEqual(topics, { 'Create a project': [2, 0], 'Unmatched questions': [1, 1] });
    assert.deepEqual(analytics.missingTargets, [{ key: 'new-project', count: 1 }]);
    assert.deepEqual(analytics.feedback, { helpful: 1, notHelpful: 1 });
    const abandonment = analytics.stepAbandonment.map((row: { workflowId: string; stepIndex: number; views: number; dropOffs: number }) => [row.workflowId, row.stepIndex, row.views, row.dropOffs]);
    assert.deepEqual(abandonment, [[workflowId, 1, 2, 1], [workflowId, 0, 2, 0]]);
    assert.equal(analytics.retainedQuestions, null);
    assert.ok(analytics.measured.includes('feedback'));
    assert.ok(!analytics.measured.includes('retainedQuestions'));
  });

  test('error states seen in context are counted', async () => {
    const { admin, app } = await setupWorkspace(harness, { org: 'Errors', publish: ['development'] });
    const sdk = await sdkFor(harness, app.publicKey);
    await sdk.ask('Why can’t I save?', { visibleErrors: [{ code: 'PROJECT_NAME_REQUIRED', message: 'Project name is required', nearNavoroId: null }] });
    const analytics = (await admin.get(`/api/admin/applications/${app.id}/analytics`)).body;
    assert.deepEqual(analytics.errorStates, [{ code: 'PROJECT_NAME_REQUIRED', count: 1 }]);
  });

  test('events referencing another tenant’s session are dropped', async () => {
    const a = await setupWorkspace(harness, { org: 'Events A', publish: ['development'] });
    const b = await setupWorkspace(harness, { org: 'Events B', publish: ['development'] });
    const sdkA = await sdkFor(harness, a.app.publicKey);
    const sdkB = await sdkFor(harness, b.app.publicKey);
    const sessionA = (await sdkA.ask('How do I create a project?')).result.sessionId;
    const response = await sendEvents(sdkB, [{ type: 'workflow_completed', sessionId: sessionA }, { type: 'step_viewed', sessionId: 'gs_made_up', stepIndex: 0 }, { type: 'launcher_opened' }]);
    assert.equal(response.body.accepted, 1, 'only the session-less event is stored');
    const count = harness.app.context.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM analytics_events WHERE session_id = ?", [sessionA]);
    assert.equal(count?.n, 0);
    assert.equal((await a.admin.get(`/api/admin/applications/${a.app.id}/analytics`)).body.sessions.completed, 0);
  });

  test('analyticsEnabled=false → events are not stored', async () => {
    const { admin, app } = await setupWorkspace(harness, { org: 'No Analytics', publish: [] });
    await setPolicy(admin, app.id, { analyticsEnabled: false });
    const sdk = await sdkFor(harness, app.publicKey);
    const init = await sdk.init(app.publicKey);
    assert.equal(init.body.config.analyticsEnabled, false);
    const sessionId = (await sdk.ask('How do I create a project?')).result.sessionId;
    const response = await sendEvents(sdk, [{ type: 'launcher_opened' }, { type: 'feedback_helpful', sessionId }]);
    assert.equal(response.body.accepted, 0);
    const stored = harness.app.context.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM analytics_events WHERE app_id = ?', [app.id]);
    assert.equal(stored?.n, 0);
    const analytics = (await admin.get(`/api/admin/applications/${app.id}/analytics`)).body;
    assert.ok(!analytics.measured.includes('feedback'));
  });

  test('invalid events are rejected', async () => {
    const { app } = await setupWorkspace(harness, { org: 'Bad Events', publish: ['development'] });
    const sdk = await sdkFor(harness, app.publicKey);
    assert.equal((await sendEvents(sdk, [{ type: 'keystroke', value: 'secret' }])).status, 400);
    assert.equal((await sendEvents(sdk, [{ type: 'launcher_opened', text: 'free text' }])).status, 400);
    assert.equal((await sendEvents(sdk, Array.from({ length: 51 }, () => ({ type: 'launcher_opened' })))).status, 400);
  });
});

describe('question retention', () => {
  test('retainQuestions=false (default) stores no question text', async () => {
    const { admin, app } = await setupWorkspace(harness, { org: 'No Retention', publish: ['development'] });
    const sdk = await sdkFor(harness, app.publicKey);
    await sdk.ask('How do I create a project?');
    await sdk.ask('my email is secret@example.com, why?');
    const rows = questionRows(app.id);
    assert.equal(rows.length, 2);
    assert.ok(rows.every((row) => row.text === null && row.expires_at === null));
    assert.equal(rows[0]?.topic, 'Create a project');
    const dump = JSON.stringify(harness.app.context.db.all('SELECT * FROM questions WHERE app_id = ?', [app.id]));
    assert.ok(!dump.includes('secret@example.com'));
    const analytics = (await admin.get(`/api/admin/applications/${app.id}/analytics`)).body;
    assert.equal(analytics.retainedQuestions, null);
  });

  test('retention only applies once published, and the sweep scrubs expired text', async () => {
    const { admin, app } = await setupWorkspace(harness, { org: 'Retention', publish: ['development'] });
    const sdk = await sdkFor(harness, app.publicKey);
    // Draft-only change does not affect live behaviour.
    await setPolicy(admin, app.id, { retainQuestions: true, retentionDays: 7 }, []);
    await sdk.ask('How do I create a project?');
    assert.equal(questionRows(app.id)[0]?.text, null);

    const versionsBefore = (await admin.get(`/api/admin/applications/${app.id}`)).body.configVersions.length;
    await admin.post(`/api/admin/applications/${app.id}/publish`, { environment: 'development' });
    assert.equal((await admin.get(`/api/admin/applications/${app.id}`)).body.configVersions.length, versionsBefore + 1);
    await sdk.ask('How do I create a project?');
    const rows = questionRows(app.id);
    assert.equal(rows[1]?.text, 'How do I create a project?');
    const expires = new Date(rows[1]?.expires_at ?? 0).getTime();
    assert.ok(Math.abs(expires - (Date.now() + 7 * 86_400_000)) < 60_000, 'expires after retentionDays');

    const analytics = (await admin.get(`/api/admin/applications/${app.id}/analytics`)).body;
    assert.deepEqual(analytics.retainedQuestions, [{ text: 'how do i create a project?', count: 1, grounded: true }]);

    const orgId = (await admin.get('/api/auth/me')).body.organization.id;
    const t = tenant(harness.app.context.db, orgId);
    assert.equal(t.activity.sweepRetention(), 0, 'nothing expired yet');
    harness.app.context.db.run('UPDATE questions SET expires_at = ? WHERE app_id = ? AND text IS NOT NULL', [new Date(Date.now() - 1000).toISOString(), app.id]);
    assert.equal(t.activity.sweepRetention(), 1);
    assert.ok(questionRows(app.id).every((row) => row.text === null));
    const scrubbed = (await admin.get(`/api/admin/applications/${app.id}/analytics`)).body;
    assert.deepEqual(scrubbed.retainedQuestions, []);
    assert.equal(scrubbed.topTopics[0].count, 2, 'topics survive the sweep');
  });

  test("the sweep is scoped to one tenant", async () => {
    const a = await setupWorkspace(harness, { org: 'Sweep A', publish: [] });
    const b = await setupWorkspace(harness, { org: 'Sweep B', publish: [] });
    await setPolicy(a.admin, a.app.id, { retainQuestions: true });
    await setPolicy(b.admin, b.app.id, { retainQuestions: true });
    await (await sdkFor(harness, a.app.publicKey)).ask('How do I create a project?');
    await (await sdkFor(harness, b.app.publicKey)).ask('How do I create a project?');
    const past = new Date(Date.now() - 1000).toISOString();
    harness.app.context.db.run('UPDATE questions SET expires_at = ? WHERE app_id IN (?, ?)', [past, a.app.id, b.app.id]);
    const orgA = (await a.admin.get('/api/auth/me')).body.organization.id;
    tenant(harness.app.context.db, orgA).activity.sweepRetention();
    assert.equal(questionRows(a.app.id)[0]?.text, null);
    assert.equal(questionRows(b.app.id)[0]?.text, 'How do I create a project?');
  });
});
