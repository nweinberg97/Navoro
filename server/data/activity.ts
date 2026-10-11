/**
 * Tenant-scoped activity: audit log, guidance sessions, (optionally retained)
 * questions, analytics events, AI usage, and the aggregate queries behind the
 * Overview and Analytics pages. No free text from end users is stored unless
 * the application's policy explicitly enables question retention.
 */
import type { Database } from '../db/database.ts';
import { newId, now, parseJson } from '../db/database.ts';
import type { AnalyticsResponse, AuditEventDTO, Role, SettingsResponse } from '../../packages/contracts/src/admin-types.ts';
import type { EnvironmentName, SdkEvent } from '../../packages/contracts/src/sdk-types.ts';

export interface GuidanceSessionRow {
  id: string;
  org_id: string;
  app_id: string;
  environment: string;
  kind: string | null;
  outcome: 'answered' | 'unresolved' | 'completed' | 'dismissed' | 'cancelled' | 'error';
  workflow_id: string | null;
  topic: string | null;
  steps_viewed: number;
  step_count: number;
  mode: string | null;
  started_at: string;
  updated_at: string;
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export class ActivityRepo {
  #db: Database;
  readonly orgId: string;
  constructor(db: Database, orgId: string) {
    this.#db = db;
    this.orgId = orgId;
  }

  // ── Audit ─────────────────────────────────────────────────────────────────

  audit(input: { actorUserId: string | null; action: string; targetType: string; targetId: string | null; summary: string; detail?: Record<string, unknown> }): void {
    this.#db.run(
      'INSERT INTO audit_events (id, org_id, actor_user_id, action, target_type, target_id, summary, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [newId('aud'), this.orgId, input.actorUserId, input.action, input.targetType, input.targetId, input.summary, JSON.stringify(input.detail ?? {}), now()],
    );
  }

  auditEvents(limit = 50): AuditEventDTO[] {
    return this.#db
      .all<{ id: string; action: string; target_type: string; target_id: string | null; actor: string | null; summary: string; created_at: string }>(
        `SELECT a.id, a.action, a.target_type, a.target_id, u.name AS actor, a.summary, a.created_at
           FROM audit_events a LEFT JOIN users u ON u.id = a.actor_user_id
          WHERE a.org_id = ? ORDER BY a.created_at DESC LIMIT ?`,
        [this.orgId, limit],
      )
      .map((row) => ({
        id: row.id,
        action: row.action,
        targetType: row.target_type,
        targetId: row.target_id,
        actor: row.actor,
        summary: row.summary,
        createdAt: row.created_at,
      }));
  }

  // ── Guidance sessions & questions ─────────────────────────────────────────

  session(sessionId: string, appId: string): GuidanceSessionRow | undefined {
    return this.#db.get<GuidanceSessionRow>('SELECT * FROM guidance_sessions WHERE id = ? AND app_id = ? AND org_id = ?', [sessionId, appId, this.orgId]);
  }

  /** Creates a session, or updates an existing one the client is continuing. */
  recordGuidance(input: {
    appId: string;
    environment: EnvironmentName;
    sessionId?: string;
    kind: string;
    outcome: 'answered' | 'unresolved' | 'error';
    workflowId: string | null;
    topic: string;
    stepCount: number;
    mode: string;
  }): string {
    const timestamp = now();
    const existing = input.sessionId ? this.session(input.sessionId, input.appId) : undefined;
    if (existing) {
      this.#db.run(
        `UPDATE guidance_sessions SET kind = ?, outcome = ?, workflow_id = ?, topic = ?, step_count = ?, steps_viewed = 0, mode = ?, updated_at = ?
          WHERE id = ? AND org_id = ?`,
        [input.kind, input.outcome, input.workflowId, input.topic, input.stepCount, input.mode, timestamp, existing.id, this.orgId],
      );
      return existing.id;
    }
    const id = newId('gs');
    this.#db.run(
      `INSERT INTO guidance_sessions (id, org_id, app_id, environment, kind, outcome, workflow_id, topic, step_count, mode, started_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, this.orgId, input.appId, input.environment, input.kind, input.outcome, input.workflowId, input.topic, input.stepCount, input.mode, timestamp, timestamp],
    );
    return id;
  }

  recordQuestion(input: { appId: string; sessionId: string; text: string | null; topic: string; grounded: boolean; confidence: number; retentionDays: number }): void {
    const createdAt = new Date();
    const expiresAt = input.text ? new Date(createdAt.getTime() + input.retentionDays * 86_400_000).toISOString() : null;
    this.#db.run(
      'INSERT INTO questions (id, org_id, app_id, session_id, text, topic, grounded, confidence, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [newId('q'), this.orgId, input.appId, input.sessionId, input.text, input.topic, input.grounded ? 1 : 0, input.confidence, createdAt.toISOString(), expiresAt],
    );
  }

  recordErrorStates(appId: string, environment: EnvironmentName, sessionId: string, codes: string[]): void {
    for (const code of codes.slice(0, 5)) {
      this.#db.run(
        'INSERT INTO analytics_events (id, org_id, app_id, environment, type, session_id, error_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [newId('evt'), this.orgId, appId, environment, 'error_state_seen', sessionId, code, now()],
      );
    }
  }

  /** Applies SDK events: stores them (no free text) and advances session outcomes. */
  recordEvents(appId: string, environment: EnvironmentName, events: SdkEvent[]): number {
    let accepted = 0;
    this.#db.transaction(() => {
      for (const event of events) {
        const session = event.sessionId ? this.session(event.sessionId, appId) : undefined;
        if (event.sessionId && !session) continue; // unknown or other tenant's session: drop
        this.#db.run(
          `INSERT INTO analytics_events (id, org_id, app_id, environment, type, session_id, workflow_id, step_index, mapping_key, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [newId('evt'), this.orgId, appId, environment, event.type, session?.id ?? null, session?.workflow_id ?? null, event.stepIndex ?? null, event.mappingKey ?? null, now()],
        );
        accepted += 1;
        if (!session) continue;
        const timestamp = now();
        if (event.type === 'step_viewed' && event.stepIndex !== undefined) {
          this.#db.run('UPDATE guidance_sessions SET steps_viewed = MAX(steps_viewed, ?), updated_at = ? WHERE id = ? AND org_id = ?', [
            event.stepIndex + 1,
            timestamp,
            session.id,
            this.orgId,
          ]);
        } else if (event.type === 'workflow_completed') {
          this.#db.run("UPDATE guidance_sessions SET outcome = 'completed', steps_viewed = step_count, updated_at = ? WHERE id = ? AND org_id = ?", [
            timestamp,
            session.id,
            this.orgId,
          ]);
        } else if (event.type === 'guidance_dismissed') {
          this.#db.run(
            "UPDATE guidance_sessions SET outcome = 'dismissed', updated_at = ? WHERE id = ? AND org_id = ? AND outcome = 'answered' AND step_count > 0",
            [timestamp, session.id, this.orgId],
          );
        } else if (event.type === 'request_cancelled') {
          this.#db.run("UPDATE guidance_sessions SET outcome = 'cancelled', updated_at = ? WHERE id = ? AND org_id = ? AND outcome = 'answered'", [
            timestamp,
            session.id,
            this.orgId,
          ]);
        }
      }
    });
    return accepted;
  }

  recordAiUsage(input: { appId: string | null; purpose: string; provider: string; model: string; inputTokens: number; outputTokens: number; latencyMs: number; ok: boolean; errorCode: string | null }): void {
    this.#db.run(
      `INSERT INTO ai_usage (id, org_id, app_id, purpose, provider, model, input_tokens, output_tokens, latency_ms, ok, error_code, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId('ai'), this.orgId, input.appId, input.purpose, input.provider, input.model, input.inputTokens, input.outputTokens, input.latencyMs, input.ok ? 1 : 0, input.errorCode, now()],
    );
  }

  // ── Aggregates ────────────────────────────────────────────────────────────

  guidanceCounts(days: number, appId?: string): { sessions: number; answered: number; unresolved: number; completed: number; dismissed: number; cancelled: number; errors: number } {
    const rows = this.#db.all<{ outcome: GuidanceSessionRow['outcome']; n: number }>(
      `SELECT outcome, COUNT(*) AS n FROM guidance_sessions WHERE org_id = ? AND started_at >= ? ${appId ? 'AND app_id = ?' : ''} GROUP BY outcome`,
      appId ? [this.orgId, daysAgo(days), appId] : [this.orgId, daysAgo(days)],
    );
    const by = (outcome: string) => rows.find((row) => row.outcome === outcome)?.n ?? 0;
    const total = rows.reduce((sum, row) => sum + row.n, 0);
    return {
      sessions: total,
      // "answered" counts every grounded outcome, including later completion/dismissal.
      answered: by('answered') + by('completed') + by('dismissed'),
      unresolved: by('unresolved'),
      completed: by('completed'),
      dismissed: by('dismissed'),
      cancelled: by('cancelled'),
      errors: by('error'),
    };
  }

  analytics(appId: string, days: number, retainQuestions: boolean, analyticsEnabled: boolean): Omit<AnalyticsResponse, 'staleSources' | 'lowConfidenceMappings'> {
    const since = daysAgo(days);
    const counts = this.guidanceCounts(days, appId);
    const daily = this.#db.all<{ date: string; sessions: number; unresolved: number }>(
      `SELECT substr(started_at, 1, 10) AS date, COUNT(*) AS sessions, SUM(CASE WHEN outcome = 'unresolved' THEN 1 ELSE 0 END) AS unresolved
         FROM guidance_sessions WHERE org_id = ? AND app_id = ? AND started_at >= ? GROUP BY date ORDER BY date`,
      [this.orgId, appId, since],
    );
    const filledDaily: AnalyticsResponse['daily'] = [];
    for (let offset = days - 1; offset >= 0; offset -= 1) {
      const date = new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
      const found = daily.find((row) => row.date === date);
      filledDaily.push({ date, sessions: found?.sessions ?? 0, unresolved: found?.unresolved ?? 0 });
    }
    const topTopics = this.#db.all<{ topic: string; count: number; unresolved: number }>(
      `SELECT topic, COUNT(*) AS count, SUM(CASE WHEN grounded = 0 THEN 1 ELSE 0 END) AS unresolved
         FROM questions WHERE org_id = ? AND app_id = ? AND created_at >= ? AND topic IS NOT NULL
        GROUP BY topic ORDER BY count DESC LIMIT 10`,
      [this.orgId, appId, since],
    );
    const retainedQuestions = retainQuestions
      ? this.#db
          .all<{ text: string; count: number; grounded: number }>(
            `SELECT lower(text) AS text, COUNT(*) AS count, MIN(grounded) AS grounded FROM questions
              WHERE org_id = ? AND app_id = ? AND created_at >= ? AND text IS NOT NULL
              GROUP BY lower(text) ORDER BY count DESC LIMIT 15`,
            [this.orgId, appId, since],
          )
          .map((row) => ({ text: row.text, count: row.count, grounded: row.grounded === 1 }))
      : null;
    const errorStates = this.#db.all<{ code: string; count: number }>(
      `SELECT error_code AS code, COUNT(*) AS count FROM analytics_events
        WHERE org_id = ? AND app_id = ? AND created_at >= ? AND type = 'error_state_seen' AND error_code IS NOT NULL
        GROUP BY error_code ORDER BY count DESC LIMIT 10`,
      [this.orgId, appId, since],
    );
    const stepViews = this.#db.all<{ workflow_id: string; title: string; step_index: number; views: number }>(
      `SELECT e.workflow_id, w.title, e.step_index, COUNT(DISTINCT e.session_id) AS views
         FROM analytics_events e JOIN workflows w ON w.id = e.workflow_id
        WHERE e.org_id = ? AND e.app_id = ? AND e.created_at >= ? AND e.type = 'step_viewed' AND e.step_index IS NOT NULL
        GROUP BY e.workflow_id, e.step_index ORDER BY w.title, e.step_index`,
      [this.orgId, appId, since],
    );
    const dropOffs = this.#db.all<{ workflow_id: string; step_index: number; n: number }>(
      `SELECT workflow_id, steps_viewed - 1 AS step_index, COUNT(*) AS n FROM guidance_sessions
        WHERE org_id = ? AND app_id = ? AND started_at >= ? AND workflow_id IS NOT NULL AND outcome = 'dismissed' AND steps_viewed > 0
        GROUP BY workflow_id, steps_viewed`,
      [this.orgId, appId, since],
    );
    const stepAbandonment = stepViews
      .map((row) => ({
        workflowId: row.workflow_id,
        workflowTitle: row.title,
        stepIndex: row.step_index,
        views: row.views,
        dropOffs: dropOffs.find((drop) => drop.workflow_id === row.workflow_id && drop.step_index === row.step_index)?.n ?? 0,
      }))
      .sort((a, b) => b.dropOffs - a.dropOffs || a.workflowTitle.localeCompare(b.workflowTitle) || a.stepIndex - b.stepIndex)
      .slice(0, 15);
    const missingTargets = this.#db.all<{ key: string; count: number }>(
      `SELECT mapping_key AS key, COUNT(*) AS count FROM analytics_events
        WHERE org_id = ? AND app_id = ? AND created_at >= ? AND type = 'step_target_missing' AND mapping_key IS NOT NULL
        GROUP BY mapping_key ORDER BY count DESC LIMIT 10`,
      [this.orgId, appId, since],
    );
    const feedbackRows = this.#db.all<{ type: string; n: number }>(
      `SELECT type, COUNT(*) AS n FROM analytics_events WHERE org_id = ? AND app_id = ? AND created_at >= ?
          AND type IN ('feedback_helpful', 'feedback_not_helpful') GROUP BY type`,
      [this.orgId, appId, since],
    );
    const measured = ['sessions', 'daily', 'topTopics', 'lowConfidenceMappings', 'staleSources'];
    if (analyticsEnabled) measured.push('errorStates', 'stepAbandonment', 'missingTargets', 'feedback');
    if (retainQuestions) measured.push('retainedQuestions');
    return {
      days,
      measured,
      topTopics,
      retainedQuestions,
      sessions: { total: counts.sessions, answered: counts.answered, unresolved: counts.unresolved, completed: counts.completed, dismissed: counts.dismissed, cancelled: counts.cancelled, errors: counts.errors },
      daily: filledDaily,
      errorStates,
      stepAbandonment,
      missingTargets,
      feedback: {
        helpful: feedbackRows.find((row) => row.type === 'feedback_helpful')?.n ?? 0,
        notHelpful: feedbackRows.find((row) => row.type === 'feedback_not_helpful')?.n ?? 0,
      },
    };
  }

  /** Deletes retained question text past its expiry. Returns rows scrubbed. */
  sweepRetention(): number {
    return this.#db.run('UPDATE questions SET text = NULL WHERE org_id = ? AND text IS NOT NULL AND expires_at < ?', [this.orgId, now()]).changes;
  }

  // ── Organization settings ─────────────────────────────────────────────────

  organization(): SettingsResponse['organization'] | undefined {
    const row = this.#db.get<{ id: string; name: string; slug: string; approval_policy: 'manual' | 'auto' }>('SELECT * FROM organizations WHERE id = ?', [this.orgId]);
    return row ? { id: row.id, name: row.name, slug: row.slug, approvalPolicy: row.approval_policy } : undefined;
  }

  updateOrganization(patch: { name?: string; approvalPolicy?: 'manual' | 'auto' }): void {
    const org = this.organization();
    if (!org) return;
    this.#db.run('UPDATE organizations SET name = ?, approval_policy = ? WHERE id = ?', [patch.name ?? org.name, patch.approvalPolicy ?? org.approvalPolicy, this.orgId]);
  }

  members(): SettingsResponse['members'] {
    return this.#db
      .all<{ user_id: string; email: string; name: string; role: Role; created_at: string }>(
        `SELECT m.user_id, u.email, u.name, m.role, m.created_at FROM memberships m JOIN users u ON u.id = m.user_id
          WHERE m.org_id = ? ORDER BY m.created_at`,
        [this.orgId],
      )
      .map((row) => ({ userId: row.user_id, email: row.email, name: row.name, role: row.role, createdAt: row.created_at }));
  }

  memberRole(userId: string): Role | undefined {
    return this.#db.get<{ role: Role }>('SELECT role FROM memberships WHERE org_id = ? AND user_id = ?', [this.orgId, userId])?.role;
  }

  setMemberRole(userId: string, role: Role): void {
    this.#db.run('UPDATE memberships SET role = ? WHERE org_id = ? AND user_id = ?', [role, this.orgId, userId]);
  }

  ownerCount(): number {
    return this.#db.get<{ n: number }>("SELECT COUNT(*) AS n FROM memberships WHERE org_id = ? AND role = 'owner'", [this.orgId])?.n ?? 0;
  }
}

export { parseJson };
