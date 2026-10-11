/**
 * Durable background jobs. Jobs are rows in SQLite; the in-process worker
 * (server/jobs/runner.ts) claims queued jobs, persists per-step progress, and
 * checks `cancel_requested` between steps. Admin reads are tenant-scoped; the
 * worker's claim/heartbeat functions are internal.
 */
import type { Database } from '../db/database.ts';
import { newId, now, parseJson } from '../db/database.ts';
import type { JobDTO, JobStepDTO, RefreshReport } from '../../packages/contracts/src/admin-types.ts';

export interface JobRow {
  id: string;
  org_id: string;
  app_id: string | null;
  type: 'ingest' | 'refresh';
  status: JobDTO['status'];
  payload: string;
  steps: string;
  report: string | null;
  error: string | null;
  cancel_requested: number;
  requested_by: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export function jobDTO(row: JobRow): JobDTO {
  return {
    id: row.id,
    applicationId: row.app_id,
    type: row.type,
    status: row.status,
    steps: parseJson<JobStepDTO[]>(row.steps, []),
    report: parseJson<RefreshReport | null>(row.report, null),
    error: row.error,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export class JobsRepo {
  #db: Database;
  readonly orgId: string;
  constructor(db: Database, orgId: string) {
    this.#db = db;
    this.orgId = orgId;
  }

  enqueue(input: { appId: string | null; type: JobRow['type']; payload: Record<string, unknown>; steps: JobStepDTO[]; requestedBy: string | null }): string {
    const id = newId('job');
    this.#db.run(
      `INSERT INTO jobs (id, org_id, app_id, type, status, payload, steps, requested_by, created_at)
       VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?)`,
      [id, this.orgId, input.appId, input.type, JSON.stringify(input.payload), JSON.stringify(input.steps), input.requestedBy, now()],
    );
    return id;
  }

  get(jobId: string): JobRow | undefined {
    return this.#db.get<JobRow>('SELECT * FROM jobs WHERE id = ? AND org_id = ?', [jobId, this.orgId]);
  }

  list(appId: string | null, limit = 20): JobRow[] {
    if (appId) {
      return this.#db.all<JobRow>('SELECT * FROM jobs WHERE org_id = ? AND app_id = ? ORDER BY created_at DESC LIMIT ?', [this.orgId, appId, limit]);
    }
    return this.#db.all<JobRow>('SELECT * FROM jobs WHERE org_id = ? ORDER BY created_at DESC LIMIT ?', [this.orgId, limit]);
  }

  activeRefresh(appId: string): JobRow | undefined {
    return this.#db.get<JobRow>(
      "SELECT * FROM jobs WHERE org_id = ? AND app_id = ? AND type = 'refresh' AND status IN ('queued', 'running', 'cancelling') ORDER BY created_at DESC LIMIT 1",
      [this.orgId, appId],
    );
  }

  /** Requests cancellation. Queued jobs cancel immediately; running jobs stop at the next step boundary. */
  requestCancel(jobId: string): void {
    this.#db.transaction(() => {
      const job = this.get(jobId);
      if (!job) return;
      if (job.status === 'queued') {
        this.#db.run("UPDATE jobs SET status = 'cancelled', cancel_requested = 1, finished_at = ? WHERE id = ? AND org_id = ?", [now(), jobId, this.orgId]);
      } else if (job.status === 'running') {
        this.#db.run("UPDATE jobs SET status = 'cancelling', cancel_requested = 1 WHERE id = ? AND org_id = ?", [jobId, this.orgId]);
      }
    });
  }
}

/** Worker-side operations (not tenant-scoped; the job row carries its tenant). */
export class JobQueue {
  #db: Database;
  constructor(db: Database) {
    this.#db = db;
  }

  claimNext(): JobRow | undefined {
    return this.#db.transaction(() => {
      const job = this.#db.get<JobRow>("SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1");
      if (!job) return undefined;
      this.#db.run("UPDATE jobs SET status = 'running', started_at = ? WHERE id = ? AND status = 'queued'", [now(), job.id]);
      return { ...job, status: 'running' as const };
    });
  }

  isCancelRequested(jobId: string): boolean {
    return (this.#db.get<{ cancel_requested: number }>('SELECT cancel_requested FROM jobs WHERE id = ?', [jobId])?.cancel_requested ?? 0) === 1;
  }

  saveSteps(jobId: string, steps: JobStepDTO[]): void {
    this.#db.run('UPDATE jobs SET steps = ? WHERE id = ?', [JSON.stringify(steps), jobId]);
  }

  finish(jobId: string, status: 'succeeded' | 'failed' | 'cancelled', steps: JobStepDTO[], report: RefreshReport | null, error: string | null): void {
    this.#db.run('UPDATE jobs SET status = ?, steps = ?, report = ?, error = ?, finished_at = ? WHERE id = ?', [
      status,
      JSON.stringify(steps),
      report ? JSON.stringify(report) : null,
      error,
      now(),
      jobId,
    ]);
  }

  /** Jobs interrupted by a restart are marked failed rather than silently resumed. */
  failInterrupted(): number {
    return this.#db.run(
      "UPDATE jobs SET status = CASE WHEN status = 'cancelling' THEN 'cancelled' ELSE 'failed' END, error = COALESCE(error, 'Interrupted by a server restart. Run it again.'), finished_at = ? WHERE status IN ('running', 'cancelling')",
      [now()],
    ).changes;
  }

  hasQueued(): boolean {
    return Boolean(this.#db.get("SELECT 1 FROM jobs WHERE status = 'queued' LIMIT 1"));
  }
}
