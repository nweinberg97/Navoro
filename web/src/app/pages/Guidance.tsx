import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { GuidancePreviewResponse, KnowledgeItemDTO, MappingDTO, WorkflowDTO } from '../../../../packages/contracts/src/admin-types.ts';
import { api, errorMessage } from '../api.ts';
import { useDocumentTitle, useResource } from '../hooks.ts';
import { Link, paths, useRouter, type GuidanceTab } from '../router.tsx';
import { useCanEdit } from '../session.tsx';
import { RefreshButton, useRefresh } from '../refresh.tsx';
import { timeAgo } from '../format.ts';
import { PROVENANCE_LABEL, ValidationPill, WorkflowStatusPill } from '../status.tsx';
import { RequireApp } from './common.tsx';
import {
  Badge,
  Button,
  ConfidenceMeter,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Notice,
  PageHeader,
  SkeletonRows,
  Table,
  TabPanel,
  Tabs,
  Textarea,
  useToast,
} from '../../ui/index.ts';
import { IconGuidance, IconTarget, IconWarning } from '../icons.tsx';

/* ───────────── Workflows tab ───────────── */

type WfFilter = 'all' | WorkflowDTO['status'];

function WorkflowsTab({ appId }: { appId: string }) {
  const { navigate } = useRouter();
  const { completedCount } = useRefresh();
  const res = useResource((s) => api.workflows(appId, s), [appId, completedCount]);
  const [filter, setFilter] = useState<WfFilter>('all');
  const all = res.data?.workflows ?? [];
  const rows = filter === 'all' ? all.filter((w) => w.status !== 'archived') : all.filter((w) => w.status === filter);
  const count = (s: WfFilter) => (s === 'all' ? all.filter((w) => w.status !== 'archived').length : all.filter((w) => w.status === s).length);

  if (res.loading && !res.data) return <div className="n-card n-card--table"><SkeletonRows rows={5} label="Loading workflows" /></div>;
  if (res.error && !res.data) return <ErrorState message={res.error} onRetry={res.reload} />;

  return (
    <div className="stack-sm">
      {all.length > 0 ? (
        <div className="chip-filter" role="group" aria-label="Filter by status">
          {(['all', 'needs_review', 'draft', 'published', 'archived'] as WfFilter[]).map((f) => (
            <button key={f} type="button" className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === 'all' ? 'Active' : f === 'needs_review' ? 'Needs review' : f[0]!.toUpperCase() + f.slice(1)}
              <span>{count(f)}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div className="n-card n-card--table">
        <Table<WorkflowDTO>
          caption="Workflows"
          rows={rows}
          rowKey={(w) => w.id}
          onRowClick={(w) => navigate(paths.workflow(w.id))}
          empty={
            all.length === 0 ? (
              <EmptyState
                icon={<IconGuidance />}
                title="No workflows yet"
                action={
                  <Link href={paths.knowledge()} className="n-btn n-btn--secondary n-btn--md">
                    Go to Knowledge
                  </Link>
                }
              >
                Workflows are extracted from your knowledge sources. Add a source, then run Refresh Learning.
              </EmptyState>
            ) : (
              <p className="card-empty">No workflows with this status.</p>
            )
          }
          columns={[
            {
              key: 'title',
              header: 'Workflow',
              render: (w) => (
                <div className="cell-stack">
                  <span className="cell-title-row">
                    <Link href={paths.workflow(w.id)} className="cell-title">
                      {w.title}
                    </Link>
                    {w.edited ? <Badge>Edited</Badge> : null}
                  </span>
                  <span className="cell-sub clamp-1">{w.summary}</span>
                </div>
              ),
            },
            { key: 'status', header: 'Status', render: (w) => <WorkflowStatusPill status={w.status} /> },
            { key: 'conf', header: 'Confidence', hideOnMobile: true, render: (w) => <ConfidenceMeter value={w.confidence} /> },
            {
              key: 'steps',
              header: 'Steps',
              hideOnMobile: true,
              render: (w) => (
                <span className="steps-cell">
                  {w.stepCount}
                  {w.brokenTargets > 0 ? (
                    <span className="broken-flag" title={`${w.brokenTargets} broken target${w.brokenTargets === 1 ? '' : 's'}`}>
                      <IconWarning size={14} />
                      {w.brokenTargets} broken
                    </span>
                  ) : null}
                </span>
              ),
            },
            {
              key: 'src',
              header: 'Source',
              hideOnMobile: true,
              render: (w) =>
                w.sourceId ? (
                  <Link href={paths.source(w.sourceId)} className="muted-link clamp-1">
                    {w.sourceTitle ?? 'Source'}
                  </Link>
                ) : (
                  <span className="muted">—</span>
                ),
            },
            { key: 'origin', header: 'Origin', hideOnMobile: true, render: (w) => <span className="muted">{w.origin === 'extracted' ? 'Extracted' : 'Manual'}</span> },
            { key: 'upd', header: 'Updated', hideOnMobile: true, render: (w) => <span className="muted">{timeAgo(w.updatedAt)}</span> },
          ]}
        />
      </div>
    </div>
  );
}

/* ───────────── Knowledge items tab ───────────── */

const ITEM_KIND: Record<KnowledgeItemDTO['kind'], { label: string; tone: 'neutral' | 'info' | 'warning' | 'danger' }> = {
  feature: { label: 'Feature', tone: 'info' },
  ui_concept: { label: 'UI concept', tone: 'neutral' },
  known_error: { label: 'Known error', tone: 'danger' },
  troubleshooting: { label: 'Troubleshooting', tone: 'warning' },
};

function KnowledgeItemsTab({ appId }: { appId: string }) {
  const { completedCount } = useRefresh();
  const res = useResource((s) => api.knowledge(appId, s), [appId, completedCount]);
  const [kind, setKind] = useState<'all' | KnowledgeItemDTO['kind']>('all');
  if (res.loading && !res.data) return <div className="n-card n-card--table"><SkeletonRows rows={5} label="Loading concepts" /></div>;
  if (res.error && !res.data) return <ErrorState message={res.error} onRetry={res.reload} />;
  const items = res.data?.items ?? [];
  const shown = kind === 'all' ? items : items.filter((i) => i.kind === kind);
  if (items.length === 0)
    return (
      <div className="n-card">
        <EmptyState title="No troubleshooting or concepts yet">
          Navoro extracts features, UI concepts, known errors and fixes alongside workflows. They’re used to answer “why” and “what is” questions.
        </EmptyState>
      </div>
    );
  return (
    <div className="stack-sm">
      <div className="chip-filter" role="group" aria-label="Filter by kind">
        {(['all', 'troubleshooting', 'known_error', 'feature', 'ui_concept'] as const).map((k) => (
          <button key={k} type="button" className="chip" aria-pressed={kind === k} onClick={() => setKind(k)}>
            {k === 'all' ? 'All' : ITEM_KIND[k].label}
            <span>{k === 'all' ? items.length : items.filter((i) => i.kind === k).length}</span>
          </button>
        ))}
      </div>
      <ul className="item-list">
        {shown.map((i) => (
          <li key={i.id} className="item-card">
            <div className="item-card__head">
              <Badge tone={ITEM_KIND[i.kind].tone}>{ITEM_KIND[i.kind].label}</Badge>
              <Link href={paths.source(i.sourceId)} className="muted-link item-card__src">
                {i.sourceTitle}
              </Link>
            </div>
            <h3 className="item-card__title">{i.title}</h3>
            <p className="item-card__body">{i.body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ───────────── Mappings tab ───────────── */

function strategyValue(m: MappingDTO, type: 'navoro_id' | 'aria_label' | 'text') {
  return m.strategies.find((s) => s.type === type);
}

function MappingDialog({ appId, mapping, onClose, onSaved }: { appId: string; mapping: MappingDTO | null; onClose: () => void; onSaved: (m: MappingDTO) => void }) {
  const toast = useToast();
  const [label, setLabel] = useState('');
  const [navoroId, setNavoroId] = useState('');
  const [ariaLabel, setAriaLabel] = useState('');
  const [text, setText] = useState('');
  const [role, setRole] = useState('');
  const [errors, setErrors] = useState<{ label?: string; strategy?: string }>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!mapping) return;
    setLabel(mapping.label);
    setNavoroId(strategyValue(mapping, 'navoro_id')?.value ?? '');
    setAriaLabel(strategyValue(mapping, 'aria_label')?.value ?? '');
    setText(strategyValue(mapping, 'text')?.value ?? '');
    setRole(strategyValue(mapping, 'aria_label')?.role ?? strategyValue(mapping, 'text')?.role ?? '');
    setErrors({});
  }, [mapping]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!mapping) return;
    const next: typeof errors = {};
    if (!label.trim()) next.label = 'Give the target a human label.';
    if (!navoroId.trim() && !ariaLabel.trim() && !text.trim()) next.strategy = 'Provide at least one way to find the element.';
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      const saved = await api.upsertMapping(appId, mapping.key, {
        label: label.trim(),
        navoroId: navoroId.trim() || undefined,
        ariaLabel: ariaLabel.trim() || undefined,
        text: text.trim() || undefined,
        role: role.trim() || undefined,
      });
      onSaved(saved);
      toast.success('Mapping saved', 'It will be validated on the next Refresh Learning.');
      onClose();
    } catch (err) {
      toast.error('Couldn’t save mapping', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={mapping != null}
      onClose={onClose}
      dismissible={!busy}
      title="Edit mapping"
      description={mapping ? <>Key <code>{mapping.key}</code>. Strategies are tried in order: navoro id, accessible name, then visible text.</> : undefined}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="mapping-form" loading={busy}>
            Save mapping
          </Button>
        </>
      }
    >
      <form id="mapping-form" className="form-stack" onSubmit={submit} noValidate>
        {mapping?.validationDetail ? (
          <Notice tone={mapping.validation === 'broken' ? 'danger' : mapping.validation === 'uncertain' ? 'warning' : 'neutral'} title="Last validation">
            {mapping.validationDetail}
          </Notice>
        ) : null}
        <Field label="Label" error={errors.label} hint="What the step calls this control, e.g. “Invite member button”.">
          {(ids) => <Input {...ids} value={label} onChange={(e) => setLabel(e.target.value)} data-autofocus="" />}
        </Field>
        <Field label="navoro id" optional hint="Most stable. Matches data-navoro-id in your markup." error={errors.strategy}>
          {(ids) => <Input {...ids} className="n-mono" value={navoroId} onChange={(e) => setNavoroId(e.target.value)} placeholder="members.invite" spellCheck={false} />}
        </Field>
        <div className="form-grid">
          <Field label="Accessible name" optional>
            {(ids) => <Input {...ids} value={ariaLabel} onChange={(e) => setAriaLabel(e.target.value)} />}
          </Field>
          <Field label="Role" optional hint="e.g. button, link, textbox">
            {(ids) => <Input {...ids} value={role} onChange={(e) => setRole(e.target.value)} />}
          </Field>
        </div>
        <Field label="Visible text" optional hint="Least stable — breaks when copy changes.">
          {(ids) => <Input {...ids} value={text} onChange={(e) => setText(e.target.value)} />}
        </Field>
      </form>
    </Dialog>
  );
}

const VALIDATION_ORDER = { broken: 0, uncertain: 1, unverified: 2, valid: 3 } as const;

function MappingsTab({ appId }: { appId: string }) {
  const canEdit = useCanEdit();
  const { completedCount } = useRefresh();
  const res = useResource((s) => api.mappings(appId, s), [appId, completedCount]);
  const [editing, setEditing] = useState<MappingDTO | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const rows = useMemo(
    () => [...(res.data?.mappings ?? [])].sort((a, b) => VALIDATION_ORDER[a.validation] - VALIDATION_ORDER[b.validation] || a.key.localeCompare(b.key)),
    [res.data],
  );
  if (res.loading && !res.data) return <div className="n-card n-card--table"><SkeletonRows rows={5} label="Loading mappings" /></div>;
  if (res.error && !res.data) return <ErrorState message={res.error} onRetry={res.reload} />;

  return (
    <div className="stack-sm">
      <p className="tab-intro">
        Mappings connect a step to a control in your UI. Fix a broken one here and every workflow using it is corrected — no retraining needed.
      </p>
      <div className="n-card n-card--table">
        <Table<MappingDTO>
          caption="Element mappings"
          rows={rows}
          rowKey={(m) => m.id}
          empty={
            <EmptyState icon={<IconTarget />} title="No mappings yet">
              Mappings are created when workflows are extracted, and validated against your approved application metadata.
            </EmptyState>
          }
          columns={[
            {
              key: 'key',
              header: 'Target',
              render: (m) => (
                <div className="cell-stack">
                  <span className="cell-title">{m.label}</span>
                  <code className="cell-sub">{m.key}</code>
                </div>
              ),
            },
            {
              key: 'strat',
              header: 'Strategies',
              hideOnMobile: true,
              render: (m) => (
                <ol className="strategies">
                  {m.strategies.map((s, i) => (
                    <li key={i}>
                      <span className="strategies__type">{s.type === 'navoro_id' ? 'id' : s.type === 'aria_label' ? 'name' : 'text'}</span>
                      <code>{s.value}</code>
                      {s.role ? <span className="muted"> · {s.role}</span> : null}
                    </li>
                  ))}
                </ol>
              ),
            },
            { key: 'prov', header: 'Provenance', hideOnMobile: true, render: (m) => <span className="muted">{PROVENANCE_LABEL[m.provenance]}</span> },
            { key: 'conf', header: 'Confidence', hideOnMobile: true, render: (m) => <ConfidenceMeter value={m.confidence} /> },
            {
              key: 'val',
              header: 'Validation',
              render: (m) => (
                <div className="cell-stack">
                  <ValidationPill validation={m.validation} />
                  {m.validationDetail ? (
                    <button type="button" className="detail-toggle" aria-expanded={expanded === m.id} onClick={() => setExpanded(expanded === m.id ? null : m.id)}>
                      {expanded === m.id ? 'Hide detail' : 'Why?'}
                    </button>
                  ) : null}
                  {expanded === m.id ? <span className="cell-sub cell-detail">{m.validationDetail}</span> : null}
                </div>
              ),
            },
            {
              key: 'act',
              header: <span className="n-visually-hidden">Actions</span>,
              align: 'right',
              render: (m) =>
                canEdit ? (
                  <Button size="sm" variant={m.validation === 'broken' ? 'primary' : 'ghost'} onClick={() => setEditing(m)}>
                    {m.validation === 'broken' ? 'Fix' : 'Edit'}
                  </Button>
                ) : null,
            },
          ]}
        />
      </div>
      <MappingDialog
        appId={appId}
        mapping={editing}
        onClose={() => setEditing(null)}
        onSaved={(m) => res.setData((d) => (d ? { mappings: d.mappings.map((x) => (x.key === m.key ? m : x)) } : d))}
      />
    </div>
  );
}

/* ───────────── Preview tab ───────────── */

function PreviewResult({ data }: { data: GuidancePreviewResponse }) {
  const r = data.result;
  const kindLabel = { workflow: 'Workflow', answer: 'Answer', troubleshooting: 'Troubleshooting', unresolved: 'Unresolved' }[r.kind];
  return (
    <div className="preview-result">
      <div className="widget" aria-label="End-user preview">
        <div className="widget__bar">
          <span className="widget__brand">
            <span className="widget__mark" aria-hidden="true" />
            Navoro
          </span>
          <span className="widget__badges">
            {r.mode === 'demo' ? <Badge tone="warning">Demo mode</Badge> : <Badge tone="success">Model</Badge>}
            <Badge tone={r.kind === 'unresolved' ? 'danger' : 'neutral'}>{kindLabel}</Badge>
          </span>
        </div>
        <div className="widget__body">
          {r.workflow ? <p className="widget__wf">{r.workflow.title}</p> : null}
          <p className="widget__answer">{r.answer}</p>
          {r.steps.length > 0 ? (
            <ol className="widget__steps">
              {r.steps.map((s) => (
                <li key={s.index} className="widget-step">
                  <span className="widget-step__num" aria-hidden="true">
                    {s.index + 1}
                  </span>
                  <div className="widget-step__text">
                    <span className="widget-step__title">{s.title}</span>
                    <span className="widget-step__instr">{s.instruction}</span>
                    {s.target ? (
                      <span className="widget-step__target">
                        <IconTarget size={12} />
                        <span>{s.target.label}</span>
                        <code>{s.target.key}</code>
                        <ValidationPill validation={s.target.validation} />
                      </span>
                    ) : (
                      <span className="widget-step__target widget-step__target--none">
                        <IconWarning size={12} />
                        {s.targetNote ?? 'No on-screen target for this step.'}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          ) : null}
          {r.fallback ? (
            <p className="widget__fallback">
              {r.fallback.url ? (
                <a href={r.fallback.url} target="_blank" rel="noopener noreferrer">
                  {r.fallback.label}
                </a>
              ) : (
                r.fallback.label
              )}
            </p>
          ) : null}
        </div>
      </div>

      <div className="preview-side">
        <div className="preview-facts">
          <div>
            <span className="preview-facts__label">Grounded</span>
            <span className={r.grounded ? 'preview-facts__ok' : 'preview-facts__warn'}>{r.grounded ? 'Yes — backed by sources' : 'No — not supported by sources'}</span>
          </div>
          <div>
            <span className="preview-facts__label">Confidence</span>
            <ConfidenceMeter value={r.confidence} />
          </div>
        </div>
        <section aria-labelledby="pv-cites">
          <h3 id="pv-cites" className="preview-h">
            Citations
          </h3>
          {r.citations.length === 0 ? (
            <p className="muted small">No citations.</p>
          ) : (
            <ul className="cites">
              {r.citations.map((c, i) => (
                <li key={i}>
                  <Link href={paths.source(c.sourceId)} className="cites__title">
                    {c.sourceTitle}
                  </Link>
                  <q className="cites__excerpt">{c.excerpt}</q>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="pv-retr">
          <h3 id="pv-retr" className="preview-h">
            Retrieval
          </h3>
          {data.retrieval.length === 0 ? (
            <p className="muted small">Nothing retrieved.</p>
          ) : (
            <table className="retrieval">
              <caption className="n-visually-hidden">Retrieved passages and scores</caption>
              <thead>
                <tr>
                  <th scope="col">Passage</th>
                  <th scope="col">Score</th>
                </tr>
              </thead>
              <tbody>
                {data.retrieval.map((x, i) => (
                  <tr key={i}>
                    <td>
                      <span className="retrieval__src">{x.sourceTitle}</span>
                      {x.heading ? <span className="retrieval__h"> · {x.heading}</span> : null}
                    </td>
                    <td>
                      <span className="retrieval__score">
                        <span className="retrieval__bar" aria-hidden="true">
                          <span style={{ width: `${Math.max(0, Math.min(1, x.score)) * 100}%` }} />
                        </span>
                        {x.score.toFixed(2)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <details className="ctx-details">
          <summary>Synthetic context used</summary>
          <pre>{JSON.stringify(data.context, null, 2)}</pre>
        </details>
      </div>
    </div>
  );
}

function PreviewTab({ appId }: { appId: string }) {
  const [question, setQuestion] = useState('');
  const [route, setRoute] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GuidancePreviewResponse | null>(null);
  const [asked, setAsked] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!question.trim()) {
      setFieldError('Type a question an end user might ask.');
      return;
    }
    if (route.trim() && !route.trim().startsWith('/')) {
      setFieldError(null);
      setError('Routes start with “/”, e.g. /settings/members.');
      return;
    }
    setFieldError(null);
    setBusy(true);
    setError(null);
    try {
      const r = await api.preview(appId, { question: question.trim(), route: route.trim() || undefined });
      setResult(r);
      setAsked(question.trim());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack-lg">
      <Notice tone="neutral" title="Preview uses drafts too">
        You’ll see draft and needs-review workflows here. End users only see what’s published in a configuration version.
      </Notice>
      <form className="preview-form" onSubmit={submit} noValidate>
        <Field label="Question" error={fieldError}>
          {(ids) => <Textarea {...ids} rows={2} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="How do I invite a teammate?" />}
        </Field>
        <Field label="Current page route" optional hint="Simulates where the user is.">
          {(ids) => <Input {...ids} className="n-mono" value={route} onChange={(e) => setRoute(e.target.value)} placeholder="/settings/members" />}
        </Field>
        <div className="preview-form__actions">
          <Button type="submit" variant="primary" loading={busy}>
            Ask
          </Button>
        </div>
      </form>
      <div aria-live="polite" aria-busy={busy}>
        {error ? <ErrorState title="Preview failed" message={error} /> : null}
        {result && !error ? (
          <>
            <p className="preview-asked">
              Result for <q>{asked}</q>
            </p>
            <PreviewResult data={result} />
          </>
        ) : null}
      </div>
    </div>
  );
}

/* ───────────── Page ───────────── */

const TABS: Array<{ key: GuidanceTab; label: string }> = [
  { key: 'workflows', label: 'Workflows' },
  { key: 'knowledge', label: 'Troubleshooting & concepts' },
  { key: 'mappings', label: 'Element mappings' },
  { key: 'preview', label: 'Preview' },
];

export function GuidancePage({ tab }: { tab: GuidanceTab }) {
  useDocumentTitle('Guidance');
  const { navigate } = useRouter();
  return (
    <RequireApp title="Guidance">
      {(app) => (
        <>
          <PageHeader
            title="Guidance"
            description="What Navoro learned, and how it will guide people. Review drafts, correct targets, and preview answers."
            actions={<RefreshButton />}
          />
          <Tabs items={TABS} value={tab} onChange={(k) => navigate(paths.guidance(k), { replace: true })} label="Guidance sections" idBase="guidance" />
          <TabPanel idBase="guidance" tabKey={tab}>
            {tab === 'workflows' ? <WorkflowsTab key={app.id} appId={app.id} /> : null}
            {tab === 'knowledge' ? <KnowledgeItemsTab key={app.id} appId={app.id} /> : null}
            {tab === 'mappings' ? <MappingsTab key={app.id} appId={app.id} /> : null}
            {tab === 'preview' ? <PreviewTab key={app.id} appId={app.id} /> : null}
          </TabPanel>
        </>
      )}
    </RequireApp>
  );
}

export { MappingDialog };
