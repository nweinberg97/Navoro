import { useEffect, useState } from 'react';
import type { MappingDTO, WorkflowDetailDTO, WorkflowKind, WorkflowStatus, WorkflowStepDTO } from '../../../../packages/contracts/src/admin-types.ts';
import { api, errorMessage } from '../api.ts';
import { useDocumentTitle, useResource } from '../hooks.ts';
import { Link, paths } from '../router.tsx';
import { useCanEdit } from '../session.tsx';
import { formatDateTime } from '../format.ts';
import { ValidationPill, WORKFLOW_KIND_LABEL, WorkflowStatusPill } from '../status.tsx';
import { MappingDialog } from './Guidance.tsx';
import { ReadOnlyBanner } from './common.tsx';
import {
  Badge,
  Button,
  Card,
  ConfidenceMeter,
  ErrorState,
  Field,
  Input,
  KeyValue,
  Notice,
  PageHeader,
  PageSkeleton,
  Select,
  Textarea,
  useToast,
} from '../../ui/index.ts';
import { IconArrowLeft, IconPen, IconTarget, IconWarning } from '../icons.tsx';

const STATUS_ACTIONS: Record<WorkflowStatus, Array<{ to: WorkflowStatus; label: string; primary?: boolean }>> = {
  draft: [
    { to: 'published', label: 'Publish', primary: true },
    { to: 'archived', label: 'Archive' },
  ],
  needs_review: [
    { to: 'published', label: 'Approve & publish', primary: true },
    { to: 'draft', label: 'Move to drafts' },
    { to: 'archived', label: 'Archive' },
  ],
  published: [
    { to: 'draft', label: 'Unpublish' },
    { to: 'archived', label: 'Archive' },
  ],
  archived: [{ to: 'draft', label: 'Restore to drafts', primary: true }],
};

/* ───────────── Step editor ───────────── */

function StepRow({
  step,
  workflowId,
  mappings,
  canEdit,
  onUpdated,
  onFixMapping,
}: {
  step: WorkflowStepDTO;
  workflowId: string;
  mappings: MappingDTO[];
  canEdit: boolean;
  onUpdated: (w: WorkflowDetailDTO) => void;
  onFixMapping: (m: MappingDTO) => void;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(step.title);
  const [instruction, setInstruction] = useState(step.instruction);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [targetSaving, setTargetSaving] = useState(false);

  useEffect(() => {
    if (!editing) {
      setTitle(step.title);
      setInstruction(step.instruction);
    }
  }, [step, editing]);

  const save = async () => {
    if (!title.trim()) {
      setTitleError('A step needs a title.');
      return;
    }
    setSaving(true);
    try {
      onUpdated(await api.updateStep(workflowId, step.id, { title: title.trim(), instruction: instruction.trim() }));
      setEditing(false);
      setTitleError(null);
      toast.success(`Step ${step.index + 1} saved`);
    } catch (err) {
      toast.error('Couldn’t save step', errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const changeTarget = async (key: string) => {
    setTargetSaving(true);
    try {
      onUpdated(await api.updateStep(workflowId, step.id, { targetKey: key || null }));
      toast.success('Target updated', key ? `Step ${step.index + 1} now points at ${key}.` : `Step ${step.index + 1} has no on-screen target.`);
    } catch (err) {
      toast.error('Couldn’t change target', errorMessage(err));
    } finally {
      setTargetSaving(false);
    }
  };

  const target = step.target;
  const selectId = `target-${step.id}`;
  return (
    <li className={['wf-step', target?.validation === 'broken' ? 'wf-step--broken' : ''].join(' ')}>
      <span className="wf-step__num" aria-hidden="true">
        {step.index + 1}
      </span>
      <div className="wf-step__main">
        {editing ? (
          <div className="form-stack">
            <Field label={`Step ${step.index + 1} title`} error={titleError}>
              {(ids) => <Input {...ids} value={title} onChange={(e) => setTitle(e.target.value)} data-autofocus="" autoFocus />}
            </Field>
            <Field label="Instruction">
              {(ids) => <Textarea {...ids} rows={3} value={instruction} onChange={(e) => setInstruction(e.target.value)} />}
            </Field>
            <div className="form-actions">
              <Button size="sm" onClick={() => setEditing(false)} disabled={saving}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" onClick={save} loading={saving}>
                Save step
              </Button>
            </div>
          </div>
        ) : (
          <div className="wf-step__text">
            <h3 className="wf-step__title">
              <span className="n-visually-hidden">Step {step.index + 1}: </span>
              {step.title}
              {step.edited ? <Badge>Edited</Badge> : null}
            </h3>
            <p className="wf-step__instr">{step.instruction}</p>
            {canEdit ? (
              <button type="button" className="wf-step__edit" onClick={() => setEditing(true)} aria-label={`Edit step ${step.index + 1}`}>
                <IconPen size={14} /> Edit
              </button>
            ) : null}
          </div>
        )}

        <div className="wf-step__target">
          <label htmlFor={selectId} className="wf-step__target-label">
            <IconTarget size={14} /> Target
          </label>
          <Select
            id={selectId}
            className="n-select--inline wf-step__select"
            value={step.targetKey ?? ''}
            disabled={!canEdit || targetSaving}
            onChange={(e) => void changeTarget(e.target.value)}
          >
            <option value="">No on-screen target</option>
            {mappings.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label} ({m.key})
              </option>
            ))}
            {step.targetKey && !mappings.some((m) => m.key === step.targetKey) ? <option value={step.targetKey}>{step.targetKey}</option> : null}
          </Select>
          {target ? <ValidationPill validation={target.validation} /> : null}
          {target && target.validation === 'broken' && canEdit ? (
            <Button size="sm" variant="ghost" onClick={() => onFixMapping(target)}>
              Fix mapping
            </Button>
          ) : null}
        </div>
        {target?.validationDetail && target.validation !== 'valid' ? (
          <p className={`wf-step__vdetail wf-step__vdetail--${target.validation}`}>
            <IconWarning size={12} /> {target.validationDetail}
          </p>
        ) : null}
        {step.sourceExcerpt ? (
          <details className="wf-step__excerpt">
            <summary>Source excerpt</summary>
            <blockquote>{step.sourceExcerpt}</blockquote>
          </details>
        ) : null}
      </div>
    </li>
  );
}

/* ───────────── Page ───────────── */

export function WorkflowDetailPage({ id }: { id: string }) {
  const toast = useToast();
  const canEdit = useCanEdit();
  const res = useResource((s) => api.workflow(id, s), [id]);
  const appId = res.data?.applicationId ?? null;
  const mappings = useResource((s) => api.mappings(appId!, s), [appId], appId != null);
  useDocumentTitle(res.data?.title ?? 'Workflow');

  const [editingMeta, setEditingMeta] = useState(false);
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [kind, setKind] = useState<WorkflowKind>('task');
  const [titleError, setTitleError] = useState<string | null>(null);
  const [savingMeta, setSavingMeta] = useState(false);
  const [statusBusy, setStatusBusy] = useState<WorkflowStatus | null>(null);
  const [fixing, setFixing] = useState<MappingDTO | null>(null);

  useEffect(() => {
    if (res.data && !editingMeta) {
      setTitle(res.data.title);
      setSummary(res.data.summary);
      setKind(res.data.kind);
    }
  }, [res.data, editingMeta]);

  const back = (
    <Link href={paths.guidance()}>
      <IconArrowLeft size={14} /> Guidance
    </Link>
  );
  if (res.loading && !res.data) return <PageSkeleton />;
  if (res.error && !res.data)
    return (
      <>
        <PageHeader title="Workflow" back={back} />
        <ErrorState message={res.error} onRetry={res.reload} />
      </>
    );
  const wf = res.data!;

  const saveMeta = async () => {
    if (!title.trim()) {
      setTitleError('Title is required.');
      return;
    }
    setSavingMeta(true);
    try {
      res.setData(await api.updateWorkflow(wf.id, { title: title.trim(), summary: summary.trim(), kind }));
      setEditingMeta(false);
      setTitleError(null);
      toast.success('Workflow saved');
    } catch (err) {
      toast.error('Couldn’t save workflow', errorMessage(err));
    } finally {
      setSavingMeta(false);
    }
  };

  const setStatus = async (to: WorkflowStatus) => {
    setStatusBusy(to);
    try {
      res.setData(await api.updateWorkflow(wf.id, { status: to }));
      toast.success(
        to === 'published' ? 'Workflow published' : to === 'archived' ? 'Workflow archived' : 'Moved to drafts',
        to === 'published' ? 'Publish a configuration version for end users to see it.' : undefined,
      );
    } catch (err) {
      toast.error('Couldn’t change status', errorMessage(err));
    } finally {
      setStatusBusy(null);
    }
  };

  const brokenSteps = wf.steps.filter((s) => s.target?.validation === 'broken' || (s.targetKey && !s.target)).length;

  return (
    <>
      <PageHeader
        back={back}
        eyebrow={WORKFLOW_KIND_LABEL[wf.kind]}
        title={wf.title}
        description={
          <span className="app-head-meta">
            <WorkflowStatusPill status={wf.status} />
            <ConfidenceMeter value={wf.confidence} />
            <span>{wf.origin === 'extracted' ? 'Extracted' : 'Manual'}</span>
            {wf.edited ? <Badge>Edited</Badge> : null}
          </span>
        }
        actions={
          canEdit
            ? STATUS_ACTIONS[wf.status].map((a) => (
                <Button
                  key={a.to}
                  variant={a.primary ? 'primary' : 'secondary'}
                  onClick={() => void setStatus(a.to)}
                  loading={statusBusy === a.to}
                  disabled={statusBusy != null && statusBusy !== a.to}
                >
                  {a.label}
                </Button>
              ))
            : null
        }
      />
      {!canEdit ? <ReadOnlyBanner /> : null}

      <div className="detail-grid">
        <div className="stack-lg">
          {wf.status === 'needs_review' ? (
            <Notice tone="warning" title="Needs review">
              The source changed or a target couldn’t be validated. Check the steps below, then approve.
            </Notice>
          ) : null}
          {brokenSteps > 0 ? (
            <Notice tone="danger" title={`${brokenSteps} step${brokenSteps === 1 ? '' : 's'} can’t be highlighted`}>
              Pick a different target or fix the mapping. The rest of the workflow still works — those steps show text only.
            </Notice>
          ) : null}

          <Card
            title="About this workflow"
            actions={
              canEdit && !editingMeta ? (
                <Button size="sm" variant="ghost" icon={<IconPen size={14} />} onClick={() => setEditingMeta(true)}>
                  Edit
                </Button>
              ) : null
            }
          >
            {editingMeta ? (
              <div className="form-stack">
                <Field label="Title" error={titleError}>
                  {(ids) => <Input {...ids} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />}
                </Field>
                <Field label="Summary">
                  {(ids) => <Textarea {...ids} rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} />}
                </Field>
                <Field label="Kind">
                  {(ids) => (
                    <Select {...ids} value={kind} onChange={(e) => setKind(e.target.value as WorkflowKind)}>
                      {(Object.keys(WORKFLOW_KIND_LABEL) as WorkflowKind[]).map((k) => (
                        <option key={k} value={k}>
                          {WORKFLOW_KIND_LABEL[k]}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <div className="form-actions">
                  <Button onClick={() => setEditingMeta(false)} disabled={savingMeta}>
                    Cancel
                  </Button>
                  <Button variant="primary" onClick={saveMeta} loading={savingMeta}>
                    Save
                  </Button>
                </div>
              </div>
            ) : (
              <div className="stack-sm">
                <p className="wf-summary">{wf.summary || <span className="muted">No summary.</span>}</p>
                {wf.prerequisites.length > 0 ? (
                  <div>
                    <p className="label-sm">Before you start</p>
                    <ul className="prereqs">
                      {wf.prerequisites.map((p, i) => (
                        <li key={i}>{p}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            )}
          </Card>

          <section aria-labelledby="steps-title" className="stack-sm">
            <h2 id="steps-title" className="section-h">
              Steps <span className="muted">{wf.steps.length}</span>
            </h2>
            {mappings.error ? <ErrorState title="Couldn’t load targets" message={mappings.error} onRetry={mappings.reload} /> : null}
            {wf.steps.length === 0 ? (
              <div className="n-card">
                <p className="card-empty">This workflow has no steps.</p>
              </div>
            ) : (
              <ol className="wf-steps">
                {[...wf.steps]
                  .sort((a, b) => a.index - b.index)
                  .map((s) => (
                    <StepRow
                      key={s.id}
                      step={s}
                      workflowId={wf.id}
                      mappings={mappings.data?.mappings ?? []}
                      canEdit={canEdit}
                      onUpdated={(w) => res.setData(w)}
                      onFixMapping={setFixing}
                    />
                  ))}
              </ol>
            )}
          </section>
        </div>

        <aside className="stack-lg" aria-label="Workflow details">
          <Card title="Details">
            <KeyValue
              items={[
                { label: 'Key', value: <code className="hash">{wf.key}</code> },
                { label: 'Kind', value: WORKFLOW_KIND_LABEL[wf.kind] },
                { label: 'Origin', value: wf.origin === 'extracted' ? 'Extracted from knowledge' : 'Created manually' },
                {
                  label: 'Source',
                  value: wf.sourceId ? <Link href={paths.source(wf.sourceId)}>{wf.sourceTitle ?? 'View source'}</Link> : '—',
                },
                { label: 'Updated', value: formatDateTime(wf.updatedAt) },
              ]}
            />
          </Card>
          <Card title="Visibility">
            <p className="small muted">
              {wf.status === 'published'
                ? 'Included in the next configuration you publish. End users see it once that version is live.'
                : 'Not visible to end users. Drafts and needs-review workflows only appear in Preview.'}
            </p>
          </Card>
        </aside>
      </div>

      {appId ? (
        <MappingDialog
          appId={appId}
          mapping={fixing}
          onClose={() => setFixing(null)}
          onSaved={() => {
            res.reload();
            mappings.reload();
          }}
        />
      ) : null}
    </>
  );
}
