import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AdminClient, SAMPLE_DOC, type Harness } from '../helpers/harness.ts';
import { addSource, createApp, newAdmin, start, startDocServer, waitForSource, type DocServer } from './support.ts';

let harness: Harness;
let admin: AdminClient;
let appId: string;
let docs: DocServer;

before(async () => {
  harness = await start();
  admin = await newAdmin(harness, 'Knowledge Org');
  appId = (await createApp(admin)).id;
  docs = await startDocServer();
});
after(async () => {
  await docs.close();
  await harness.close();
});

const sourcesPath = () => `/api/admin/applications/${appId}/sources`;

describe('text-based sources', () => {
  test('test config allows private URLs (needed for the local doc server)', () => {
    assert.equal(harness.config.allowPrivateUrls, true);
    assert.equal(harness.config.nodeEnv, 'test');
  });

  test('manual source reaches ready with workflows, items and chunks', async () => {
    const source = await addSource(harness, admin, appId, { type: 'manual', title: 'Manual', content: SAMPLE_DOC });
    assert.equal(source.status, 'ready');
    assert.equal(source.error, null);
    assert.deepEqual(source.stats, { chunks: 4, knowledgeItems: 3, workflows: 1 });
    assert.equal(source.metadata.extractor, 'structured-markdown/v1');
    const workflows = (await admin.get(`/api/admin/applications/${appId}/workflows`)).body.workflows;
    assert.equal(workflows[0].title, 'Create a project');
    assert.equal(workflows[0].status, 'draft', 'extracted workflows start as drafts');
    const items = (await admin.get(`/api/admin/applications/${appId}/knowledge`)).body.items;
    assert.deepEqual(items.map((item: { kind: string }) => item.kind).sort(), ['feature', 'known_error', 'ui_concept']);
  });

  test('text source with no headings is searchable but needs attention', async () => {
    const source = await addSource(harness, admin, appId, { type: 'text', content: 'Plain prose about the product. It explains concepts without any structure at all.' });
    assert.equal(source.status, 'needs_attention');
    assert.match(source.error, /no workflows, errors or terms were recognized/);
    assert.equal(source.stats.chunks, 1);
    assert.equal(source.title, 'Plain prose about the product. It explains concepts without any structure at all.');
  });

  test('file source (.md) reaches ready and keeps the file name as reference', async () => {
    const source = await addSource(harness, admin, appId, { type: 'file', reference: 'guide.md', content: SAMPLE_DOC.replace('# Acme Help', '# Guide') });
    assert.equal(source.status, 'ready');
    assert.equal(source.reference, 'guide.md');
    assert.equal(source.title, 'Guide');
  });

  test('file with a wrong extension → 400', async () => {
    const response = await admin.post(sourcesPath(), { type: 'file', reference: 'guide.pdf', content: SAMPLE_DOC });
    assert.equal(response.status, 400);
    assert.match(response.body.error.message, /Markdown/);
  });

  test('empty or too-short content → 400', async () => {
    for (const content of ['', '   ', 'tiny']) {
      const response = await admin.post(sourcesPath(), { type: 'manual', content });
      assert.equal(response.status, 400, JSON.stringify(content));
    }
    assert.equal((await admin.post(sourcesPath(), { type: 'manual' })).status, 400);
    assert.equal((await admin.post(sourcesPath(), { type: 'pdf', content: SAMPLE_DOC })).status, 400);
  });

  test('sample docs endpoint imports the Lumen help center', async () => {
    const response = await admin.post(`/api/admin/applications/${appId}/sources/sample`, {});
    assert.equal(response.status, 201);
    await harness.app.context.runner.drain();
    const source = await waitForSource(admin, response.body.id);
    assert.equal(source.status, 'ready');
    assert.equal(source.stats.workflows, 4);
  });
});

describe('URL and YouTube sources', () => {
  test('URL source served by a local server reaches ready with fetched content and title', async () => {
    docs.routes.set('/docs', {
      body: `<html><head><title>Acme Docs</title><script>steal()</script></head><body><nav>Home | Pricing</nav><main>
        <h2>How to archive a project</h2><ol><li>Open <b>Projects</b>.</li><li>Click <b>Archive project</b>.</li></ol></main></body></html>`,
    });
    const source = await addSource(harness, admin, appId, { type: 'url', reference: `${docs.url}/docs` });
    assert.equal(source.status, 'ready', source.error);
    assert.equal(source.title, 'Acme Docs');
    assert.doesNotMatch(source.content, /steal|Pricing/);
    assert.match(source.content, /## How to archive a project/);
    assert.match(source.metadata.contentType, /text\/html/);
    assert.equal(source.metadata.finalUrl, `${docs.url}/docs`);
    assert.equal(source.stats.workflows, 1);
  });

  test('URL returning 404 → failed with a clear error', async () => {
    const source = await addSource(harness, admin, appId, { type: 'url', reference: `${docs.url}/missing` });
    assert.equal(source.status, 'failed');
    assert.equal(source.error, 'The page was not found (HTTP 404).');
    const jobs = (await admin.get(`/api/admin/jobs?applicationId=${appId}`)).body.jobs;
    const job = jobs.find((entry: { status: string }) => entry.status === 'failed');
    assert.ok(job, 'the ingest job is marked failed');
    assert.equal(job.steps[0].status, 'failed');
  });

  test('a non-text content type → failed with an explanation', async () => {
    docs.routes.set('/file.pdf', { type: 'application/pdf', body: '%PDF-1.4 binary-ish' });
    const source = await addSource(harness, admin, appId, { type: 'url', reference: `${docs.url}/file.pdf` });
    assert.equal(source.status, 'failed');
    assert.match(source.error, /Unsupported content type "application\/pdf"/);
  });

  test('a page with no readable text → failed', async () => {
    docs.routes.set('/empty', { body: '<html><body><script>x()</script></body></html>' });
    const source = await addSource(harness, admin, appId, { type: 'url', reference: `${docs.url}/empty` });
    assert.equal(source.status, 'failed');
    assert.match(source.error, /no readable text/);
  });

  test('invalid URLs are rejected up front', async () => {
    for (const reference of ['ftp://example.com/x', 'not a url', 'https://user:pw@example.com/']) {
      assert.equal((await admin.post(sourcesPath(), { type: 'url', reference })).status, 400, reference);
    }
    const youtubeAsUrl = await admin.post(sourcesPath(), { type: 'url', reference: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
    assert.equal(youtubeAsUrl.status, 400);
  });

  test('YouTube URL that is not a video → 400', async () => {
    for (const reference of ['https://www.youtube.com/channel/UC123', 'https://example.com/watch?v=dQw4w9WgXcQ']) {
      const response = await admin.post(sourcesPath(), { type: 'youtube', reference });
      assert.equal(response.status, 400, reference);
      assert.match(response.body.error.message, /YouTube video URL/);
    }
  });

  test('remote sources cannot be edited directly', async () => {
    docs.routes.set('/edit', { type: 'text/markdown', body: SAMPLE_DOC });
    const source = await addSource(harness, admin, appId, { type: 'url', reference: `${docs.url}/edit` });
    const response = await admin.patch(`/api/admin/sources/${source.id}`, { content: 'new content that is long enough' });
    assert.equal(response.status, 400);
  });
});

describe('private network protection in production-like config', () => {
  test('with allowPrivateUrls=false a loopback URL fails without being fetched', async () => {
    const strict = await start({ config: { allowPrivateUrls: false } });
    try {
      const strictAdmin = await newAdmin(strict, 'Strict');
      const strictApp = await createApp(strictAdmin);
      docs.routes.set('/secret', { body: 'internal secret '.repeat(10) });
      for (const reference of [`${docs.url}/secret`, docs.url.replace('127.0.0.1', 'localhost') + '/secret']) {
        const source = await addSource(strict, strictAdmin, strictApp.id, { type: 'url', reference });
        assert.equal(source.status, 'failed', reference);
        assert.match(source.error, /private network/);
        assert.equal(source.content, '');
      }
      assert.ok(!docs.requests.includes('/secret'), 'the private server was never contacted');
    } finally {
      await strict.close();
    }
  });
});

describe('editing and deleting', () => {
  test('editing content re-queues and re-processes the source', async () => {
    const source = await addSource(harness, admin, appId, { type: 'manual', title: 'Editable', content: SAMPLE_DOC.replace(/project/g, 'board').replace(/Project/g, 'Board').replace('PROJECT_NAME_REQUIRED', 'BOARD_NAME_REQUIRED') });
    assert.equal(source.status, 'ready');
    const before = source.processedAt;
    const edited = await admin.patch(`/api/admin/sources/${source.id}`, { content: `${source.content}\n\n## How to delete a board\n\n1. Open **Boards**.\n2. Click **Delete board**.` });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.status, 'pending');
    await harness.app.context.runner.drain();
    const after = await waitForSource(admin, source.id);
    assert.equal(after.status, 'ready');
    assert.notEqual(after.processedAt, before);
    assert.equal(after.stats.workflows, 2);
    const titles = (await admin.get(`/api/admin/applications/${appId}/workflows`)).body.workflows.map((w: { title: string }) => w.title);
    assert.ok(titles.includes('Delete a board'));
  });

  test('deleting a source archives its workflows and removes it', async () => {
    const source = await addSource(harness, admin, appId, { type: 'manual', title: 'Doomed', content: '# Doomed\n\n## How to export data\n\n1. Open **Exports**.\n2. Click **Export now**.' });
    const workflow = (await admin.get(`/api/admin/applications/${appId}/workflows`)).body.workflows.find((w: { sourceId: string }) => w.sourceId === source.id);
    assert.ok(workflow);
    const removed = await admin.delete(`/api/admin/sources/${source.id}`);
    assert.equal(removed.status, 200);
    assert.equal((await admin.get(`/api/admin/sources/${source.id}`)).status, 404);
    const archived = (await admin.get(`/api/admin/workflows/${workflow.id}`)).body;
    assert.equal(archived.status, 'archived');
    const preview = await admin.post(`/api/admin/applications/${appId}/preview`, { question: 'How do I export data?' });
    assert.notEqual(preview.body.result.workflow?.id, workflow.id, 'archived workflows are not used, even in preview');
  });

  test('unknown source → 404', async () => {
    assert.equal((await admin.get('/api/admin/sources/src_nope')).status, 404);
    assert.equal((await admin.delete('/api/admin/sources/src_nope')).status, 404);
  });
});
