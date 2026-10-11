/**
 * In-process durable job worker. Jobs persist in SQLite; the worker claims one
 * queued job at a time, records each step's progress, honours cancellation at
 * step boundaries, and marks interrupted jobs failed on restart.
 *
 * This is deliberately simple infrastructure for a single-node deployment. A
 * multi-node deployment would move claiming to SELECT … FOR UPDATE SKIP LOCKED
 * on Postgres or a queue service; handlers would not change.
 */
import type { Database } from '../db/database.ts';
import { JobQueue, type JobRow } from '../data/jobs.ts';
import type { JobStepDTO, RefreshReport } from '../../packages/contracts/src/admin-types.ts';
import { log } from '../lib/log.ts';

export class JobCancelled extends Error {}

export interface JobContext {
  job: JobRow;
  /** Runs one named step, persisting running/done/failed and checking cancellation first. */
  step<T>(key: string, fn: (setDetail: (detail: string) => void) => Promise<T> | T): Promise<T>;
  skip(key: string, detail: string): void;
  checkCancelled(): void;
  report: RefreshReport | null;
}

export type JobHandler = (ctx: JobContext) => Promise<void>;

export class JobRunner {
  #queue: JobQueue;
  #handlers = new Map<JobRow['type'], JobHandler>();
  #timer: NodeJS.Timeout | null = null;
  #busy = false;
  #idleWaiters: Array<() => void> = [];

  constructor(db: Database) {
    this.#queue = new JobQueue(db);
  }

  register(type: JobRow['type'], handler: JobHandler): void {
    this.#handlers.set(type, handler);
  }

  start(intervalMs = 250): void {
    const interrupted = this.#queue.failInterrupted();
    if (interrupted) log('warn', 'jobs.interrupted', { count: interrupted });
    this.#timer = setInterval(() => void this.tick(), intervalMs);
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  /** Nudges the worker (called right after enqueueing so jobs start immediately). */
  kick(): void {
    setImmediate(() => void this.tick());
  }

  /** Resolves when no job is queued or running (used by tests and the seed script). */
  async drain(): Promise<void> {
    while (this.#busy || this.#queue.hasQueued()) {
      if (!this.#busy) await this.tick();
      else await new Promise<void>((resolve) => this.#idleWaiters.push(resolve));
    }
  }

  async tick(): Promise<void> {
    if (this.#busy) return;
    const job = this.#queue.claimNext();
    if (!job) return;
    this.#busy = true;
    try {
      await this.#run(job);
    } finally {
      this.#busy = false;
      const waiters = this.#idleWaiters.splice(0);
      for (const resolve of waiters) resolve();
    }
  }

  async #run(job: JobRow): Promise<void> {
    const handler = this.#handlers.get(job.type);
    const steps = JSON.parse(job.steps) as JobStepDTO[];
    const queue = this.#queue;
    const save = () => queue.saveSteps(job.id, steps);
    const findStep = (key: string): JobStepDTO => {
      let step = steps.find((entry) => entry.key === key);
      if (!step) {
        step = { key, label: key, status: 'pending', detail: null };
        steps.push(step);
      }
      return step;
    };
    const ctx: JobContext = {
      job,
      report: null,
      checkCancelled() {
        if (queue.isCancelRequested(job.id)) throw new JobCancelled();
      },
      async step(key, fn) {
        ctx.checkCancelled();
        const step = findStep(key);
        step.status = 'running';
        save();
        try {
          const result = await fn((detail) => {
            step.detail = detail;
            save();
          });
          step.status = 'done';
          save();
          return result;
        } catch (error) {
          step.status = error instanceof JobCancelled ? 'skipped' : 'failed';
          if (!(error instanceof JobCancelled)) step.detail = step.detail ?? (error as Error).message;
          save();
          throw error;
        }
      },
      skip(key, detail) {
        const step = findStep(key);
        step.status = 'skipped';
        step.detail = detail;
        save();
      },
    };
    const started = Date.now();
    try {
      if (!handler) throw new Error(`No handler for job type ${job.type}`);
      await handler(ctx);
      queue.finish(job.id, 'succeeded', steps, ctx.report, null);
      log('info', 'job.succeeded', { jobId: job.id, type: job.type, ms: Date.now() - started });
    } catch (error) {
      for (const step of steps) if (step.status === 'pending' || step.status === 'running') step.status = 'skipped';
      if (error instanceof JobCancelled) {
        queue.finish(job.id, 'cancelled', steps, ctx.report, null);
        log('info', 'job.cancelled', { jobId: job.id, type: job.type });
      } else {
        queue.finish(job.id, 'failed', steps, ctx.report, (error as Error).message || 'Job failed');
        log('error', 'job.failed', { jobId: job.id, type: job.type, error: (error as Error).message });
      }
    }
  }
}
