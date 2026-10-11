/** Tenant-scoped storage of each application's draft privacy policy. */
import type { Database } from '../db/database.ts';
import { now, parseJson } from '../db/database.ts';
import { defaultPrivacyPolicy, type StoredPrivacyPolicy } from './types.ts';

export class PrivacyRepo {
  #db: Database;
  readonly orgId: string;
  constructor(db: Database, orgId: string) {
    this.#db = db;
    this.orgId = orgId;
  }

  draft(appId: string): { policy: StoredPrivacyPolicy; updatedAt: string } | null {
    const row = this.#db.get<{ draft: string; updated_at: string }>('SELECT draft, updated_at FROM privacy_policies WHERE app_id = ? AND org_id = ?', [
      appId,
      this.orgId,
    ]);
    if (!row) return null;
    return { policy: { ...defaultPrivacyPolicy(), ...parseJson<Partial<StoredPrivacyPolicy>>(row.draft, {}) }, updatedAt: row.updated_at };
  }

  save(appId: string, policy: StoredPrivacyPolicy): void {
    this.#db.run('UPDATE privacy_policies SET draft = ?, updated_at = ? WHERE app_id = ? AND org_id = ?', [JSON.stringify(policy), now(), appId, this.orgId]);
  }
}
