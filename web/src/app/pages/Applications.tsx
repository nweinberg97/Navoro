import { useEffect, useState, type FormEvent } from 'react';
import type { ApplicationSummary } from '../../../../packages/contracts/src/admin-types.ts';
import { api, errorMessage } from '../api.ts';
import { useDocumentTitle } from '../hooks.ts';
import { Link, paths, useRouter } from '../router.tsx';
import { useCanEdit, useWorkspace } from '../session.tsx';
import { parseOrigins, timeAgo, formatDate } from '../format.ts';
import { Button, Dialog, EmptyState, ErrorState, Field, Input, PageHeader, SkeletonRows, StatusPill, Table, Textarea, useToast, Badge } from '../../ui/index.ts';
import { IconApplications, IconPlus } from '../icons.tsx';

export function connectionOf(lastSeenAt: string | null): { label: string; tone: 'success' | 'warning' | 'neutral' } {
  if (!lastSeenAt) return { label: 'Never connected', tone: 'neutral' };
  const age = Date.now() - new Date(lastSeenAt).getTime();
  // Assumption: "connected" means the SDK initialised within the last 24 hours.
  return age < 24 * 3600 * 1000 ? { label: 'Connected', tone: 'success' } : { label: 'Not seen recently', tone: 'warning' };
}

export function RegisterApplicationDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { upsert, select } = useWorkspace();
  const { navigate } = useRouter();
  const toast = useToast();
  const [name, setName] = useState('');
  const [dev, setDev] = useState('http://localhost:4500');
  const [prod, setProd] = useState('');
  const [errors, setErrors] = useState<{ name?: string; dev?: string; prod?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName('');
      setDev('http://localhost:4500');
      setProd('');
      setErrors({});
      setFormError(null);
    }
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!name.trim()) next.name = 'Give the application a name.';
    const d = parseOrigins(dev);
    const p = parseOrigins(prod);
    if (d.error) next.dev = d.error;
    if (p.error) next.prod = p.error;
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    setFormError(null);
    try {
      const app = await api.createApplication({ name: name.trim(), developmentOrigins: d.origins, productionOrigins: p.origins });
      upsert(app);
      select(app.id);
      toast.success('Application registered', `${app.name} is ready to connect.`);
      onClose();
      navigate(paths.application(app.id));
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!busy}
      title="Register application"
      description="Navoro only answers requests from origins you allow. You can change these later."
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="register-app" loading={busy}>
            Register
          </Button>
        </>
      }
    >
      <form id="register-app" onSubmit={submit} noValidate className="form-stack">
        {formError ? <ErrorState title="Couldn’t register the application" message={formError} /> : null}
        <Field label="Name" error={errors.name}>
          {(ids) => <Input {...ids} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lumen" data-autofocus="" />}
        </Field>
        <Field label="Development origins" hint="One per line, e.g. http://localhost:3000. Element discovery and Training Mode only run here." error={errors.dev} optional>
          {(ids) => <Textarea {...ids} className="n-textarea--mono" rows={3} value={dev} onChange={(e) => setDev(e.target.value)} spellCheck={false} />}
        </Field>
        <Field label="Production origins" hint="One per line, e.g. https://app.example.com." error={errors.prod} optional>
          {(ids) => <Textarea {...ids} className="n-textarea--mono" rows={3} value={prod} onChange={(e) => setProd(e.target.value)} spellCheck={false} placeholder="https://app.example.com" />}
        </Field>
      </form>
    </Dialog>
  );
}

export function ApplicationsPage() {
  useDocumentTitle('Applications');
  const { applications, loading, error, reload } = useWorkspace();
  const { location, navigate } = useRouter();
  const canEdit = useCanEdit();
  const wantsRegister = new URLSearchParams(location.search).get('register') === '1';
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (wantsRegister && canEdit) {
      setOpen(true);
      navigate(paths.applications(), { replace: true });
    }
  }, [wantsRegister, canEdit, navigate]);

  return (
    <>
      <PageHeader
        title="Applications"
        description="Each application has its own knowledge, guidance, privacy policy and install key."
        actions={
          canEdit ? (
            <Button variant="primary" icon={<IconPlus size={16} />} onClick={() => setOpen(true)}>
              Register application
            </Button>
          ) : null
        }
      />
      <div className="n-card n-card--table">
        {loading ? (
          <SkeletonRows rows={2} label="Loading applications" />
        ) : error ? (
          <div className="pad">
            <ErrorState message={error} onRetry={() => void reload()} />
          </div>
        ) : (
          <Table<ApplicationSummary>
            caption="Applications"
            rows={applications}
            rowKey={(a) => a.id}
            onRowClick={(a) => navigate(paths.application(a.id))}
            empty={
              <EmptyState
                icon={<IconApplications />}
                title="No applications yet"
                action={
                  canEdit ? (
                    <Button variant="primary" icon={<IconPlus size={16} />} onClick={() => setOpen(true)}>
                      Register application
                    </Button>
                  ) : null
                }
              >
                Register the web app you want to guide people through. You’ll get an install snippet and a public key.
              </EmptyState>
            }
            columns={[
              {
                key: 'name',
                header: 'Name',
                render: (a) => (
                  <Link href={paths.application(a.id)} className="cell-title">
                    {a.name}
                  </Link>
                ),
              },
              {
                key: 'conn',
                header: 'Connection',
                render: (a) => {
                  const c = connectionOf(a.lastSeenAt);
                  return <StatusPill tone={c.tone}>{c.label}</StatusPill>;
                },
              },
              {
                key: 'envs',
                header: 'Environments',
                hideOnMobile: true,
                render: (a) => (
                  <span className="env-chips">
                    {a.environments.map((e) => (
                      <Badge key={e.id} tone={e.activeConfigVersion != null ? 'success' : 'neutral'}>
                        {e.name === 'development' ? 'Dev' : 'Prod'} {e.activeConfigVersion != null ? `v${e.activeConfigVersion}` : '—'}
                      </Badge>
                    ))}
                  </span>
                ),
              },
              { key: 'sdk', header: 'SDK', hideOnMobile: true, render: (a) => <span className="muted">{a.sdkVersion ?? '—'}</span> },
              { key: 'seen', header: 'Last seen', hideOnMobile: true, render: (a) => <span className="muted">{timeAgo(a.lastSeenAt)}</span> },
              { key: 'created', header: 'Created', hideOnMobile: true, render: (a) => <span className="muted">{formatDate(a.createdAt)}</span> },
            ]}
          />
        )}
      </div>
      <RegisterApplicationDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
