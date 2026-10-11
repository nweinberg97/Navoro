import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, safeEqual, signSdkToken, verifySdkToken, type SdkTokenClaims } from '../../server/security/crypto.ts';
import { RateLimiter } from '../../server/security/rate-limit.ts';
import { isOriginAllowed, normalizeOrigin } from '../../server/security/origins.ts';
import { verifyPassword } from '../../server/security/crypto.ts';
import { FetchError, isPrivateAddress, validatePublicUrl, youtubeVideoId } from '../../server/knowledge/fetchers.ts';
import { ConfigError, loadConfig } from '../../server/config/env.ts';

const SECRET = 'a'.repeat(40);

describe('passwords', () => {
  test('hash verifies only the original password and is salted', async () => {
    const hash = await hashPassword('correct-horse-battery');
    assert.match(hash, /^scrypt\$16384\$[\w-]+\$[\w-]+$/);
    assert.equal(await verifyPassword('correct-horse-battery', hash), true);
    assert.equal(await verifyPassword('wrong-password', hash), false);
    assert.notEqual(await hashPassword('correct-horse-battery'), hash);
  });

  test('malformed stored hashes never verify', async () => {
    assert.equal(await verifyPassword('x', 'plain'), false);
    assert.equal(await verifyPassword('x', 'bcrypt$1$a$b'), false);
  });

  test('safeEqual compares length and content', () => {
    assert.equal(safeEqual('abc', 'abc'), true);
    assert.equal(safeEqual('abc', 'abd'), false);
    assert.equal(safeEqual('abc', 'abcd'), false);
  });
});

describe('SDK tokens', () => {
  const claims: SdkTokenClaims = { app: 'app_1', org: 'org_1', env: 'development', origin: 'https://a.example', exp: 2_000_000_000 };

  test('round-trips claims', () => {
    assert.deepEqual(verifySdkToken(signSdkToken(claims, SECRET), SECRET, 1_000), claims);
  });

  test('rejects tampered payloads and signatures', () => {
    const token = signSdkToken(claims, SECRET);
    const [, signature] = token.split('.');
    const forgedBody = Buffer.from(JSON.stringify({ ...claims, org: 'org_2' })).toString('base64url');
    assert.equal(verifySdkToken(`${forgedBody}.${signature}`, SECRET, 1_000), null);
    assert.equal(verifySdkToken(`${token}x`, SECRET, 1_000), null);
    assert.equal(verifySdkToken('garbage', SECRET, 1_000), null);
    assert.equal(verifySdkToken('', SECRET, 1_000), null);
  });

  test('rejects expired tokens and tokens signed with another secret', () => {
    const token = signSdkToken(claims, SECRET);
    assert.equal(verifySdkToken(token, SECRET, claims.exp + 1), null);
    assert.equal(verifySdkToken(token, 'b'.repeat(40), 1_000), null);
  });

  test('rejects well-signed tokens with invalid claim shapes', () => {
    const bad = signSdkToken({ ...claims, env: 'staging' as 'production' }, SECRET);
    assert.equal(verifySdkToken(bad, SECRET, 1_000), null);
  });
});

describe('RateLimiter', () => {
  test('allows a burst up to capacity, then refills over time', () => {
    let now = 0;
    const limiter = new RateLimiter({ capacity: 3, refillPerSecond: 1 }, () => now);
    assert.equal(limiter.take('k'), 0);
    assert.equal(limiter.take('k'), 0);
    assert.equal(limiter.take('k'), 0);
    assert.equal(limiter.take('k'), 1, 'returns seconds to wait');
    assert.equal(limiter.take('other'), 0, 'keys are independent');
    now = 1_000;
    assert.equal(limiter.take('k'), 0);
    assert.ok(limiter.take('k') > 0);
    now = 100_000;
    assert.equal(limiter.take('k', 3), 0, 'refill is capped at capacity');
    assert.ok(limiter.take('k') > 0);
  });

  test('cost larger than remaining tokens is refused', () => {
    const limiter = new RateLimiter({ capacity: 5, refillPerSecond: 0.5 }, () => 0);
    assert.equal(limiter.take('k', 5), 0);
    assert.equal(limiter.take('k', 2), 4);
  });
});

describe('origins', () => {
  test('normalizeOrigin accepts scheme://host[:port] only', () => {
    assert.equal(normalizeOrigin('https://App.Example.com'), 'https://app.example.com');
    assert.equal(normalizeOrigin('http://localhost:3000/'), 'http://localhost:3000');
    assert.equal(normalizeOrigin('https://example.com:443'), 'https://example.com');
    for (const bad of ['https://example.com/path', 'https://user:pw@example.com', 'ftp://example.com', 'https://example.com?q=1', 'https://example.com#x', 'example.com', '', '   ', 'javascript:alert(1)']) {
      assert.equal(normalizeOrigin(bad), null, bad);
    }
  });

  test('isOriginAllowed requires an exact normalized match', () => {
    const allowed = ['https://app.example.com'];
    assert.equal(isOriginAllowed('https://APP.example.com', allowed), true);
    assert.equal(isOriginAllowed('https://app.example.com.evil.com', allowed), false);
    assert.equal(isOriginAllowed('http://app.example.com', allowed), false);
    assert.equal(isOriginAllowed(undefined, allowed), false);
    assert.equal(isOriginAllowed('null', allowed), false);
  });
});

describe('URL safety', () => {
  test('isPrivateAddress covers loopback, RFC1918, link-local, CGNAT, multicast and IPv6 forms', () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '198.18.0.1', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe']) {
      assert.equal(isPrivateAddress(address), true, address);
    }
    for (const address of ['8.8.8.8', '172.32.0.1', '1.1.1.1', '2606:4700::1111', '::ffff:808:808']) {
      assert.equal(isPrivateAddress(address), false, address);
    }
  });

  test('validatePublicUrl accepts http(s) and rejects other schemes and credentials', () => {
    assert.equal(validatePublicUrl(' https://docs.example.com/a ').hostname, 'docs.example.com');
    for (const bad of ['file:///etc/passwd', 'ftp://x.com', 'https://u:p@x.com', 'not a url']) {
      assert.throws(() => validatePublicUrl(bad), FetchError, bad);
    }
  });

  test('youtubeVideoId recognizes watch, short and embed URLs only', () => {
    assert.equal(youtubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
    assert.equal(youtubeVideoId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
    assert.equal(youtubeVideoId('https://youtube.com/embed/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
    assert.equal(youtubeVideoId('https://www.youtube.com/channel/abc'), null);
    assert.equal(youtubeVideoId('https://evil.com/watch?v=dQw4w9WgXcQ'), null);
  });
});

describe('loadConfig', () => {
  const KEYS = ['NODE_ENV', 'PORT', 'NAVORO_SESSION_SECRET', 'NAVORO_ALLOW_PRIVATE_URLS', 'NAVORO_PUBLIC_ORIGIN', 'NAVORO_SECURE_COOKIES', 'NAVORO_SERVE_DEMO', 'ANTHROPIC_API_KEY'];
  const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  function setEnv(values: Record<string, string | undefined>): void {
    for (const key of KEYS) delete process.env[key];
    for (const [key, value] of Object.entries(values)) if (value !== undefined) process.env[key] = value;
  }
  afterEach(() => {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  test('development defaults: ephemeral secret, private URLs allowed, insecure cookies on http', () => {
    setEnv({ NODE_ENV: 'development' });
    const config = loadConfig();
    assert.equal(config.port, 4400);
    assert.ok(config.sessionSecret.length >= 32);
    assert.equal(config.allowPrivateUrls, true);
    assert.equal(config.secureCookies, false);
    assert.equal(config.anthropicApiKey, null);
  });

  test('production requires a session secret of at least 32 characters', () => {
    setEnv({ NODE_ENV: 'production' });
    assert.throws(() => loadConfig(), ConfigError);
    setEnv({ NODE_ENV: 'production', NAVORO_SESSION_SECRET: 'short' });
    assert.throws(() => loadConfig(), /at least 32/);
    setEnv({ NODE_ENV: 'production', NAVORO_SESSION_SECRET: SECRET, NAVORO_PUBLIC_ORIGIN: 'https://navoro.example.com' });
    const config = loadConfig();
    assert.equal(config.allowPrivateUrls, false);
    assert.equal(config.secureCookies, true);
    assert.equal(config.serveDemo, false);
  });

  test('invalid port and booleans are rejected', () => {
    setEnv({ NODE_ENV: 'development', PORT: '70000' });
    assert.throws(() => loadConfig(), /PORT must be a valid port/);
    setEnv({ NODE_ENV: 'development', PORT: 'abc' });
    assert.throws(() => loadConfig(), ConfigError);
    setEnv({ NODE_ENV: 'development', NAVORO_ALLOW_PRIVATE_URLS: 'maybe' });
    assert.throws(() => loadConfig(), /must be a boolean/);
  });

  test('NAVORO_ALLOW_PRIVATE_URLS is refused in production', () => {
    setEnv({ NODE_ENV: 'production', NAVORO_SESSION_SECRET: SECRET, NAVORO_ALLOW_PRIVATE_URLS: 'true' });
    assert.throws(() => loadConfig(), /cannot be enabled in production/);
    setEnv({ NODE_ENV: 'development' });
    assert.throws(() => loadConfig({ nodeEnv: 'production', allowPrivateUrls: true }), /cannot be enabled in production/);
  });

  test('non-http public origins are rejected', () => {
    setEnv({ NODE_ENV: 'development', NAVORO_PUBLIC_ORIGIN: 'ftp://navoro' });
    assert.throws(() => loadConfig(), /NAVORO_PUBLIC_ORIGIN/);
  });
});
