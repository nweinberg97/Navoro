import { useEffect, useState, type FormEvent } from 'react';
import type { Role, SettingsResponse } from '../../../../packages/contracts/src/admin-types.ts';
import { api, errorMessage } from '../api.ts';
import { useDocumentTitle, useResource } from '../hooks.ts';
import { useCanEdit, useMe } from '../session.tsx';
import { formatDate, formatDateTime } from '../format.ts';
import { ProviderLine } from './Overview.tsx';
import { ReadOnlyBanner } from './common.tsx';
import {
  Badge,
  Button,
  Card,
  CopyField,
  Dialog,
  ErrorState,
  Field,
  Input,
  PageHeader,
  PageSkeleton,
  Select,
  SkeletonRows,
  Table,
  useToast,
} from '../../ui/index.ts';
import { IconPlus } from '../icons.tsx';

const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' };
const ROLE_DESC: Record<Role, string> = {
  owner: 'Full control, including members and billing.',
  admin: 'Manage applications, knowledge, guidance and privacy.',
  member: 'Read-only access to everything.',
};

function AddMemberDialog({ open, onClose, onAdded, canGrantOwner }: { open: boolean; onClose: () => void; onAdded: (s: SettingsResponse) => void; canGrantOwner: boolean }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', email: '', role: 'member' as Role, password: '' });
  const [errors, setErrors] = useState<Partial<Record<keyof typeof form, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({ name: '', email: '', role: 'member', password: '' });
      setErrors({});
      setFormError(null);
    }
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!form.name.trim()) next.name = 'Enter their name.';
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) next.email = 'Enter a valid email address.';
    if (form.password.length < 10) next.password = 'Use at least 10 characters.';
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    setFormError(null);
    try {
      const s = await api.addMember({ name: form.name.trim(), email: form.email.trim(), role: form.role, password: form.password });
      onAdded(s);
      toast.success('Member added', `Share the initial password with ${form.name.trim()} securely.`);
      onClose();
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
      title="Add member"
      description="This build doesn’t send email. Set an initial password and share it with them through a secure channel."
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="add-member" loading={busy}>
            Add member
          </Button>
        </>
      }
    >
      <form id="add-member" className="form-stack" onSubmit={submit} noValidate>
        {formError ? <ErrorState title="Couldn’t add member" message={formError} /> : null}
        <div className="form-grid">
          <Field label="Name" error={errors.name}>
            {(ids) => <Input {...ids} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-autofocus="" />}
          </Field>
          <Field label="Email" error={errors.email}>
            {(ids) => <Input {...ids} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />}
          </Field>
        </div>
        <Field label="Role" hint={ROLE_DESC[form.role]}>
          {(ids) => (
            <Select {...ids} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
              {canGrantOwner ? <option value="owner">Owner</option> : null}
            </Select>
          )}
        </Field>
        <Field label="Initial password" hint={errors.password ? undefined : 'At least 10 characters. They can change it after signing in.'} error={errors.password}>
          {(ids) => <Input {...ids} type="text" autoComplete="new-password" className="n-mono" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} spellCheck={false} />}
        </Field>
      </form>
    </Dialog>
  );
}

export function SettingsPage() {
  useDocumentTitle('Settings');
  const me = useMe();
  const canEdit = useCanEdit();
  const toast = useToast();
  const res = useResource((s) => api.settings(s), []);
  const audit = useResource((s) => api.audit(s), []);
  const [orgName, setOrgName] = useState('');
  const [orgErr, setOrgErr] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [roleBusy, setRoleBusy] = useState<string | null>(null);

  useEffect(() => {
    if (res.data) setOrgName(res.data.organization.name);
  }, [res.data]);

  useEffect(() => {
    if (window.location.hash === '#audit' && audit.data) document.getElementById('audit')?.scrollIntoView();
  }, [audit.data]);

  if (res.loading && !res.data) return <PageSkeleton />;
  if (res.error && !res.data)
    return (
      <>
        <PageHeader title="Settings" />
        <ErrorState message={res.error} onRetry={res.reload} />
      </>
    );
  const s = res.data!;

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    if (!orgName.trim()) {
      setOrgErr('Organization name is required.');
      return;
    }
    setOrgErr(null);
    setSavingName(true);
    try {
      res.setData(await api.updateSettings({ name: orgName.trim() }));
      toast.success('Organization renamed');
    } catch (err) {
      toast.error('Couldn’t save', errorMessage(err));
    } finally {
      setSavingName(false);
    }
  };

  const setPolicy = async (p: 'manual' | 'auto') => {
    if (p === s.organization.approvalPolicy) return;
    setSavingPolicy(true);
    try {
      res.setData(await api.updateSettings({ approvalPolicy: p }));
      toast.success('Approval policy updated');
    } catch (err) {
      toast.error('Couldn’t update policy', errorMessage(err));
    } finally {
      setSavingPolicy(false);
    }
  };

  const changeRole = async (userId: string, role: Role) => {
    setRoleBusy(userId);
    try {
      res.setData(await api.setMemberRole(userId, role));
      toast.success('Role updated');
    } catch (err) {
      toast.error('Couldn’t change role', errorMessage(err));
    } finally {
      setRoleBusy(null);
    }
  };

  const isOwner = me.role === 'owner';

  return (
    <>
      <PageHeader title="Settings" description={`Workspace settings for ${s.organization.name}.`} />
      {!canEdit ? <ReadOnlyBanner /> : null}
      <div className="stack-lg">
        <Card title="Organization">
          <form className="org-form" onSubmit={saveName} noValidate>
            <Field label="Name" error={orgErr}>
              {(ids) => <Input {...ids} value={orgName} onChange={(e) => setOrgName(e.target.value)} disabled={!canEdit} />}
            </Field>
            <Field label="Workspace slug" hint="Used in URLs and logs. Can’t be changed.">
              {(ids) => <Input {...ids} className="n-mono" value={s.organization.slug} readOnly />}
            </Field>
            {canEdit ? (
              <div className="org-form__actions">
                <Button type="submit" variant="primary" loading={savingName} disabled={orgName.trim() === s.organization.name}>
                  Save
                </Button>
              </div>
            ) : null}
          </form>
        </Card>

        <Card title="Refresh Learning approval" description="What happens after Refresh Learning extracts new or changed workflows.">
          <div className="policy" role="radiogroup" aria-label="Approval policy">
            {(
              [
                {
                  key: 'manual',
                  title: 'Manual review',
                  body: 'New and changed workflows wait as drafts or needs review. Nothing reaches end users until someone approves and publishes. Recommended.',
                },
                {
                  key: 'auto',
                  title: 'Auto-publish when validation passes',
                  body: 'If every target validates against approved application metadata and confidence is high, Navoro publishes to development automatically. Anything uncertain still waits for review.',
                },
              ] as const
            ).map((o) => {
              const on = s.organization.approvalPolicy === o.key;
              return (
                <button
                  key={o.key}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className={['policy__opt', on ? 'policy__opt--on' : ''].join(' ')}
                  disabled={!canEdit || savingPolicy}
                  onClick={() => void setPolicy(o.key)}
                >
                  <span className="policy__radio" aria-hidden="true" />
                  <span className="policy__text">
                    <span className="policy__title">{o.title}</span>
                    <span className="policy__body">{o.body}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </Card>

        <Card
          title="Members"
          description={`${s.members.length} ${s.members.length === 1 ? 'person' : 'people'} in this workspace.`}
          flush
          actions={
            canEdit ? (
              <Button size="sm" variant="primary" icon={<IconPlus size={14} />} onClick={() => setAddOpen(true)}>
                Add member
              </Button>
            ) : null
          }
        >
          <Table
            caption="Members"
            rows={s.members}
            rowKey={(m) => m.userId}
            columns={[
              {
                key: 'name',
                header: 'Name',
                render: (m) => (
                  <div className="cell-stack">
                    <span className="cell-title">
                      {m.name}
                      {m.userId === me.user.id ? <span className="muted"> (you)</span> : null}
                    </span>
                    <span className="cell-sub">{m.email}</span>
                  </div>
                ),
              },
              {
                key: 'role',
                header: 'Role',
                render: (m) => {
                  // Assumption: only owners can grant/revoke owner; you can't change your own role.
                  const editable = canEdit && m.userId !== me.user.id && (isOwner || m.role !== 'owner');
                  return editable ? (
                    <Select
                      className="n-select--inline role-select"
                      aria-label={`Role for ${m.name}`}
                      value={m.role}
                      disabled={roleBusy === m.userId}
                      onChange={(e) => void changeRole(m.userId, e.target.value as Role)}
                    >
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                      {isOwner ? <option value="owner">Owner</option> : null}
                    </Select>
                  ) : (
                    <Badge tone={m.role === 'owner' ? 'accent' : 'neutral'}>{ROLE_LABEL[m.role]}</Badge>
                  );
                },
              },
              { key: 'since', header: 'Joined', hideOnMobile: true, render: (m) => <span className="muted">{formatDate(m.createdAt)}</span> },
            ]}
          />
        </Card>

        <Card title="AI provider" description="Navoro works without a model in demo mode, assembling answers from your knowledge locally.">
          <div className="stack-md">
            <ProviderLine provider={s.provider} />
            {s.provider.mode === 'demo' ? (
              <div className="provider-help">
                <p>To enable model-generated answers, set an API key in the server’s environment and restart it:</p>
                <CopyField label="Environment variable" value="ANTHROPIC_API_KEY=sk-ant-…" />
                <p className="small muted">The key stays on your server. It is never sent to the browser or the SDK.</p>
              </div>
            ) : (
              <p className="small muted">{s.provider.note}</p>
            )}
          </div>
        </Card>

        <section id="audit" aria-labelledby="audit-title" className="stack-sm">
          <h2 id="audit-title" className="section-h">
            Audit log
          </h2>
          <div className="n-card n-card--table">
            {audit.loading && !audit.data ? (
              <SkeletonRows rows={5} label="Loading audit log" />
            ) : audit.error && !audit.data ? (
              <div className="pad">
                <ErrorState message={audit.error} onRetry={audit.reload} />
              </div>
            ) : (
              <Table
                caption="Audit log"
                rows={audit.data?.events ?? []}
                rowKey={(e) => e.id}
                empty={<p className="card-empty">No events yet.</p>}
                columns={[
                  { key: 'when', header: 'When', width: '160px', render: (e) => <time className="muted" dateTime={e.createdAt}>{formatDateTime(e.createdAt)}</time> },
                  { key: 'who', header: 'Actor', hideOnMobile: true, render: (e) => e.actor ?? <span className="muted">System</span> },
                  { key: 'what', header: 'Event', render: (e) => e.summary },
                  { key: 'action', header: 'Action', hideOnMobile: true, render: (e) => <code className="code-chip">{e.action}</code> },
                ]}
              />
            )}
          </div>
        </section>
      </div>
      <AddMemberDialog open={addOpen} onClose={() => setAddOpen(false)} onAdded={(x) => res.setData(x)} canGrantOwner={isOwner} />
    </>
  );
}
