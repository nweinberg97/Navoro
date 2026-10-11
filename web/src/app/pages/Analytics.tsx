import { useState, type ReactNode } from 'react';
import type { AnalyticsResponse } from '../../../../packages/contracts/src/admin-types.ts';
import { api } from '../api.ts';
import { useDocumentTitle, useResource } from '../hooks.ts';
import { Link, paths } from '../router.tsx';
import { formatNumber, timeAgo } from '../format.ts';
import { SourceStatusPill, ValidationPill } from '../status.tsx';
import { BarList, DailyChart } from '../charts.tsx';
import { RequireApp } from './common.tsx';
import { Card, ConfidenceMeter, EmptyState, ErrorState, PageHeader, PageSkeleton, SegmentedBar, Table } from '../../ui/index.ts';
import { IconAnalytics } from '../icons.tsx';

function pct(n: number, d: number): string {
  if (!d) return '—';
  return `${Math.round((n / d) * 100)}%`;
}

/**
 * The API's `measured` list names what is actually collected. We match generously:
 * an exact key, or a prefix (e.g. "sessions" covers "sessions.daily"). If the list
 * is empty, nothing is measured and we render nothing but the explanation.
 */
function makeIsMeasured(measured: string[]) {
  const set = measured.map((m) => m.toLowerCase());
  return (key: string) => set.some((m) => m === key.toLowerCase() || m.startsWith(`${key.toLowerCase()}.`));
}

function Unmeasured({ children }: { children: ReactNode }) {
  return <p className="card-empty">{children}</p>;
}

function AnalyticsBody({ appId }: { appId: string }) {
  const [days, setDays] = useState<7 | 30>(7);
  const res = useResource((s) => api.analytics(appId, days, s), [appId, days]);

  const header = (
    <PageHeader
      title="Analytics"
      description="How guidance is being used. Only what Navoro actually measures is shown."
      actions={
        <div className="seg-control" role="radiogroup" aria-label="Time range">
          {([7, 30] as const).map((d) => (
            <button key={d} type="button" role="radio" aria-checked={days === d} className="seg-control__opt" onClick={() => setDays(d)}>
              {d} days
            </button>
          ))}
        </div>
      }
    />
  );

  if (res.loading && !res.data)
    return (
      <>
        {header}
        <PageSkeleton />
      </>
    );
  if (res.error && !res.data)
    return (
      <>
        {header}
        <ErrorState message={res.error} onRetry={res.reload} />
      </>
    );
  const a: AnalyticsResponse = res.data!;
  const m = makeIsMeasured(a.measured);
  const s = a.sessions;

  const analyticsOff = a.measured.length === 0;
  const noSessions = s.total === 0;

  return (
    <>
      {header}
      <div className={['stack-lg', res.loading ? 'is-refreshing' : ''].join(' ')} aria-busy={res.loading}>
        {m('sessions') ? (
          <section aria-labelledby="an-sessions" className="metrics">
            <h2 id="an-sessions" className="metrics__title">
              Sessions <span>Last {a.days} days</span>
            </h2>
            <div className="metrics__row">
              <div className="metric metric--lead">
                <span className="metric__value">{formatNumber(s.total)}</span>
                <span className="metric__label">Total</span>
              </div>
              <div className="metric">
                <span className="metric__value">{formatNumber(s.answered)}</span>
                <span className="metric__label">Answered · {pct(s.answered, s.total)}</span>
              </div>
              <div className="metric">
                <span className={['metric__value', s.unresolved ? 'metric__value--warn' : ''].join(' ')}>{formatNumber(s.unresolved)}</span>
                <span className="metric__label">Unresolved · {pct(s.unresolved, s.total)}</span>
              </div>
              <div className="metric">
                <span className="metric__value">{formatNumber(s.completed)}</span>
                <span className="metric__label">Workflows completed</span>
              </div>
            </div>
          </section>
        ) : null}

        {analyticsOff ? (
          <div className="n-card">
            <EmptyState icon={<IconAnalytics />} title="Usage analytics is off for this application">
              Turn on usage analytics in <Link href={paths.privacy()}>Privacy & Security</Link> and publish a configuration. Navoro will start measuring session outcomes — never page content.
            </EmptyState>
          </div>
        ) : noSessions ? (
          <div className="n-card">
            <EmptyState compact title="No sessions in this period">
              Once people open the Navoro launcher in your app, outcomes appear here. Try the Lumen demo or your development build to generate a first session.
            </EmptyState>
          </div>
        ) : (
          <>
            {m('sessions') ? (
              <Card title="Outcomes" description="Every session ends one way. Dismissed and cancelled are normal; errors are worth a look.">
                <SegmentedBar
                  label="Session outcomes"
                  segments={[
                    { key: 'completed', label: 'Completed', value: s.completed, tone: 'success' },
                    { key: 'answered', label: 'Answered', value: Math.max(0, s.answered - s.completed), tone: 'info' },
                    { key: 'unresolved', label: 'Unresolved', value: s.unresolved, tone: 'warning' },
                    { key: 'dismissed', label: 'Dismissed', value: s.dismissed, tone: 'neutral' },
                    { key: 'cancelled', label: 'Cancelled', value: s.cancelled, tone: 'neutral' },
                    { key: 'errors', label: 'Errors', value: s.errors, tone: 'danger' },
                  ]}
                />
              </Card>
            ) : null}

            {m('daily') && a.daily.length > 0 ? (
              <Card title="Daily sessions" description="Unresolved sessions are the lower segment of each day.">
                <DailyChart data={a.daily} />
              </Card>
            ) : null}

            <div className="two-col">
              {m('topTopics') ? (
                <Card title="Top topics" description="What people ask about, grouped. Unresolved counts show where knowledge is thin.">
                  {a.topTopics.length === 0 ? (
                    <Unmeasured>No topics yet.</Unmeasured>
                  ) : (
                    <BarList
                      label="Top topics"
                      items={a.topTopics.map((t) => ({ key: t.topic, label: t.topic, value: t.count, secondary: t.unresolved ? `${t.unresolved} unresolved` : undefined }))}
                    />
                  )}
                </Card>
              ) : null}

              {m('feedback') ? (
                <Card title="Feedback" description="From the helpful / not helpful buttons.">
                  {a.feedback.helpful + a.feedback.notHelpful === 0 ? (
                    <Unmeasured>No feedback yet.</Unmeasured>
                  ) : (
                    <div className="feedback">
                      <div>
                        <span className="feedback__value">{a.feedback.helpful}</span>
                        <span className="feedback__label">Helpful</span>
                      </div>
                      <div>
                        <span className="feedback__value">{a.feedback.notHelpful}</span>
                        <span className="feedback__label">Not helpful</span>
                      </div>
                      <div>
                        <span className="feedback__value">{pct(a.feedback.helpful, a.feedback.helpful + a.feedback.notHelpful)}</span>
                        <span className="feedback__label">Helpful rate</span>
                      </div>
                    </div>
                  )}
                </Card>
              ) : null}
            </div>

            {m('sessions') ? <Card title="Questions" description="The exact text people typed." flush>
              {a.retainedQuestions === null ? (
                <Unmeasured>
                  Question text isn’t retained for this application, so only topics are shown. You can turn on retention in <Link href={paths.privacy()}>Privacy & Security</Link>.
                </Unmeasured>
              ) : (
                <Table
                  caption="Retained questions"
                  rows={a.retainedQuestions}
                  rowKey={(q) => q.text}
                  empty={<Unmeasured>No questions retained in this period.</Unmeasured>}
                  columns={[
                    { key: 'q', header: 'Question', render: (q) => <span>{q.text}</span> },
                    { key: 'n', header: 'Times asked', align: 'right', render: (q) => q.count },
                    { key: 'g', header: 'Grounded', render: (q) => (q.grounded ? <span>Yes</span> : <span className="warn-text">No</span>) },
                  ]}
                />
              )}
            </Card> : null}

            {m('stepAbandonment') ? (
              <Card title="Step drop-off" description="Where people stop part-way through a workflow." flush>
                <Table
                  caption="Step abandonment"
                  rows={[...a.stepAbandonment].sort((x, y) => y.dropOffs - x.dropOffs)}
                  rowKey={(r) => `${r.workflowId}-${r.stepIndex}`}
                  empty={<Unmeasured>No drop-offs recorded.</Unmeasured>}
                  columns={[
                    {
                      key: 'wf',
                      header: 'Workflow',
                      render: (r) => <Link href={paths.workflow(r.workflowId)}>{r.workflowTitle}</Link>,
                    },
                    { key: 'step', header: 'Step', render: (r) => r.stepIndex + 1 },
                    { key: 'views', header: 'Views', align: 'right', render: (r) => r.views },
                    { key: 'drop', header: 'Drop-offs', align: 'right', render: (r) => r.dropOffs },
                    { key: 'rate', header: 'Rate', align: 'right', render: (r) => pct(r.dropOffs, r.views) },
                  ]}
                />
              </Card>
            ) : null}

            {m('errorStates') ? (
              <Card title="Error states" description="Errors returned to the SDK, by code.">
                {a.errorStates.length === 0 ? (
                  <Unmeasured>No errors in this period.</Unmeasured>
                ) : (
                  <BarList label="Error states" items={a.errorStates.map((e) => ({ key: e.code, label: e.code, value: e.count }))} />
                )}
              </Card>
            ) : null}
          </>
        )}

        <div className="two-col">
          {m('missingTargets') ? (
            <Card title="Missing targets" description="Steps the SDK couldn’t find on screen." flush>
              <Table
                caption="Missing targets"
                rows={a.missingTargets}
                rowKey={(t) => t.key}
                empty={<Unmeasured>Every target was found.</Unmeasured>}
                columns={[
                  { key: 'k', header: 'Mapping', render: (t) => <code>{t.key}</code> },
                  { key: 'n', header: 'Misses', align: 'right', render: (t) => t.count },
                ]}
              />
            </Card>
          ) : null}

          {m('lowConfidenceMappings') ? (
            <Card title="Low-confidence mappings" flush actions={<Link href={paths.guidance('mappings')} className="card-link">Review</Link>}>
              <Table
                caption="Low-confidence mappings"
                rows={a.lowConfidenceMappings}
                rowKey={(x) => x.id}
                empty={<Unmeasured>None — mappings look healthy.</Unmeasured>}
                columns={[
                  { key: 'l', header: 'Target', render: (x) => x.label },
                  { key: 'c', header: 'Confidence', render: (x) => <ConfidenceMeter value={x.confidence} /> },
                  { key: 'v', header: 'Validation', render: (x) => <ValidationPill validation={x.validation} /> },
                ]}
              />
            </Card>
          ) : null}
        </div>

        {m('staleSources') ? (
          <Card title="Stale sources" description="Knowledge that hasn’t been processed recently or needs attention." flush>
            <Table
              caption="Stale sources"
              rows={a.staleSources}
              rowKey={(x) => x.id}
              empty={<Unmeasured>All sources are fresh.</Unmeasured>}
              columns={[
                { key: 't', header: 'Source', render: (x) => <Link href={paths.source(x.id)}>{x.title}</Link> },
                { key: 's', header: 'Status', render: (x) => <SourceStatusPill status={x.status} /> },
                { key: 'p', header: 'Last processed', render: (x) => <span className="muted">{x.processedAt ? timeAgo(x.processedAt) : 'Never'}</span> },
              ]}
            />
          </Card>
        ) : null}
      </div>
    </>
  );
}

export function AnalyticsPage() {
  useDocumentTitle('Analytics');
  return <RequireApp title="Analytics">{(app) => <AnalyticsBody key={app.id} appId={app.id} />}</RequireApp>;
}
