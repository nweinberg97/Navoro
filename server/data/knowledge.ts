/**
 * Tenant-scoped data access for knowledge sources and their derived chunks and
 * structured items. Source content is the preserved original (provenance).
 */
import type { Database } from '../db/database.ts';
import { newId, now, parseJson } from '../db/database.ts';
import type { KnowledgeItemDTO, SourceDTO, SourceDetailDTO, SourceStatus, SourceType } from '../../packages/contracts/src/admin-types.ts';
import type { ChunkRow, SourceRow } from './types.ts';

export interface DerivedChunk {
  heading: string | null;
  text: string;
}

export interface DerivedItem {
  kind: KnowledgeItemDTO['kind'];
  title: string;
  body: string;
  data: Record<string, unknown>;
  excerpt: string | null;
}

export class KnowledgeRepo {
  #db: Database;
  readonly orgId: string;
  constructor(db: Database, orgId: string) {
    this.#db = db;
    this.orgId = orgId;
  }

  get(sourceId: string): SourceRow | undefined {
    return this.#db.get<SourceRow>('SELECT * FROM knowledge_sources WHERE id = ? AND org_id = ?', [sourceId, this.orgId]);
  }

  list(appId: string): SourceRow[] {
    return this.#db.all<SourceRow>('SELECT * FROM knowledge_sources WHERE app_id = ? AND org_id = ? ORDER BY created_at DESC', [appId, this.orgId]);
  }

  create(appId: string, input: { type: SourceType; title: string; reference: string | null; content: string; contentHash: string | null }): string {
    const id = newId('src');
    const timestamp = now();
    this.#db.run(
      `INSERT INTO knowledge_sources (id, org_id, app_id, type, title, reference, content, content_hash, status, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', '{}', ?, ?)`,
      [id, this.orgId, appId, input.type, input.title, input.reference, input.content, input.contentHash, timestamp, timestamp],
    );
    return id;
  }

  updateContent(sourceId: string, patch: { title?: string; content?: string; contentHash?: string | null }): void {
    const source = this.get(sourceId);
    if (!source) return;
    this.#db.run(
      `UPDATE knowledge_sources SET title = ?, content = ?, content_hash = ?, status = 'pending', error = NULL, updated_at = ?
        WHERE id = ? AND org_id = ?`,
      [
        patch.title ?? source.title,
        patch.content ?? source.content,
        patch.contentHash === undefined ? source.content_hash : patch.contentHash,
        now(),
        sourceId,
        this.orgId,
      ],
    );
  }

  setStatus(sourceId: string, status: SourceStatus, error: string | null = null): void {
    this.#db.run('UPDATE knowledge_sources SET status = ?, error = ?, updated_at = ? WHERE id = ? AND org_id = ?', [status, error, now(), sourceId, this.orgId]);
  }

  /** Stores freshly fetched/normalized content (URL, YouTube) without touching processing state. */
  setFetchedContent(sourceId: string, content: string, contentHash: string, metadata: Record<string, unknown>, title?: string): void {
    const source = this.get(sourceId);
    if (!source) return;
    const merged = { ...parseJson<Record<string, unknown>>(source.metadata, {}), ...metadata };
    this.#db.run(
      'UPDATE knowledge_sources SET content = ?, content_hash = ?, metadata = ?, title = ?, updated_at = ? WHERE id = ? AND org_id = ?',
      [content, contentHash, JSON.stringify(merged), title ?? source.title, now(), sourceId, this.orgId],
    );
  }

  mergeMetadata(sourceId: string, metadata: Record<string, unknown>): void {
    const source = this.get(sourceId);
    if (!source) return;
    const merged = { ...parseJson<Record<string, unknown>>(source.metadata, {}), ...metadata };
    this.#db.run('UPDATE knowledge_sources SET metadata = ? WHERE id = ? AND org_id = ?', [JSON.stringify(merged), sourceId, this.orgId]);
  }

  /** Atomically replaces a source's derived chunks and items and marks it processed. */
  replaceDerived(sourceId: string, chunks: DerivedChunk[], items: DerivedItem[], status: SourceStatus, error: string | null): void {
    const source = this.get(sourceId);
    if (!source) return;
    this.#db.transaction(() => {
      this.#db.run('DELETE FROM knowledge_chunks WHERE source_id = ? AND org_id = ?', [sourceId, this.orgId]);
      this.#db.run('DELETE FROM knowledge_items WHERE source_id = ? AND org_id = ?', [sourceId, this.orgId]);
      chunks.forEach((chunk, ordinal) => {
        this.#db.run('INSERT INTO knowledge_chunks (id, org_id, app_id, source_id, ordinal, heading, text) VALUES (?, ?, ?, ?, ?, ?, ?)', [
          newId('chk'),
          this.orgId,
          source.app_id,
          sourceId,
          ordinal,
          chunk.heading,
          chunk.text,
        ]);
      });
      for (const item of items) {
        this.#db.run(
          'INSERT INTO knowledge_items (id, org_id, app_id, source_id, kind, title, body, data, excerpt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [newId('ki'), this.orgId, source.app_id, sourceId, item.kind, item.title, item.body, JSON.stringify(item.data), item.excerpt],
        );
      }
      const timestamp = now();
      this.#db.run(
        `UPDATE knowledge_sources SET status = ?, error = ?, processed_hash = content_hash, processed_at = ?, updated_at = ?
          WHERE id = ? AND org_id = ?`,
        [status, error, timestamp, timestamp, sourceId, this.orgId],
      );
    });
  }

  delete(sourceId: string): void {
    this.#db.run('DELETE FROM knowledge_sources WHERE id = ? AND org_id = ?', [sourceId, this.orgId]);
  }

  /** Chunks from sources that are usable for answering (ready or needs_attention). */
  usableChunks(appId: string): ChunkRow[] {
    return this.#db.all<ChunkRow>(
      `SELECT c.id, c.source_id, c.ordinal, c.heading, c.text, s.title AS source_title
         FROM knowledge_chunks c JOIN knowledge_sources s ON s.id = c.source_id
        WHERE c.app_id = ? AND c.org_id = ? AND s.status IN ('ready', 'needs_attention')
        ORDER BY s.created_at, c.ordinal`,
      [appId, this.orgId],
    );
  }

  items(appId: string, kinds?: KnowledgeItemDTO['kind'][]): KnowledgeItemDTO[] {
    const rows = this.#db.all<{ id: string; kind: KnowledgeItemDTO['kind']; title: string; body: string; data: string; source_id: string; source_title: string }>(
      `SELECT i.id, i.kind, i.title, i.body, i.data, i.source_id, s.title AS source_title
         FROM knowledge_items i JOIN knowledge_sources s ON s.id = i.source_id
        WHERE i.app_id = ? AND i.org_id = ? AND s.status IN ('ready', 'needs_attention')
        ORDER BY i.kind, i.title`,
      [appId, this.orgId],
    );
    return rows
      .filter((row) => !kinds || kinds.includes(row.kind))
      .map((row) => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        body: row.body,
        data: parseJson<Record<string, unknown>>(row.data, {}),
        sourceId: row.source_id,
        sourceTitle: row.source_title,
      }));
  }

  stats(sourceId: string): SourceDTO['stats'] {
    const chunks = this.#db.get<{ n: number }>('SELECT COUNT(*) AS n FROM knowledge_chunks WHERE source_id = ? AND org_id = ?', [sourceId, this.orgId]);
    const items = this.#db.get<{ n: number }>('SELECT COUNT(*) AS n FROM knowledge_items WHERE source_id = ? AND org_id = ?', [sourceId, this.orgId]);
    const workflows = this.#db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM workflows WHERE source_id = ? AND org_id = ? AND status != 'archived'",
      [sourceId, this.orgId],
    );
    return { chunks: chunks?.n ?? 0, knowledgeItems: items?.n ?? 0, workflows: workflows?.n ?? 0 };
  }

  dto(row: SourceRow): SourceDTO {
    return {
      id: row.id,
      applicationId: row.app_id,
      type: row.type,
      title: row.title,
      reference: row.reference,
      status: row.status,
      error: row.error,
      contentHash: row.content_hash,
      charCount: row.content.length,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      processedAt: row.processed_at,
      stats: this.stats(row.id),
    };
  }

  detailDTO(row: SourceRow): SourceDetailDTO {
    return { ...this.dto(row), content: row.content, metadata: parseJson<Record<string, unknown>>(row.metadata, {}) };
  }
}
