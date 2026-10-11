import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { CreateSourceRequest, JobDTO, SourceDTO } from '../../../../packages/contracts/src/admin-types.ts';
import { api, errorMessage } from '../api.ts';
import { useDocumentTitle, usePolling, useResource } from '../hooks.ts';
import { Link, paths, useRouter } from '../router.tsx';
import { useCanEdit } from '../session.tsx';
import { RefreshButton, useRefresh } from '../refresh.tsx';
import { duration, formatNumber, pluralize, timeAgo } from '../format.ts';
import { JobStatusPill, SOURCE_TYPE_LABEL, SourceStatusPill, isJobActive } from '../status.tsx';
import { ReadOnlyBanner, RequireApp, SectionTitle } from './common.tsx';
import {
  Button,
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
import { IconKnowledge, IconPlus, IconSparkle } from '../icons.tsx';

const MAX_UPLOAD = 500 * 1024;
type AddTab = 'write' | 'paste' | 'upload' | 'url' | 'youtube';

function isYouTubeUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return /(^|\.)youtube\.com$/.test(u.hostname) || u.hostname === 'youtu.be';
  } catch {
    return false;
  }
}

/* ───────────── Add source dialog ───────────── */

function AddSourceDialog({ open, onClose, appId, onCreated }: { open: boolean; onClose: () => void; appId: string; onCreated: (s: SourceDTO) => void }) {
  const toast = useToast();
  const [tab, setTab] = useState<AddTab>('write');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<{ name: string; content: string; size: number } | null>(null);
  const [errors, setErrors] = useState<{ title?: string; content?: string; url?: string; file?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTitle('');
      setContent('');
      setUrl('');
      setFile(null);
      setErrors({});
      setFormError(null);
    }
  }, [open]);

  useEffect(() => {
    setErrors({});
    setFormError(null);
  }, [tab]);

  const onFile = (f: File | undefined) => {
    setErrors((e) => ({ ...e, file: undefined }));
    if (!f) {
      setFile(null);
      return;
    }
    if (!/\.(md|markdown|txt)$/i.test(f.name)) {
      setErrors((e) => ({ ...e, file: 'Choose a .md or .txt file.' }));
      setFile(null);
      return;
    }
    if (f.size > MAX_UPLOAD) {
      setErrors((e) => ({ ...e, file: `That file is ${Math.round(f.size / 1024)} KB. The limit is 500 KB.` }));
      setFile(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      setFile({ name: f.name, content: text, size: f.size });
      if (!title) setTitle(f.name.replace(/\.(md|markdown|txt)$/i, ''));
    };
    reader.onerror = () => setErrors((e) => ({ ...e, file: 'Couldn’t read that file.' }));
    reader.readAsText(f);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    let body: CreateSourceRequest | null = null;
    if (tab === 'write' || tab === 'paste') {
      if (tab === 'write' && !title.trim()) next.title = 'Give this document a title.';
      if (!content.trim()) next.content = tab === 'write' ? 'Write some content first.' : 'Paste the article text.';
      else if (content.trim().length < 40) next.content = 'That’s too short to learn from — add a bit more detail.';
      body = { type: tab === 'write' ? 'manual' : 'text', title: title.trim() || undefined, content };
    } else if (tab === 'upload') {
      if (!file) next.file = next.file ?? 'Choose a file to upload.';
      else if (!file.content.trim()) next.file = 'That file is empty.';
      body = file ? { type: 'file', title: title.trim() || undefined, content: file.content, reference: file.name } : null;
    } else {
      let parsed: URL | null = null;
      try {
        parsed = new URL(url.trim());
      } catch {
        parsed = null;
      }
      if (!parsed || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) next.url = 'Enter a full URL starting with https://.';
      else if (tab === 'youtube' && !isYouTubeUrl(url.trim())) next.url = 'That doesn’t look like a YouTube link.';
      body = { type: tab === 'url' ? 'url' : 'youtube', title: title.trim() || undefined, reference: url.trim() };
    }
    setErrors(next);
    if (Object.keys(next).length || !body) return;
    setBusy(true);
    setFormError(null);
    try {
      const created = await api.createSource(appId, body);
      onCreated(created);
      toast.success('Source added', 'Processing has started. You can keep working.');
      onClose();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const tabs: Array<{ key: AddTab; label: string }> = [
    { key: 'write', label: 'Write' },
    { key: 'paste', label: 'Paste' },
    { key: 'upload', label: 'Upload' },
    { key: 'url', label: 'URL' },
    { key: 'youtube', label: 'YouTube' },
  ];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!busy}
      size="lg"
      title="Add knowledge"
      description="Navoro reads it, extracts workflows and concepts, and keeps the result as drafts for you to review."
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="add-source" loading={busy}>
            Add source
          </Button>
        </>
      }
    >
      <Tabs items={tabs} value={tab} onChange={setTab} label="Source type" idBase="add-src" />
      <TabPanel idBase="add-src" tabKey={tab}>
        <form id="add-source" onSubmit={submit} noValidate className="form-stack">
          {formError ? <ErrorState title="Couldn’t add the source" message={formError} /> : null}

          {tab === 'write' ? (
            <>
              <Field label="Title" error={errors.title}>
                {(ids) => <Input {...ids} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. How to invite a teammate" />}
              </Field>
              <Field label="Content" hint="Markdown is fine. Numbered steps and headings help Navoro extract clean workflows." error={errors.content}>
                {(ids) => (
                  <Textarea
                    {...ids}
                    className="n-textarea--mono"
                    rows={12}
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder={'## Invite a teammate\n\n1. Open **Settings → Members**.\n2. Click **Invite member**.\n3. …'}
                  />
                )}
              </Field>
            </>
          ) : null}

          {tab === 'paste' ? (
            <>
              <Field label="Title" optional hint="Leave blank to use the article’s first heading.">
                {(ids) => <Input {...ids} value={title} onChange={(e) => setTitle(e.target.value)} />}
              </Field>
              <Field label="Help article text" error={errors.content}>
                {(ids) => <Textarea {...ids} rows={12} value={content} onChange={(e) => setContent(e.target.value)} placeholder="Paste the full text of a help center article." />}
              </Field>
            </>
          ) : null}

          {tab === 'upload' ? (
            <>
              <Field label="File" hint="Markdown (.md) or plain text (.txt), up to 500 KB. Read in your browser and sent as text." error={errors.file}>
                {(ids) => (
                  <div className="file-drop">
                    <input
                      {...ids}
                      ref={fileRef}
                      type="file"
                      accept=".md,.markdown,.txt,text/markdown,text/plain"
                      className="file-drop__input"
                      onChange={(e) => onFile(e.target.files?.[0])}
                    />
                    <div className="file-drop__face" aria-hidden="true">
                      {file ? (
                        <>
                          <strong>{file.name}</strong>
                          <span>
                            {Math.max(1, Math.round(file.size / 1024))} KB · {formatNumber(file.content.length)} characters
                          </span>
                        </>
                      ) : (
                        <>
                          <strong>Choose a file</strong>
                          <span>or drop it here</span>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </Field>
              <Field label="Title" optional>
                {(ids) => <Input {...ids} value={title} onChange={(e) => setTitle(e.target.value)} />}
              </Field>
            </>
          ) : null}

          {tab === 'url' ? (
            <>
              <Field label="Public docs URL" hint="Navoro fetches this page once per refresh. It must be publicly reachable — no login walls." error={errors.url}>
                {(ids) => <Input {...ids} type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.example.com/getting-started" />}
              </Field>
              <Field label="Title" optional hint="Defaults to the page title.">
                {(ids) => <Input {...ids} value={title} onChange={(e) => setTitle(e.target.value)} />}
              </Field>
            </>
          ) : null}

          {tab === 'youtube' ? (
            <>
              <Notice tone="neutral" title="Transcripts must be public">
                Navoro learns from the video’s transcript, not its pixels. If captions aren’t publicly available, the source will fail with a clear reason and you can paste a transcript instead.
              </Notice>
              <Field label="YouTube URL" error={errors.url}>
                {(ids) => <Input {...ids} type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" />}
              </Field>
              <Field label="Title" optional hint="Defaults to the video title.">
                {(ids) => <Input {...ids} value={title} onChange={(e) => setTitle(e.target.value)} />}
              </Field>
            </>
          ) : null}
        </form>
      </TabPanel>
    </Dialog>
  );
}

/* ───────────── Recent jobs ───────────── */

function RecentJobs({ jobs, loading, error, onRetry }: { jobs: JobDTO[]; loading: boolean; error: string | null; onRetry: () => void }) {
  const { open } = useRefresh();
  return (
    <section aria-labelledby="jobs-title" className="stack-sm">
      <SectionTitle id="jobs-title">Recent jobs</SectionTitle>
      <div className="n-card n-card--table">
        {loading && jobs.length === 0 ? (
          <SkeletonRows rows={3} label="Loading jobs" />
        ) : error && jobs.length === 0 ? (
          <div className="pad">
            <ErrorState message={error} onRetry={onRetry} />
          </div>
        ) : (
          <Table<JobDTO>
            caption="Recent jobs"
            rows={jobs.slice(0, 10)}
            rowKey={(j) => j.id}
            onRowClick={open}
            empty={<p className="card-empty">No jobs yet. Adding a source or running Refresh Learning creates one.</p>}
            columns={[
              {
                key: 'type',
                header: 'Job',
                render: (j) => (
                  <button type="button" className="cell-button" onClick={() => open(j)}>
                    {j.type === 'refresh' ? 'Refresh Learning' : 'Process source'}
                  </button>
                ),
              },
              { key: 'status', header: 'Status', render: (j) => <JobStatusPill status={j.status} /> },
              {
                key: 'detail',
                header: 'Detail',
                hideOnMobile: true,
                render: (j) => (
                  <span className="muted clamp-1">
                    {j.error ??
                      j.report?.publishNote ??
                      (isJobActive(j.status) ? (j.steps.find((s) => s.status === 'running')?.label ?? 'Waiting to start') : '—')}
                  </span>
                ),
              },
              { key: 'dur', header: 'Duration', hideOnMobile: true, render: (j) => <span className="muted">{duration(j.startedAt, j.finishedAt)}</span> },
              { key: 'when', header: 'Started', render: (j) => <span className="muted nowrap">{timeAgo(j.createdAt)}</span> },
            ]}
          />
        )}
      </div>
    </section>
  );
}

/* ───────────── Page ───────────── */

function KnowledgeBody({ appId }: { appId: string }) {
  const canEdit = useCanEdit();
  const toast = useToast();
  const { navigate } = useRouter();
  const { completedCount } = useRefresh();
  const sources = useResource((s) => api.sources(appId, s), [appId]);
  const jobs = useResource((s) => api.jobs(appId, s), [appId]);
  const [addOpen, setAddOpen] = useState(false);
  const [sampleBusy, setSampleBusy] = useState(false);

  const busySources = (sources.data?.sources ?? []).some((s) => s.status === 'pending' || s.status === 'processing');
  const busyJobs = (jobs.data?.jobs ?? []).some((j) => isJobActive(j.status));
  const polling = busySources || busyJobs;

  usePolling(
    async (signal) => {
      const [s, j] = await Promise.all([api.sources(appId, signal), api.jobs(appId, signal)]);
      if (signal.aborted) return;
      sources.setData(s);
      jobs.setData(j);
    },
    1500,
    polling,
  );

  const { reload: reloadSources } = sources;
  const { reload: reloadJobs } = jobs;
  useEffect(() => {
    if (completedCount > 0) {
      reloadSources();
      reloadJobs();
    }
  }, [completedCount, reloadSources, reloadJobs]);

  const onCreated = (s: SourceDTO) => {
    sources.setData((d) => ({ sources: [s, ...(d?.sources ?? []).filter((x) => x.id !== s.id)] }));
    jobs.reload();
  };

  const addSample = async () => {
    setSampleBusy(true);
    try {
      const s = await api.sampleSource(appId);
      onCreated(s);
      toast.success('Sample knowledge added', 'The Lumen help docs are processing now.');
    } catch (err) {
      toast.error('Couldn’t add sample knowledge', errorMessage(err));
    } finally {
      setSampleBusy(false);
    }
  };

  const list = sources.data?.sources ?? [];

  return (
    <>
      <PageHeader
        title="Knowledge"
        description="Everything Navoro learns from. Changes are picked up by Refresh Learning."
        actions={
          <>
            <RefreshButton />
            {canEdit ? (
              <Button variant="primary" icon={<IconPlus size={16} />} onClick={() => setAddOpen(true)}>
                Add source
              </Button>
            ) : null}
          </>
        }
      />
      {!canEdit ? <ReadOnlyBanner /> : null}

      <div className="stack-lg">
        <section aria-labelledby="sources-title" className="stack-sm">
          <SectionTitle
            id="sources-title"
            actions={
              polling ? (
                <span className="live-dot" role="status">
                  <span aria-hidden="true" />
                  Processing — updating live
                </span>
              ) : null
            }
          >
            Sources
          </SectionTitle>
          <div className="n-card n-card--table">
            {sources.loading && !sources.data ? (
              <SkeletonRows rows={4} label="Loading sources" />
            ) : sources.error && !sources.data ? (
              <div className="pad">
                <ErrorState message={sources.error} onRetry={sources.reload} />
              </div>
            ) : (
              <Table<SourceDTO>
                caption="Knowledge sources"
                rows={list}
                rowKey={(s) => s.id}
                onRowClick={(s) => navigate(paths.source(s.id))}
                empty={
                  <EmptyState
                    icon={<IconKnowledge />}
                    title="Teach Navoro how your product works"
                    action={
                      canEdit ? (
                        <>
                          <Button variant="primary" icon={<IconPlus size={16} />} onClick={() => setAddOpen(true)}>
                            Add source
                          </Button>
                          <Button icon={<IconSparkle size={16} />} onClick={addSample} loading={sampleBusy}>
                            Use sample knowledge
                          </Button>
                        </>
                      ) : null
                    }
                  >
                    Add a help article, a how-to you write here, a Markdown file, a public docs page, or a YouTube walkthrough. Or start with the sample Lumen docs to see how it works.
                  </EmptyState>
                }
                columns={[
                  {
                    key: 'title',
                    header: 'Source',
                    render: (s) => (
                      <div className="cell-stack">
                        <Link href={paths.source(s.id)} className="cell-title">
                          {s.title}
                        </Link>
                        {s.error ? <span className={`cell-error cell-error--${s.status === 'failed' ? 'danger' : 'warning'}`}>{s.error}</span> : s.reference ? <span className="cell-sub clamp-1">{s.reference}</span> : null}
                      </div>
                    ),
                  },
                  { key: 'status', header: 'Status', render: (s) => <SourceStatusPill status={s.status} /> },
                  { key: 'type', header: 'Type', hideOnMobile: true, render: (s) => <span className="muted nowrap">{SOURCE_TYPE_LABEL[s.type]}</span> },
                  { key: 'chars', header: 'Characters', align: 'right', hideOnMobile: true, render: (s) => <span className="muted">{s.charCount ? formatNumber(s.charCount) : '—'}</span> },
                  {
                    key: 'extracted',
                    header: 'Extracted',
                    hideOnMobile: true,
                    render: (s) =>
                      s.status === 'ready' || s.status === 'needs_attention' ? (
                        <span className="muted cell-sub-stack">
                          <span>{pluralize(s.stats.workflows, 'workflow')}</span>
                          <span>
                            {pluralize(s.stats.knowledgeItems, 'concept')} · {pluralize(s.stats.chunks, 'chunk')}
                          </span>
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      ),
                  },
                  { key: 'when', header: 'Processed', hideOnMobile: true, render: (s) => <span className="muted nowrap">{s.processedAt ? timeAgo(s.processedAt) : '—'}</span> },
                ]}
              />
            )}
          </div>
          {list.length > 0 && canEdit ? (
            <div className="below-table">
              <Button variant="ghost" size="sm" icon={<IconSparkle size={14} />} onClick={addSample} loading={sampleBusy}>
                Add sample knowledge
              </Button>
            </div>
          ) : null}
        </section>

        <RecentJobs jobs={jobs.data?.jobs ?? []} loading={jobs.loading} error={jobs.error} onRetry={jobs.reload} />
      </div>

      <AddSourceDialog open={addOpen} onClose={() => setAddOpen(false)} appId={appId} onCreated={onCreated} />
    </>
  );
}

export function KnowledgePage() {
  useDocumentTitle('Knowledge');
  return <RequireApp title="Knowledge">{(app) => <KnowledgeBody key={app.id} appId={app.id} />}</RequireApp>;
}
