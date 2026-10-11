/**
 * SQLite persistence via Node's built-in `node:sqlite` (no native addon, no server
 * to install). The schema is managed by ordered SQL migrations in ./migrations.
 *
 * The raw handle is only used by the data-access modules under server/data —
 * route handlers never touch it directly (enforced by `npm run lint`).
 */
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export type Row = Record<string, SQLInputValue>;
export type Params = Record<string, SQLInputValue | undefined> | SQLInputValue[];

export class Database {
  readonly raw: DatabaseSync;
  #statements = new Map<string, ReturnType<DatabaseSync['prepare']>>();
  #txDepth = 0;

  constructor(filePath: string) {
    if (filePath !== ':memory:') mkdirSync(path.dirname(filePath), { recursive: true });
    this.raw = new DatabaseSync(filePath);
    this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  }

  #prepare(sql: string) {
    let statement = this.#statements.get(sql);
    if (!statement) {
      statement = this.raw.prepare(sql);
      this.#statements.set(sql, statement);
    }
    return statement;
  }

  #bind(params?: Params): SQLInputValue[] | [Record<string, SQLInputValue>] {
    if (params === undefined) return [];
    if (Array.isArray(params)) return params;
    const named: Record<string, SQLInputValue> = {};
    for (const [key, value] of Object.entries(params)) named[key] = value === undefined ? null : value;
    return [named];
  }

  all<T = Row>(sql: string, params?: Params): T[] {
    return this.#prepare(sql).all(...(this.#bind(params) as SQLInputValue[])) as T[];
  }

  get<T = Row>(sql: string, params?: Params): T | undefined {
    return this.#prepare(sql).get(...(this.#bind(params) as SQLInputValue[])) as T | undefined;
  }

  run(sql: string, params?: Params): { changes: number } {
    const result = this.#prepare(sql).run(...(this.#bind(params) as SQLInputValue[]));
    return { changes: Number(result.changes) };
  }

  /** Synchronous transaction. Nested calls join the outer transaction via savepoints. */
  transaction<T>(fn: () => T): T {
    const savepoint = `sp_${this.#txDepth}`;
    this.raw.exec(this.#txDepth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${savepoint}`);
    this.#txDepth += 1;
    try {
      const result = fn();
      this.#txDepth -= 1;
      this.raw.exec(this.#txDepth === 0 ? 'COMMIT' : `RELEASE ${savepoint}`);
      return result;
    } catch (error) {
      this.#txDepth -= 1;
      this.raw.exec(this.#txDepth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
      throw error;
    }
  }

  migrate(): string[] {
    this.raw.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
    const applied = new Set(this.all<{ name: string }>('SELECT name FROM schema_migrations').map((row) => row.name));
    const files = readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith('.sql')).sort();
    const newlyApplied: string[] = [];
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      this.transaction(() => {
        this.raw.exec(sql);
        this.run('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)', [file, now()]);
      });
      newlyApplied.push(file);
    }
    return newlyApplied;
  }

  close(): void {
    this.#statements.clear();
    this.raw.close();
  }
}

export function now(): string {
  return new Date().toISOString();
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value === '') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
