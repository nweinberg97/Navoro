import type { OverviewResponse, ProviderStatusDTO } from '../../../../packages/contracts/src/admin-types.ts';
import { api } from '../api.ts';
import { useDocumentTitle, useResource } from '../hooks.ts';
import { Link, paths, useRouter } from '../router.tsx';
import { useMe, useWorkspace, useCanEdit } from '../session.tsx';
import { RefreshButton, useRefresh } from '../refresh.tsx';
import { formatNumber, timeAgo } from '../format.ts';
import { Badge, Card, ErrorState, PageHeader, PageSkeleton, SegmentedBar, StatusPill, Button } from '../../ui/index.ts';
import { IconArrowRight, IconCheck } from '../icons.tsx';
import { useEffect } from 'react';

function greeting(name: string): string {
  const h = new Date().getHours();
  const first = name.split(/\s+/)[0] ?? name;
  if (h < 5) return `Working late, ${first}`;
  if (h < 12) return `Good morning, ${first}`;
  if (h < 18) return `Good afternoon, ${first}`;
  return `Good evening, ${first}`;
}

export function ProviderLine({ provider }: { provider: ProviderStatusDTO }) {
  return (
    <div className={`provider provider--${provider.mode}`}>
      <span className="provider__dot" aria-hidden="true" />
      <span className="provider__text">
        {provider.mode === 'llm' ? (
          <>
            <strong>Model connected</strong>
            <span>
              {[provider.provider, provider.model].filter(Boolean).join(' · ') || 'Language model'}
            </span>
          </>
        ) : (
          <>
            <strong>Demo mode — no model configured</strong>
            <span>{provider.note}</span>
          </>
        )}
      </span>
    </div>
  );
}

const CONNECTION = {
  connected: { label: 'Connected', tone: 'success' },
  stale: { label: 'Not seen recently', tone: 'warning' },
  never_connected: { label: 'Never connected', tone: 'neutral' },
} as const;

/* ───────────── Getting started (new workspace) ───────────── */

function GetStarted({ data }: { data: OverviewResponse }) {
  const { navigate } = useRouter();
  const canEdit = useCanEdit();
  const hasApp = data.applications.length > 0;
  const hasKnowledge = data.sources.total > 0;
  const live = data.applications.some((a) => a.connection !== 'never_connected' && a.publishedVersion != null);
  const firstApp = data.applications[0];
  const steps = [
    {
      done: hasApp,
      title: 'Register your application',
      body: 'Tell Navoro where your product runs. You’ll get a public key and an install snippet for development and production.',
      cta: 'Register application',
      href: `${paths.applications()}?register=1`,
    },
    {
      done: hasKnowledge,
      title: 'Add knowledge',
      body: 'Write a guide, paste a help article, upload Markdown, or point at your public docs. Navoro learns workflows and concepts from it.',
      cta: 'Add knowledge',
      href: paths.knowledge(),
    },
    {
      done: live,
      title: 'Install the SDK & publish',
      body: 'Drop the snippet into your app, open it once in development, review what Navoro learned, then publish a configuration.',
      cta: 'Open install steps',
      href: firstApp ? paths.application(firstApp.id) : paths.applications(),
    },
  ];
  const nextIndex = steps.findIndex((s) => !s.done);
  return (
    <section className="getstarted" aria-labelledby="gs-title">
      <div className="getstarted__intro">
        <p className="getstarted__eyebrow">Welcome to Navoro</p>
        <h2 id="gs-title" className="getstarted__title">
          Get Navoro running
        </h2>
        <p className="getstarted__lede">Three steps between your users and less searching. Most teams are live in under an hour.</p>
      </div>
      <ol className="getstarted__steps">
        {steps.map((s, i) => {
          const state = s.done ? 'done' : i === nextIndex ? 'current' : 'upcoming';
          return (
            <li key={s.title} className={`gs-step gs-step--${state}`}>
              <span className="gs-step__num" aria-hidden="true">
                {s.done ? <IconCheck size={14} strokeWidth={2.25} /> : i + 1}
              </span>
              <div className="gs-step__body">
                <h3>
                  {s.title}
                  {s.done ? <span className="n-visually-hidden"> (done)</span> : null}
                </h3>
                <p>{s.body}</p>
                {state === 'current' && canEdit ? (
                  <Button variant="primary" size="sm" onClick={() => navigate(s.href)} iconRight={<IconArrowRight size={14} />}>
                    {s.cta}
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/* ───────────── Page ───────────── */

export function OverviewPage() {
  useDocumentTitle('Overview');
  const me = useMe();
  const { selected, applications } = useWorkspace();
  const { completedCount } = useRefresh();
  const res = useResource((s) => api.overview(s), []);
  const { reload } = res;

  useEffect(() => {
    if (completedCount > 0) reload();
  }, [completedCount, reload]);

  if (res.loading && !res.data) return <PageSkeleton />;
  if (res.error && !res.data)
    return (
      <>
        <PageHeader title="Overview" />
        <ErrorState message={res.error} onRetry={res.reload} />
      </>
    );
  const d = res.data!;
  const isNew = d.applications.length === 0 || (d.sources.total === 0 && d.workflows.published === 0);
  const totalWorkflows = d.workflows.published + d.workflows.draft + d.workflows.needsReview;

  return (
    <>
      <PageHeader
        eyebrow={me.organization.name}
        title={greeting(me.user.name)}
        description={
          applications.length > 0
            ? selected
              ? `Here’s where ${selected.name} stands across your workspace.`
              : 'Here’s where your workspace stands.'
            : 'Let’s get your first application set up.'
        }
        actions={applications.length > 0 ? <RefreshButton /> : null}
      />

      <div className="overview">
        <ProviderLine provider={d.provider} />

        {isNew ? <GetStarted data={d} /> : null}

        {d.nextActions.length > 0 ? (
          <Card title="Recommended next" description="What would make guidance better right now." flush>
            <ul className="next-actions">
              {d.nextActions.map((a) => (
                <li key={a.id}>
                  <Link href={a.href} className="next-action">
                    <span className="next-action__box" aria-hidden="true" />
                    <span className="next-action__text">
                      <span className="next-action__title">{a.title}</span>
                      <span className="next-action__desc">{a.description}</span>
                    </span>
                    <IconArrowRight size={16} className="next-action__arrow" />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        {d.applications.length === 0 ? null : (
        <>
        <section aria-labelledby="ov-guidance" className="metrics">
          <h2 id="ov-guidance" className="metrics__title">
            Guidance <span>Last 7 days</span>
          </h2>
          <div className="metrics__row">
            <div className="metric metric--lead">
              <span className="metric__value">{formatNumber(d.guidance.sessions7d)}</span>
              <span className="metric__label">Sessions</span>
            </div>
            <div className="metric">
              <span className="metric__value">{formatNumber(d.guidance.answered7d)}</span>
              <span className="metric__label">Answered</span>
            </div>
            <div className="metric">
              <span className={['metric__value', d.guidance.unresolved7d > 0 ? 'metric__value--warn' : ''].join(' ')}>{formatNumber(d.guidance.unresolved7d)}</span>
              <span className="metric__label">Unresolved</span>
            </div>
            <div className="metric">
              <span className="metric__value">{formatNumber(d.guidance.completedWorkflows7d)}</span>
              <span className="metric__label">Workflows completed</span>
            </div>
          </div>
        </section>

        <div className="overview__grid">
          <Card title="Applications" description="SDK connection by application." flush actions={<Link href={paths.applications()} className="card-link">Manage</Link>}>
            {d.applications.length === 0 ? (
              <p className="card-empty">No applications registered yet.</p>
            ) : (
              <ul className="conn-list">
                {d.applications.map((a) => {
                  const c = CONNECTION[a.connection];
                  return (
                    <li key={a.id}>
                      <Link href={paths.application(a.id)} className="conn-row">
                        <span className="conn-row__name">{a.name}</span>
                        <span className="conn-row__meta">
                          {a.publishedVersion != null ? <Badge>v{a.publishedVersion} live</Badge> : <Badge tone="warning">Not published</Badge>}
                          <StatusPill tone={c.tone}>{c.label}</StatusPill>
                        </span>
                        <span className="conn-row__seen">{a.lastSeenAt ? `Seen ${timeAgo(a.lastSeenAt).toLowerCase()}` : 'Waiting for first SDK init'}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card title="Knowledge" description="Sources Navoro learns from." actions={<Link href={paths.knowledge()} className="card-link">Open</Link>}>
            <div className="kn-counts">
              <span className="kn-counts__total">{formatNumber(d.sources.total)}</span>
              <span className="kn-counts__label">{d.sources.total === 1 ? 'source' : 'sources'}</span>
            </div>
            <SegmentedBar
              label="Knowledge sources by status"
              emptyLabel="No sources yet."
              segments={[
                { key: 'ready', label: 'Ready', value: d.sources.ready, tone: 'success' },
                { key: 'processing', label: 'Processing', value: d.sources.processing + d.sources.pending, tone: 'accent' },
                { key: 'attention', label: 'Needs attention', value: d.sources.needsAttention, tone: 'warning' },
                { key: 'failed', label: 'Failed', value: d.sources.failed, tone: 'danger' },
              ]}
            />
            <p className="freshness">
              {d.freshness.newestProcessedAt ? (
                <>
                  Last processed {timeAgo(d.freshness.newestProcessedAt).toLowerCase()}
                  {d.freshness.staleCount > 0 ? (
                    <>
                      {' · '}
                      <span className="freshness__stale">{d.freshness.staleCount} stale</span>
                    </>
                  ) : null}
                </>
              ) : (
                'Nothing processed yet.'
              )}
            </p>
          </Card>

          <Card title="Element mappings" description="How reliably steps can point at your UI." actions={<Link href={paths.guidance('mappings')} className="card-link">Review</Link>}>
            <div className="kn-counts">
              <span className="kn-counts__total">{formatNumber(d.mappings.total)}</span>
              <span className="kn-counts__label">{d.mappings.total === 1 ? 'mapping' : 'mappings'}</span>
            </div>
            <SegmentedBar
              label="Mapping health"
              emptyLabel="No mappings yet. They appear once workflows are extracted."
              segments={[
                { key: 'valid', label: 'Valid', value: d.mappings.valid, tone: 'success' },
                { key: 'unverified', label: 'Unverified', value: d.mappings.unverified, tone: 'neutral' },
                { key: 'uncertain', label: 'Uncertain', value: d.mappings.uncertain, tone: 'warning' },
                { key: 'broken', label: 'Broken', value: d.mappings.broken, tone: 'danger' },
              ]}
            />
          </Card>

          <Card title="Workflows" description="What end users can be guided through." actions={<Link href={paths.guidance()} className="card-link">Open</Link>}>
            <div className="kn-counts">
              <span className="kn-counts__total">{formatNumber(totalWorkflows)}</span>
              <span className="kn-counts__label">{totalWorkflows === 1 ? 'workflow' : 'workflows'}</span>
            </div>
            <SegmentedBar
              label="Workflow publish state"
              emptyLabel="No workflows yet. Add knowledge, then Refresh Learning."
              segments={[
                { key: 'published', label: 'Published', value: d.workflows.published, tone: 'success' },
                { key: 'draft', label: 'Draft', value: d.workflows.draft, tone: 'neutral' },
                { key: 'review', label: 'Needs review', value: d.workflows.needsReview, tone: 'warning' },
              ]}
            />
          </Card>
        </div>

        <Card title="Recent activity" flush actions={<Link href={`${paths.settings()}#audit`} className="card-link">Audit log</Link>}>
          {d.recentActivity.length === 0 ? (
            <p className="card-empty">No activity yet. Changes made by your team will show up here.</p>
          ) : (
            <ol className="activity">
              {d.recentActivity.map((e) => (
                <li key={e.id} className="activity__item">
                  <span className="activity__dot" aria-hidden="true" />
                  <span className="activity__text">
                    <span className="activity__summary">{e.summary}</span>
                    <span className="activity__meta">
                      {e.actor ?? 'System'} · <time dateTime={e.createdAt}>{timeAgo(e.createdAt)}</time>
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>
        </>
        )}
      </div>
    </>
  );
}
