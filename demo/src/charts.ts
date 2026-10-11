import { s } from './ui.ts';

function scale(values: number[], w: number, h: number, pad: number, min?: number, max?: number) {
  const lo = min ?? Math.min(...values);
  const hi = max ?? Math.max(...values);
  const span = hi - lo || 1;
  return values.map((v, i) => [
    pad + (i / Math.max(values.length - 1, 1)) * (w - pad * 2),
    h - pad - ((v - lo) / span) * (h - pad * 2),
  ] as const);
}

const path = (pts: ReadonlyArray<readonly [number, number]>) =>
  pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');

export function sparkline(values: number[], good: boolean): SVGElement {
  const w = 112;
  const h = 36;
  const pts = scale(values, w, h, 3);
  const color = good ? 'var(--chart-1)' : 'var(--chart-warn)';
  const last = pts[pts.length - 1] ?? [0, 0];
  return s(
    'svg',
    { viewBox: `0 0 ${w} ${h}`, width: w, height: h, class: 'spark', 'aria-hidden': 'true', focusable: 'false' },
    s('path', { d: `${path(pts)} L${w - 3} ${h} L3 ${h} Z`, fill: color, opacity: 0.1 }),
    s('path', { d: path(pts), fill: 'none', stroke: color, 'stroke-width': 1.75, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }),
    s('circle', { cx: last[0], cy: last[1], r: 2.5, fill: color }),
  );
}

export function trendChart(labels: string[], orders: number[], shipped: number[]): SVGElement {
  const w = 720;
  const h = 260;
  const left = 44;
  const right = 12;
  const top = 12;
  const bottom = 28;
  const all = [...orders, ...shipped];
  const max = Math.ceil(Math.max(...all) / 100) * 100;
  const min = Math.floor(Math.min(...all) / 100) * 100;
  const inner = (vals: number[]) =>
    vals.map((v, i) => [
      left + (i / Math.max(vals.length - 1, 1)) * (w - left - right),
      top + (1 - (v - min) / (max - min || 1)) * (h - top - bottom),
    ] as const);
  const a = inner(orders);
  const b = inner(shipped);
  const svg = s('svg', { viewBox: `0 0 ${w} ${h}`, class: 'trend', role: 'img', 'aria-label': 'Line chart of orders received and orders shipped over the selected period' });
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const v = min + ((max - min) * i) / ticks;
    const y = top + (1 - i / ticks) * (h - top - bottom);
    svg.append(s('line', { x1: left, x2: w - right, y1: y, y2: y, stroke: 'var(--border)', 'stroke-width': 1 }));
    svg.append(s('text', { x: left - 8, y: y + 4, 'text-anchor': 'end', class: 'axis' }, String(Math.round(v))));
  }
  const step = Math.ceil(labels.length / 6);
  labels.forEach((l, i) => {
    if (i % step !== 0 && i !== labels.length - 1) return;
    if (i === labels.length - 1 && (labels.length - 1) % step !== 0 && (labels.length - 1) % step < step / 2) return;
    const pt = a[i];
    if (pt) svg.append(s('text', { x: pt[0], y: h - 8, 'text-anchor': i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle', class: 'axis' }, l));
  });
  const last = a[a.length - 1] ?? [0, 0];
  svg.append(s('path', { d: `${path(a)} L${last[0]} ${h - bottom} L${a[0]?.[0] ?? 0} ${h - bottom} Z`, fill: 'var(--chart-1)', opacity: 0.08 }));
  svg.append(s('path', { d: path(b), fill: 'none', stroke: 'var(--chart-2)', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-dasharray': '5 4' }));
  svg.append(s('path', { d: path(a), fill: 'none', stroke: 'var(--chart-1)', 'stroke-width': 2.25, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
  svg.append(s('circle', { cx: last[0], cy: last[1], r: 3.5, fill: 'var(--surface)', stroke: 'var(--chart-1)', 'stroke-width': 2 }));
  return svg;
}

/** Miniature chart-type glyph for the reports table. */
export function chartGlyph(kind: 'Line' | 'Bar' | 'Table'): SVGElement {
  const svg = s('svg', { viewBox: '0 0 24 24', width: 18, height: 18, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' });
  if (kind === 'Line') svg.append(s('path', { d: 'M3 17l5-6 4 3 8-9' }));
  else if (kind === 'Bar') svg.append(s('path', { d: 'M6 20v-7M12 20V5M18 20v-10' }));
  else svg.append(s('rect', { x: 3.5, y: 5, width: 17, height: 14, rx: 2 }), s('path', { d: 'M3.5 10h17M9.5 10v9' }));
  return svg;
}
