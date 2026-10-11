import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Database } from '../../server/db/database.ts';
import { Accounts } from '../../server/data/accounts.ts';
import { tenant, type Tenant } from '../../server/data/tenant.ts';
import { processSource } from '../../server/services/ingestion.ts';
import { buildSnapshot } from '../../server/services/publishing.ts';
import { generateGuidance, type GuidanceOptions } from '../../server/services/guidance.ts';
import { ProviderError, type ModelProvider, type StructuredRequest, type StructuredResponse } from '../../server/ai/provider.ts';
import { contentHash } from '../../server/knowledge/normalize.ts';
import type { ApplicationRow, ConfigSnapshot } from '../../server/data/types.ts';
import { SAMPLE_DOC } from '../helpers/harness.ts';

class FakeProvider implements ModelProvider {
  readonly name = 'fake';
  readonly model = 'fake-model';
  requests: StructuredRequest[] = [];
  readonly respond: (request: StructuredRequest) => unknown;
  constructor(respond: (request: StructuredRequest) => unknown) {
    this.respond = respond;
  }
  async generateStructured(request: StructuredRequest): Promise<StructuredResponse> {
    this.requests.push(request);
    const input = this.respond(request);
    return { input, usage: { inputTokens: 10, outputTokens: 5 }, model: this.model, latencyMs: 3 };
  }
}

let db: Database;
let t: Tenant;
let app: ApplicationRow;
let snapshot: ConfigSnapshot;
let workflowId: string;

before(async () => {
  db = new Database(':memory:');
  db.migrate();
  const { orgId } = new Accounts(db).createUserWithOrganization({ name: 'A', email: 'a@example.com', passwordHash: 'x', organizationName: 'Org' });
  t = tenant(db, orgId);
  const appId = t.apps.create({ name: 'Acme', developmentOrigins: ['http://localhost:3000'], productionOrigins: [] });
  t.apps.upsertCatalog(appId, [
    { navoroId: 'projects.new', label: 'New project', role: 'button', route: '/projects' },
    { navoroId: 'projects.save', label: 'Save project', role: 'button', route: '/projects' },
  ], 'manual');
  const sourceId = t.knowledge.create(appId, { type: 'manual', title: 'Acme Help', reference: null, content: SAMPLE_DOC, contentHash: contentHash(SAMPLE_DOC) });
  await processSource(t, sourceId, { allowPrivateUrls: false }, { refetch: false });
  const workflow = t.guidance.workflows(appId)[0];
  assert.ok(workflow);
  workflowId = workflow.id;
  t.guidance.setWorkflowStatus(workflowId, 'published');
  app = t.apps.get(appId) as ApplicationRow;
  snapshot = buildSnapshot(t, app);
});

after(() => db.close());

function ask(question: string, options: Partial<GuidanceOptions> = {}, context = {}) {
  return generateGuidance(t, app, snapshot, { question, context, requestId: 'r1', sessionId: 's1' }, { provider: null, includeDrafts: false, ...options });
}

describe('deterministic composer (demo mode)', () => {
  test('a procedural question returns the stored workflow with mapped targets', async () => {
    const phases: string[] = [];
    const { result, topic } = await ask('How do I create a project?', { onPhase: (phase) => phases.push(phase) });
    assert.equal(result.mode, 'demo');
    assert.equal(result.kind, 'workflow');
    assert.equal(result.grounded, true);
    assert.equal(result.workflow?.id, workflowId);
    assert.equal(topic, 'Create a project');
    assert.deepEqual(result.steps.map((step) => step.title), ['Open Projects', 'Click New project', 'Enter a Project name', 'Click Save project']);
    assert.deepEqual(result.steps[1]?.target?.strategies[0], { type: 'navoro_id', value: 'projects.new' });
    assert.equal(result.steps[1]?.target?.validation, 'valid');
    assert.match(result.answer, /Before you start: Admin role/);
    assert.ok(result.citations.length >= 1);
    assert.deepEqual(phases, ['retrieving', 'reasoning', 'validating']);
  });

  test('a visible error code yields troubleshooting targeted at the resolution label', async () => {
    const { result, errorCodes } = await ask('Why can’t I save?', {}, { visibleErrors: [{ code: 'PROJECT_NAME_REQUIRED', message: 'Project name is required', nearNavoroId: null }] });
    assert.equal(result.kind, 'troubleshooting');
    assert.equal(result.grounded, true);
    assert.match(result.answer, /Type a name into Project name/);
    assert.deepEqual(errorCodes, ['PROJECT_NAME_REQUIRED']);
    assert.equal(result.steps[0]?.target?.label, 'Project name');
  });

  test('an unmatched question is unresolved, ungrounded, and says so', async () => {
    const { result, topic } = await ask('What is the airspeed velocity of an unladen swallow?');
    assert.equal(result.kind, 'unresolved');
    assert.equal(result.grounded, false);
    assert.equal(result.confidence, 0);
    assert.deepEqual(result.steps, []);
    assert.match(result.answer, /couldn't find this in Acme's documentation/);
    assert.ok(result.fallback);
    assert.equal(topic, 'Unmatched questions');
  });

  test('draft workflows are excluded for end users but included for preview', async () => {
    t.guidance.setWorkflowStatus(workflowId, 'draft');
    try {
      const draftSnapshot = buildSnapshot(t, app);
      const user = await generateGuidance(t, app, draftSnapshot, { question: 'How do I create a project?', context: {}, requestId: 'r', sessionId: 's' }, { provider: null, includeDrafts: false });
      assert.notEqual(user.result.kind, 'workflow');
      const preview = await generateGuidance(t, app, draftSnapshot, { question: 'How do I create a project?', context: {}, requestId: 'r', sessionId: 's' }, { provider: null, includeDrafts: true });
      assert.equal(preview.result.kind, 'workflow');
    } finally {
      t.guidance.setWorkflowStatus(workflowId, 'published');
    }
  });
});

describe('model-backed decisions', () => {
  test('valid model output choosing a candidate workflow → llm mode with steps from the DB', async () => {
    const usage: Array<{ ok: boolean }> = [];
    const provider = new FakeProvider(() => ({
      decision: 'workflow',
      answer: 'Sure — <b>here</b> is **how**.',
      workflow_id: workflowId,
      citation_ids: [],
      confidence: 0.99,
    }));
    const { result } = await ask('How do I create a project?', { provider, onUsage: (entry) => usage.push(entry) });
    assert.equal(result.mode, 'llm');
    assert.equal(result.kind, 'workflow');
    assert.equal(result.workflow?.id, workflowId);
    assert.equal(result.answer, 'Sure — here is how.', 'markup is stripped from model text');
    assert.equal(result.steps.length, 4);
    assert.equal(result.steps[3]?.title, 'Click Save project');
    assert.ok(result.confidence <= 1, 'confidence is capped by workflow confidence');
    assert.deepEqual(usage.map((entry) => entry.ok), [true]);
    // Candidates and question are delimited and the question is JSON-escaped.
    const prompt = provider.requests[0]?.prompt ?? '';
    assert.match(prompt, /<question>"How do I create a project\?"<\/question>/);
    assert.ok(prompt.includes(workflowId));
  });

  test('unknown workflow_id falls back to the deterministic composer (demo)', async () => {
    const provider = new FakeProvider(() => ({ decision: 'workflow', answer: 'x', workflow_id: 'wf_invented', citation_ids: [], confidence: 0.9 }));
    const { result } = await ask('How do I create a project?', { provider });
    assert.equal(result.mode, 'demo');
    assert.equal(result.kind, 'workflow');
    assert.equal(result.workflow?.id, workflowId);
  });

  test('garbage model output falls back to demo', async () => {
    for (const output of [{ decision: 'execute_js', answer: 'x', citation_ids: [], confidence: 1 }, { answer: 'missing decision' }, 'not an object', { decision: 'answer', answer: 'x', citation_ids: 'nope', confidence: 2 }]) {
      const { result } = await ask('How do I create a project?', { provider: new FakeProvider(() => output) });
      assert.equal(result.mode, 'demo', JSON.stringify(output));
      assert.equal(result.grounded, true);
    }
  });

  test('a troubleshooting decision for an error outside the candidates falls back', async () => {
    const provider = new FakeProvider(() => ({ decision: 'troubleshooting', answer: 'x', error_id: 'ki_fake', citation_ids: [], confidence: 0.9 }));
    const { result } = await ask('How do I create a project?', { provider });
    assert.equal(result.mode, 'demo');
  });

  test('an answer with no valid citations is downgraded to unresolved', async () => {
    const provider = new FakeProvider(() => ({ decision: 'answer', answer: 'Made up fact.', citation_ids: ['chk_invented'], confidence: 0.9 }));
    const { result } = await ask('How do I create a project?', { provider });
    assert.equal(result.mode, 'llm');
    assert.equal(result.kind, 'unresolved');
    assert.equal(result.grounded, false);
  });

  test('a throwing provider falls back to demo and reports failed usage', async () => {
    const usage: Array<{ ok: boolean; errorCode: string | null }> = [];
    const provider: ModelProvider = {
      name: 'broken',
      model: 'broken-model',
      async generateStructured() {
        throw new ProviderError('unavailable', 'down', true);
      },
    };
    const { result } = await ask('How do I create a project?', { provider, onUsage: (entry) => usage.push(entry) });
    assert.equal(result.mode, 'demo');
    assert.equal(result.kind, 'workflow');
    assert.deepEqual(usage, [{ inputTokens: 0, outputTokens: 0, latencyMs: 0, ok: false, errorCode: 'unavailable', model: 'broken-model' }]);
  });

  test('cancellation from the provider propagates instead of falling back', async () => {
    const provider: ModelProvider = {
      name: 'c',
      model: 'c',
      async generateStructured() {
        throw new ProviderError('cancelled', 'cancelled', false);
      },
    };
    await assert.rejects(ask('How do I create a project?', { provider }), (error: unknown) => error instanceof ProviderError && error.code === 'cancelled');
  });

  test('the model is not consulted when there are no candidates', async () => {
    const provider = new FakeProvider(() => ({}));
    const { result } = await ask('zzqx vvkp', { provider });
    assert.equal(provider.requests.length, 0);
    assert.equal(result.kind, 'unresolved');
    assert.equal(result.grounded, false);
  });

  test('model unresolved decision caps confidence and is ungrounded', async () => {
    const provider = new FakeProvider(() => ({ decision: 'unresolved', answer: 'Not documented.', citation_ids: [], confidence: 0.9 }));
    const { result } = await ask('How do I create a project?', { provider });
    assert.equal(result.mode, 'llm');
    assert.equal(result.kind, 'unresolved');
    assert.equal(result.grounded, false);
    assert.ok(result.confidence <= 0.3);
    assert.ok(result.fallback);
  });
});
