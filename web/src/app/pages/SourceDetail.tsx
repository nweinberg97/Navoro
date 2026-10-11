import { useEffect, useState } from 'react';
import type { KnowledgeItemDTO, WorkflowDTO } from '../../../../packages/contracts/src/admin-types.ts';
import { api, errorMessage } from '../api.ts';
import { useDocumentTitle, usePolling, useResource } from '../hooks.ts';
import { Link, paths, useRouter } from '../router.tsx';
import { useCanEdit } from '../session.tsx';
import { formatDateTime, formatNumber } from '../format.ts';
import { SOURCE_TYPE_LABEL, SourceStatusPill, WorkflowStatusPill } from '../status.tsx';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  ErrorState,
  Field,
  Input,
  KeyValue,
  Notice,
  PageHeader,
  PageSkeleton,
  Textarea,
  useToast,
} from '../../ui/index.ts';
import { IconArrowLeft, IconExternal } from '../icons.tsx';

const KIND_LABEL: Record<KnowledgeItemDTO['kind'], string> = {
  feature: 'Feature',
  ui_concept: 'UI concept',
  known_error: 'Known error',
  troubleshooting: 'Troubleshooting',
};

function metaValue(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return '—';
  }
}

export function SourceDetailPage({ id }: { id: string }) {
  const toast = useToast();
  const canEdit = useCanEdit();
  const { navigate } = useRouter();
  const res = useResource((s) => api.source(id, s), [id]);
  const appId = res.data?.applicationId ?? null;
  const extracted = useResource(
    async (s) => {
      const [w, k] = await Promise.all([api.workflows(appId!, s), api.knowledge(appId!, s)]);
      return { workflows: w.workflows.filter((x) => x.sourceId === id), items: k.items.filter((x) => x.sourceId === id) };
    },
    [appId, id, res.data?.processedAt],
    appId != null,
  );
  useDocumentTitle(res.data?.title ?? 'Source');

  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [errors, setErrors] = useState<{ title?: string; content?: string }>({});
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (res.data && !editing) {
      setTitle(res.data.title);
      setContent(res.data.content);
    }
  }, [res.data, editing]);

  const processing = res.data?.status === 'pending' || res.data?.status === 'processing';
  usePolling(
    async (signal) => {
      const next = await api.source(id, signal);
      if (!signal.aborted) res.setData(next);
    },
    1500,
    processing && !editing,
  );

  const back = (
    <Link href={paths.knowledge()}>
      <IconArrowLeft size={14} /> Knowledge
    </Link>
  );

  if (res.loading && !res.data) return <PageSkeleton />;
  if (res.error && !res.data)
    return (
      <>
        <PageHeader title="Source" back={back} />
        <ErrorState message={res.error} onRetry={res.reload} />
      </>
    );
  const src = res.data!;
  const editableContent = src.type === 'manual' || src.type === 'text' || src.type === 'file';

  const save = async () => {
    const next: typeof errors = {};
    if (!title.trim()) next.title = 'Title is required.';
    if (editableContent && !content.trim()) next.content = 'Content can’t be empty.';
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try {
      await api.updateSource(src.id, { title: title.trim(), ...(editableContent ? { content } : {}) });
      setEditing(false);
      toast.success('Source updated', 'Re-processing has started.');
      res.reload();
    } catch (err) {
      toast.error('Couldn’t save', errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async () => {
    setDeleting(true);
    try {
      await api.deleteSource(src.id);
      toast.success('Source deleted', 'Run Refresh Learning to update workflows learned from it.');
      navigate(paths.knowledge(), { replace: true });
    } catch (err) {
      toast.error('Couldn’t delete', errorMessage(err));
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const metaEntries = Object.entries(src.metadata ?? {});
  const isLink = src.reference && /^https?:\/\//.test(src.reference);

  return (
    <>
      <PageHeader
        back={back}
        title={src.title}
        description={
          <span className="app-head-meta">
            <SourceStatusPill status={src.status} />
            <span>{SOURCE_TYPE_LABEL[src.type]}</span>
            <span>·</span>
            <span>Updated {formatDateTime(src.updatedAt)}</span>
          </span>
        }
        actions={
          canEdit && !editing ? (
            <>
              <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
              <Button variant="primary" onClick={() => setEditing(true)}>
                Edit
              </Button>
            </>
          ) : null
        }
      />

      <div className="detail-grid">
        <div className="stack-lg">
          {src.status === 'failed' ? (
            <Notice tone="danger" title="Processing failed">
              {src.error ?? 'Navoro couldn’t process this source.'}
            </Notice>
          ) : src.status === 'needs_attention' ? (
            <Notice tone="warning" title="Needs attention">
              {src.error ?? 'Processing finished with warnings.'}
            </Notice>
          ) : processing ? (
            <Notice tone="info" title={src.status === 'pending' ? 'Queued for processing' : 'Processing'}>
              <span role="status">This page updates automatically.</span>
            </Notice>
          ) : null}

          {editing ? (
            <Card title="Edit source" description="Saving re-queues processing. Extracted drafts are updated; edited workflows keep your changes.">
              <div className="form-stack">
                <Field label="Title" error={errors.title}>
                  {(ids) => <Input {...ids} value={title} onChange={(e) => setTitle(e.target.value)} data-autofocus="" />}
                </Field>
                {editableContent ? (
                  <Field label="Content" error={errors.content}>
                    {(ids) => <Textarea {...ids} className="n-textarea--mono" rows={18} value={content} onChange={(e) => setContent(e.target.value)} />}
                  </Field>
                ) : (
                  <p className="muted">Content for {SOURCE_TYPE_LABEL[src.type].toLowerCase()} sources is fetched from the reference on each refresh.</p>
                )}
                <div className="form-actions">
                  <Button
                    onClick={() => {
                      setEditing(false);
                      setErrors({});
                    }}
                    disabled={saving}
                  >
                    Cancel
                  </Button>
                  <Button variant="primary" onClick={save} loading={saving}>
                    Save & re-process
                  </Button>
                </div>
              </div>
            </Card>
          ) : (
            <Card title="Content" description={src.charCount ? `${formatNumber(src.charCount)} characters` : undefined}>
              {src.content ? (
                <pre className="reader" tabIndex={0} aria-label="Source content">
                  {src.content}
                </pre>
              ) : (
                <p className="muted">{processing ? 'Content will appear once it’s been fetched.' : 'No content was extracted.'}</p>
              )}
            </Card>
          )}

          <Card title="Learned from this source" flush>
            {extracted.loading && !extracted.data ? (
              <p className="card-empty">Loading…</p>
            ) : extracted.error ? (
              <div className="pad">
                <ErrorState message={extracted.error} onRetry={extracted.reload} />
              </div>
            ) : extracted.data && extracted.data.workflows.length + extracted.data.items.length === 0 ? (
              <p className="card-empty">{processing ? 'Nothing yet — still processing.' : 'No workflows or concepts were extracted from this source.'}</p>
            ) : (
              <ul className="learned">
                {extracted.data?.workflows.map((w: WorkflowDTO) => (
                  <li key={w.id}>
                    <Link href={paths.workflow(w.id)} className="learned__row">
                      <Badge tone="info">Workflow</Badge>
                      <span className="learned__title">{w.title}</span>
                      <span className="learned__meta">{w.stepCount} steps</span>
                      <WorkflowStatusPill status={w.status} />
                    </Link>
                  </li>
                ))}
                {extracted.data?.items.map((k) => (
                  <li key={k.id}>
                    <div className="learned__row">
                      <Badge>{KIND_LABEL[k.kind]}</Badge>
                      <span className="learned__title">{k.title}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <aside className="stack-lg" aria-label="Source details">
          <Card title="Details">
            <KeyValue
              items={[
                { label: 'Type', value: SOURCE_TYPE_LABEL[src.type] },
                {
                  label: 'Reference',
                  value: src.reference ? (
                    isLink ? (
                      <a href={src.reference} target="_blank" rel="noopener noreferrer" className="ext-link">
                        {src.reference} <IconExternal size={12} />
                      </a>
                    ) : (
                      src.reference
                    )
                  ) : (
                    '—'
                  ),
                },
                { label: 'Created', value: formatDateTime(src.createdAt) },
                { label: 'Last processed', value: formatDateTime(src.processedAt) },
                { label: 'Chunks', value: formatNumber(src.stats.chunks) },
                { label: 'Workflows', value: formatNumber(src.stats.workflows) },
                { label: 'Concepts', value: formatNumber(src.stats.knowledgeItems) },
                { label: 'Content hash', value: src.contentHash ? <code className="hash">{src.contentHash.slice(0, 16)}</code> : '—' },
              ]}
            />
          </Card>
          {metaEntries.length > 0 ? (
            <Card title="Metadata">
              <KeyValue items={metaEntries.map(([k, v]) => ({ label: k, value: metaValue(v) }))} />
            </Card>
          ) : null}
        </aside>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={doDelete}
        busy={deleting}
        danger
        title="Delete this source?"
        confirmLabel="Delete source"
        body={
          <>
            <p>
              “{src.title}” and its {src.stats.chunks} chunks will be removed. Workflows learned only from it will be flagged on the next Refresh Learning.
            </p>
            <p>This can’t be undone.</p>
          </>
        }
      />
    </>
  );
}
