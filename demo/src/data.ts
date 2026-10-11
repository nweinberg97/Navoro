/** Synthetic, obviously fictional data for the Lumen demo workspace. */

export type ChartType = 'Line' | 'Bar' | 'Table';
export type Schedule = "Don't send" | 'Daily' | 'Weekly';

export interface Report {
  id: string;
  name: string;
  source: string;
  chart: ChartType;
  schedule: Schedule;
  updated: string;
}

export const state = {
  reports: [
    { id: 'r1', name: 'Weekly fulfillment', source: 'fulfillment_events (Warehouse)', chart: 'Line', schedule: 'Weekly', updated: 'Today, 09:12' },
    { id: 'r2', name: 'Orders by region', source: 'orders_daily (Warehouse)', chart: 'Bar', schedule: "Don't send", updated: 'Yesterday' },
    { id: 'r3', name: 'Carrier delay breakdown', source: 'fulfillment_events (Warehouse)', chart: 'Bar', schedule: 'Daily', updated: 'Oct 8' },
    { id: 'r4', name: 'Support backlog', source: 'support_tickets (CSV upload)', chart: 'Table', schedule: 'Weekly', updated: 'Oct 7' },
    { id: 'r5', name: 'Daily order volume', source: 'orders_daily (Warehouse)', chart: 'Line', schedule: 'Daily', updated: 'Oct 3' },
    { id: 'r6', name: 'Returns by reason', source: 'orders_daily (Warehouse)', chart: 'Table', schedule: "Don't send", updated: 'Sep 29' },
  ] as Report[],
  warehouse: { connected: false, host: '' },
  members: [
    { name: 'Jordan Avery', email: 'jordan@northwind.example', role: 'Owner' },
    { name: 'Priya Natarajan', email: 'priya@northwind.example', role: 'Admin' },
    { name: 'Tomás Reyes', email: 'tomas@northwind.example', role: 'Editor' },
  ] as Array<{ name: string; email: string; role: string }>,
};

export const SOURCES = [
  'orders_daily (Warehouse)',
  'fulfillment_events (Warehouse)',
  'support_tickets (CSV upload)',
] as const;

export type RangeKey = '7' | '30' | '90';
export const RANGES: Array<{ value: RangeKey; label: string }> = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
];

/** Deterministic pseudo-random series so the charts are stable between renders. */
function series(seed: number, n: number, base: number, amp: number, trend: number): number[] {
  let x = seed;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    x = (x * 1664525 + 1013904223) % 4294967296;
    const noise = x / 4294967296 - 0.5;
    out.push(base + trend * i + amp * Math.sin(i / 2.3 + seed) * 0.5 + amp * noise);
  }
  return out;
}

export interface Kpi {
  label: string;
  value: string;
  delta: string;
  good: boolean;
  points: number[];
}

export function kpisFor(range: RangeKey): Kpi[] {
  const n = range === '7' ? 7 : range === '30' ? 14 : 20;
  const m = range === '7' ? 1 : range === '30' ? 4.2 : 12.6;
  const num = (v: number) => Math.round(v).toLocaleString('en-US');
  return [
    { label: 'Orders processed', value: num(1840 * m), delta: '+8.4%', good: true, points: series(3, n, 60, 24, 1.1) },
    { label: 'On-time fulfillment', value: `${(96.2 - (range === '90' ? 1.1 : 0)).toFixed(1)}%`, delta: '+1.2 pts', good: true, points: series(7, n, 90, 6, 0.15) },
    { label: 'Avg. cycle time', value: `${(31.4 + (range === '7' ? 0 : 1.6)).toFixed(1)} h`, delta: '-2.1 h', good: true, points: series(11, n, 40, 10, -0.5) },
    { label: 'Open support tickets', value: num(128 * (range === '7' ? 1 : 1.2)), delta: '+14', good: false, points: series(19, n, 30, 12, 0.6) },
  ];
}

export function trendFor(range: RangeKey): { labels: string[]; orders: number[]; shipped: number[] } {
  const n = range === '7' ? 7 : range === '30' ? 30 : 90;
  const orders = series(5, n, 240, 70, range === '90' ? 0.6 : 1.2);
  const shipped = orders.map((v, i) => v * (0.9 + 0.04 * Math.sin(i / 3)));
  const labels: string[] = [];
  const end = new Date(Date.UTC(2026, 9, 10));
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(end.getTime() - i * 86400000);
    labels.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }));
  }
  return { labels, orders, shipped };
}

export const TIMEZONES = [
  { value: 'America/Los_Angeles', label: '(UTC-08:00) Pacific Time' },
  { value: 'America/Denver', label: '(UTC-07:00) Mountain Time' },
  { value: 'America/Chicago', label: '(UTC-06:00) Central Time' },
  { value: 'America/New_York', label: '(UTC-05:00) Eastern Time' },
  { value: 'UTC', label: '(UTC+00:00) UTC' },
  { value: 'Europe/Berlin', label: '(UTC+01:00) Central European Time' },
  { value: 'Asia/Singapore', label: '(UTC+08:00) Singapore' },
];
