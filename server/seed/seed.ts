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

const HELP_CENTER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'lumen-help-center.md');

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
  t.activity.audit({ actorUserId: userId, action: 'workspace.seeded', targetType: 'organization', targetId: orgId, summary: 'Created the synthetic Lumen demo workspace' });
  return { created: true, orgId, appId };
}
