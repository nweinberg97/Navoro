import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { BlueprintDTO, PrivacyPolicyDTO, PrivacyPolicyInput } from '../../../../packages/contracts/src/admin-types.ts';
import type { ContextCategory, EnvironmentName } from '../../../../packages/contracts/src/sdk-types.ts';
import { api, errorMessage } from '../api.ts';
import { useDocumentTitle, useResource } from '../hooks.ts';
import { useCanEdit } from '../session.tsx';
import { formatDateTime, timeAgo } from '../format.ts';
import { PublishDialog } from '../PublishDialog.tsx';
import { ReadOnlyBanner, RequireApp } from './common.tsx';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  Notice,
  PageHeader,
  PageSkeleton,
  Select,
  Switch,
  useToast,
} from '../../ui/index.ts';
import { IconEyeOff, IconPlus, IconTrash } from '../icons.tsx';

const CATEGORIES: Array<{ key: ContextCategory; label: string; description: string }> = [
  { key: 'route', label: 'Page route', description: 'The URL path, e.g. /settings/members. Never query strings or fragments.' },
  { key: 'pageTitle', label: 'Page title', description: 'The document title shown in the browser tab.' },
  { key: 'headings', label: 'Headings', description: 'Visible section headings, so Navoro knows which screen the user is on.' },
  { key: 'elements', label: 'Approved controls', description: 'Labels and enabled/disabled state of approved elements only. Never input values.' },
  { key: 'fieldLabels', label: 'Field labels', description: 'Form field labels, e.g. “Email address”. The values people type are never read.' },
  { key: 'visibleErrors', label: 'Visible errors', description: 'Error messages your app marks with data-navoro-error, so Navoro can help fix them.' },
];

type Rule = PrivacyPolicyInput['neverCollect'][number];

function toInput(p: PrivacyPolicyDTO): PrivacyPolicyInput {
  return {
    observe: p.observe,
    transmit: p.transmit,
    neverCollect: p.neverCollect.map((r) => ({ kind: r.kind, value: r.value, label: r.label })),
    retainQuestions: p.retainQuestions,
    retentionDays: p.retentionDays,
    analyticsEnabled: p.analyticsEnabled,
    discoveryInDevelopment: p.discoveryInDevelopment,
    environments: p.environments,
  };
}

function sameInput(a: PrivacyPolicyInput, b: PrivacyPolicyInput): boolean {
  const norm = (x: PrivacyPolicyInput) =>
    JSON.stringify({
      ...x,
      observe: [...x.observe].sort(),
      transmit: [...x.transmit].sort(),
      environments: [...x.environments].sort(),
      neverCollect: x.neverCollect.map((r) => `${r.kind}:${r.value}:${r.label}`).sort(),
    });
  return norm(a) === norm(b);
}

/* ───────────── Training mode ───────────── */

function TrainingMode({
  appId,
  rules,
  onToggle,
  canEdit,
}: {
  appId: string;
  rules: Rule[];
  onToggle: (navoroId: string, label: string) => void;
  canEdit: boolean;
}) {
  const res = useResource((s) => api.blueprints(appId, s), [appId]);
  const [routeIdx, setRouteIdx] = useState(0);
  const frameRef = useRef<HTMLDivElement>(null);
  const [frameWidth, setFrameWidth] = useState(640);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setFrameWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [res.data]);

  // Latest blueprint per route.
  const blueprints = useMemo(() => {
    const byRoute = new Map<string, BlueprintDTO>();
    for (const b of res.data?.blueprints ?? []) {
      const prev = byRoute.get(b.route);
      if (!prev || prev.capturedAt < b.capturedAt) byRoute.set(b.route, b);
    }
    return [...byRoute.values()].sort((a, b) => a.route.localeCompare(b.route));
  }, [res.data]);

  const bp = blueprints[Math.min(routeIdx, blueprints.length - 1)];
  const blocked = new Set(rules.filter((r) => r.kind === 'navoro_id').map((r) => r.value));

  if (res.loading && !res.data) return <div className="training__loading" role="status" aria-label="Loading blueprints" />;
  if (res.error) return <ErrorState message={res.error} onRetry={res.reload} />;
  if (!bp)
    return (
      <EmptyState compact icon={<IconEyeOff />} title="No page blueprints yet">
        Open your app (or the Lumen demo) in development once with the SDK installed and “Discovery in development” enabled. The SDK captures a structural outline of each page — positions and labels only, never content — so you can mark sensitive areas here.
      </EmptyState>
    );

  const docW = Math.max(bp.viewport.width, 1);
  const docH = Math.max(bp.documentHeight, bp.viewport.height, 1);
  const scale = frameWidth / docW;
  const height = Math.min(docH * scale, 640);
  // Larger elements first so smaller ones sit on top and stay clickable.
  const elements = [...bp.elements].sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height);

  return (
    <div className="training">
      <div className="training__bar">
        <Field label="Page" className="training__route">
          {(ids) => (
            <Select {...ids} value={String(routeIdx)} onChange={(e) => setRouteIdx(Number(e.target.value))}>
              {blueprints.map((b, i) => (
                <option key={b.id} value={i}>
                  {b.route}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <p className="training__meta">
          {bp.elements.length} elements · {bp.viewport.width}×{bp.viewport.height} viewport · captured {timeAgo(bp.capturedAt).toLowerCase()}
        </p>
      </div>
      <ul className="training__legend" aria-label="Legend">
        <li>
          <span className="tl tl--el" aria-hidden="true" /> Element
        </li>
        <li>
          <span className="tl tl--input" aria-hidden="true" /> Input field
        </li>
        <li>
          <span className="tl tl--blocked" aria-hidden="true" /> Never collect
        </li>
      </ul>
      <div className="training__frame" ref={frameRef} style={{ height }}>
        <div className="training__canvas" style={{ height: docH * scale }} role="group" aria-label={`Wireframe of ${bp.route}. Select an element to mark it sensitive.`}>
          {elements.map((el) => {
            const isBlocked = blocked.has(el.navoroId);
            const isInput = el.tag === 'input' || el.tag === 'textarea' || el.tag === 'select' || el.role === 'textbox';
            const w = el.rect.width * scale;
            const h = el.rect.height * scale;
            const name = el.label || el.navoroId;
            return (
              <button
                key={el.navoroId}
                type="button"
                className={['bp-box', isInput ? 'bp-box--input' : '', isBlocked ? 'bp-box--blocked' : ''].join(' ')}
                style={{ left: el.rect.x * scale, top: el.rect.y * scale, width: Math.max(w, 6), height: Math.max(h, 6) }}
                aria-pressed={isBlocked}
                aria-label={`${name} (${el.navoroId}${el.inputType ? `, ${el.inputType} input` : ''})${isBlocked ? ' — never collect' : ''}`}
                title={`${name}\n${el.navoroId}${isBlocked ? '\nNever collect' : ''}`}
                disabled={!canEdit}
                onClick={() => onToggle(el.navoroId, el.label ?? el.navoroId)}
              >
                {w > 56 && h > 14 ? <span className="bp-box__label">{name}</span> : null}
              </button>
            );
          })}
        </div>
      </div>
      <p className="training__hint">Click an element to toggle it as sensitive. Changes are added to the “Never collect” rules below and apply when you save and publish.</p>
    </div>
  );
}

/* ───────────── Page body ───────────── */

function PrivacyBody({ appId, appName }: { appId: string; appName: string }) {
  const canEdit = useCanEdit();
  const toast = useToast();
  const res = useResource((s) => api.privacy(appId, s), [appId]);
  const [draft, setDraft] = useState<PrivacyPolicyInput | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [newKind, setNewKind] = useState<Rule['kind']>('navoro_id');
  const [newValue, setNewValue] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [ruleErr, setRuleErr] = useState<string | null>(null);
  const [retentionErr, setRetentionErr] = useState<string | null>(null);

  useEffect(() => {
    if (res.data) setDraft(toInput(res.data));
  }, [res.data]);

  if (res.loading && !res.data) return <PageSkeleton />;
  if (res.error && !res.data)
    return (
      <>
        <PageHeader title="Privacy & Security" />
        <ErrorState message={res.error} onRetry={res.reload} />
      </>
    );
  const policy = res.data!;
  const d = draft ?? toInput(policy);
  const dirty = !sameInput(d, toInput(policy));
  const set = (patch: Partial<PrivacyPolicyInput>) => setDraft({ ...d, ...patch });

  const toggleObserve = (c: ContextCategory, on: boolean) => {
    const observe = on ? [...d.observe, c] : d.observe.filter((x) => x !== c);
    // transmit must stay a subset of observe
    const transmit = on ? d.transmit : d.transmit.filter((x) => x !== c);
    set({ observe, transmit });
  };
  const toggleTransmit = (c: ContextCategory, on: boolean) => {
    set({ transmit: on ? [...d.transmit, c] : d.transmit.filter((x) => x !== c) });
  };
  const toggleEnv = (e: EnvironmentName, on: boolean) => set({ environments: on ? [...d.environments, e] : d.environments.filter((x) => x !== e) });

  const toggleBlocked = (navoroId: string, label: string) => {
    const exists = d.neverCollect.some((r) => r.kind === 'navoro_id' && r.value === navoroId);
    set({
      neverCollect: exists ? d.neverCollect.filter((r) => !(r.kind === 'navoro_id' && r.value === navoroId)) : [...d.neverCollect, { kind: 'navoro_id', value: navoroId, label }],
    });
  };

  const addRule = (e: FormEvent) => {
    e.preventDefault();
    const value = newValue.trim();
    if (!value) {
      setRuleErr(newKind === 'navoro_id' ? 'Enter a navoro id.' : 'Enter a CSS selector.');
      return;
    }
    if (newKind === 'selector') {
      try {
        document.createDocumentFragment().querySelector(value);
      } catch {
        setRuleErr('That isn’t a valid CSS selector.');
        return;
      }
    } else if (!/^[A-Za-z0-9._:-]+$/.test(value)) {
      setRuleErr('navoro ids use letters, numbers, dots, dashes, colons and underscores.');
      return;
    }
    if (d.neverCollect.some((r) => r.kind === newKind && r.value === value)) {
      setRuleErr('That rule already exists.');
      return;
    }
    set({ neverCollect: [...d.neverCollect, { kind: newKind, value, label: newLabel.trim() || value }] });
    setNewValue('');
    setNewLabel('');
    setRuleErr(null);
  };

  const save = async () => {
    if (!Number.isInteger(d.retentionDays) || d.retentionDays < 1 || d.retentionDays > 365) {
      setRetentionErr('Choose between 1 and 365 days.');
      return;
    }
    setRetentionErr(null);
    setSaving(true);
    try {
      const saved = await api.savePrivacy(appId, { ...d, transmit: d.transmit.filter((c) => d.observe.includes(c)) });
      res.setData(saved);
      setDraft(toInput(saved));
      toast.success('Privacy draft saved', 'Publish a configuration for the SDK to enforce it.');
    } catch (err) {
      toast.error('Couldn’t save privacy settings', errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const savedRuleKeys = new Set(policy.neverCollect.map((r) => `${r.kind}:${r.value}`));
  const pendingAdds = d.neverCollect.filter((r) => !savedRuleKeys.has(`${r.kind}:${r.value}`));
  const draftKeys = new Set(d.neverCollect.map((r) => `${r.kind}:${r.value}`));
  const pendingRemovals = policy.neverCollect.filter((r) => !draftKeys.has(`${r.kind}:${r.value}`));

  return (
    <>
      <PageHeader
        title="Privacy & Security"
        description={`Decide exactly what Navoro may see inside ${appName}, and what may leave the browser. The SDK enforces this allowlist before anything is sent.`}
        actions={
          canEdit ? (
            <>
              {policy.unpublishedChanges && !dirty ? (
                <Button variant="primary" onClick={() => setPublishOpen(true)}>
                  Publish policy
                </Button>
              ) : null}
              <Button variant={dirty ? 'primary' : 'secondary'} onClick={save} loading={saving} disabled={!dirty}>
                Save draft
              </Button>
            </>
          ) : null
        }
      />
      {!canEdit ? <ReadOnlyBanner /> : null}

      <div className="stack-lg privacy">
        {dirty ? (
          <Notice tone="warning" title="Unsaved changes" action={canEdit ? <Button size="sm" variant="primary" onClick={save} loading={saving}>Save draft</Button> : null}>
            Your edits aren’t saved yet.
          </Notice>
        ) : policy.unpublishedChanges ? (
          <Notice tone="info" title="Saved, not yet published" action={canEdit ? <Button size="sm" onClick={() => setPublishOpen(true)}>Publish…</Button> : null}>
            The SDK keeps enforcing the last published policy until you publish a new configuration.
          </Notice>
        ) : (
          <p className="privacy__status">
            <Badge tone="success">In sync</Badge> Draft matches what’s published · last changed {formatDateTime(policy.updatedAt)}
          </p>
        )}

        <Card title="Data flow" description="Observing happens locally in the browser. Only categories you also allow to be sent ever leave it.">
          <div className="flow" role="table" aria-label="Context categories">
            <div className="flow__head" role="row">
              <span role="columnheader">Category</span>
              <span role="columnheader">May observe</span>
              <span role="columnheader">May send to AI provider</span>
            </div>
            {CATEGORIES.map((c) => {
              const observed = d.observe.includes(c.key);
              const sent = d.transmit.includes(c.key) && observed;
              return (
                <div className="flow__row" role="row" key={c.key}>
                  <div className="flow__cat" role="cell">
                    <span className="flow__label">{c.label}</span>
                    <span className="flow__desc">{c.description}</span>
                  </div>
                  <div role="cell" className="flow__cell">
                    <Checkbox label={<span className="n-visually-hidden">Observe {c.label}</span>} checked={observed} disabled={!canEdit} onChange={(e) => toggleObserve(c.key, e.target.checked)} />
                  </div>
                  <div role="cell" className="flow__cell">
                    <Checkbox
                      label={<span className="n-visually-hidden">Send {c.label}</span>}
                      checked={sent}
                      disabled={!canEdit || !observed}
                      onChange={(e) => toggleTransmit(c.key, e.target.checked)}
                      title={!observed ? 'Turn on observing first' : undefined}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="flow__foot">Sending requires observing. Input values, passwords, and anything outside approved elements are never transmitted.</p>
        </Card>

        <Card title="Training Mode" description="Point at sensitive regions on a wireframe of your pages. Navoro will never read inside them.">
          <TrainingMode appId={appId} rules={d.neverCollect} onToggle={toggleBlocked} canEdit={canEdit} />
          {pendingAdds.length + pendingRemovals.length > 0 ? (
            <div className="review">
              <p className="review__title">Changes to review before saving</p>
              <ul>
                {pendingAdds.map((r) => (
                  <li key={`a-${r.kind}-${r.value}`}>
                    <Badge tone="danger">Block</Badge> <span>{r.label}</span> <code>{r.value}</code>
                  </li>
                ))}
                {pendingRemovals.map((r) => (
                  <li key={`r-${r.id}`}>
                    <Badge>Unblock</Badge> <span>{r.label}</span> <code>{r.value}</code>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>

        <Card title="Never collect" description="Elements and regions whose entire subtree the SDK skips — nothing inside is observed or sent." flush>
          {d.neverCollect.length === 0 ? (
            <p className="card-empty">No custom rules. Built-in exclusions still apply.</p>
          ) : (
            <ul className="rules">
              {d.neverCollect.map((r) => (
                <li key={`${r.kind}:${r.value}`} className="rule">
                  <span className="rule__kind">{r.kind === 'navoro_id' ? 'navoro id' : 'selector'}</span>
                  <code className="rule__value">{r.value}</code>
                  <span className="rule__label">{r.label}</span>
                  {canEdit ? (
                    <IconButton label={`Remove rule ${r.label}`} size="sm" onClick={() => set({ neverCollect: d.neverCollect.filter((x) => x !== r) })}>
                      <IconTrash size={16} />
                    </IconButton>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {canEdit ? (
            <form className="rule-add" onSubmit={addRule} noValidate>
              <Field label="Match by">
                {(ids) => (
                  <Select {...ids} value={newKind} onChange={(e) => setNewKind(e.target.value as Rule['kind'])}>
                    <option value="navoro_id">navoro id</option>
                    <option value="selector">CSS selector</option>
                  </Select>
                )}
              </Field>
              <Field label={newKind === 'navoro_id' ? 'navoro id' : 'Selector'} error={ruleErr}>
                {(ids) => (
                  <Input {...ids} className="n-mono" value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder={newKind === 'navoro_id' ? 'billing.card-number' : '.patient-notes'} spellCheck={false} />
                )}
              </Field>
              <Field label="Label" optional>
                {(ids) => <Input {...ids} value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Card details" />}
              </Field>
              <Button type="submit" icon={<IconPlus size={16} />}>
                Add rule
              </Button>
            </form>
          ) : null}
        </Card>

        <Card title="Built-in exclusions" description="Always enforced by the SDK, regardless of configuration.">
          {policy.builtInExclusions.length ? (
            <ul className="builtins">
              {policy.builtInExclusions.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          ) : (
            <p className="muted small">None reported by the server.</p>
          )}
        </Card>

        <Card title="Retention & analytics">
          <div className="stack-md">
            <Switch
              label="Retain question text"
              description="Off by default. When on, the text people type is stored so you can see real questions in Analytics. When off, only topics and outcomes are kept."
              checked={d.retainQuestions}
              disabled={!canEdit}
              onChange={(v) => set({ retainQuestions: v })}
            />
            <div className="retention">
              <Field label="Retention period" hint="Applies to stored questions and analytics events." error={retentionErr}>
                {(ids) => (
                  <span className="input-suffix">
                    <Input
                      {...ids}
                      type="number"
                      min={1}
                      max={365}
                      value={Number.isFinite(d.retentionDays) ? d.retentionDays : ''}
                      disabled={!canEdit}
                      onChange={(e) => set({ retentionDays: Number.parseInt(e.target.value, 10) })}
                    />
                    <span>days</span>
                  </span>
                )}
              </Field>
            </div>
            <Switch
              label="Usage analytics"
              description="Session outcomes, step views and drop-offs. Never includes page content."
              checked={d.analyticsEnabled}
              disabled={!canEdit}
              onChange={(v) => set({ analyticsEnabled: v })}
            />
            <Switch
              label="Discovery in development"
              description="Lets the SDK report element IDs and page blueprints from development origins only. Powers the element catalog and Training Mode."
              checked={d.discoveryInDevelopment}
              disabled={!canEdit}
              onChange={(v) => set({ discoveryInDevelopment: v })}
            />
          </div>
        </Card>

        <Card title="Environments" description="Where this policy allows Navoro to run at all.">
          <div className="stack-sm">
            <Checkbox label="Development" checked={d.environments.includes('development')} disabled={!canEdit} onChange={(e) => toggleEnv('development', e.target.checked)} />
            <Checkbox label="Production" checked={d.environments.includes('production')} disabled={!canEdit} onChange={(e) => toggleEnv('production', e.target.checked)} />
            {d.environments.length === 0 ? <p className="field-warn">With no environments allowed, Navoro won’t load anywhere.</p> : null}
          </div>
        </Card>

        {canEdit ? (
          <div className="sticky-save" data-visible={dirty || undefined}>
            <span>{dirty ? 'You have unsaved privacy changes.' : 'All changes saved.'}</span>
            <Button variant="primary" onClick={save} loading={saving} disabled={!dirty}>
              Save draft
            </Button>
          </div>
        ) : null}
      </div>

      <PublishDialog
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        applicationId={appId}
        applicationName={appName}
        allowedEnvironments={policy.environments}
        defaultEnvironment={policy.environments.includes('development') ? 'development' : 'production'}
        onPublished={() => res.reload()}
      />
    </>
  );
}

export function PrivacyPage() {
  useDocumentTitle('Privacy & Security');
  return <RequireApp title="Privacy & Security">{(app) => <PrivacyBody key={app.id} appId={app.id} appName={app.name} />}</RequireApp>;
}
