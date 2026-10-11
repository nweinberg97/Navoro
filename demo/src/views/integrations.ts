import { state } from '../data.ts';
import { h, icon, pageHeader, textField, toast } from '../ui.ts';

function card(iconName: string, title: string, desc: string, status: Node, action: Node, extra?: Node, navoroId?: string): HTMLElement {
  return h(
    'article',
    { class: 'card integration', 'data-navoro-id': navoroId },
    h('div', { class: 'integration-top' }, h('span', { class: 'int-icon' }, icon(iconName, 20)), h('div', { class: 'int-body' }, h('h2', { class: 'card-title' }, title), h('p', { class: 'muted' }, desc)), status),
    h('div', { class: 'integration-actions' }, action),
    extra,
  );
}

const pill = (text: string, tone: 'ok' | 'idle') => h('span', { class: `pill pill-${tone}` }, text);

export function integrationsView(): HTMLElement {
  const warehousePill = h('span', {}, pill(state.warehouse.connected ? 'Connected' : 'Not connected', state.warehouse.connected ? 'ok' : 'idle'));
  const host = textField({ label: 'Host', navoroId: 'warehouse.host', placeholder: 'warehouse.example.internal', autocomplete: 'off' });
  const db = textField({ label: 'Database', navoroId: 'warehouse.database', placeholder: 'northwind_ops', autocomplete: 'off' });
  const user = textField({ label: 'Username', navoroId: 'warehouse.username', placeholder: 'read-only user', autocomplete: 'username' });
  const pass = textField({ label: 'Password', navoroId: 'warehouse.password', type: 'password', autocomplete: 'current-password' });
  const result = h('div', { class: 'test-result', 'aria-live': 'polite' });
  const testBtn = h('button', { type: 'button', class: 'btn', 'data-navoro-id': 'warehouse.test-button' }, 'Test connection');
  const saveBtn = h('button', { type: 'button', class: 'btn btn-primary', 'data-navoro-id': 'warehouse.save-button', disabled: true }, 'Save connection');
  const cancelBtn = h('button', { type: 'button', class: 'btn btn-ghost' }, 'Close');

  const panel = h(
    'form',
    { class: 'panel', hidden: true, 'aria-label': 'Connect warehouse', novalidate: true },
    h('div', { class: 'panel-grid' }, host.root, db.root, user.root, pass.root),
    result,
    h('div', { class: 'form-actions' }, cancelBtn, testBtn, saveBtn),
  );

  const connectBtn = h('button', { type: 'button', class: 'btn', 'data-navoro-id': 'integrations.warehouse-connect', 'aria-expanded': 'false' }, 'Connect warehouse');
  const setOpen = (open: boolean) => {
    panel.hidden = !open;
    connectBtn.setAttribute('aria-expanded', String(open));
    if (open) host.control.focus();
    else connectBtn.focus();
  };
  connectBtn.addEventListener('click', () => setOpen(panel.hidden === true));
  cancelBtn.addEventListener('click', () => setOpen(false));
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      setOpen(false);
    }
  });
  panel.addEventListener('submit', (e) => e.preventDefault());

  const invalidate = () => {
    saveBtn.disabled = true;
    result.replaceChildren();
    user.control.removeAttribute('aria-invalid');
    pass.control.removeAttribute('aria-invalid');
  };
  for (const f of [host, db, user, pass]) f.control.addEventListener('input', invalidate);

  testBtn.addEventListener('click', () => {
    invalidate();
    testBtn.disabled = true;
    testBtn.textContent = 'Testing…';
    result.replaceChildren(h('p', { class: 'muted' }, 'Checking credentials…'));
    window.setTimeout(() => {
      testBtn.disabled = false;
      testBtn.textContent = 'Test connection';
      if (user.control.value === 'analyst_ro' && pass.control.value) {
        result.replaceChildren(h('p', { class: 'success', role: 'status' }, icon('check', 16), 'Connection successful. 3 tables found.'));
        saveBtn.disabled = false;
      } else {
        const username = user.control.value;
        result.replaceChildren(h('p', { class: 'error', 'data-navoro-error': 'WAREHOUSE_AUTH_FAILED', role: 'alert' }, `Authentication failed for user "${username}". Check the username and password.`));
        user.control.setAttribute('aria-invalid', 'true');
        pass.control.setAttribute('aria-invalid', 'true');
      }
    }, 600);
  });

  saveBtn.addEventListener('click', () => {
    state.warehouse = { connected: true, host: host.control.value || 'warehouse.example.internal' };
    warehousePill.replaceChildren(pill('Connected', 'ok'));
    setOpen(false);
    toast('Warehouse connection saved.');
  });

  return h(
    'div',
    { class: 'view' },
    pageHeader('Integrations', 'Connect the systems where your data lives.'),
    h(
      'div',
      { class: 'integration-list' },
      card('database', 'Warehouse', 'Read tables from your SQL data warehouse and use them as report data sources.', warehousePill, connectBtn, panel, 'integrations.warehouse-card'),
      card('slack', 'Slack', 'Post scheduled reports to a channel.', pill('Not connected', 'idle'), h('button', { type: 'button', class: 'btn', onclick: () => toast('Slack is not available in this demo.', 'info') }, 'Connect Slack')),
      card('upload', 'CSV uploads', 'Upload spreadsheets as one-off data sources.', pill('1 file', 'ok'), h('button', { type: 'button', class: 'btn', onclick: () => toast('Uploads are disabled in this demo.', 'info') }, 'Upload CSV')),
    ),
  );
}
