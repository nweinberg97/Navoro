import { state } from '../data.ts';
import { chartGlyph } from '../charts.ts';
import { h, icon, pageHeader } from '../ui.ts';

export function reportsView(): HTMLElement {
  const newBtn = h('button', { type: 'button', class: 'btn btn-primary', 'data-navoro-id': 'reports.new-button', onclick: () => { location.hash = '#/reports/new'; } }, icon('plus', 16), 'New report');

  const table = h(
    'table',
    { class: 'table', 'data-navoro-id': 'reports.list' },
    h('caption', { class: 'sr-only' }, 'Reports in this workspace'),
    h('thead', {}, h('tr', {}, ['Name', 'Source', 'Chart', 'Schedule', 'Updated'].map((c) => h('th', { scope: 'col' }, c)))),
    h(
      'tbody',
      {},
      state.reports.map((r) =>
        h(
          'tr',
          {},
          h('th', { scope: 'row', class: 'cell-name' }, r.name),
          h('td', {}, r.source),
          h('td', {}, h('span', { class: 'chip' }, chartGlyph(r.chart), r.chart)),
          h('td', {}, r.schedule === "Don't send" ? h('span', { class: 'muted' }, 'Not scheduled') : r.schedule),
          h('td', { class: 'muted' }, r.updated),
        ),
      ),
    ),
  );
  return h('div', { class: 'view' }, pageHeader('Reports', 'Charts your team can share and schedule.', newBtn), h('div', { class: 'card card-flush table-wrap' }, table));
}
