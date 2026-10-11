/**
 * Reproducible demo workspace: a synthetic "Lumen Labs" organization with the
 * Lumen Analytics application registered, its approved element metadata, the
 * sample help center ingested through the real pipeline, guidance published,
 * and a development configuration live. All data is fictional.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NavoroApp } from '../app.ts';
import { tenant } from '../data/tenant.ts';
import { hashPassword } from '../security/crypto.ts';
import { contentHash, normalizeText } from '../knowledge/normalize.ts';
import { INGEST_STEPS } from '../jobs/handlers.ts';
import { publish } from '../services/publishing.ts';
import { newId, now } from '../db/database.ts';

export const DEMO_EMAIL = 'demo@navoro.dev';
export const DEMO_PASSWORD = 'navoro-demo-2026';
export const DEMO_PUBLIC_KEY = 'nav_pk_demo_lumen_dev';
export const SEDI_PUBLIC_KEY = 'nav_pk_demo_sedi_dev';

const HELP_CENTER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'lumen-help-center.md');
/** Mirror of docs/help-center.md in the Sedi repository (github.com/nweinberg97/sedi). */
const SEDI_HELP_CENTER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sedi-help-center.md');

/** Approved application metadata for the Lumen demo (what a developer would register). */
export const LUMEN_ELEMENTS: Array<{ navoroId: string; label: string; role: string; route: string }> = [
  { navoroId: 'nav.dashboard', label: 'Dashboard', role: 'link', route: '/#/dashboard' },
  { navoroId: 'nav.reports', label: 'Reports', role: 'link', route: '/#/dashboard' },
  { navoroId: 'nav.integrations', label: 'Integrations', role: 'link', route: '/#/dashboard' },
  { navoroId: 'nav.settings', label: 'Settings', role: 'link', route: '/#/dashboard' },
  { navoroId: 'dashboard.kpi-row', label: 'Key metrics', role: 'region', route: '/#/dashboard' },
  { navoroId: 'dashboard.date-range', label: 'Date range', role: 'combobox', route: '/#/dashboard' },
  { navoroId: 'reports.new-button', label: 'New report', role: 'button', route: '/#/reports' },
  { navoroId: 'reports.list', label: 'Reports list', role: 'table', route: '/#/reports' },
  { navoroId: 'report.form', label: 'New report form', role: 'form', route: '/#/reports/new' },
  { navoroId: 'report.name', label: 'Report name', role: 'textbox', route: '/#/reports/new' },
  { navoroId: 'report.source', label: 'Data source', role: 'combobox', route: '/#/reports/new' },
  { navoroId: 'report.chart-type', label: 'Chart type', role: 'group', route: '/#/reports/new' },
  { navoroId: 'report.schedule', label: 'Schedule', role: 'combobox', route: '/#/reports/new' },
  { navoroId: 'report.save-button', label: 'Create report', role: 'button', route: '/#/reports/new' },
  { navoroId: 'report.cancel-button', label: 'Cancel', role: 'button', route: '/#/reports/new' },
  { navoroId: 'integrations.warehouse-card', label: 'Warehouse', role: 'region', route: '/#/integrations' },
  { navoroId: 'integrations.warehouse-connect', label: 'Connect warehouse', role: 'button', route: '/#/integrations' },
  { navoroId: 'warehouse.host', label: 'Host', role: 'textbox', route: '/#/integrations' },
  { navoroId: 'warehouse.database', label: 'Database', role: 'textbox', route: '/#/integrations' },
  { navoroId: 'warehouse.username', label: 'Username', role: 'textbox', route: '/#/integrations' },
  { navoroId: 'warehouse.password', label: 'Password', role: 'textbox', route: '/#/integrations' },
  { navoroId: 'warehouse.test-button', label: 'Test connection', role: 'button', route: '/#/integrations' },
  { navoroId: 'warehouse.save-button', label: 'Save connection', role: 'button', route: '/#/integrations' },
  { navoroId: 'settings.workspace-name', label: 'Workspace name', role: 'textbox', route: '/#/settings' },
  { navoroId: 'settings.timezone', label: 'Time zone', role: 'combobox', route: '/#/settings' },
  { navoroId: 'settings.invite-button', label: 'Invite teammate', role: 'button', route: '/#/settings' },
  { navoroId: 'settings.api-token', label: 'API token', role: 'textbox', route: '/#/settings' },
  { navoroId: 'settings.save-button', label: 'Save changes', role: 'button', route: '/#/settings' },
  { navoroId: 'settings.billing-tab', label: 'Billing', role: 'link', route: '/#/settings' },
  { navoroId: 'billing.payment-region', label: 'Payment method', role: 'region', route: '/#/settings/billing' },
  { navoroId: 'billing.card-number', label: 'Card number', role: 'textbox', route: '/#/settings/billing' },
  { navoroId: 'billing.tax-id', label: 'Tax ID', role: 'textbox', route: '/#/settings/billing' },
];

/**
 * Approved application metadata for Sedi (github.com/nweinberg97/sedi), a local-first
 * workspace app that installs the Navoro SDK from js/navoro.js. Labels are the controls'
 * accessible names, which the help center's bold labels match exactly.
 */
export const SEDI_ELEMENTS: Array<{ navoroId: string; label: string; role: string; route: string }> = [
  { navoroId: 'nav.home-logo', label: 'Sedi home', role: 'link', route: '/#/home' },
  { navoroId: 'menu.open', label: 'Open menu', role: 'button', route: '/#/home' },
  { navoroId: 'menu.download', label: 'Download data', role: 'button', route: '/#/home' },
  { navoroId: 'menu.import', label: 'Import data', role: 'button', route: '/#/home' },
  { navoroId: 'menu.brain', label: 'Sovereign Brain', role: 'button', route: '/#/home' },
  { navoroId: 'menu.reminders', label: 'Apple Reminders', role: 'button', route: '/#/home' },
  { navoroId: 'menu.clear', label: 'Clear storage', role: 'button', route: '/#/home' },
  { navoroId: 'nav.switch', label: 'Switch tool', role: 'button', route: '/#/home' },
  { navoroId: 'nav.taskly', label: 'Taskly', role: 'link', route: '/#/home' },
  { navoroId: 'nav.boardly', label: 'Boardly', role: 'link', route: '/#/home' },
  { navoroId: 'nav.home', label: 'Home', role: 'link', route: '/#/home' },
  { navoroId: 'nav.timely', label: 'Timely', role: 'link', route: '/#/home' },
  { navoroId: 'nav.brainly', label: 'Brainly', role: 'link', route: '/#/home' },
  { navoroId: 'universal.open', label: 'Universal Board', role: 'button', route: '/#/home' },
  { navoroId: 'universal.capture', label: 'Add to Universal Board', role: 'textbox', route: '/#/home' },
  { navoroId: 'trash', label: 'Trash', role: 'region', route: '/#/home' },
  { navoroId: 'assistant.open', label: 'Open assistant (⌘K)', role: 'button', route: '/#/home' },
  { navoroId: 'assistant.input', label: 'Message the assistant', role: 'textbox', route: '/#/home' },
  { navoroId: 'assistant.send', label: 'Send', role: 'button', route: '/#/home' },
  { navoroId: 'home.weather', label: 'Weather', role: 'button', route: '/#/home' },
  { navoroId: 'home.next-up', label: 'Next up', role: 'button', route: '/#/home' },
  { navoroId: 'home.activity', label: 'Recent activity', role: 'button', route: '/#/home' },
  { navoroId: 'taskly.add-todo', label: 'Add to To do', role: 'button', route: '/#/taskly' },
  { navoroId: 'taskly.add-inprogress', label: 'Add to In progress', role: 'button', route: '/#/taskly' },
  { navoroId: 'taskly.add-review', label: 'Add to Review', role: 'button', route: '/#/taskly' },
  { navoroId: 'taskly.add-completed', label: 'Add to Completed', role: 'button', route: '/#/taskly' },
  { navoroId: 'taskly.add-backlog', label: 'Add to Backlog', role: 'button', route: '/#/taskly' },
  { navoroId: 'taskly.new-task', label: 'New task title', role: 'textbox', route: '/#/taskly' },
  { navoroId: 'taskly.col-todo', label: 'To do', role: 'region', route: '/#/taskly' },
  { navoroId: 'task.column', label: 'Column', role: 'combobox', route: '/#/taskly' },
  { navoroId: 'boardly.add-category', label: 'Add category', role: 'button', route: '/#/boardly' },
  { navoroId: 'goal.title', label: 'Goal title', role: 'textbox', route: '/#/boardly' },
  { navoroId: 'timely.schedule', label: 'Scheduling', role: 'tab', route: '/#/timely' },
  { navoroId: 'timely.plan', label: 'Planning', role: 'tab', route: '/#/timely' },
  { navoroId: 'timely.day', label: 'Daily', role: 'tab', route: '/#/timely' },
  { navoroId: 'timely.week', label: 'Weekly', role: 'tab', route: '/#/timely' },
  { navoroId: 'timely.month', label: 'Monthly', role: 'tab', route: '/#/timely' },
  { navoroId: 'timely.reminders', label: 'Reminders', role: 'tab', route: '/#/timely' },
  { navoroId: 'timely.new-reminder', label: 'New reminder', role: 'textbox', route: '/#/timely' },
  { navoroId: 'timely.due-date', label: 'Due date', role: 'textbox', route: '/#/timely' },
  { navoroId: 'timely.due-time', label: 'Due time', role: 'textbox', route: '/#/timely' },
  { navoroId: 'timely.previous', label: 'Previous', role: 'button', route: '/#/timely' },
  { navoroId: 'timely.next', label: 'Next', role: 'button', route: '/#/timely' },
  { navoroId: 'timely.today', label: 'Today', role: 'button', route: '/#/timely' },
  { navoroId: 'brainly.search', label: 'Search everything', role: 'searchbox', route: '/#/brainly' },
  { navoroId: 'brainly.paste-link', label: 'Paste a link', role: 'textbox', route: '/#/brainly' },
  { navoroId: 'brainly.add-file', label: 'Add a text file', role: 'button', route: '/#/brainly' },
  { navoroId: 'brainly.new-folder', label: 'New link folder', role: 'button', route: '/#/brainly' },
  { navoroId: 'note.title', label: 'Note title', role: 'textbox', route: '/#/brainly' },
  { navoroId: 'note.body', label: 'Note body', role: 'textbox', route: '/#/brainly' },
  { navoroId: 'card.title', label: 'Title', role: 'textbox', route: '/#/taskly' },
  { navoroId: 'card.description', label: 'Description', role: 'textbox', route: '/#/taskly' },
];

export interface SeedResult {
  created: boolean;
  orgId: string;
  appId: string;
}

export async function seedDemoWorkspace(app: NavoroApp, options: { demoPort: number }): Promise<SeedResult> {
  const { db, accounts } = app.context;
  const existing = accounts.findUserByEmail(DEMO_EMAIL);
  if (existing) {
    const membership = accounts.primaryMembership(existing.id);
    const appRow = db.get<{ id: string }>('SELECT id FROM applications WHERE public_key = ?', [DEMO_PUBLIC_KEY]);
    return { created: false, orgId: membership?.org_id ?? '', appId: appRow?.id ?? '' };
  }

  const { userId, orgId } = accounts.createUserWithOrganization({
    name: 'Avery Demo',
    email: DEMO_EMAIL,
    passwordHash: await hashPassword(DEMO_PASSWORD),
    organizationName: 'Lumen Labs (demo)',
  });
  const t = tenant(db, orgId);
  const appId = t.apps.create({
    name: 'Lumen Analytics',
    publicKey: DEMO_PUBLIC_KEY,
    developmentOrigins: [`http://localhost:${options.demoPort}`, `http://127.0.0.1:${options.demoPort}`],
    productionOrigins: [],
  });
  t.apps.update(appId, {
    greeting: 'Hi! Ask how to do anything in Lumen — I’ll point you to the right place.',
    suggestions: ['How do I create a report?', 'Why can’t I connect my warehouse?', 'Where do I change the time zone?'],
    supportUrl: null,
  });
  t.apps.upsertCatalog(appId, LUMEN_ELEMENTS.map((element) => ({ ...element })), 'manual');

  const draft = t.privacy.draft(appId);
  if (draft) {
    t.privacy.save(appId, {
      ...draft.policy,
      neverCollect: [
        { id: newId('rule'), kind: 'navoro_id', value: 'billing.payment-region', label: 'Billing — payment method (synthetic sensitive region)', createdAt: now() },
        { id: newId('rule'), kind: 'navoro_id', value: 'settings.api-token', label: 'Workspace API token', createdAt: now() },
      ],
    });
  }

  const content = normalizeText(readFileSync(HELP_CENTER, 'utf8'));
  const sourceId = t.knowledge.create(appId, { type: 'manual', title: 'Lumen Help Center (sample)', reference: null, content, contentHash: contentHash(content) });
  t.jobs.enqueue({ appId, type: 'ingest', payload: { sourceId }, steps: INGEST_STEPS.map((step) => ({ ...step })), requestedBy: userId });
  await app.context.runner.drain();

  for (const workflow of t.guidance.workflows(appId)) {
    if (workflow.status === 'draft') t.guidance.setWorkflowStatus(workflow.id, 'published');
  }
  const appRow = t.apps.get(appId);
  if (appRow) publish(t, appRow, 'development', 'Initial demo configuration', userId);

  // Second application: Sedi, a real open-source app (github.com/nweinberg97/sedi) with the SDK installed.
  const sediId = t.apps.create({
    name: 'Sedi',
    publicKey: SEDI_PUBLIC_KEY,
    developmentOrigins: ['http://localhost:8000', 'http://127.0.0.1:8000'],
    productionOrigins: ['https://nweinberg97.github.io'],
  });
  t.apps.update(sediId, {
    greeting: 'Hi! Ask how to do anything in Sedi — I’ll point you to the right place.',
    suggestions: ['How do I create a task?', 'How do I add a reminder?', 'Where do I download my data?'],
    supportUrl: 'https://github.com/nweinberg97/sedi',
  });
  t.apps.upsertCatalog(sediId, SEDI_ELEMENTS.map((element) => ({ ...element })), 'manual');
  const sediDraft = t.privacy.draft(sediId);
  if (sediDraft) {
    t.privacy.save(sediId, {
      ...sediDraft.policy,
      neverCollect: [
        { id: newId('rule'), kind: 'navoro_id', value: 'note.body', label: 'Note editor — personal notes', createdAt: now() },
        { id: newId('rule'), kind: 'navoro_id', value: 'assistant.input', label: 'Assistant message box', createdAt: now() },
      ],
    });
  }
  const sediContent = normalizeText(readFileSync(SEDI_HELP_CENTER, 'utf8'));
  const sediSourceId = t.knowledge.create(sediId, { type: 'manual', title: 'Sedi Help Center', reference: null, content: sediContent, contentHash: contentHash(sediContent) });
  t.jobs.enqueue({ appId: sediId, type: 'ingest', payload: { sourceId: sediSourceId }, steps: INGEST_STEPS.map((step) => ({ ...step })), requestedBy: userId });
  await app.context.runner.drain();
  for (const workflow of t.guidance.workflows(sediId)) {
    if (workflow.status === 'draft') t.guidance.setWorkflowStatus(workflow.id, 'published');
  }
  const sediRow = t.apps.get(sediId);
  if (sediRow) publish(t, sediRow, 'development', 'Initial demo configuration', userId);

  t.activity.audit({ actorUserId: userId, action: 'workspace.seeded', targetType: 'organization', targetId: orgId, summary: 'Created the synthetic Lumen demo workspace' });
  return { created: true, orgId, appId };
}
