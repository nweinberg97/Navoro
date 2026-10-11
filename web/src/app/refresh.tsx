/**
 * Refresh Learning: start a refresh job for the selected application and follow it
 * live in a side sheet (polls GET /jobs/:id every second while active).
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { JobDTO, JobStepDTO, RefreshReport } from '../../../packages/contracts/src/admin-types.ts';
import { api, errorMessage } from './api.ts';
import { usePolling } from './hooks.ts';
import { useCanEdit, useWorkspace } from './session.tsx';
import { Button, Notice, Sheet, Spinner, useToast } from '../ui/index.ts';
import { IconCheck, IconRefresh, IconX } from './icons.tsx';
import { JobStatusPill, isJobActive } from './status.tsx';
import { duration, formatDateTime, pluralize } from './format.ts';
import { Link, paths } from './router.tsx';

interface RefreshValue {
  /** Start a new refresh for the selected app (opens the sheet). */
  start: () => Promise<void>;
  /** Open the sheet for an existing job. */
  open: (job: JobDTO) => void;
  starting: boolean;
  activeJob: JobDTO | null;
  /** Increments whenever a followed job reaches a terminal state, so pages can reload. */
  completedCount: number;
}

const RefreshContext = createContext<RefreshValue | null>(null);

export function RefreshProvider({ children }: { children: ReactNode }) {
  const { selected } = useWorkspace();
  const toast = useToast();
  const [job, setJob] = useState<JobDTO | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);
  const [completedCount, setCompletedCount] = useState(0);

  const active = job != null && isJobActive(job.status);

  usePolling(
    async (signal) => {
      if (!job) return;
      try {
        const next = await api.job(job.id, signal);
        setPollError(null);
        setJob(next);
        if (!isJobActive(next.status)) {
          setCompletedCount((n) => n + 1);
          if (next.status === 'succeeded') toast.success('Refresh Learning finished', next.report?.publishNote);
          else if (next.status === 'failed') toast.error('Refresh Learning failed', next.error ?? undefined);
          else if (next.status === 'cancelled') toast.info('Refresh Learning cancelled');
        }
      } catch (e) {
        if (!signal.aborted) setPollError(errorMessage(e));
      }
    },
    1000,
    active,
  );

  const start = useCallback(async () => {
    if (!selected) return;
    setStarting(true);
    try {
      const created = await api.refresh(selected.id);
      setJob(created);
      setPollError(null);
      setSheetOpen(true);
    } catch (e) {
      toast.error('Couldn’t start Refresh Learning', errorMessage(e));
    } finally {
      setStarting(false);
    }
  }, [selected, toast]);

  const open = useCallback((j: JobDTO) => {
    setJob(j);
    setPollError(null);
    setSheetOpen(true);
  }, []);

  const cancel = async () => {
    if (!job) return;
    setCancelling(true);
    try {
      setJob(await api.cancelJob(job.id));
    } catch (e) {
      toast.error('Couldn’t cancel the job', errorMessage(e));
    } finally {
      setCancelling(false);
    }
  };

  const value = useMemo(
    () => ({ start, open, starting, activeJob: active ? job : null, completedCount }),
    [start, open, starting, active, job, completedCount],
  );

  return (
    <RefreshContext.Provider value={value}>
      {children}
      <Sheet
        open={sheetOpen && job != null}
        onClose={() => setSheetOpen(false)}
        title={job?.type === 'ingest' ? 'Processing knowledge' : 'Refresh Learning'}
        description={
          job?.type === 'ingest'
            ? 'Reading a source and extracting workflows and concepts.'
            : 'Re-reads changed knowledge, re-extracts workflows, validates mappings against the approved application metadata, and applies your approval policy.'
        }
        footer={
          job ? (
            <>
              {isJobActive(job.status) ? (
                <Button onClick={cancel} loading={cancelling} disabled={job.status === 'cancelling'} variant="secondary">
                  {job.status === 'cancelling' ? 'Cancelling…' : 'Cancel refresh'}
                </Button>
              ) : null}
              <Button variant="primary" onClick={() => setSheetOpen(false)}>
                {isJobActive(job.status) ? 'Run in background' : 'Done'}
              </Button>
            </>
          ) : null
        }
      >
        {job ? <JobProgress job={job} pollError={pollError} onNavigate={() => setSheetOpen(false)} /> : null}
      </Sheet>
    </RefreshContext.Provider>
  );
}

export function useRefresh(): RefreshValue {
  const ctx = useContext(RefreshContext);
  if (!ctx) throw new Error('useRefresh outside RefreshProvider');
  return ctx;
}

/** The global "Refresh Learning" button. */
export function RefreshButton({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const { start, starting, activeJob, open } = useRefresh();
  const { selected } = useWorkspace();
  const canEdit = useCanEdit();
  if (!canEdit) return null;
  if (activeJob && activeJob.applicationId === selected?.id && activeJob.type === 'refresh') {
    return (
      <Button size={size} variant="secondary" onClick={() => open(activeJob)} icon={<Spinner size={14} />}>
        Learning…
      </Button>
    );
  }
  return (
    <Button
      size={size}
      variant="accent"
      onClick={() => void start()}
      loading={starting}
      disabled={!selected}
      icon={<IconRefresh size={16} />}
      title={selected ? `Refresh Learning for ${selected.name}` : 'Register an application first'}
    >
      Refresh Learning
    </Button>
  );
}

/* ───────────────────────── Job progress view ───────────────────────── */

function StepIcon({ status }: { status: JobStepDTO['status'] }) {
  if (status === 'running') return <Spinner size={14} />;
  if (status === 'done') return <IconCheck size={14} strokeWidth={2} />;
  if (status === 'failed') return <IconX size={14} strokeWidth={2} />;
  return null;
}

const STEP_STATUS_TEXT: Record<JobStepDTO['status'], string> = {
  pending: 'Pending',
  running: 'In progress',
  done: 'Done',
  failed: 'Failed',
  skipped: 'Skipped',
};

export function JobProgress({ job, pollError, onNavigate }: { job: JobDTO; pollError?: string | null; onNavigate?: () => void }) {
  const done = job.steps.filter((s) => s.status === 'done' || s.status === 'skipped').length;
  const total = job.steps.length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const activeStep = job.steps.find((s) => s.status === 'running');
  return (
    <div className="job">
      <div className="job__summary">
        <div className="job__summary-row">
          <JobStatusPill status={job.status} />
          <span className="job__meta">
            Started {formatDateTime(job.startedAt ?? job.createdAt)} · {duration(job.startedAt ?? job.createdAt, job.finishedAt)}
          </span>
        </div>
        <div
          className={`job__progress job__progress--${job.status}`}
          role="progressbar"
          aria-label="Refresh progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
        >
          <span style={{ width: `${isJobActive(job.status) ? Math.max(pct, 4) : pct}%` }} />
        </div>
        <p className="n-visually-hidden" aria-live="polite">
          {isJobActive(job.status)
            ? activeStep
              ? `${activeStep.label}: in progress`
              : 'Queued'
            : `Job ${job.status}`}
        </p>
      </div>

      {pollError ? (
        <Notice tone="warning" title="Lost contact with the server">
          {pollError} Still retrying.
        </Notice>
      ) : null}

      <ol className="job__steps" aria-label="Steps">
        {job.steps.map((s) => (
          <li key={s.key} className={`job__step job__step--${s.status}`}>
            <span className="job__step-icon" aria-hidden="true">
              <StepIcon status={s.status} />
            </span>
            <div className="job__step-text">
              <span className="job__step-label">{s.label}</span>
              {s.detail ? <span className="job__step-detail">{s.detail}</span> : null}
            </div>
            <span className="job__step-status">{STEP_STATUS_TEXT[s.status]}</span>
          </li>
        ))}
      </ol>

      {job.status === 'failed' ? (
        <Notice tone="danger" title="Refresh failed">
          {job.error ?? 'The job stopped before finishing. Nothing was published. Fix the issue below and run it again.'}
        </Notice>
      ) : null}
      {job.status === 'cancelled' ? (
        <Notice tone="neutral" title="Cancelled">
          The refresh was stopped. Completed steps were kept; nothing new was published.
        </Notice>
      ) : null}

      {job.report ? <RefreshReportView report={job.report} onNavigate={onNavigate} /> : null}
    </div>
  );
}

function NameList({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <p className="report__none">{empty}</p>;
  return (
    <ul className="report__names">
      {items.map((t, i) => (
        <li key={`${t}-${i}`}>{t}</li>
      ))}
    </ul>
  );
}

export function RefreshReportView({ report, onNavigate }: { report: RefreshReport; onNavigate?: () => void }) {
  return (
    <div className="report">
      <h3 className="report__heading">Report</h3>

      <section className="report__section" aria-label="Sources">
        <h4>Knowledge sources</h4>
        <div className="report__stats">
          <div>
            <span>{report.sourcesConsidered}</span>Considered
          </div>
          <div>
            <span>{report.sourcesChanged}</span>Changed
          </div>
          <div>
            <span>{report.sourcesUnchanged}</span>Unchanged
          </div>
          <div className={report.sourcesFailed.length ? 'report__stat--danger' : ''}>
            <span>{report.sourcesFailed.length}</span>Failed
          </div>
        </div>
        {report.sourcesFailed.length ? (
          <ul className="report__issues">
            {report.sourcesFailed.map((f) => (
              <li key={f.id}>
                <Link href={paths.source(f.id)} onClick={onNavigate}>
                  {f.title}
                </Link>
                <span>{f.error}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="report__section" aria-label="Workflows">
        <h4>Workflows</h4>
        <div className="report__grid">
          <div>
            <p className="report__label">Added · {report.workflowsAdded.length}</p>
            <NameList items={report.workflowsAdded} empty="None" />
          </div>
          <div>
            <p className="report__label">Updated · {report.workflowsUpdated.length}</p>
            <NameList items={report.workflowsUpdated} empty="None" />
          </div>
          <div>
            <p className="report__label">Removed · {report.workflowsRemoved.length}</p>
            <NameList items={report.workflowsRemoved} empty="None" />
          </div>
          <div>
            <p className="report__label">Needs review · {report.workflowsNeedingReview.length}</p>
            <NameList items={report.workflowsNeedingReview} empty="None" />
          </div>
        </div>
      </section>

      <section className="report__section" aria-label="Mapping validation">
        <h4>Mapping validation</h4>
        <p className="report__line">
          <strong>{pluralize(report.mappingsValid, 'mapping')}</strong> valid against approved application metadata.
        </p>
        {report.mappingsBroken.length ? (
          <>
            <p className="report__label report__label--danger">Broken · {report.mappingsBroken.length}</p>
            <ul className="report__issues">
              {report.mappingsBroken.map((m) => (
                <li key={m.key}>
                  <code>{m.key}</code> {m.label}
                  <span>{m.detail}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {report.mappingsUncertain.length ? (
          <>
            <p className="report__label report__label--warning">Uncertain · {report.mappingsUncertain.length}</p>
            <ul className="report__issues">
              {report.mappingsUncertain.map((m) => (
                <li key={m.key}>
                  <code>{m.key}</code> {m.label}
                  <span>{m.detail}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {report.mappingsBroken.length + report.mappingsUncertain.length > 0 ? (
          <Link className="report__link" href={paths.guidance('mappings')} onClick={onNavigate}>
            Review mappings →
          </Link>
        ) : null}
      </section>

      <section className="report__section" aria-label="Publish outcome">
        <h4>Publish</h4>
        <Notice tone={report.published ? 'success' : 'neutral'} title={report.published ? `Published v${report.published.version} to ${report.published.environment}` : 'Not published'}>
          {report.publishNote}
        </Notice>
      </section>
    </div>
  );
}
