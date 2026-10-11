import { SOURCES, state, type ChartType, type Schedule } from '../data.ts';
import { clearError, h, pageHeader, selectField, showError, textField, toast } from '../ui.ts';

export function newReportView(): HTMLElement {
  const name = textField({ label: 'Report name', navoroId: 'report.name', placeholder: 'e.g. Weekly fulfillment', autocomplete: 'off' });
  const source = selectField({
    label: 'Data source',
    navoroId: 'report.source',
    options: [{ value: '', label: 'Select a data source' }, ...SOURCES.map((s) => ({ value: s, label: s }))],
  });
  const schedule = selectField({
    label: 'Schedule',
    navoroId: 'report.schedule',
    options: [{ value: "Don't send", label: "Don't send" }, { value: 'Daily', label: 'Daily' }, { value: 'Weekly', label: 'Weekly' }],
    hint: 'Optionally email this report to subscribers.',
  });

  const chartTypes: ChartType[] = ['Line', 'Bar', 'Table'];
  const glyph: Record<ChartType, string> = { Line: 'M3 17l5-6 4 3 8-9', Bar: 'M6 20v-7M12 20V5M18 20v-10', Table: 'M4 6h16v12H4zM4 11h16M10 11v7' };
  const radios = chartTypes.map((t, i) => {
    const input = h('input', { type: 'radio', name: 'chartType', value: t, id: `chart-${t}`, checked: i === 0, class: 'radio-input' });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'radio-glyph');
    svg.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', glyph[t]);
    svg.append(p);
    return h('label', { class: 'radio-card', for: `chart-${t}` }, input, svg, h('span', {}, t));
  });
  const fieldset = h('fieldset', { class: 'fieldset', 'data-navoro-id': 'report.chart-type' }, h('legend', { class: 'label' }, 'Chart type'), h('div', { class: 'radio-row' }, radios));

  name.control.addEventListener('input', () => clearError(name));
  source.control.addEventListener('change', () => clearError(source));

  const form = h(
    'form',
    { class: 'card form', novalidate: true, 'data-navoro-id': 'report.form', 'aria-label': 'New report' },
    name.root,
    source.root,
    fieldset,
    schedule.root,
    h(
      'div',
      { class: 'form-actions' },
      h('button', { type: 'button', class: 'btn', 'data-navoro-id': 'report.cancel-button', onclick: () => { location.hash = '#/reports'; } }, 'Cancel'),
      h('button', { type: 'submit', class: 'btn btn-primary', 'data-navoro-id': 'report.save-button' }, 'Create report'),
    ),
  );

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    clearError(name);
    clearError(source);
    let first: HTMLElement | null = null;
    if (!name.control.value.trim()) {
      showError(name, 'REPORT_NAME_REQUIRED', 'Give the report a name.', 'report.name');
      first = name.control;
    }
    if (!source.control.value) {
      showError(source, 'REPORT_SOURCE_REQUIRED', 'Choose a data source before creating the report.', 'report.source');
      first ??= source.control;
    }
    if (first) {
      first.focus();
      return;
    }
    const chart = (form.querySelector('input[name="chartType"]:checked') as HTMLInputElement | null)?.value as ChartType | undefined;
    const reportName = name.control.value.trim();
    state.reports.unshift({ id: `r${Date.now()}`, name: reportName, source: source.control.value, chart: chart ?? 'Line', schedule: schedule.control.value as Schedule, updated: 'Just now' });
    location.hash = '#/reports';
    toast(`Report "${reportName}" created.`);
  });

  return h('div', { class: 'view view-narrow' }, pageHeader('New report', 'Pick a data source and how you want to see it.'), form);
}
