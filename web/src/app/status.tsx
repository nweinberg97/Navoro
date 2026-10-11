/** Mapping from contract enums to labeled, colored status pills. */
import type {
  JobStatus,
  MappingValidation,
  SourceStatus,
  SourceType,
  WorkflowKind,
  WorkflowStatus,
} from '../../../packages/contracts/src/admin-types.ts';
import { StatusPill, type Tone } from '../ui/index.ts';

const SOURCE: Record<SourceStatus, { label: string; tone: Tone; pulse?: boolean }> = {
  pending: { label: 'Pending', tone: 'neutral' },
  processing: { label: 'Processing', tone: 'progress', pulse: true },
  ready: { label: 'Ready', tone: 'success' },
  needs_attention: { label: 'Needs attention', tone: 'warning' },
  failed: { label: 'Failed', tone: 'danger' },
};
export function SourceStatusPill({ status }: { status: SourceStatus }) {
  const s = SOURCE[status];
  return (
    <StatusPill tone={s.tone} pulse={s.pulse}>
      {s.label}
    </StatusPill>
  );
}

export const SOURCE_TYPE_LABEL: Record<SourceType, string> = {
  manual: 'Written',
  text: 'Pasted',
  file: 'File',
  url: 'Web page',
  youtube: 'YouTube',
};

const WORKFLOW: Record<WorkflowStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  published: { label: 'Published', tone: 'success' },
  needs_review: { label: 'Needs review', tone: 'warning' },
  archived: { label: 'Archived', tone: 'neutral' },
};
export function WorkflowStatusPill({ status }: { status: WorkflowStatus }) {
  const s = WORKFLOW[status];
  return <StatusPill tone={s.tone}>{s.label}</StatusPill>;
}
export const WORKFLOW_KIND_LABEL: Record<WorkflowKind, string> = {
  task: 'Task',
  onboarding: 'Onboarding',
  troubleshooting: 'Troubleshooting',
};

const VALIDATION: Record<MappingValidation, { label: string; tone: Tone }> = {
  valid: { label: 'Valid', tone: 'success' },
  unverified: { label: 'Unverified', tone: 'neutral' },
  uncertain: { label: 'Uncertain', tone: 'warning' },
  broken: { label: 'Broken', tone: 'danger' },
};
export function ValidationPill({ validation }: { validation: MappingValidation }) {
  const s = VALIDATION[validation];
  return <StatusPill tone={s.tone}>{s.label}</StatusPill>;
}

const JOB: Record<JobStatus, { label: string; tone: Tone; pulse?: boolean }> = {
  queued: { label: 'Queued', tone: 'neutral' },
  running: { label: 'Running', tone: 'progress', pulse: true },
  cancelling: { label: 'Cancelling', tone: 'warning', pulse: true },
  succeeded: { label: 'Succeeded', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};
export function JobStatusPill({ status }: { status: JobStatus }) {
  const s = JOB[status];
  return (
    <StatusPill tone={s.tone} pulse={s.pulse}>
      {s.label}
    </StatusPill>
  );
}
export function isJobActive(status: JobStatus): boolean {
  return status === 'queued' || status === 'running' || status === 'cancelling';
}

export const PROVENANCE_LABEL = {
  developer_id: 'Developer ID',
  extracted: 'Extracted',
  admin: 'Admin',
} as const;
