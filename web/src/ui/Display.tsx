import { useRef, useState, useId, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from './Button.tsx';

/* ───────────────────────────── Badge / StatusPill ───────────────────────────── */

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent' | 'progress';

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={['n-badge', `n-badge--${tone}`, className].filter(Boolean).join(' ')}>{children}</span>;
}

/** A status pill: dot + label. `tone` carries semantic color, the label carries meaning (never color alone). */
export function StatusPill({ tone, children, pulse }: { tone: Tone; children: ReactNode; pulse?: boolean }) {
  return (
    <span className={`n-pill n-pill--${tone}`}>
      <span className={['n-pill__dot', pulse ? 'n-pill__dot--pulse' : ''].join(' ')} aria-hidden="true" />
      {children}
    </span>
  );
}

/* ───────────────────────────── Card / Section ───────────────────────────── */

export interface CardProps {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  flush?: boolean;
  as?: 'section' | 'div' | 'article';
  headingLevel?: 2 | 3;
}

export function Card({ title, description, actions, children, className, flush, as = 'section', headingLevel = 2 }: CardProps) {
  const Tag = as;
  const id = useId();
  const H = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <Tag className={['n-card', flush ? 'n-card--flush' : '', className].filter(Boolean).join(' ')} aria-labelledby={title ? id : undefined}>
      {title || actions ? (
        <header className="n-card__header">
          <div className="n-card__heading">
            {title ? (
              <H className="n-card__title" id={id}>
                {title}
              </H>
            ) : null}
            {description ? <p className="n-card__desc">{description}</p> : null}
          </div>
          {actions ? <div className="n-card__actions">{actions}</div> : null}
        </header>
      ) : null}
      <div className="n-card__body">{children}</div>
    </Tag>
  );
}

/* ───────────────────────────── PageHeader ───────────────────────────── */

export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
  back,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
}) {
  return (
    <header className="n-page-header">
      {back ? <div className="n-page-header__back">{back}</div> : null}
      <div className="n-page-header__row">
        <div className="n-page-header__text">
          {eyebrow ? <p className="n-page-header__eyebrow">{eyebrow}</p> : null}
          <h1 className="n-page-header__title" tabIndex={-1} data-page-title="">
            {title}
          </h1>
          {description ? <p className="n-page-header__desc">{description}</p> : null}
        </div>
        {actions ? <div className="n-page-header__actions">{actions}</div> : null}
      </div>
    </header>
  );
}

/* ───────────────────────────── Tabs ───────────────────────────── */

export interface TabItem<K extends string> {
  key: K;
  label: ReactNode;
  count?: number | null;
}

/** Accessible tablist (automatic activation, arrow keys/Home/End). Panels are rendered by the caller via `TabPanel`. */
export function Tabs<K extends string>({
  items,
  value,
  onChange,
  label,
  idBase,
}: {
  items: TabItem<K>[];
  value: K;
  onChange: (key: K) => void;
  label: string;
  idBase: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = -1;
    if (e.key === 'ArrowRight') next = (index + 1) % items.length;
    else if (e.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const item = items[next];
    if (!item) return;
    onChange(item.key);
    refs.current[next]?.focus();
  };
  return (
    <div className="n-tabs" role="tablist" aria-label={label}>
      {items.map((item, i) => {
        const selected = item.key === value;
        return (
          <button
            key={item.key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${idBase}-tab-${item.key}`}
            aria-selected={selected}
            aria-controls={`${idBase}-panel-${item.key}`}
            tabIndex={selected ? 0 : -1}
            className={['n-tab', selected ? 'n-tab--active' : ''].join(' ')}
            onClick={() => onChange(item.key)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {item.label}
            {item.count != null ? <span className="n-tab__count">{item.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ idBase, tabKey, children }: { idBase: string; tabKey: string; children: ReactNode }) {
  return (
    <div role="tabpanel" id={`${idBase}-panel-${tabKey}`} aria-labelledby={`${idBase}-tab-${tabKey}`} className="n-tabpanel">
      {children}
    </div>
  );
}

/* ───────────────────────────── Table ───────────────────────────── */

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  align?: 'left' | 'right';
  width?: string;
  /** Hide this column under 720px. */
  hideOnMobile?: boolean;
}

export function Table<T>({
  columns,
  rows,
  rowKey,
  caption,
  onRowClick,
  empty,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  caption: string;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
}) {
  if (rows.length === 0 && empty) return <>{empty}</>;
  return (
    <div className="n-table-wrap">
      <table className="n-table">
        <caption className="n-visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                style={{ width: c.width, textAlign: c.align ?? 'left' }}
                className={c.hideOnMobile ? 'n-hide-mobile' : undefined}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={onRowClick ? 'n-table__row--interactive' : undefined}
              onClick={
                onRowClick
                  ? (e) => {
                      // Let real controls inside the row handle their own clicks.
                      if ((e.target as HTMLElement).closest('a,button,input,select,textarea,label')) return;
                      onRowClick(row);
                    }
                  : undefined
              }
            >
              {columns.map((c) => (
                <td key={c.key} style={{ textAlign: c.align ?? 'left' }} className={c.hideOnMobile ? 'n-hide-mobile' : undefined}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ───────────────────────────── EmptyState / ErrorState ───────────────────────────── */

export function EmptyState({
  title,
  children,
  action,
  icon,
  compact,
}: {
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={['n-empty', compact ? 'n-empty--compact' : ''].join(' ')}>
      {icon ? (
        <div className="n-empty__icon" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <p className="n-empty__title">{title}</p>
      {children ? <div className="n-empty__body">{children}</div> : null}
      {action ? <div className="n-empty__action">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ title = 'This didn’t load', message, onRetry }: { title?: string; message: string; onRetry?: () => void }) {
  return (
    <div className="n-error-state" role="alert">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <circle cx="10" cy="10" r="8.25" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10 5.75v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="10" cy="13.75" r="1" fill="currentColor" />
      </svg>
      <div className="n-error-state__text">
        <p className="n-error-state__title">{title}</p>
        <p className="n-error-state__msg">{message}</p>
      </div>
      {onRetry ? (
        <Button size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

/* ───────────────────────────── Skeleton ───────────────────────────── */

export function Skeleton({ width, height = 14, radius, className }: { width?: number | string; height?: number | string; radius?: number; className?: string }) {
  return <span className={['n-skeleton', className].filter(Boolean).join(' ')} style={{ width, height, borderRadius: radius }} aria-hidden="true" />;
}

export function SkeletonRows({ rows = 4, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div className="n-skeleton-rows" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div className="n-skeleton-rows__row" key={i}>
          <Skeleton width={`${28 + ((i * 17) % 30)}%`} />
          <Skeleton width={72} />
          <Skeleton width={56} />
        </div>
      ))}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="n-page-skeleton" role="status" aria-label="Loading page">
      <Skeleton width={220} height={28} />
      <Skeleton width={360} height={14} />
      <div className="n-page-skeleton__grid">
        <Skeleton height={120} radius={14} />
        <Skeleton height={120} radius={14} />
        <Skeleton height={120} radius={14} />
      </div>
      <Skeleton height={240} radius={14} />
    </div>
  );
}

/* ───────────────────────────── KeyValue ───────────────────────────── */

export function KeyValue({ items, columns = 1 }: { items: Array<{ label: ReactNode; value: ReactNode }>; columns?: 1 | 2 | 3 }) {
  return (
    <dl className={`n-kv n-kv--cols-${columns}`}>
      {items.map((item, i) => (
        <div className="n-kv__item" key={i}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ───────────────────────────── CopyField ───────────────────────────── */

export function CopyField({ value, label, multiline, mono = true }: { value: string; label: string; multiline?: boolean; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Fallback for non-secure contexts.
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1800);
  };
  return (
    <div className={['n-copy', multiline ? 'n-copy--multi' : ''].join(' ')}>
      {multiline ? (
        <pre className={['n-copy__value', mono ? 'n-mono' : ''].join(' ')} aria-label={label} tabIndex={0}>
          {value}
        </pre>
      ) : (
        <code className={['n-copy__value', mono ? 'n-mono' : ''].join(' ')} aria-label={label}>
          {value}
        </code>
      )}
      <button type="button" className="n-copy__btn" onClick={copy} aria-label={`Copy ${label}`}>
        {copied ? (
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M3.5 8.5 6.5 11.5 12.5 4.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="5.25" y="5.25" width="8" height="8" rx="1.75" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10.75 3.25v-.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        )}
        <span>{copied ? 'Copied' : 'Copy'}</span>
      </button>
      <span className="n-visually-hidden" aria-live="polite">
        {copied ? `${label} copied to clipboard` : ''}
      </span>
    </div>
  );
}

/* ───────────────────────────── ConfidenceMeter ───────────────────────────── */

/** 0–1 confidence as a 5-segment meter + percentage. Low confidence reads as warning. */
export function ConfidenceMeter({ value, showValue = true }: { value: number; showValue?: boolean }) {
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const filled = Math.round(v * 5);
  const tone = v >= 0.75 ? 'high' : v >= 0.5 ? 'mid' : 'low';
  const pct = Math.round(v * 100);
  return (
    <span className={`n-meter n-meter--${tone}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`Confidence ${pct}%`}>
      <span className="n-meter__bars" aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => (
          <span key={i} className={i < filled ? 'n-meter__bar n-meter__bar--on' : 'n-meter__bar'} />
        ))}
      </span>
      {showValue ? <span className="n-meter__value">{pct}%</span> : null}
    </span>
  );
}

/* ───────────────────────────── SegmentedBar ───────────────────────────── */

export interface Segment {
  key: string;
  label: string;
  value: number;
  tone: 'success' | 'neutral' | 'warning' | 'danger' | 'info' | 'accent';
}

/** Compact proportional bar with a legend that carries labels + counts (identity never by color alone). */
export function SegmentedBar({ segments, label, emptyLabel = 'Nothing to show yet' }: { segments: Segment[]; label: string; emptyLabel?: string }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  return (
    <div className="n-segbar">
      <div className="n-segbar__track" role="img" aria-label={`${label}: ${segments.map((s) => `${s.value} ${s.label.toLowerCase()}`).join(', ')}`}>
        {total === 0 ? (
          <span className="n-segbar__empty" />
        ) : (
          segments
            .filter((s) => s.value > 0)
            .map((s) => <span key={s.key} className={`n-segbar__seg n-segbar__seg--${s.tone}`} style={{ flexGrow: s.value }} title={`${s.label}: ${s.value}`} />)
        )}
      </div>
      {total === 0 ? (
        <p className="n-segbar__none">{emptyLabel}</p>
      ) : (
        <ul className="n-segbar__legend">
          {segments.map((s) => (
            <li key={s.key}>
              <span className={`n-segbar__swatch n-segbar__seg--${s.tone}`} aria-hidden="true" />
              <span className="n-segbar__legend-label">{s.label}</span>
              <span className="n-segbar__legend-value">{s.value}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ───────────────────────────── Stat ───────────────────────────── */

export function Stat({ label, value, hint, tone }: { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: 'warning' | 'danger' }) {
  return (
    <div className={['n-stat', tone ? `n-stat--${tone}` : ''].join(' ')}>
      <span className="n-stat__label">{label}</span>
      <span className="n-stat__value">{value}</span>
      {hint ? <span className="n-stat__hint">{hint}</span> : null}
    </div>
  );
}

/* ───────────────────────────── Notice ───────────────────────────── */

export function Notice({ tone = 'info', title, children, action }: { tone?: 'info' | 'warning' | 'danger' | 'success' | 'neutral'; title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={`n-notice n-notice--${tone}`} role={tone === 'danger' ? 'alert' : undefined}>
      <span className="n-notice__bar" aria-hidden="true" />
      <div className="n-notice__text">
        {title ? <p className="n-notice__title">{title}</p> : null}
        {children ? <div className="n-notice__body">{children}</div> : null}
      </div>
      {action ? <div className="n-notice__action">{action}</div> : null}
    </div>
  );
}
