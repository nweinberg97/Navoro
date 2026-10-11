/**
 * Users, organizations, memberships and dashboard sessions.
 * These are the only queries that are not scoped to a tenant, because they
 * establish which tenant a request belongs to.
 */
import type { Database } from '../db/database.ts';
import { newId, now } from '../db/database.ts';
import { randomToken, sha256 } from '../security/crypto.ts';
import type { Role } from '../../packages/contracts/src/admin-types.ts';

export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  created_at: string;
}

export interface SessionInfo {
  userId: string;
  email: string;
  name: string;
  orgId: string;
  orgName: string;
  orgSlug: string;
  role: Role;
  csrfToken: string;
  tokenHash: string;
}

export function slugify(name: string): string {
  const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return base || 'workspace';
}

export class Accounts {
  #db: Database;
  constructor(db: Database) {
    this.#db = db;
  }

  findUserByEmail(email: string): UserRow | undefined {
    return this.#db.get<UserRow>('SELECT * FROM users WHERE email = ? COLLATE NOCASE', [email]);
  }

  createUserWithOrganization(input: { name: string; email: string; passwordHash: string; organizationName: string }): { userId: string; orgId: string } {
    return this.#db.transaction(() => {
      const userId = newId('usr');
      const orgId = newId('org');
      const createdAt = now();
      this.#db.run('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)', [
        userId,
        input.email,
        input.name,
        input.passwordHash,
        createdAt,
      ]);
      let slug = slugify(input.organizationName);
      if (this.#db.get('SELECT 1 FROM organizations WHERE slug = ?', [slug])) slug = `${slug}-${orgId.slice(-6)}`;
      this.#db.run('INSERT INTO organizations (id, name, slug, approval_policy, created_at) VALUES (?, ?, ?, ?, ?)', [
        orgId,
        input.organizationName,
        slug,
        'manual',
        createdAt,
      ]);
      this.#db.run('INSERT INTO memberships (org_id, user_id, role, created_at) VALUES (?, ?, ?, ?)', [orgId, userId, 'owner', createdAt]);
      return { userId, orgId };
    });
  }

  /** Adds a user to an existing organization (creating the user if needed). */
  addMember(orgId: string, input: { email: string; name: string; role: Role; passwordHash: string }): string {
    return this.#db.transaction(() => {
      let user = this.findUserByEmail(input.email);
      if (!user) {
        const userId = newId('usr');
        this.#db.run('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)', [
          userId,
          input.email,
          input.name,
          input.passwordHash,
          now(),
        ]);
        user = this.#db.get<UserRow>('SELECT * FROM users WHERE id = ?', [userId]);
      }
      if (!user) throw new Error('user creation failed');
      if (this.#db.get('SELECT 1 FROM memberships WHERE org_id = ? AND user_id = ?', [orgId, user.id])) {
        throw new Error('already_member');
      }
      this.#db.run('INSERT INTO memberships (org_id, user_id, role, created_at) VALUES (?, ?, ?, ?)', [orgId, user.id, input.role, now()]);
      return user.id;
    });
  }

  primaryMembership(userId: string): { org_id: string; role: Role } | undefined {
    return this.#db.get<{ org_id: string; role: Role }>(
      'SELECT org_id, role FROM memberships WHERE user_id = ? ORDER BY created_at ASC LIMIT 1',
      [userId],
    );
  }

  createSession(userId: string, orgId: string): { token: string; csrfToken: string } {
    const token = randomToken(32);
    const csrfToken = randomToken(24);
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + SESSION_TTL_SECONDS * 1000);
    this.#db.run(
      'INSERT INTO sessions (token_hash, user_id, org_id, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
      [sha256(token), userId, orgId, csrfToken, createdAt.toISOString(), expiresAt.toISOString()],
    );
    return { token, csrfToken };
  }

  resolveSession(token: string): SessionInfo | null {
    const row = this.#db.get<{
      token_hash: string;
      user_id: string;
      org_id: string;
      csrf_token: string;
      expires_at: string;
      email: string;
      name: string;
      org_name: string;
      org_slug: string;
      role: Role | null;
    }>(
      `SELECT s.token_hash, s.user_id, s.org_id, s.csrf_token, s.expires_at, u.email, u.name,
              o.name AS org_name, o.slug AS org_slug, m.role
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         JOIN organizations o ON o.id = s.org_id
         LEFT JOIN memberships m ON m.org_id = s.org_id AND m.user_id = s.user_id
        WHERE s.token_hash = ?`,
      [sha256(token)],
    );
    if (!row) return null;
    if (!row.role || new Date(row.expires_at).getTime() < Date.now()) {
      this.#db.run('DELETE FROM sessions WHERE token_hash = ?', [row.token_hash]);
      return null;
    }
    return {
      userId: row.user_id,
      email: row.email,
      name: row.name,
      orgId: row.org_id,
      orgName: row.org_name,
      orgSlug: row.org_slug,
      role: row.role,
      csrfToken: row.csrf_token,
      tokenHash: row.token_hash,
    };
  }

  deleteSession(tokenHash: string): void {
    this.#db.run('DELETE FROM sessions WHERE token_hash = ?', [tokenHash]);
  }

  deleteExpiredSessions(): number {
    return this.#db.run('DELETE FROM sessions WHERE expires_at < ?', [now()]).changes;
  }
}
