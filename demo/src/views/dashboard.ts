import { RANGES, kpisFor, state, trendFor, type RangeKey } from '../data.ts';
import { sparkline, trendChart } from '../charts.ts';
import { h, pageHeader, selectField } from '../ui.ts';

export function dashboardView(): HTMLElement {
  const range = selectField({ label: 'Date range', navoroId: 'dashboard.date-range', options: RANGES.map((r) => ({ value: r.value, label: r.label })), value: '30' });
  range.root.classList.add('field-inline');

  const kpiRow = h('div', { class: 'kpi-row', 'data-navoro-id': 'dashboard.kpi-row', role: 'group', 'aria-label': 'Key metrics' });
  const chartHost = h('div', { class: 'chart-host' });
  const periodLabel = h('span', { class: 'muted' });

  const paint = (key: RangeKey) => {
    kpiRow.replaceChildren(
      ...kpisFor(key).map((k) =>
        h(
          'article',
          { class: 'card kpi' },
          h('h2', { class: 'kpi-label' }, k.label),
          h('p', { class: 'kpi-value' }, k.value),
          h('div', { class: 'kpi-foot' }, h('span', { class: `delta ${k.good ? 'delta-good' : 'delta-warn'}` }, k.delta, h('span', { class: 'sr-only' }, ' versus previous period')), sparkline(k.points, k.good)),
        ),
      ),
    );
    const t = trendFor(key);
    chartHost.replaceChildren(trendChart(t.labels, t.orders, t.shipped));
    periodLabel.textContent = RANGES.find((r) => r.value === key)?.label ?? '';
  };
  range.control.addEventListener('change', () => paint(range.control.value as RangeKey));
  paint('30');

  const recent = state.reports.slice(0, 4);
  return h(
    'div',
    { class: 'view' },
    pageHeader('Dashboard', 'How Northwind Ops is performing across fulfillment and support.', range.root),
    kpiRow,
    h(
      'div',
      { class: 'grid-2' },
      h(
        'section',
        { class: 'card', 'aria-labelledby': 'trend-h' },
        h('div', { class: 'card-head' }, h('h2', { id: 'trend-h', class: 'card-title' }, 'Orders received vs. shipped'), periodLabel),
        chartHost,
        h('ul', { class: 'legend' }, h('li', {}, h('i', { class: 'swatch swatch-1' }), 'Received'), h('li', {}, h('i', { class: 'swatch swatch-2' }), 'Shipped')),
      ),
      h(
        'section',
        { class: 'card', 'aria-labelledby': 'recent-h' },
        h('div', { class: 'card-head' }, h('h2', { id: 'recent-h', class: 'card-title' }, 'Recent reports'), h('a', { href: '#/reports', class: 'link' }, 'View all')),
        h(
          'ul',
          { class: 'recent-list' },
          recent.map((r) =>
            h('li', {}, h('a', { href: '#/reports', class: 'recent-item' }, h('span', { class: 'recent-name' }, r.name), h('span', { class: 'muted small' }, `${r.chart} · ${r.updated}`))),
          ),
        ),
      ),
    ),
  );
}
