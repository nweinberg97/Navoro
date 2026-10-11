/** Dashboard authentication: signup, login, logout, session introspection. */
import { badRequest, HttpError, readJson, sendJson, serializeCookie, unauthorized, type Router } from '../http/http.ts';
import { hashPassword, verifyPassword } from '../security/crypto.ts';
import { SESSION_TTL_SECONDS } from '../data/accounts.ts';
import { tenant } from '../data/tenant.ts';
import { v } from '../lib/validate.ts';
import { requireSession, SESSION_COOKIE, type ServerContext } from './context.ts';
import type { MeResponse } from '../../packages/contracts/src/admin-types.ts';

const email = v.string({ min: 3, max: 254, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, patternMessage: 'Enter a valid email address' });

const signupSchema = v.object({
  name: v.string({ min: 1, max: 80 }),
  email,
  password: v.string({ min: 10, max: 200, trim: false }),
  organizationName: v.string({ min: 1, max: 80 }),
});

const loginSchema = v.object({ email, password: v.string({ min: 1, max: 200, trim: false }) });

// A fixed dummy hash keeps login timing similar for unknown emails.
const DUMMY_HASH = 'scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA$' + 'A'.repeat(86);

function setSessionCookie(server: ServerContext, token: string): string {
  return serializeCookie(SESSION_COOKIE, token, { maxAgeSeconds: SESSION_TTL_SECONDS, secure: server.config.secureCookies });
}

export function registerAuthRoutes(router: Router, server: ServerContext): void {
  router.post('/api/auth/signup', async (ctx) => {
    if (server.limits.signup.take(`signup:${ctx.ip}`)) throw new HttpError(429, 'rate_limited', 'Too many sign-ups from this network. Try again later.');
    const body = await readJson(ctx, signupSchema);
    if (server.accounts.findUserByEmail(body.email)) throw badRequest('An account with that email already exists. Sign in instead.');
    const passwordHash = await hashPassword(body.password);
    const { userId, orgId } = server.accounts.createUserWithOrganization({ name: body.name, email: body.email, passwordHash, organizationName: body.organizationName });
    tenant(server.db, orgId).activity.audit({ actorUserId: userId, action: 'workspace.created', targetType: 'organization', targetId: orgId, summary: `Created workspace ${body.organizationName}` });
    const { token } = server.accounts.createSession(userId, orgId);
    const session = server.accounts.resolveSession(token);
    if (!session) throw new Error('session creation failed');
    sendJson(ctx.res, 201, me(session), { 'set-cookie': setSessionCookie(server, token) });
  });

  router.post('/api/auth/login', async (ctx) => {
    const body = await readJson(ctx, loginSchema);
    const key = `login:${ctx.ip}:${body.email.toLowerCase()}`;
    if (server.limits.login.take(key)) throw new HttpError(429, 'rate_limited', 'Too many sign-in attempts. Wait a few minutes and try again.');
    const user = server.accounts.findUserByEmail(body.email);
    const valid = await verifyPassword(body.password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !valid) throw unauthorized('Email or password is incorrect.');
    const membership = server.accounts.primaryMembership(user.id);
    if (!membership) throw unauthorized('This account is not a member of any workspace.');
    const { token } = server.accounts.createSession(user.id, membership.org_id);
    const session = server.accounts.resolveSession(token);
    if (!session) throw new Error('session creation failed');
    sendJson(ctx.res, 200, me(session), { 'set-cookie': setSessionCookie(server, token) });
  });

  router.post('/api/auth/logout', (ctx) => {
    try {
      const { session } = requireSession(server, ctx);
      server.accounts.deleteSession(session.tokenHash);
    } catch {
      // Logging out without a valid session is still a successful logout.
    }
    sendJson(ctx.res, 200, { ok: true }, { 'set-cookie': serializeCookie(SESSION_COOKIE, '', { maxAgeSeconds: 0, secure: server.config.secureCookies }) });
  });

  router.get('/api/auth/me', (ctx) => {
    const { session } = requireSession(server, ctx);
    sendJson(ctx.res, 200, me(session));
  });
}

function me(session: NonNullable<ReturnType<ServerContext['accounts']['resolveSession']>>): MeResponse {
  return {
    user: { id: session.userId, email: session.email, name: session.name },
    organization: { id: session.orgId, name: session.orgName, slug: session.orgSlug },
    role: session.role,
    csrfToken: session.csrfToken,
  };
}
