import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_DOC, waitFor, type Harness } from '../helpers/harness.ts';
import { addSource, createApp, newAdmin, setupWorkspace, start, startDocServer, waitForJob, type DocServer } from './support.ts';

let harness: Harness;
let docs: DocServer;

before(async () => {
  harness = await start();
  docs = await startDocServer();
});
after(async () => {
  await docs.close();
  await harness.close();
});

async function refresh(admin: Awaited<ReturnType<typeof setupWorkspace>>['admin'], appId: string) {
  const started = await admin.post(`/api/admin/applications/${appId}/refresh`, {});
  assert.equal(started.status, 202, JSON.stringify(started.body));
  return waitForJob(admin, started.body.id);
}

describe('Refresh Learning', () => {
  test('completes with every step done and a report', async () => {
    const { admin, app } = await setupWorkspace(harness, { org: 'Refresh Basic' });
    const job = await refresh(admin, app.id);
    assert.equal(job.status, 'succeeded');
    assert.equal(job.type, 'refresh');
    assert.deepEqual(job.steps.map((step: { key: string }) => step.key), ['identify', 'detect', 'reprocess', 'rebuild', 'revalidate', 'review', 'publish']);
    assert.ok(job.steps.every((step: { status: string }) => step.status === 'done'));
    assert.equal(job.report.sourcesConsidered, 1);
    assert.equal(job.report.sourcesChanged, 0);
    assert.equal(job.report.sourcesUnchanged, 1);
    assert.equal(job.report.mappingsBroken.length, 0);
    assert.equal(job.report.mappingsValid, 4, 'all four SAMPLE_DOC labels resolve against the approved catalog');
    assert.equal(job.report.published, null);
    assert.match(job.report.publishNote, /Manual approval is on/);
    const audit = (await admin.get('/api/admin/audit')).body.events.map((event: { action: string }) => event.action);
    assert.ok(audit.includes('refresh.started') && audit.includes('refresh.completed'));
  });

  test('changed source content → sourcesChanged=1 and the published workflow goes to needs_review', async () => {
    const { admin, app, source, workflowId } = await setupWorkspace(harness, { org: 'Refresh Changed' });
    // Change the stored content directly (as a re-fetch would) without enqueuing an ingest job.
    const changed = SAMPLE_DOC.replace('Click **New project**.', 'Click **New project** in the top right.');
    harness.app.context.db.run('UPDATE knowledge_sources SET content = ?, content_hash = ? WHERE id = ?', [changed, 'changed-hash', source.id]);
    const job = await refresh(admin, app.id);
    assert.equal(job.status, 'succeeded');
    assert.equal(job.report.sourcesChanged, 1);
    assert.equal(job.report.sourcesUnchanged, 0);
    assert.deepEqual(job.report.workflowsNeedingReview, ['Create a project']);
    assert.deepEqual(job.report.workflowsUpdated, []);
    const workflow = (await admin.get(`/api/admin/workflows/${workflowId}`)).body;
    assert.equal(workflow.status, 'needs_review');
    assert.equal(workflow.steps[1].instruction, 'Click New project in the top right.');
  });

  test('changed content for a draft workflow is reported as updated (stays draft)', async () => {
    const { admin, app, source, workflowId } = await setupWorkspace(harness, { org: 'Refresh Draft', publishWorkflow: false, publish: [] });
    harness.app.context.db.run('UPDATE knowledge_sources SET content = ?, content_hash = ? WHERE id = ?', [SAMPLE_DOC.replace('Admin role', 'Owner role'), 'changed-hash', source.id]);
    const job = await refresh(admin, app.id);
    assert.deepEqual(job.report.workflowsUpdated, ['Create a project']);
    assert.deepEqual(job.report.workflowsNeedingReview, []);
    assert.equal((await admin.get(`/api/admin/workflows/${workflowId}`)).body.status, 'draft');
  });

  test('unapproving an element breaks its mapping, reports it, and flags the published workflow', async () => {
    const { admin, app, workflowId } = await setupWorkspace(harness, { org: 'Refresh Broken' });
    const catalog = (await admin.get(`/api/admin/applications/${app.id}/catalog`)).body.elements;
    const save = catalog.find((element: { navoroId: string }) => element.navoroId === 'projects.save');
    assert.equal((await admin.patch(`/api/admin/applications/${app.id}/catalog/${save.id}`, { approved: false })).status, 200);
    const job = await refresh(admin, app.id);
    assert.equal(job.status, 'succeeded');
    assert.deepEqual(job.report.mappingsBroken.map((mapping: { key: string }) => mapping.key), ['save-project']);
    assert.deepEqual(job.report.workflowsNeedingReview, ['Create a project']);
    assert.equal((await admin.get(`/api/admin/workflows/${workflowId}`)).body.status, 'needs_review');
    const mapping = (await admin.get(`/api/admin/applications/${app.id}/mappings`)).body.mappings.find((m: { key: string }) => m.key === 'save-project');
    assert.equal(mapping.validation, 'broken');
    // The live guidance never points at the revoked control.
    const preview = await admin.post(`/api/admin/applications/${app.id}/preview`, { question: 'How do I create a project?' });
    const step = preview.body.result.steps[3];
    assert.equal(step.target, null);
    assert.match(step.targetNote, /awaiting review/);
  });

  test('an admin mapping to a navoro id that disappears becomes broken', async () => {
    const { admin, app } = await setupWorkspace(harness, { org: 'Refresh Admin Map' });
    const put = await admin.put(`/api/admin/applications/${app.id}/mappings/new-project`, { label: 'New project', navoroId: 'projects.create-v2' });
    assert.equal(put.status, 200);
    assert.equal(put.body.validation, 'broken', 'immediately validated against the catalog');
    assert.equal(put.body.provenance, 'admin');
    const job = await refresh(admin, app.id);
    assert.ok(job.report.mappingsBroken.some((mapping: { key: string }) => mapping.key === 'new-project'));
    // Importing the new id fixes it on the next refresh, and the admin strategies are kept.
    await admin.post(`/api/admin/applications/${app.id}/catalog`, { elements: [{ navoroId: 'projects.create-v2', label: 'New project', role: 'button' }] });
    const second = await refresh(admin, app.id);
    assert.ok(!second.report.mappingsBroken.some((mapping: { key: string }) => mapping.key === 'new-project'));
    const mapping = (await admin.get(`/api/admin/applications/${app.id}/mappings`)).body.mappings.find((m: { key: string }) => m.key === 'new-project');
    assert.equal(mapping.validation, 'valid');
    assert.deepEqual(mapping.strategies[0], { type: 'navoro_id', value: 'projects.create-v2' });
  });

  test('a second refresh while one is active → 409', async () => {
    const admin = await newAdmin(harness, 'Refresh Conflict');
    const app = await createApp(admin);
    // Hold the worker busy on a slow URL fetch so the refresh stays queued/running.
    docs.routes.set('/slow-conflict', { type: 'text/markdown', body: SAMPLE_DOC, delayMs: 400 });
    const sourceRes = await admin.post(`/api/admin/applications/${app.id}/sources`, { type: 'url', reference: `${docs.url}/slow-conflict` });
    assert.equal(sourceRes.status, 201);
    const first = await admin.post(`/api/admin/applications/${app.id}/refresh`, {});
    assert.equal(first.status, 202);
    const second = await admin.post(`/api/admin/applications/${app.id}/refresh`, {});
    assert.equal(second.status, 409);
    assert.equal(second.body.error.code, 'conflict');
    await harness.app.context.runner.drain();
    assert.equal((await waitForJob(admin, first.body.id)).status, 'succeeded');
    assert.equal((await admin.post(`/api/admin/applications/${app.id}/refresh`, {})).status, 202, 'allowed again once finished');
    await harness.app.context.runner.drain();
  });

  test('cancelling during the detect step ends the job as cancelled', async () => {
    const admin = await newAdmin(harness, 'Refresh Cancel');
    const app = await createApp(admin);
    docs.routes.set('/cancel-doc', { type: 'text/markdown', body: SAMPLE_DOC });
    const source = await addSource(harness, admin, app.id, { type: 'url', reference: `${docs.url}/cancel-doc` });
    assert.equal(source.status, 'ready');
    docs.routes.set('/cancel-doc', { type: 'text/markdown', body: SAMPLE_DOC, delayMs: 600 });
    const started = await admin.post(`/api/admin/applications/${app.id}/refresh`, {});
    assert.equal(started.status, 202);
    await waitFor(async () => {
      const job = (await admin.get(`/api/admin/jobs/${started.body.id}`)).body;
      return job.steps.find((step: { key: string }) => step.key === 'detect')?.status === 'running';
    });
    const cancel = await admin.post(`/api/admin/jobs/${started.body.id}/cancel`, {});
    assert.equal(cancel.status, 200);
    assert.equal(cancel.body.status, 'cancelling');
    const job = await waitForJob(admin, started.body.id);
    assert.equal(job.status, 'cancelled');
    const byKey = Object.fromEntries(job.steps.map((step: { key: string; status: string }) => [step.key, step.status]));
    // Cancellation is honoured at the next boundary: the in-flight fetch completes, nothing after it runs.
    assert.equal(byKey.identify, 'done');
    assert.equal(byKey.detect, 'done');
    for (const key of ['reprocess', 'rebuild', 'revalidate', 'review', 'publish']) assert.equal(byKey[key], 'skipped', key);
    assert.equal(job.report.published, null);
    assert.equal((await admin.get(`/api/admin/sources/${source.id}`)).body.status, 'ready', 'source state untouched');
  });

  test('cancelling a queued refresh cancels immediately', async () => {
    const admin = await newAdmin(harness, 'Refresh Queue Cancel');
    const app = await createApp(admin);
    // Occupy the single worker with a slow ingest so the refresh stays queued.
    docs.routes.set('/slow-queue', { type: 'text/markdown', body: SAMPLE_DOC, delayMs: 400 });
    await admin.post(`/api/admin/applications/${app.id}/sources`, { type: 'url', reference: `${docs.url}/slow-queue` });
    await waitFor(async () => docs.requests.includes('/slow-queue'));
    const started = await admin.post(`/api/admin/applications/${app.id}/refresh`, {});
    assert.equal(started.body.status, 'queued');
    const cancel = await admin.post(`/api/admin/jobs/${started.body.id}/cancel`, {});
    assert.equal(cancel.body.status, 'cancelled');
    assert.ok(cancel.body.finishedAt);
    await harness.app.context.runner.drain();
    const job = (await admin.get(`/api/admin/jobs/${started.body.id}`)).body;
    assert.equal(job.status, 'cancelled');
    assert.equal(job.startedAt, null, 'never ran');
  });

  test('auto approval publishes a new development version; manual does not', async () => {
    const { admin, app } = await setupWorkspace(harness, { org: 'Refresh Auto', publishWorkflow: false, publish: [] });
    const manual = await refresh(admin, app.id);
    assert.equal(manual.report.published, null);
    assert.equal((await admin.get(`/api/admin/applications/${app.id}`)).body.configVersions.length, 0);

    assert.equal((await admin.patch('/api/admin/settings', { approvalPolicy: 'auto' })).status, 200);
    const auto = await refresh(admin, app.id);
    assert.deepEqual(auto.report.published, { version: 1, environment: 'development' });
    assert.match(auto.report.publishNote, /1 workflow\(s\) passed validation/);
    const detail = (await admin.get(`/api/admin/applications/${app.id}`)).body;
    assert.equal(detail.configVersions.length, 1);
    assert.equal(detail.configVersions[0].environment, 'development');
    assert.equal(detail.configVersions[0].summary.publishedWorkflows, 1);
    const envs = Object.fromEntries(detail.environments.map((env: { name: string; activeConfigVersion: number | null }) => [env.name, env.activeConfigVersion]));
    assert.deepEqual(envs, { development: 1, production: null });
    const workflows = (await admin.get(`/api/admin/applications/${app.id}/workflows`)).body.workflows;
    assert.equal(workflows[0].status, 'published');
  });

  test('a URL source whose fetch now fails keeps old content as needs_attention', async () => {
    const admin = await newAdmin(harness, 'Refresh Failing');
    const app = await createApp(admin);
    docs.routes.set('/flaky', { type: 'text/markdown', body: SAMPLE_DOC });
    const source = await addSource(harness, admin, app.id, { type: 'url', reference: `${docs.url}/flaky` });
    assert.equal(source.status, 'ready');
    docs.routes.delete('/flaky');
    const job = await refresh(admin, app.id);
    assert.equal(job.status, 'succeeded');
    assert.equal(job.report.sourcesFailed.length, 1);
    assert.match(job.report.sourcesFailed[0].error, /404/);
    const after = (await admin.get(`/api/admin/sources/${source.id}`)).body;
    assert.equal(after.status, 'needs_attention');
    assert.match(after.error, /Previously imported content is still in use/);
    assert.ok(after.stats.workflows >= 1);
  });
});
