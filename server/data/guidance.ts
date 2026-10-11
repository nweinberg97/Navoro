/**
 * Tenant-scoped data access for workflows, workflow steps and element mappings.
 */
import type { Database } from '../db/database.ts';
import { newId, now, parseJson } from '../db/database.ts';
import type {
  MappingDTO,
  WorkflowDTO,
  WorkflowDetailDTO,
  WorkflowKind,
  WorkflowStatus,
} from '../../packages/contracts/src/admin-types.ts';
import type { MatchStrategy } from '../../packages/contracts/src/sdk-types.ts';
import type { MappingRow, StepRow, WorkflowRow } from './types.ts';

export interface ExtractedStep {
  title: string;
  instruction: string;
  targetKey: string | null;
  excerpt: string | null;
}

export interface ExtractedWorkflow {
  key: string;
  title: string;
  summary: string;
  kind: WorkflowKind;
  prerequisites: string[];
  steps: ExtractedStep[];
  confidence: number;
  /** Hash of the extracted content, used to detect real changes on reprocessing. */
  contentHash: string;
}

export type UpsertOutcome = 'added' | 'updated' | 'unchanged' | 'needs_review';

export class GuidanceRepo {
  #db: Database;
  readonly orgId: string;
  constructor(db: Database, orgId: string) {
    this.#db = db;
    this.orgId = orgId;
  }

  // ── Workflows ─────────────────────────────────────────────────────────────

  workflow(workflowId: string): WorkflowRow | undefined {
    return this.#db.get<WorkflowRow>('SELECT * FROM workflows WHERE id = ? AND org_id = ?', [workflowId, this.orgId]);
  }

  workflows(appId: string): WorkflowRow[] {
    return this.#db.all<WorkflowRow>(
      `SELECT * FROM workflows WHERE app_id = ? AND org_id = ?
        ORDER BY CASE status WHEN 'needs_review' THEN 0 WHEN 'draft' THEN 1 WHEN 'published' THEN 2 ELSE 3 END, title`,
      [appId, this.orgId],
    );
  }

  workflowsBySource(sourceId: string): WorkflowRow[] {
    return this.#db.all<WorkflowRow>('SELECT * FROM workflows WHERE source_id = ? AND org_id = ?', [sourceId, this.orgId]);
  }

  steps(workflowId: string): StepRow[] {
    return this.#db.all<StepRow>('SELECT * FROM workflow_steps WHERE workflow_id = ? AND org_id = ? ORDER BY ordinal', [workflowId, this.orgId]);
  }

  step(workflowId: string, stepId: string): StepRow | undefined {
    return this.#db.get<StepRow>('SELECT * FROM workflow_steps WHERE id = ? AND workflow_id = ? AND org_id = ?', [stepId, workflowId, this.orgId]);
  }

  #insertSteps(workflowId: string, steps: ExtractedStep[]): void {
    steps.forEach((step, ordinal) => {
      this.#db.run(
        `INSERT INTO workflow_steps (id, org_id, workflow_id, ordinal, title, instruction, target_key, source_excerpt, edited)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        [newId('stp'), this.orgId, workflowId, ordinal, step.title, step.instruction, step.targetKey, step.excerpt],
      );
    });
  }

  /**
   * Applies an extracted workflow without clobbering admin edits:
   *  - new key → inserted as draft
   *  - unchanged content → untouched
   *  - changed content, not edited → replaced; published workflows move to needs_review
   *  - changed content, admin-edited → kept as-is and flagged needs_review
   */
  upsertExtracted(appId: string, sourceId: string, extracted: ExtractedWorkflow): { id: string; outcome: UpsertOutcome } {
    return this.#db.transaction(() => {
      const existing = this.#db.get<WorkflowRow>('SELECT * FROM workflows WHERE app_id = ? AND org_id = ? AND key = ?', [appId, this.orgId, extracted.key]);
      const timestamp = now();
      if (!existing) {
        const id = newId('wf');
        this.#db.run(
          `INSERT INTO workflows (id, org_id, app_id, source_id, key, title, summary, kind, status, confidence, origin, edited, prerequisites, source_hash, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, 'extracted', 0, ?, ?, ?, ?)`,
          [id, this.orgId, appId, sourceId, extracted.key, extracted.title, extracted.summary, extracted.kind, extracted.confidence,
            JSON.stringify(extracted.prerequisites), extracted.contentHash, timestamp, timestamp],
        );
        this.#insertSteps(id, extracted.steps);
        return { id, outcome: 'added' };
      }
      if (existing.source_hash === extracted.contentHash && existing.status !== 'archived') {
        return { id: existing.id, outcome: 'unchanged' };
      }
      if (existing.edited === 1) {
        this.#db.run("UPDATE workflows SET status = 'needs_review', source_hash = ?, updated_at = ? WHERE id = ? AND org_id = ?", [
          extracted.contentHash,
          timestamp,
          existing.id,
          this.orgId,
        ]);
        return { id: existing.id, outcome: 'needs_review' };
      }
      const nextStatus: WorkflowStatus = existing.status === 'published' || existing.status === 'needs_review' ? 'needs_review' : 'draft';
      this.#db.run(
        `UPDATE workflows SET source_id = ?, title = ?, summary = ?, kind = ?, status = ?, confidence = ?, prerequisites = ?, source_hash = ?, updated_at = ?
          WHERE id = ? AND org_id = ?`,
        [sourceId, extracted.title, extracted.summary, extracted.kind, nextStatus, extracted.confidence, JSON.stringify(extracted.prerequisites),
          extracted.contentHash, timestamp, existing.id, this.orgId],
      );
      this.#db.run('DELETE FROM workflow_steps WHERE workflow_id = ? AND org_id = ?', [existing.id, this.orgId]);
      this.#insertSteps(existing.id, extracted.steps);
      return { id: existing.id, outcome: nextStatus === 'needs_review' ? 'needs_review' : 'updated' };
    });
  }

  /** Archives extracted, unedited workflows of a source whose keys are no longer present. */
  archiveMissing(sourceId: string, keepKeys: Set<string>): string[] {
    const removed: string[] = [];
    for (const workflow of this.workflowsBySource(sourceId)) {
      if (keepKeys.has(workflow.key) || workflow.status === 'archived') continue;
      if (workflow.edited === 1) {
        this.#db.run("UPDATE workflows SET status = 'needs_review', updated_at = ? WHERE id = ? AND org_id = ?", [now(), workflow.id, this.orgId]);
        continue;
      }
      this.#db.run("UPDATE workflows SET status = 'archived', updated_at = ? WHERE id = ? AND org_id = ?", [now(), workflow.id, this.orgId]);
      removed.push(workflow.title);
    }
    return removed;
  }

  updateWorkflow(workflowId: string, patch: { title?: string; summary?: string; kind?: WorkflowKind; status?: WorkflowStatus }): void {
    const workflow = this.workflow(workflowId);
    if (!workflow) return;
    const contentEdited = patch.title !== undefined || patch.summary !== undefined || patch.kind !== undefined;
    this.#db.run(
      'UPDATE workflows SET title = ?, summary = ?, kind = ?, status = ?, edited = ?, updated_at = ? WHERE id = ? AND org_id = ?',
      [
        patch.title ?? workflow.title,
        patch.summary ?? workflow.summary,
        patch.kind ?? workflow.kind,
        patch.status ?? workflow.status,
        contentEdited ? 1 : workflow.edited,
        now(),
        workflowId,
        this.orgId,
      ],
    );
  }

  setWorkflowStatus(workflowId: string, status: WorkflowStatus): void {
    this.#db.run('UPDATE workflows SET status = ?, updated_at = ? WHERE id = ? AND org_id = ?', [status, now(), workflowId, this.orgId]);
  }

  updateStep(workflowId: string, stepId: string, patch: { title?: string; instruction?: string; targetKey?: string | null }): void {
    const step = this.step(workflowId, stepId);
    if (!step) return;
    this.#db.transaction(() => {
      this.#db.run('UPDATE workflow_steps SET title = ?, instruction = ?, target_key = ?, edited = 1 WHERE id = ? AND org_id = ?', [
        patch.title ?? step.title,
        patch.instruction ?? step.instruction,
        patch.targetKey === undefined ? step.target_key : patch.targetKey,
        stepId,
        this.orgId,
      ]);
      this.#db.run('UPDATE workflows SET edited = 1, updated_at = ? WHERE id = ? AND org_id = ?', [now(), workflowId, this.orgId]);
    });
  }

  workflowDTO(row: WorkflowRow): WorkflowDTO {
    const steps = this.steps(row.id);
    const mappings = new Map(this.mappings(row.app_id).map((mapping) => [mapping.key, mapping]));
    const brokenTargets = steps.filter((step) => step.target_key && mappings.get(step.target_key)?.validation === 'broken').length;
    const source = row.source_id
      ? this.#db.get<{ title: string }>('SELECT title FROM knowledge_sources WHERE id = ? AND org_id = ?', [row.source_id, this.orgId])
      : undefined;
    return {
      id: row.id,
      applicationId: row.app_id,
      key: row.key,
      title: row.title,
      summary: row.summary,
      kind: row.kind,
      status: row.status,
      confidence: row.confidence,
      origin: row.origin,
      edited: row.edited === 1,
      stepCount: steps.length,
      brokenTargets,
      sourceId: row.source_id,
      sourceTitle: source?.title ?? null,
      updatedAt: row.updated_at,
    };
  }

  workflowDetailDTO(row: WorkflowRow): WorkflowDetailDTO {
    const mappings = new Map(this.mappings(row.app_id).map((mapping) => [mapping.key, mapping]));
    return {
      ...this.workflowDTO(row),
      prerequisites: parseJson<string[]>(row.prerequisites, []),
      steps: this.steps(row.id).map((step) => {
        const mapping = step.target_key ? mappings.get(step.target_key) : undefined;
        return {
          id: step.id,
          index: step.ordinal,
          title: step.title,
          instruction: step.instruction,
          targetKey: step.target_key,
          target: mapping ? this.mappingDTO(mapping) : null,
          sourceExcerpt: step.source_excerpt,
          edited: step.edited === 1,
        };
      }),
    };
  }

  // ── Element mappings ──────────────────────────────────────────────────────

  mappings(appId: string): MappingRow[] {
    return this.#db.all<MappingRow>('SELECT * FROM element_mappings WHERE app_id = ? AND org_id = ? ORDER BY key', [appId, this.orgId]);
  }

  mapping(appId: string, key: string): MappingRow | undefined {
    return this.#db.get<MappingRow>('SELECT * FROM element_mappings WHERE app_id = ? AND org_id = ? AND key = ?', [appId, this.orgId, key]);
  }

  /** Inserts or updates a mapping. Extracted mappings never overwrite admin-authored ones. */
  upsertMapping(
    appId: string,
    input: { key: string; label: string; strategies: MatchStrategy[]; provenance: MappingRow['provenance']; confidence: number; validation: MappingRow['validation']; detail: string | null },
  ): 'inserted' | 'updated' | 'kept_admin' {
    const existing = this.mapping(appId, input.key);
    const timestamp = now();
    if (!existing) {
      this.#db.run(
        `INSERT INTO element_mappings (id, org_id, app_id, key, label, strategies, provenance, confidence, validation, validation_detail, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [newId('map'), this.orgId, appId, input.key, input.label, JSON.stringify(input.strategies), input.provenance, input.confidence, input.validation, input.detail, timestamp],
      );
      return 'inserted';
    }
    if (existing.provenance === 'admin' && input.provenance !== 'admin') return 'kept_admin';
    this.#db.run(
      `UPDATE element_mappings SET label = ?, strategies = ?, provenance = ?, confidence = ?, validation = ?, validation_detail = ?, updated_at = ?
        WHERE id = ? AND org_id = ?`,
      [input.label, JSON.stringify(input.strategies), input.provenance, input.confidence, input.validation, input.detail, timestamp, existing.id, this.orgId],
    );
    return 'updated';
  }

  setMappingValidation(mappingId: string, validation: MappingRow['validation'], detail: string | null, confidence?: number): void {
    this.#db.run(
      'UPDATE element_mappings SET validation = ?, validation_detail = ?, confidence = COALESCE(?, confidence), updated_at = ? WHERE id = ? AND org_id = ?',
      [validation, detail, confidence ?? null, now(), mappingId, this.orgId],
    );
  }

  mappingDTO(row: MappingRow): MappingDTO {
    return {
      id: row.id,
      key: row.key,
      label: row.label,
      strategies: parseJson<MappingDTO['strategies']>(row.strategies, []),
      provenance: row.provenance,
      confidence: row.confidence,
      validation: row.validation,
      validationDetail: row.validation_detail,
      updatedAt: row.updated_at,
    };
  }
}
