import { useEffect, useState, type FormEvent } from 'react';
import type { ApplicationDetail, CatalogElementDTO, CatalogImportRequest, ConfigVersionDTO, EnvironmentDTO } from '../../../../packages/contracts/src/admin-types.ts';
import { api, errorMessage } from '../api.ts';
import { useDocumentTitle, useResource } from '../hooks.ts';
import { Link, paths } from '../router.tsx';
import { useCanEdit, useWorkspace } from '../session.tsx';
import { formatDateTime, parseLines, parseOrigins, timeAgo } from '../format.ts';
import { PublishDialog } from '../PublishDialog.tsx';
import { connectionOf } from './Applications.tsx';
import { ReadOnlyBanner } from './common.tsx';
import {
  Badge,
  Button,
  Card,
  CopyField,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LinkButton,
  PageHeader,
  PageSkeleton,
  SkeletonRows,
  StatusPill,
  Switch,
  Table,
  Textarea,
  useToast,
} from '../../ui/index.ts';
import { IconArrowLeft, IconExternal } from '../icons.tsx';

const DEMO_ORIGIN = 'http://localhost:4500';

/* ───────────── General settings ───────────── */

function GeneralCard({ app, onSaved }: { app: ApplicationDetail; onSaved: (a: ApplicationDetail) => void }) {
  const canEdit = useCanEdit();
  const toast = useToast();
  const [name, setName] = useState(app.name);
  const [supportUrl, setSupportUrl] = useState(app.supportUrl ?? '');
  const [greeting, setGreeting] = useState(app.greeting);
  const [suggestions, setSuggestions] = useState(app.suggestions.join('\n'));
  const [errors, setErrors] = useState<{ name?: string; supportUrl?: string; suggestions?: string }>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(app.name);
    setSupportUrl(app.supportUrl ?? '');
    setGreeting(app.greeting);
    setSuggestions(app.suggestions.join('\n'));
  }, [app]);

  const dirty =
    name !== app.name || supportUrl !== (app.supportUrl ?? '') || greeting !== app.greeting || suggestions !== app.suggestions.join('\n');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!name.trim()) next.name = 'Name is required.';
    if (supportUrl.trim()) {
      try {
        const u = new URL(supportUrl.trim());
        if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error();
      } catch {
        next.supportUrl = 'Enter a full URL, e.g. https://help.example.com.';
      }
    }
    const list = parseLines(suggestions);
    if (list.length > 6) next.suggestions = 'Keep it to 6 suggestions or fewer.';
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      const updated = await api.updateApplication(app.id, {
        name: name.trim(),
        supportUrl: supportUrl.trim() || null,
        greeting: greeting.trim(),
        suggestions: list,
      });
      onSaved(updated);
      toast.success('Application saved', 'Publish a configuration for end users to see launcher changes.');
    } catch (err) {
      toast.error('Couldn’t save', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Launcher & details" description="What end users see when they open Navoro inside your app.">
      <form className="form-stack" onSubmit={submit} noValidate>
        <div className="form-grid">
          <Field label="Name" error={errors.name}>
            {(ids) => <Input {...ids} value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} />}
          </Field>
          <Field label="Support URL" optional error={errors.supportUrl} hint="Offered when Navoro can’t resolve a question.">
            {(ids) => <Input {...ids} type="url" value={supportUrl} onChange={(e) => setSupportUrl(e.target.value)} placeholder="https://help.example.com" disabled={!canEdit} />}
          </Field>
        </div>
        <Field label="Greeting">
          {(ids) => <Input {...ids} value={greeting} onChange={(e) => setGreeting(e.target.value)} placeholder="Hi! What are you trying to do?" disabled={!canEdit} />}
        </Field>
        <Field label="Suggested questions" hint="One per line. Shown as quick starts in the launcher." error={errors.suggestions} optional>
          {(ids) => <Textarea {...ids} rows={4} value={suggestions} onChange={(e) => setSuggestions(e.target.value)} disabled={!canEdit} />}
        </Field>
        {canEdit ? (
          <div className="form-actions">
            <Button type="submit" variant="primary" loading={busy} disabled={!dirty}>
              Save changes
            </Button>
          </div>
        ) : null}
      </form>
    </Card>
  );
}

/* ───────────── Environments ───────────── */

function EnvironmentRow({ app, env, onSaved }: { app: ApplicationDetail; env: EnvironmentDTO; onSaved: (a: ApplicationDetail) => void }) {
  const canEdit = useCanEdit();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(env.allowedOrigins.join('\n'));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const conn = connectionOf(env.lastSeenAt);

  const save = async () => {
    const parsed = parseOrigins(text);
    if (parsed.error) {
      setError(parsed.error);
      return;
    }
    setBusy(true);
    try {
      const updated = await api.updateEnvironment(app.id, env.name, { allowedOrigins: parsed.origins });
      onSaved(updated);
      setEditing(false);
      setError(null);
      toast.success(`${env.name === 'development' ? 'Development' : 'Production'} origins updated`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="env">
      <div className="env__head">
        <div>
          <h3 className="env__name">{env.name === 'development' ? 'Development' : 'Production'}</h3>
          <p className="env__meta">
            {env.activeConfigVersion != null ? `Config v${env.activeConfigVersion} live` : 'Nothing published yet'} ·{' '}
            {env.lastSeenAt ? `SDK seen ${timeAgo(env.lastSeenAt).toLowerCase()}` : 'SDK never seen'}
          </p>
        </div>
        <StatusPill tone={conn.tone}>{conn.label}</StatusPill>
      </div>
      {editing ? (
        <div className="env__edit">
          <Field label="Allowed origins" hint="One per line. Scheme, host and port only." error={error}>
            {(ids) => <Textarea {...ids} className="n-textarea--mono" rows={3} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} data-autofocus="" />}
          </Field>
          <div className="form-actions">
            <Button
              size="sm"
              onClick={() => {
                setEditing(false);
                setText(env.allowedOrigins.join('\n'));
                setError(null);
              }}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button size="sm" variant="primary" onClick={save} loading={busy}>
              Save origins
            </Button>
          </div>
        </div>
      ) : (
        <div className="env__origins">
          {env.allowedOrigins.length ? (
            <ul>
              {env.allowedOrigins.map((o) => (
                <li key={o}>
                  <code>{o}</code>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No origins allowed — the SDK will be refused here.</p>
          )}
          {canEdit ? (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Edit origins
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}

/* ───────────── Install ───────────── */

function InstallCard({ app }: { app: ApplicationDetail }) {
  const devOrigins = app.environments.find((e) => e.name === 'development')?.allowedOrigins ?? [];
  const hasDemo = devOrigins.includes(DEMO_ORIGIN);
  const demoUrl = `${DEMO_ORIGIN}/?navoroKey=${encodeURIComponent(app.publicKey)}&navoroOrigin=${encodeURIComponent(app.apiOrigin)}&navoroEnv=development`;
  return (
    <Card
      title="Install"
      description="Add Navoro to your app. The SDK never executes code from the server and only reads what your privacy policy allows."
      actions={
        hasDemo ? (
          <LinkButton href={demoUrl} target="_blank" rel="noopener noreferrer" size="sm" iconRight={<IconExternal size={14} />}>
            Open Lumen demo
          </LinkButton>
        ) : null
      }
    >
      <div className="install">
        <ol className="install__steps">
          <li>
            <strong>Paste the snippet</strong> before the closing <code>&lt;/body&gt;</code> tag of your app.
          </li>
          <li>
            <strong>Add <code>data-navoro-id</code></strong> to the controls you want guidance to point at — stable IDs beat text matching.
          </li>
          <li>
            <strong>Open your app in development</strong> once so Navoro can discover elements and capture a blueprint for Training Mode.
          </li>
          <li>
            <strong>Publish a configuration</strong> below. Nothing reaches end users until you do.
          </li>
        </ol>
        <CopyField label="Install snippet" value={app.installSnippet} multiline />
        <div className="install__key">
          <p className="install__key-label">Public key</p>
          <CopyField label="Public key" value={app.publicKey} />
          <p className="install__key-note">
            This identifies your application to Navoro. It isn’t a secret — it’s safe in client-side code. Requests are only accepted from the allowed origins above.
          </p>
        </div>
      </div>
    </Card>
  );
}

/* ───────────── Versions ───────────── */

function VersionsCard({ app, onPublished }: { app: ApplicationDetail; onPublished: (v: ConfigVersionDTO) => void }) {
  const canEdit = useCanEdit();
  const [open, setOpen] = useState(false);
  const versions = [...app.configVersions].sort((a, b) => b.version - a.version);
  return (
    <Card
      title="Configuration versions"
      description="Each publish snapshots workflows, mappings and privacy rules for one environment."
      flush
      actions={
        canEdit ? (
          <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
            Publish configuration
          </Button>
        ) : null
      }
    >
      <Table<ConfigVersionDTO>
        caption="Configuration versions"
        rows={versions}
        rowKey={(v) => v.id}
        empty={<p className="card-empty">No versions yet. End users won’t see guidance until you publish.</p>}
        columns={[
          { key: 'v', header: 'Version', render: (v) => <strong>v{v.version}</strong> },
          {
            key: 'env',
            header: 'Environment',
            render: (v) => (
              <span className="env-cell">
                <Badge tone={v.environment === 'production' ? 'info' : 'neutral'}>{v.environment === 'production' ? 'Production' : 'Development'}</Badge>
                {app.environments.find((e) => e.name === v.environment)?.activeConfigVersion === v.version ? <Badge tone="success">Live</Badge> : null}
              </span>
            ),
          },
          {
            key: 'sum',
            header: 'Contents',
            hideOnMobile: true,
            render: (v) => (
              <span className="muted">
                {v.summary.publishedWorkflows} workflows · {v.summary.blockedRegions} blocked · sends {v.summary.transmitCategories.length} categories
              </span>
            ),
          },
          { key: 'notes', header: 'Notes', hideOnMobile: true, render: (v) => <span className="muted clamp-1">{v.notes ?? '—'}</span> },
          {
            key: 'when',
            header: 'Published',
            render: (v) => (
              <span className="muted">
                {formatDateTime(v.createdAt)}
                {v.createdBy ? ` · ${v.createdBy}` : ''}
              </span>
            ),
          },
        ]}
      />
      <PublishDialog open={open} onClose={() => setOpen(false)} applicationId={app.id} applicationName={app.name} onPublished={onPublished} />
    </Card>
  );
}

/* ───────────── Catalog ───────────── */

function parseCatalogJson(text: string): { value: CatalogImportRequest | null; error: string | null } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { value: null, error: 'That isn’t valid JSON.' };
  }
  const list = Array.isArray(raw) ? raw : (raw as { elements?: unknown })?.elements;
  if (!Array.isArray(list) || list.length === 0) return { value: null, error: 'Expected an array of elements, or { "elements": [...] }.' };
  const elements: CatalogImportRequest['elements'] = [];
  for (const [i, item] of list.entries()) {
    const o = item as Record<string, unknown>;
    if (!o || typeof o.navoroId !== 'string' || !o.navoroId.trim()) return { value: null, error: `Element ${i + 1} is missing a "navoroId" string.` };
    const el: CatalogImportRequest['elements'][number] = { navoroId: o.navoroId.trim() };
    for (const k of ['label', 'role', 'route'] as const) {
      if (o[k] != null) {
        if (typeof o[k] !== 'string') return { value: null, error: `Element ${i + 1}: "${k}" must be a string.` };
        el[k] = o[k] as string;
      }
    }
    elements.push(el);
  }
  return { value: { elements }, error: null };
}

function CatalogCard({ appId }: { appId: string }) {
  const canEdit = useCanEdit();
  const toast = useToast();
  const res = useResource((s) => api.catalog(appId, s), [appId]);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [importOpen, setImportOpen] = useState(false);
  const [json, setJson] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [filter, setFilter] = useState('');

  const toggle = async (el: CatalogElementDTO, approved: boolean) => {
    setPending((p) => new Set(p).add(el.id));
    try {
      const updated = await api.setCatalogApproved(appId, el.id, approved);
      res.setData((d) => (d ? { elements: d.elements.map((x) => (x.id === updated.id ? updated : x)) } : d));
    } catch (err) {
      toast.error('Couldn’t update element', errorMessage(err));
    } finally {
      setPending((p) => {
        const n = new Set(p);
        n.delete(el.id);
        return n;
      });
    }
  };

  const doImport = async () => {
    const parsed = parseCatalogJson(json);
    if (parsed.error || !parsed.value) {
      setJsonError(parsed.error);
      return;
    }
    setImporting(true);
    try {
      const out = await api.importCatalog(appId, parsed.value);
      res.setData(out);
      toast.success('Catalog imported', `${parsed.value.elements.length} elements imported.`);
      setImportOpen(false);
      setJson('');
    } catch (err) {
      setJsonError(errorMessage(err));
    } finally {
      setImporting(false);
    }
  };

  const elements = (res.data?.elements ?? []).filter((e) => {
    if (!filter.trim()) return true;
    const q = filter.toLowerCase();
    return [e.navoroId, e.label, e.role, e.route].some((v) => v?.toLowerCase().includes(q));
  });
  const approvedCount = res.data?.elements.filter((e) => e.approved).length ?? 0;

  return (
    <Card
      title="Approved application metadata"
      description="Only approved elements may contribute labels to the context sent to the AI provider, and only approved elements can be targeted by steps."
      flush
      actions={
        canEdit ? (
          <Button size="sm" onClick={() => setImportOpen(true)}>
            Import JSON
          </Button>
        ) : null
      }
    >
      {res.loading && !res.data ? (
        <SkeletonRows rows={4} label="Loading element catalog" />
      ) : res.error ? (
        <div className="pad">
          <ErrorState message={res.error} onRetry={res.reload} />
        </div>
      ) : res.data && res.data.elements.length === 0 ? (
        <EmptyState compact title="No elements discovered yet">
          Open your app in development with the SDK installed (discovery must be enabled in Privacy & Security), or import a catalog as JSON.
        </EmptyState>
      ) : (
        <>
          <div className="table-toolbar">
            <Input className="table-toolbar__search" type="search" placeholder="Filter elements" aria-label="Filter elements" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <span className="muted">
              {approvedCount} of {res.data?.elements.length ?? 0} approved
            </span>
          </div>
          <Table<CatalogElementDTO>
            caption="Element catalog"
            rows={elements}
            rowKey={(e) => e.id}
            empty={<p className="card-empty">No elements match “{filter}”.</p>}
            columns={[
              { key: 'id', header: 'navoro id', render: (e) => <code className="code-chip">{e.navoroId}</code> },
              { key: 'label', header: 'Label', render: (e) => e.label ?? <span className="muted">—</span> },
              { key: 'role', header: 'Role', hideOnMobile: true, render: (e) => <span className="muted">{e.role ?? '—'}</span> },
              { key: 'route', header: 'Route', hideOnMobile: true, render: (e) => (e.route ? <code className="muted">{e.route}</code> : <span className="muted">—</span>) },
              { key: 'src', header: 'Source', hideOnMobile: true, render: (e) => <Badge>{e.source === 'sdk_discovery' ? 'Discovered' : 'Manual'}</Badge> },
              {
                key: 'ok',
                header: 'Approved',
                align: 'right',
                render: (e) => (
                  <span className="catalog-switch">
                    <Switch
                      label={<span className="n-visually-hidden">Approve {e.navoroId}</span>}
                      checked={e.approved}
                      disabled={!canEdit || pending.has(e.id)}
                      onChange={(v) => void toggle(e, v)}
                    />
                  </span>
                ),
              },
            ]}
          />
        </>
      )}
      <Dialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        dismissible={!importing}
        size="lg"
        title="Import element catalog"
        description="Paste JSON exported from your design system or test suite. Imported elements are marked Manual."
        footer={
          <>
            <Button onClick={() => setImportOpen(false)} disabled={importing}>
              Cancel
            </Button>
            <Button variant="primary" onClick={doImport} loading={importing} disabled={!json.trim()}>
              Import
            </Button>
          </>
        }
      >
        <Field label="Elements JSON" error={jsonError} hint='Format: [{ "navoroId": "billing.add-seat", "label": "Add seat", "role": "button", "route": "/settings/billing" }]'>
          {(ids) => (
            <Textarea
              {...ids}
              className="n-textarea--mono"
              rows={10}
              value={json}
              onChange={(e) => {
                setJson(e.target.value);
                setJsonError(null);
              }}
              spellCheck={false}
              data-autofocus=""
            />
          )}
        </Field>
      </Dialog>
    </Card>
  );
}

/* ───────────── Page ───────────── */

export function ApplicationDetailPage({ id }: { id: string }) {
  const res = useResource((s) => api.application(id, s), [id]);
  const { upsert, select, selectedId } = useWorkspace();
  const canEdit = useCanEdit();
  useDocumentTitle(res.data?.name ?? 'Application');

  // Viewing an application selects it for the rest of the dashboard.
  useEffect(() => {
    if (res.data && selectedId !== res.data.id) select(res.data.id);
  }, [res.data, selectedId, select]);

  const onSaved = (a: ApplicationDetail) => {
    res.setData(a);
    upsert(a);
  };

  const back = (
    <Link href={paths.applications()}>
      <IconArrowLeft size={14} /> Applications
    </Link>
  );

  if (res.loading && !res.data) return <PageSkeleton />;
  if (res.error && !res.data)
    return (
      <>
        <PageHeader title="Application" back={back} />
        <ErrorState message={res.error} onRetry={res.reload} />
      </>
    );
  const app = res.data!;
  const conn = connectionOf(app.lastSeenAt);
  return (
    <>
      <PageHeader
        back={back}
        title={app.name}
        description={
          <span className="app-head-meta">
            <StatusPill tone={conn.tone}>{conn.label}</StatusPill>
            <span>{app.sdkVersion ? `SDK ${app.sdkVersion}` : 'SDK not installed yet'}</span>
          </span>
        }
      />
      {!canEdit ? <ReadOnlyBanner /> : null}
      <div className="stack-lg">
        <InstallCard app={app} />
        <Card title="Environments" description="Origins allowed to load Navoro, and when the SDK last checked in.">
          <div className="envs">
            {app.environments.map((env) => (
              <EnvironmentRow key={env.id} app={app} env={env} onSaved={onSaved} />
            ))}
          </div>
        </Card>
        <VersionsCard app={app} onPublished={() => res.reload()} />
        <GeneralCard app={app} onSaved={onSaved} />
        <CatalogCard appId={app.id} />
      </div>
    </>
  );
}
