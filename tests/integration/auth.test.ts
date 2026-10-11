import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AdminClient, type Harness } from '../helpers/harness.ts';
import { RateLimiter } from '../../server/security/rate-limit.ts';
import { start } from './support.ts';

let harness: Harness;
before(async () => {
  harness = await start();
  // Keep the real login limiter so its behaviour is tested end to end.
  harness.app.context.limits.login = new RateLimiter({ capacity: 10, refillPerSecond: 10 / 300 });
});
after(() => harness.close());

describe('signup', () => {
  test('rejects short passwords and invalid emails with 400', async () => {
    const client = new AdminClient(harness.baseUrl);
    const short = await client.post('/api/auth/signup', { name: 'A', email: 'short@example.com', password: 'short', organizationName: 'O' });
    assert.equal(short.status, 400);
    assert.equal(short.body.error.code, 'invalid_request');
    assert.match(short.body.error.message, /password/);
    const email = await client.post('/api/auth/signup', { name: 'A', email: 'not-an-email', password: 'long-enough-pass', organizationName: 'O' });
    assert.equal(email.status, 400);
  });

  test('rejects unknown fields and non-JSON bodies', async () => {
    const client = new AdminClient(harness.baseUrl);
    const extra = await client.post('/api/auth/signup', { name: 'A', email: 'x@example.com', password: 'long-enough-pass', organizationName: 'O', role: 'owner' });
    assert.equal(extra.status, 400);
    const raw = await fetch(`${harness.baseUrl}/api/auth/signup`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'hi' });
    assert.equal(raw.status, 415);
  });

  test('rejects duplicate emails (case-insensitive) with 400', async () => {
    await new AdminClient(harness.baseUrl).signup('dupe@example.com');
    const again = await new AdminClient(harness.baseUrl).post('/api/auth/signup', { name: 'B', email: 'DUPE@example.com', password: 'another-long-pass', organizationName: 'Other' });
    assert.equal(again.status, 400);
    assert.match(again.body.error.message, /already exists/);
  });

  test('sets an HttpOnly, SameSite=Lax session cookie and never returns secrets', async () => {
    const response = await new AdminClient(harness.baseUrl).post('/api/auth/signup', { name: 'C', email: 'cookie@example.com', password: 'correct-horse-battery', organizationName: 'Cookie Co' });
    assert.equal(response.status, 201);
    const cookie = response.headers.get('set-cookie') ?? '';
    assert.match(cookie, /^navoro_session=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Path=\//);
    assert.doesNotMatch(cookie, /Secure/, 'http test origin does not set Secure');
    assert.equal(response.body.role, 'owner');
    assert.equal(typeof response.body.csrfToken, 'string');
    assert.ok(!JSON.stringify(response.body).includes('scrypt'));
  });
});

describe('login, me and logout', () => {
  const email = 'login@example.com';
  const password = 'correct-horse-battery';
  before(async () => {
    await new AdminClient(harness.baseUrl).signup(email, 'Login Org', password);
  });

  test('wrong password → 401 with a generic message; unknown email → same 401', async () => {
    const client = new AdminClient(harness.baseUrl);
    const wrong = await client.post('/api/auth/login', { email, password: 'wrong-password' });
    assert.equal(wrong.status, 401);
    const unknown = await client.post('/api/auth/login', { email: 'nobody@example.com', password: 'wrong-password' });
    assert.equal(unknown.status, 401);
    assert.equal(wrong.body.error.message, unknown.body.error.message);
  });

  test('login → me → logout invalidates the session server-side', async () => {
    const client = new AdminClient(harness.baseUrl);
    assert.equal((await client.get('/api/auth/me')).status, 401);
    const login = await client.post('/api/auth/login', { email: email.toUpperCase(), password });
    assert.equal(login.status, 200);
    const me = await client.get('/api/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.user.email, email);
    assert.equal(me.body.organization.name, 'Login Org');
    const cookie = client.cookie;
    const logout = await client.post('/api/auth/logout', {});
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get('set-cookie') ?? '', /Max-Age=0/);
    const replay = await fetch(`${harness.baseUrl}/api/auth/me`, { headers: { cookie } });
    assert.equal(replay.status, 401, 'old cookie no longer works');
  });

  test('rate limits repeated login attempts for an account with 429', async () => {
    const client = new AdminClient(harness.baseUrl);
    const target = 'ratelimit@example.com';
    const statuses: number[] = [];
    for (let i = 0; i < 12; i += 1) statuses.push((await client.post('/api/auth/login', { email: target, password: 'wrong-password' })).status);
    assert.deepEqual(statuses.slice(0, 10), Array(10).fill(401));
    assert.deepEqual(statuses.slice(10), [429, 429]);
    // Another account from the same IP is not locked out by this one.
    assert.equal((await client.post('/api/auth/login', { email, password })).status, 200);
  });
});

describe('CSRF protection', () => {
  let client: AdminClient;
  before(async () => {
    client = await new AdminClient(harness.baseUrl).signup('csrf@example.com', 'Csrf Org');
  });

  test('mutation without the CSRF header → 403 csrf_failed', async () => {
    const response = await client.request('POST', '/api/admin/applications', { name: 'X', developmentOrigins: [], productionOrigins: [] }, { 'x-navoro-csrf': '' });
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, 'csrf_failed');
  });

  test('mutation with a wrong CSRF token → 403', async () => {
    const response = await client.request('POST', '/api/admin/applications', { name: 'X', developmentOrigins: [], productionOrigins: [] }, { 'x-navoro-csrf': 'forged-token-value-xxxxxxxxxxxxx' });
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, 'csrf_failed');
  });

  test('mutation with a foreign Origin → 403 even with a valid token', async () => {
    const response = await client.request('POST', '/api/admin/applications', { name: 'X', developmentOrigins: [], productionOrigins: [] }, { 'x-navoro-csrf': client.csrf, origin: 'https://evil.example' });
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, 'origin_rejected');
  });

  test('same-origin mutation with the token succeeds; GETs need no token', async () => {
    const created = await client.request('POST', '/api/admin/applications', { name: 'Ok', developmentOrigins: [], productionOrigins: [] }, { origin: harness.baseUrl });
    assert.equal(created.status, 201);
    const list = await fetch(`${harness.baseUrl}/api/admin/applications`, { headers: { cookie: client.cookie } });
    assert.equal(list.status, 200);
  });

  test('CSRF token is per session', async () => {
    const other = await new AdminClient(harness.baseUrl).signup('csrf2@example.com', 'Other');
    const response = await client.request('PATCH', '/api/admin/settings', { name: 'Hijack' }, { 'x-navoro-csrf': other.csrf });
    assert.equal(response.status, 403);
  });
});

describe('signup rate limiting', () => {
  test('too many sign-ups from one network → 429', async () => {
    harness.app.context.limits.signup = new RateLimiter({ capacity: 5, refillPerSecond: 5 / 3600 });
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const response = await new AdminClient(harness.baseUrl).post('/api/auth/signup', { name: 'R', email: `burst-${i}@example.com`, password: 'correct-horse-battery', organizationName: 'Burst' });
      statuses.push(response.status);
    }
    assert.deepEqual(statuses, [201, 201, 201, 201, 201, 429]);
  });
});

describe('admin API requires a session', () => {
  test('unauthenticated requests → 401', async () => {
    for (const path of ['/api/admin/applications', '/api/admin/overview', '/api/admin/settings', '/api/admin/jobs']) {
      assert.equal((await fetch(`${harness.baseUrl}${path}`)).status, 401, path);
    }
  });

  test('unknown API endpoint → 404, wrong method → 405', async () => {
    assert.equal((await fetch(`${harness.baseUrl}/api/nope`)).status, 404);
    assert.equal((await fetch(`${harness.baseUrl}/api/auth/me`, { method: 'DELETE' })).status, 405);
  });
});
