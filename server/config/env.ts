/**
 * Environment configuration, validated once at startup. Secrets are read here
 * and never logged; `describeConfig()` returns a redacted view for logs.
 */
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export interface AppConfig {
  nodeEnv: 'development' | 'production' | 'test';
  port: number;
  host: string;
  /** Public origin of the Navoro API/dashboard, used in install snippets. */
  publicOrigin: string;
  demoPort: number;
  /** Serve the Lumen demo app alongside the API (local evaluation). */
  serveDemo: boolean;
  databasePath: string;
  /** HMAC secret for SDK session tokens. Must be stable across restarts in production. */
  sessionSecret: string;
  anthropicApiKey: string | null;
  anthropicModel: string;
  anthropicBaseUrl: string;
  /** Allow URL ingestion from private/loopback hosts (development only, for the demo docs URL). */
  allowPrivateUrls: boolean;
  secureCookies: boolean;
}

class ConfigError extends Error {}

function readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0 || value > 65535) {
    throw new ConfigError(`${name} must be a valid port number, got "${raw}"`);
  }
  return value;
}

function readBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw.toLowerCase())) return true;
  if (['0', 'false', 'no', 'off'].includes(raw.toLowerCase())) return false;
  throw new ConfigError(`${name} must be a boolean (true/false), got "${raw}"`);
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const nodeEnvRaw = process.env.NODE_ENV ?? 'development';
  const nodeEnv = (['development', 'production', 'test'].includes(nodeEnvRaw) ? nodeEnvRaw : 'development') as AppConfig['nodeEnv'];
  const port = readInt('PORT', 4400);
  const host = process.env.HOST || '127.0.0.1';
  const publicOrigin = (process.env.NAVORO_PUBLIC_ORIGIN || `http://localhost:${port}`).replace(/\/$/, '');
  try {
    const parsed = new URL(publicOrigin);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('bad protocol');
  } catch {
    throw new ConfigError(`NAVORO_PUBLIC_ORIGIN must be an http(s) origin, got "${publicOrigin}"`);
  }

  let sessionSecret = process.env.NAVORO_SESSION_SECRET ?? '';
  if (!sessionSecret) {
    if (nodeEnv === 'production') {
      throw new ConfigError('NAVORO_SESSION_SECRET is required in production (at least 32 random characters).');
    }
    // Development/test: ephemeral secret. SDK tokens simply re-issue after a restart.
    sessionSecret = randomBytes(32).toString('hex');
  } else if (sessionSecret.length < 32) {
    throw new ConfigError('NAVORO_SESSION_SECRET must be at least 32 characters.');
  }

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim() || null;

  const config: AppConfig = {
    nodeEnv,
    port,
    host,
    publicOrigin,
    demoPort: readInt('NAVORO_DEMO_PORT', 4500),
    serveDemo: readBool('NAVORO_SERVE_DEMO', nodeEnv !== 'production'),
    databasePath: process.env.NAVORO_DATABASE_PATH || path.join(ROOT_DIR, '.data', 'navoro.db'),
    sessionSecret,
    anthropicApiKey: apiKey,
    anthropicModel: process.env.NAVORO_ANTHROPIC_MODEL || 'claude-sonnet-5-5',
    anthropicBaseUrl: (process.env.ANTHROPIC_API_URL || 'https://api.anthropic.com').replace(/\/$/, ''),
    allowPrivateUrls: readBool('NAVORO_ALLOW_PRIVATE_URLS', nodeEnv !== 'production'),
    secureCookies: readBool('NAVORO_SECURE_COOKIES', publicOrigin.startsWith('https://')),
    ...overrides,
  };
  if (config.nodeEnv === 'production' && config.allowPrivateUrls) {
    throw new ConfigError('NAVORO_ALLOW_PRIVATE_URLS cannot be enabled in production.');
  }
  return config;
}

/** Redacted, log-safe view of the configuration. */
export function describeConfig(config: AppConfig): Record<string, unknown> {
  return {
    nodeEnv: config.nodeEnv,
    publicOrigin: config.publicOrigin,
    port: config.port,
    demo: config.serveDemo ? `http://localhost:${config.demoPort}` : 'disabled',
    database: config.databasePath,
    provider: config.anthropicApiKey ? `anthropic (${config.anthropicModel})` : 'none — demo mode',
    allowPrivateUrls: config.allowPrivateUrls,
  };
}

export { ConfigError };
