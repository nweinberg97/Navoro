/**
 * Shared server context and request guards (authentication, roles, CSRF,
 * tenant resolution). Handlers receive a Tenant bound to the session's org —
 * they cannot choose another organization.
 */
import type { AppConfig } from '../config/env.ts';
import type { Database } from '../db/database.ts';
import { Accounts, type SessionInfo } from '../data/accounts.ts';
import { tenant, type Tenant } from '../data/tenant.ts';
import type { JobRunner } from '../jobs/runner.ts';
import type { ModelProvider } from '../ai/provider.ts';
import { RateLimiter } from '../security/rate-limit.ts';
import { safeEqual } from '../security/crypto.ts';
import { forbidden, HttpError, notFound, parseCookies, unauthorized, type RequestContext } from '../http/http.ts';
import type { Role } from '../../packages/contracts/src/admin-types.ts';
import type { ApplicationRow } from '../data/types.ts';

export const SESSION_COOKIE = 'navoro_session';

export interface ServerContext {
  config: AppConfig;
  db: Database;
  accounts: Accounts;
  runner: JobRunner;
  provider: ModelProvider | null;
  limits: {
    login: RateLimiter;
    signup: RateLimiter;
    sdkInit: RateLimiter;
    guidanceByApp: RateLimiter;
    guidanceByIp: RateLimiter;
    sdkEvents: RateLimiter;
    aiByOrg: RateLimiter;
  };
}

export function createLimits(): ServerContext['limits'] {
  return {
    login: new RateLimiter({ capacity: 10, refillPerSecond: 10 / 300 }),
    signup: new RateLimiter({ capacity: 5, refillPerSecond: 5 / 3600 }),
    sdkInit: new RateLimiter({ capacity: 60, refillPerSecond: 1 }),
    guidanceByApp: new RateLimiter({ capacity: 120, refillPerSecond: 2 }),
    guidanceByIp: new RateLimiter({ capacity: 20, refillPerSecond: 0.2 }),
    sdkEvents: new RateLimiter({ capacity: 240, refillPerSecond: 4 }),
    aiByOrg: new RateLimiter({ capacity: 60, refillPerSecond: 0.5 }),
  };
}

export interface AdminRequest {
  session: SessionInfo;
  t: Tenant;
}

const ROLE_RANK: Record<Role, number> = { member: 0, admin: 1, owner: 2 };

export function hasRole(role: Role, minimum: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export function requireSession(server: ServerContext, ctx: RequestContext): AdminRequest {
  const token = parseCookies(ctx.req.headers.cookie)[SESSION_COOKIE];
  if (!token) throw unauthorized();
  const session = server.accounts.resolveSession(token);
  if (!session) throw unauthorized('Your session expired. Sign in again.');
  if (ctx.method !== 'GET' && ctx.method !== 'HEAD') verifyCsrf(server, ctx, session);
  return { session, t: tenant(server.db, session.orgId) };
}

/** Mutations need the per-session CSRF header and, when present, a same-origin Origin header. */
function verifyCsrf(server: ServerContext, ctx: RequestContext, session: SessionInfo): void {
  const header = ctx.req.headers['x-navoro-csrf'];
  if (typeof header !== 'string' || !safeEqual(header, session.csrfToken)) {
    throw new HttpError(403, 'csrf_failed', 'Security check failed. Reload the page and try again.');
  }
  const origin = ctx.req.headers.origin;
  if (origin && origin !== server.config.publicOrigin && origin !== `http://${ctx.req.headers.host ?? ''}` && origin !== `https://${ctx.req.headers.host ?? ''}`) {
    throw new HttpError(403, 'origin_rejected', 'Cross-origin request rejected.');
  }
}

export function requireRole(request: AdminRequest, minimum: Role): void {
  if (!hasRole(request.session.role, minimum)) {
    throw forbidden(minimum === 'owner' ? 'Only workspace owners can do that.' : 'Your role is read-only. Ask an admin to make this change.');
  }
}

export function requireApp(request: AdminRequest, appId: string | undefined): ApplicationRow {
  const app = appId ? request.t.apps.get(appId) : undefined;
  // Same 404 for "doesn't exist" and "belongs to another tenant" — no existence oracle.
  if (!app) throw notFound('Application not found.');
  return app;
}
