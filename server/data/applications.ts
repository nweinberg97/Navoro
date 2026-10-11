/**
 * Tenant-scoped data access for applications, environments, configuration
 * versions, approved element metadata (catalog) and Training Mode blueprints.
 * Every statement filters on org_id bound at construction time.
 */
import type { Database } from '../db/database.ts';
import { newId, now, parseJson } from '../db/database.ts';
import { randomToken } from '../security/crypto.ts';
import type { EnvironmentName, DiscoveryRequest } from '../../packages/contracts/src/sdk-types.ts';
import type {
  ApplicationSummary,
  BlueprintDTO,
  CatalogElementDTO,
  ConfigVersionDTO,
  EnvironmentDTO,
} from '../../packages/contracts/src/admin-types.ts';
import {
  defaultPrivacyPolicy,
  type ApplicationRow,
  type CatalogRow,
  type ConfigSnapshot,
  type EnvironmentRow,
} from './types.ts';

export const ENVIRONMENTS: EnvironmentName[] = ['development', 'production'];

export function generatePublicKey(): string {
  return `nav_pk_${randomToken(18).replace(/[-_]/g, 'x')}`;
}

export class ApplicationsRepo {
  #db: Database;
  readonly orgId: string;
  constructor(db: Database, orgId: string) {
    this.#db = db;
    this.orgId = orgId;
  }

  get(appId: string): ApplicationRow | undefined {
    return this.#db.get<ApplicationRow>('SELECT * FROM applications WHERE id = ? AND org_id = ?', [appId, this.orgId]);
  }

  list(): ApplicationRow[] {
    return this.#db.all<ApplicationRow>('SELECT * FROM applications WHERE org_id = ? ORDER BY created_at ASC', [this.orgId]);
  }

  environments(appId: string): EnvironmentRow[] {
    return this.#db.all<EnvironmentRow>(
      `SELECT * FROM environments WHERE app_id = ? AND org_id = ? ORDER BY CASE name WHEN 'development' THEN 0 ELSE 1 END`,
      [appId, this.orgId],
    );
  }

  environment(appId: string, name: EnvironmentName): EnvironmentRow | undefined {
    return this.#db.get<EnvironmentRow>('SELECT * FROM environments WHERE app_id = ? AND org_id = ? AND name = ?', [appId, this.orgId, name]);
  }

  create(input: { name: string; developmentOrigins: string[]; productionOrigins: string[]; publicKey?: string }): string {
    return this.#db.transaction(() => {
      const appId = newId('app');
      const timestamp = now();
      this.#db.run(
        `INSERT INTO applications (id, org_id, name, public_key, suggestions, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [appId, this.orgId, input.name, input.publicKey ?? generatePublicKey(), JSON.stringify([]), timestamp, timestamp],
      );
      for (const env of ENVIRONMENTS) {
        const origins = env === 'development' ? input.developmentOrigins : input.productionOrigins;
        this.#db.run('INSERT INTO environments (id, org_id, app_id, name, allowed_origins) VALUES (?, ?, ?, ?, ?)', [
          newId('env'),
          this.orgId,
          appId,
          env,
          JSON.stringify(origins),
        ]);
      }
      this.#db.run('INSERT INTO privacy_policies (app_id, org_id, draft, updated_at) VALUES (?, ?, ?, ?)', [
        appId,
        this.orgId,
        JSON.stringify(defaultPrivacyPolicy()),
        timestamp,
      ]);
      return appId;
    });
  }

  update(appId: string, patch: { name?: string; supportUrl?: string | null; greeting?: string; suggestions?: string[] }): void {
    const app = this.get(appId);
    if (!app) return;
    this.#db.run(
      `UPDATE applications SET name = ?, support_url = ?, greeting = ?, suggestions = ?, updated_at = ?
        WHERE id = ? AND org_id = ?`,
      [
        patch.name ?? app.name,
        patch.supportUrl === undefined ? app.support_url : patch.supportUrl,
        patch.greeting ?? app.greeting,
        patch.suggestions ? JSON.stringify(patch.suggestions) : app.suggestions,
        now(),
        appId,
        this.orgId,
      ],
    );
  }

  setOrigins(appId: string, env: EnvironmentName, origins: string[]): void {
    this.#db.run('UPDATE environments SET allowed_origins = ? WHERE app_id = ? AND org_id = ? AND name = ?', [
      JSON.stringify(origins),
      appId,
      this.orgId,
      env,
    ]);
  }

  markSeen(appId: string, env: EnvironmentName, sdkVersion: string): void {
    const timestamp = now();
    this.#db.run('UPDATE applications SET last_seen_at = ?, sdk_version = ? WHERE id = ? AND org_id = ?', [timestamp, sdkVersion, appId, this.orgId]);
    this.#db.run('UPDATE environments SET last_seen_at = ? WHERE app_id = ? AND org_id = ? AND name = ?', [timestamp, appId, this.orgId, env]);
  }

  // ── Configuration versions ────────────────────────────────────────────────

  createConfigVersion(appId: string, env: EnvironmentName, snapshot: ConfigSnapshot, notes: string | null, userId: string | null): { id: string; version: number } {
    return this.#db.transaction(() => {
      const last = this.#db.get<{ version: number }>('SELECT MAX(version) AS version FROM config_versions WHERE app_id = ? AND org_id = ?', [appId, this.orgId]);
      const version = (last?.version ?? 0) + 1;
      const id = newId('cfg');
      this.#db.run(
        `INSERT INTO config_versions (id, org_id, app_id, environment, version, snapshot, notes, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, this.orgId, appId, env, version, JSON.stringify(snapshot), notes, userId, now()],
      );
      this.#db.run('UPDATE environments SET active_config_version_id = ? WHERE app_id = ? AND org_id = ? AND name = ?', [id, appId, this.orgId, env]);
      return { id, version };
    });
  }

  activeSnapshot(appId: string, env: EnvironmentName): { version: number; snapshot: ConfigSnapshot } | null {
    const row = this.#db.get<{ version: number; snapshot: string }>(
      `SELECT c.version, c.snapshot FROM environments e
         JOIN config_versions c ON c.id = e.active_config_version_id
        WHERE e.app_id = ? AND e.org_id = ? AND e.name = ?`,
      [appId, this.orgId, env],
    );
    if (!row) return null;
    const snapshot = parseJson<ConfigSnapshot | null>(row.snapshot, null);
    return snapshot ? { version: row.version, snapshot } : null;
  }

  configVersions(appId: string): ConfigVersionDTO[] {
    const rows = this.#db.all<{
      id: string;
      version: number;
      environment: EnvironmentName;
      notes: string | null;
      created_at: string;
      created_by_name: string | null;
      snapshot: string;
    }>(
      `SELECT c.id, c.version, c.environment, c.notes, c.created_at, u.name AS created_by_name, c.snapshot
         FROM config_versions c LEFT JOIN users u ON u.id = c.created_by
        WHERE c.app_id = ? AND c.org_id = ? ORDER BY c.version DESC LIMIT 50`,
      [appId, this.orgId],
    );
    return rows.map((row) => {
      const snapshot = parseJson<ConfigSnapshot | null>(row.snapshot, null);
      return {
        id: row.id,
        version: row.version,
        environment: row.environment,
        notes: row.notes,
        createdAt: row.created_at,
        createdBy: row.created_by_name,
        summary: {
          publishedWorkflows: snapshot?.workflowIds.length ?? 0,
          blockedRegions: snapshot?.privacy.neverCollect.length ?? 0,
          transmitCategories: snapshot?.privacy.transmit ?? [],
        },
      };
    });
  }

  environmentDTOs(appId: string): EnvironmentDTO[] {
    return this.environments(appId).map((env) => {
      const active = env.active_config_version_id
        ? this.#db.get<{ version: number }>('SELECT version FROM config_versions WHERE id = ? AND org_id = ?', [env.active_config_version_id, this.orgId])
        : undefined;
      return {
        id: env.id,
        name: env.name,
        allowedOrigins: parseJson<string[]>(env.allowed_origins, []),
        activeConfigVersion: active?.version ?? null,
        lastSeenAt: env.last_seen_at,
      };
    });
  }

  summary(app: ApplicationRow): ApplicationSummary {
    return {
      id: app.id,
      name: app.name,
      publicKey: app.public_key,
      createdAt: app.created_at,
      lastSeenAt: app.last_seen_at,
      sdkVersion: app.sdk_version,
      environments: this.environmentDTOs(app.id),
    };
  }

  // ── Approved application metadata (element catalog) ───────────────────────

  catalog(appId: string): CatalogRow[] {
    return this.#db.all<CatalogRow>('SELECT * FROM element_catalog WHERE app_id = ? AND org_id = ? ORDER BY navoro_id', [appId, this.orgId]);
  }

  catalogElement(appId: string, elementId: string): CatalogRow | undefined {
    return this.#db.get<CatalogRow>('SELECT * FROM element_catalog WHERE id = ? AND app_id = ? AND org_id = ?', [elementId, appId, this.orgId]);
  }

  setCatalogApproved(appId: string, elementId: string, approved: boolean): void {
    this.#db.run('UPDATE element_catalog SET approved = ? WHERE id = ? AND app_id = ? AND org_id = ?', [approved ? 1 : 0, elementId, appId, this.orgId]);
  }

  /** Upserts catalog entries. Discovery never auto-approves; manual imports are approved by the importing admin. */
  upsertCatalog(
    appId: string,
    elements: Array<{ navoroId: string; label: string | null; role: string | null; route: string | null }>,
    source: 'sdk_discovery' | 'manual',
  ): number {
    const timestamp = now();
    let changed = 0;
    this.#db.transaction(() => {
      for (const element of elements) {
        const existing = this.#db.get<CatalogRow>('SELECT * FROM element_catalog WHERE app_id = ? AND org_id = ? AND navoro_id = ?', [
          appId,
          this.orgId,
          element.navoroId,
        ]);
        if (existing) {
          this.#db.run(
            `UPDATE element_catalog SET label = COALESCE(?, label), role = COALESCE(?, role), route = COALESCE(?, route),
                    last_seen_at = ?, approved = CASE WHEN ? = 'manual' THEN 1 ELSE approved END
              WHERE id = ? AND org_id = ?`,
            [element.label, element.role, element.route, timestamp, source, existing.id, this.orgId],
          );
        } else {
          this.#db.run(
            `INSERT INTO element_catalog (id, org_id, app_id, navoro_id, label, role, route, source, approved, first_seen_at, last_seen_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [newId('el'), this.orgId, appId, element.navoroId, element.label, element.role, element.route, source, source === 'manual' ? 1 : 0, timestamp, timestamp],
          );
        }
        changed += 1;
      }
    });
    return changed;
  }

  catalogDTO(row: CatalogRow): CatalogElementDTO {
    return {
      id: row.id,
      navoroId: row.navoro_id,
      label: row.label,
      role: row.role,
      route: row.route,
      source: row.source,
      approved: row.approved === 1,
      lastSeenAt: row.last_seen_at,
    };
  }

  approvedNavoroIds(appId: string): string[] {
    return this.#db
      .all<{ navoro_id: string }>('SELECT navoro_id FROM element_catalog WHERE app_id = ? AND org_id = ? AND approved = 1 ORDER BY navoro_id', [appId, this.orgId])
      .map((row) => row.navoro_id);
  }

  // ── Training Mode blueprints ──────────────────────────────────────────────

  saveBlueprint(appId: string, blueprint: DiscoveryRequest): void {
    const timestamp = now();
    const existing = this.#db.get<{ id: string }>('SELECT id FROM page_blueprints WHERE app_id = ? AND org_id = ? AND route = ?', [appId, this.orgId, blueprint.route]);
    const values = [JSON.stringify(blueprint.viewport), blueprint.documentHeight, JSON.stringify(blueprint.elements), timestamp];
    if (existing) {
      this.#db.run('UPDATE page_blueprints SET viewport = ?, document_height = ?, elements = ?, captured_at = ? WHERE id = ? AND org_id = ?', [
        ...values,
        existing.id,
        this.orgId,
      ]);
    } else {
      this.#db.run(
        'INSERT INTO page_blueprints (id, org_id, app_id, route, viewport, document_height, elements, captured_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [newId('bp'), this.orgId, appId, blueprint.route, ...values],
      );
    }
  }

  blueprints(appId: string): BlueprintDTO[] {
    return this.#db
      .all<{ id: string; route: string; viewport: string; document_height: number; elements: string; captured_at: string }>(
        'SELECT * FROM page_blueprints WHERE app_id = ? AND org_id = ? ORDER BY route',
        [appId, this.orgId],
      )
      .map((row) => ({
        id: row.id,
        route: row.route,
        viewport: parseJson(row.viewport, { width: 0, height: 0 }),
        documentHeight: row.document_height,
        capturedAt: row.captured_at,
        elements: parseJson(row.elements, []),
      }));
  }
}

/** Not tenant-scoped: resolves which tenant a public SDK key belongs to. */
export function findApplicationByPublicKey(db: Database, publicKey: string): ApplicationRow | undefined {
  return db.get<ApplicationRow>('SELECT * FROM applications WHERE public_key = ?', [publicKey]);
}

/** Not tenant-scoped: whether any application registers this origin (used only for CORS preflight). */
export function isOriginRegisteredAnywhere(db: Database, origin: string): boolean {
  return Boolean(db.get('SELECT 1 FROM environments e, json_each(e.allowed_origins) j WHERE j.value = ? LIMIT 1', [origin]));
}
