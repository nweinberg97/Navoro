/**
 * Hand-built SVG charts. Thin marks, recessive axes, one y-scale, hover tooltip,
 * and a visually-hidden table for screen readers.
 */
import { useId, useMemo, useRef, useState, useEffect } from 'react';

export interface DailyPoint {
  date: string;
  sessions: number;
  unresolved: number;
}

function niceMax(v: number): number {
  if (v <= 1) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

function shortDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
}

/**
 * Daily sessions as columns, with the unresolved portion drawn as the lower
 * segment of each column (a part-of-whole, same scale — no second axis).
 */
export function DailyChart({ data }: { data: DailyPoint[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [hover, setHover] = useState<number | null>(null);
  const titleId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((e) => {
      const w = e[0]?.contentRect.width;
      if (w) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const height = 220;
  const m = { top: 12, right: 8, bottom: 28, left: 36 };
  const innerW = Math.max(10, width - m.left - m.right);
  const innerH = height - m.top - m.bottom;
  // Four equal, round tick steps (e.g. 0/10/20/30/40).
  const step = useMemo(() => Math.max(1, niceMax(Math.max(0, ...data.map((d) => d.sessions)) / 4)), [data]);
  const max = step * 4;
  const ticks = [0, step, step * 2, step * 3, max];
  const band = innerW / Math.max(1, data.length);
  const barW = Math.min(24, Math.max(3, band * 0.6));
  const y = (v: number) => m.top + innerH - (v / max) * innerH;
  const labelEvery = Math.ceil(data.length / Math.max(1, Math.floor(innerW / 64)));
  const total = data.reduce((s, d) => s + d.sessions, 0);
  const hovered = hover != null ? data[hover] : undefined;

  return (
    <figure className="chart" aria-labelledby={titleId}>
      <figcaption id={titleId} className="n-visually-hidden">
        Daily guidance sessions with unresolved sessions, {data.length} days, {total} sessions total.
      </figcaption>
      <ul className="chart__legend" aria-hidden="true">
        <li>
          <span className="chart__key chart__key--resolved" />
          Resolved
        </li>
        <li>
          <span className="chart__key chart__key--unresolved" />
          Unresolved
        </li>
      </ul>
      <div className="chart__plot" ref={ref} onMouseLeave={() => setHover(null)}>
        <svg width={width} height={height} role="presentation" aria-hidden="true">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={m.left} x2={width - m.right} y1={y(t)} y2={y(t)} className={t === 0 ? 'chart__base' : 'chart__grid'} />
              <text x={m.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="chart__tick">
                {t}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const cx = m.left + band * i + band / 2;
            const x = cx - barW / 2;
            const unresolved = Math.min(d.unresolved, d.sessions);
            const resolved = d.sessions - unresolved;
            const hU = (unresolved / max) * innerH;
            const hR = (resolved / max) * innerH;
            const base = m.top + innerH;
            const gap = unresolved > 0 && resolved > 0 ? 2 : 0;
            const r = Math.min(4, barW / 2);
            const topSeg = resolved > 0 ? 'resolved' : 'unresolved';
            const seg = (yTop: number, h: number, rounded: boolean) =>
              rounded && h > r
                ? `M${x},${yTop + h} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + barW - r} Q${x + barW},${yTop} ${x + barW},${yTop + r} V${yTop + h} Z`
                : `M${x},${yTop + h} V${yTop} H${x + barW} V${yTop + h} Z`;
            return (
              <g key={d.date} className={hover === i ? 'chart__col chart__col--hover' : 'chart__col'}>
                {unresolved > 0 ? <path d={seg(base - hU, hU, topSeg === 'unresolved')} className="chart__bar chart__bar--unresolved" /> : null}
                {resolved > 0 ? <path d={seg(base - hU - gap - hR, hR, true)} className="chart__bar chart__bar--resolved" /> : null}
                {i % labelEvery === 0 ? (
                  <text x={cx} y={height - 8} textAnchor="middle" className="chart__tick">
                    {shortDate(d.date)}
                  </text>
                ) : null}
                <rect x={m.left + band * i} y={m.top} width={band} height={innerH} fill="transparent" onMouseEnter={() => setHover(i)} />
              </g>
            );
          })}
        </svg>
        {hovered && hover != null ? (
          <div
            className="chart__tip"
            style={{
              left: Math.min(Math.max(m.left + band * hover + band / 2, 70), width - 70),
              top: Math.max(0, y(hovered.sessions) - 8),
            }}
          >
            <strong>{shortDate(hovered.date)}</strong>
            <span>{hovered.sessions} sessions</span>
            <span>{hovered.unresolved} unresolved</span>
          </div>
        ) : null}
      </div>
      <table className="n-visually-hidden">
        <caption>Daily sessions</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Sessions</th>
            <th scope="col">Unresolved</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.date}>
              <td>{d.date}</td>
              <td>{d.sessions}</td>
              <td>{d.unresolved}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** Horizontal bar list (label · bar · value). Bars share one scale. */
export function BarList({ items, label }: { items: Array<{ key: string; label: string; value: number; secondary?: string }>; label: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="barlist" aria-label={label}>
      {items.map((i) => (
        <li key={i.key} className="barlist__row">
          <span className="barlist__label">{i.label}</span>
          <span className="barlist__track" aria-hidden="true">
            <span style={{ width: `${(i.value / max) * 100}%` }} />
          </span>
          <span className="barlist__value">
            {i.value}
            {i.secondary ? <span className="barlist__secondary">{i.secondary}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
