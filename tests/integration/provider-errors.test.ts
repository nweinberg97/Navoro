import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { type Harness } from '../helpers/harness.ts';
import { ProviderError, type ModelProvider, type StructuredRequest } from '../../server/ai/provider.ts';
import { sdkFor, setupWorkspace, start } from './support.ts';

class UnavailableProvider implements ModelProvider {
  readonly name = 'fake-anthropic';
  readonly model = 'fake-model';
  calls = 0;
  async generateStructured(_request: StructuredRequest): Promise<never> {
    this.calls += 1;
    throw new ProviderError('unavailable', 'The model provider returned HTTP 503.', true, 503);
  }
}

let harness: Harness;
const provider = new UnavailableProvider();

before(async () => {
  harness = await start({ provider });
});
after(() => harness.close());

describe('provider failures end to end', () => {
  test('health and provider status report llm mode', async () => {
    const health = await (await fetch(`${harness.baseUrl}/api/health`)).json();
    assert.deepEqual(health, { ok: true, mode: 'llm' });
  });

  test('SDK guidance falls back to a grounded demo answer and records ok=0 usage', async () => {
    const { admin, app, workflowId } = await setupWorkspace(harness, { org: 'Provider Down', publish: ['development'] });
    const status = (await admin.get('/api/admin/provider')).body;
    assert.equal(status.mode, 'llm');
    assert.equal(status.provider, 'fake-anthropic');

    const sdk = await sdkFor(harness, app.publicKey);
    const { status: httpStatus, events, result } = await sdk.ask('How do I create a project?');
    assert.equal(httpStatus, 200);
    assert.ok(!events.some((event) => event.type === 'error'), 'the user sees an answer, not an error');
    assert.equal(result.mode, 'demo', 'honestly labelled as not model-generated');
    assert.equal(result.kind, 'workflow');
    assert.equal(result.grounded, true);
    assert.equal(result.workflow.id, workflowId);
    assert.equal(result.steps.length, 4);
    assert.ok(provider.calls >= 1);

    const usage = harness.app.context.db.all<{ ok: number; error_code: string; purpose: string; provider: string; model: string }>(
      'SELECT ok, error_code, purpose, provider, model FROM ai_usage WHERE app_id = ?',
      [app.id],
    ).map((row) => ({ ...row }));
    assert.deepEqual(usage, [{ ok: 0, error_code: 'unavailable', purpose: 'guidance', provider: 'fake-anthropic', model: 'fake-model' }]);
    const session = harness.app.context.db.get<{ mode: string }>('SELECT mode FROM guidance_sessions WHERE id = ?', [result.sessionId]);
    assert.equal(session?.mode, 'demo');
  });

  test('admin preview also falls back and records preview usage', async () => {
    const { admin, app } = await setupWorkspace(harness, { org: 'Preview Down', publish: [] });
    const preview = await admin.post(`/api/admin/applications/${app.id}/preview`, { question: 'How do I create a project?' });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.result.mode, 'demo');
    const usage = harness.app.context.db.all<{ ok: number; purpose: string }>('SELECT ok, purpose FROM ai_usage WHERE app_id = ?', [app.id]).map((row) => ({ ...row }));
    assert.deepEqual(usage, [{ ok: 0, purpose: 'preview' }]);
  });

  test('provider errors never leak to the SDK response', async () => {
    const { app } = await setupWorkspace(harness, { org: 'No Leak', publish: ['development'] });
    const sdk = await sdkFor(harness, app.publicKey);
    const { events } = await sdk.ask('How do I create a project?');
    const text = JSON.stringify(events);
    assert.ok(!text.includes('HTTP 503'));
    assert.ok(!text.includes('fake-anthropic'));
  });
});
