import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AdminClient, startHarness } from '../helpers/harness.ts';

test('server boots and signup creates a workspace', async () => {
  const harness = await startHarness();
  try {
    const admin = await new AdminClient(harness.baseUrl).signup('smoke@example.com');
    const me = await admin.get('/api/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.role, 'owner');
  } finally {
    await harness.close();
  }
});
