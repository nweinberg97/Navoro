import { TIMEZONES, state } from '../data.ts';
import { h, icon, pageHeader, selectField, textField, toast } from '../ui.ts';

export function settingsTabs(active: 'general' | 'billing'): HTMLElement {
  const link = (label: string, href: string, key: string, id?: string) =>
    h('a', { href, class: `tab${active === key ? ' tab-active' : ''}`, 'aria-current': active === key ? 'page' : null, 'data-navoro-id': id }, label);
  return h('nav', { class: 'tabs', 'aria-label': 'Settings sections' }, link('General', '#/settings', 'general'), link('Billing', '#/settings/billing', 'billing', 'settings.billing-tab'));
}

function initials(name: string): string {
  return name.split(' ').map((p) => p[0]).join('').slice(0, 2);
}

export function settingsView(): HTMLElement {
  const workspace = textField({ label: 'Workspace name', navoroId: 'settings.workspace-name', value: 'Northwind Ops (demo)', hint: 'Shown to everyone in your workspace and on emailed reports.' });
  const tz = selectField({ label: 'Time zone', navoroId: 'settings.timezone', options: TIMEZONES, value: 'America/New_York', hint: 'Scheduled reports are sent according to this time zone.' });
  const token = textField({ label: 'API token', navoroId: 'settings.api-token', value: 'lum_live_SYNTHETIC_7f3a…', readOnly: true, hint: 'Synthetic placeholder — not a real credential.' });
  const copy = h('button', {
    type: 'button',
    class: 'btn',
    'aria-label': 'Copy API token',
    onclick: async () => {
      try {
        await navigator.clipboard.writeText(token.control.value);
        toast('API token copied.');
      } catch {
        token.control.select();
        toast('Press Ctrl+C to copy the selected token.', 'info');
      }
    },
  }, icon('copy', 16), 'Copy');
  token.root.querySelector('.label')?.after(h('div', { class: 'input-row' }, token.control, copy));

  const memberList = h('ul', { class: 'members' });
  const paintMembers = () =>
    memberList.replaceChildren(
      ...state.members.map((m) =>
        h('li', { class: 'member' }, h('span', { class: 'avatar', 'aria-hidden': 'true' }, initials(m.name)), h('div', { class: 'member-id' }, h('span', { class: 'member-name' }, m.name), h('span', { class: 'muted small' }, m.email)), h('span', { class: 'pill pill-idle' }, m.role)),
      ),
    );
  paintMembers();

  const inviteEmail = textField({ label: 'Teammate email', navoroId: 'settings.invite-email', type: 'email', placeholder: 'name@company.example', autocomplete: 'off' });
  const inviteRole = selectField({ label: 'Role', navoroId: 'settings.invite-role', options: [{ value: 'Viewer', label: 'Viewer' }, { value: 'Editor', label: 'Editor' }, { value: 'Admin', label: 'Admin' }] });
  const invitePanel = h('form', { class: 'panel', hidden: true, novalidate: true, 'aria-label': 'Invite teammate' }, h('div', { class: 'panel-grid' }, inviteEmail.root, inviteRole.root), h('div', { class: 'form-actions' }, h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => closeInvite() }, 'Cancel'), h('button', { type: 'submit', class: 'btn btn-primary' }, 'Send invitation')));
  const inviteBtn = h('button', { type: 'button', class: 'btn', 'data-navoro-id': 'settings.invite-button', 'aria-expanded': 'false', onclick: () => { invitePanel.hidden = !invitePanel.hidden; inviteBtn.setAttribute('aria-expanded', String(!invitePanel.hidden)); if (!invitePanel.hidden) inviteEmail.control.focus(); } }, icon('plus', 16), 'Invite teammate');
  const closeInvite = () => { invitePanel.hidden = true; inviteBtn.setAttribute('aria-expanded', 'false'); inviteBtn.focus(); };
  invitePanel.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeInvite(); });
  invitePanel.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = inviteEmail.control.value.trim();
    if (!email.includes('@')) { inviteEmail.control.focus(); return; }
    state.members.push({ name: email.split('@')[0] ?? email, email, role: inviteRole.control.value });
    paintMembers();
    inviteEmail.control.value = '';
    invitePanel.hidden = true;
    inviteBtn.setAttribute('aria-expanded', 'false');
    toast(`Invitation sent to ${email}.`);
  });

  const save = h('button', { type: 'button', class: 'btn btn-primary', 'data-navoro-id': 'settings.save-button', onclick: () => toast('Settings saved.') }, 'Save changes');

  return h(
    'div',
    { class: 'view view-narrow' },
    pageHeader('Settings', 'Manage your workspace, teammates, and billing.'),
    settingsTabs('general'),
    h('section', { class: 'card form', 'aria-labelledby': 'ws-h' }, h('h2', { id: 'ws-h', class: 'card-title' }, 'Workspace'), workspace.root, tz.root),
    h('section', { class: 'card', 'aria-labelledby': 'mem-h' }, h('div', { class: 'card-head' }, h('h2', { id: 'mem-h', class: 'card-title' }, 'Members'), inviteBtn), invitePanel, memberList),
    h('section', { class: 'card form', 'aria-labelledby': 'api-h' }, h('h2', { id: 'api-h', class: 'card-title' }, 'Developer'), token.root),
    h('div', { class: 'form-actions form-actions-end' }, save),
  );
}
