/**
 * The tenant boundary. Route handlers and services obtain data access only via
 * `tenant(db, orgId)`, where orgId comes from an authenticated dashboard session
 * or a verified SDK token — never from request input. Each repository binds
 * org_id into every statement; database triggers additionally reject rows whose
 * org_id disagrees with their parent records.
 */
import type { Database } from '../db/database.ts';
import { ApplicationsRepo } from './applications.ts';
import { KnowledgeRepo } from './knowledge.ts';
import { GuidanceRepo } from './guidance.ts';
import { PrivacyRepo } from './privacy.ts';
import { ActivityRepo } from './activity.ts';
import { JobsRepo } from './jobs.ts';

export interface Tenant {
  orgId: string;
  apps: ApplicationsRepo;
  knowledge: KnowledgeRepo;
  guidance: GuidanceRepo;
  privacy: PrivacyRepo;
  activity: ActivityRepo;
  jobs: JobsRepo;
  transaction<T>(fn: () => T): T;
}

export function tenant(db: Database, orgId: string): Tenant {
  if (!orgId) throw new Error('tenant() requires an organization id');
  return {
    orgId,
    apps: new ApplicationsRepo(db, orgId),
    knowledge: new KnowledgeRepo(db, orgId),
    guidance: new GuidanceRepo(db, orgId),
    privacy: new PrivacyRepo(db, orgId),
    activity: new ActivityRepo(db, orgId),
    jobs: new JobsRepo(db, orgId),
    transaction: (fn) => db.transaction(fn),
  };
}
