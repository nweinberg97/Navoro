/**
 * On-device engine: answers, context use, hand-off, "start where you are", and pack
 * validation. Runs against a pack built from the real Lumen config via navoro-pack's builder.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { answerLocally, chooseStartStep, contactFallback, validatePack, PackError } from '../../packages/engine/src/index.ts';
import { buildPack, parsePackConfig, PackConfigError } from '../../server/knowledge/pack-builder.ts';
import type { KnowledgePack } from '../../packages/contracts/src/sdk-types.ts';

const DEMO = path.resolve(import.meta.dirname, '../../demo');
let pack: KnowledgePack;

before(async () => {
  const config = parsePackConfig(JSON.parse(readFileSync(path.join(DEMO, 'navoro.config.json'), 'utf8')));
  pack = (await buildPack(config, DEMO)).pack;
});

const ask = (question: string, context = {}) => answerLocally(pack, { question, context, requestId: 'r1' }).result;

test('how-to questions become walkthroughs whose steps point at approved controls', () => {
  const r = ask('How do I create a report?');
  assert.equal(r.kind, 'workflow');
  assert.equal(r.mode, 'local');
  assert.equal(r.grounded, true);
  assert.equal(r.steps.length, 7);
  assert.deepEqual(r.steps[0]?.target?.strategies[0], { type: 'navoro_id', value: 'nav.reports' });
  assert.equal(r.steps[1]?.target?.strategies[0]?.value, 'reports.new-button');
  assert.ok(r.citations[0]?.sourceTitle.includes('Lumen'));
});

test('a visible error code on screen answers "what\'s wrong?" and points at the field to fix', () => {
  const r = ask("what's wrong?", { visibleErrors: [{ code: 'REPORT_SOURCE_REQUIRED', message: 'Choose a data source before creating the report.', nearNavoroId: 'report.source' }] });
  assert.equal(r.kind, 'troubleshooting');
  assert.match(r.answer, /data source/i);
  assert.equal(r.steps[0]?.target?.strategies[0]?.value, 'report.source');
});

test('an error on screen does not hijack unrelated questions', () => {
  const ctx = { visibleErrors: [{ code: 'REPORT_SOURCE_REQUIRED', message: 'Choose a data source', nearNavoroId: 'report.source' }] };
  assert.equal(ask('How do I invite a teammate?', ctx).kind, 'workflow');
  assert.equal(ask('I was charged twice and need a refund', ctx).kind, 'unresolved');
});

test('problems a guide cannot solve hand off to support with a pre-filled email', () => {
  for (const q of ['I want to talk to a human', 'I was charged twice, I need a refund', 'the app crashed and my data is gone', 'my sync broke and I lost my data', 'that didn\'t help']) {
    const r = ask(q, { route: '/#/settings' });
    assert.equal(r.kind, 'unresolved', q);
    assert.match(r.answer, /support team/);
    assert.ok(r.fallback?.url?.startsWith('mailto:support@lumen.example?'), q);
    const body = decodeURIComponent(r.fallback!.url!.split('body=')[1]!);
    assert.ok(body.startsWith(q));
    assert.match(body, /Page: \/#\/settings/);
  }
});

test('unknown questions say so instead of guessing, and still offer support', () => {
  const r = ask('How do I bake sourdough bread?');
  assert.equal(r.kind, 'unresolved');
  assert.equal(r.grounded, false);
  assert.equal(r.steps.length, 0);
  assert.ok(r.fallback?.url?.startsWith('mailto:'));
});

test('definitions answer and point at the control they describe', () => {
  const r = ask('What does Schedule mean?');
  assert.equal(r.kind, 'answer');
  assert.match(r.answer, /emails a report/);
  assert.equal(r.steps[0]?.target?.strategies[0]?.value, 'report.schedule');
});

test('context: an ambiguous question resolves to what is on screen', () => {
  const el = (ids: string[]) => ids.map((navoroId) => ({ navoroId, role: null, label: null, disabled: false, invalid: false }));
  const q = 'how do I change it?';
  const onDashboard = answerLocally(pack, { question: q, requestId: 'a', context: { elements: el(['nav.dashboard', 'dashboard.date-range']) } }).result;
  const onSettings = answerLocally(pack, { question: q, requestId: 'b', context: { elements: el(['nav.settings', 'settings.timezone', 'settings.save-button']) } }).result;
  assert.equal(onDashboard.workflow?.title, 'Change the date range on the dashboard');
  assert.equal(onSettings.workflow?.title, 'Change the workspace time zone');
});

test('contactFallback prefers email, then URL, then a plain label', () => {
  assert.ok(contactFallback({ application: { name: 'X' }, supportEmail: 'help@x.example', supportUrl: null }, 'q', {})?.url?.startsWith('mailto:help@x.example'));
  assert.equal(contactFallback({ application: { name: 'X' }, supportEmail: null, supportUrl: 'https://x.example/help' }, 'q', {})?.url, 'https://x.example/help');
  assert.equal(contactFallback({ application: { name: 'X' }, supportEmail: 'not an email', supportUrl: 'javascript:alert(1)' }, 'q', {})?.url, null);
});

test('chooseStartStep: start where the user already is', () => {
  // Dashboard: only the sidebar link is visible.
  assert.equal(chooseStartStep([true, false, false, false]), 0);
  // Reports page: sidebar link and "New report" visible, form not yet.
  assert.equal(chooseStartStep([true, true, false, false]), 1);
  // On the form: "New report" is gone, the fields are here.
  assert.equal(chooseStartStep([true, false, true, true, true]), 2);
  // Everything visible at once (single-page form): no evidence of progress.
  assert.equal(chooseStartStep([true, true, true]), 0);
  // Nothing visible.
  assert.equal(chooseStartStep([false, false]), 0);
  // Steps without a control (null) don't count either way.
  assert.equal(chooseStartStep([true, null, false, true]), 3);
  assert.equal(chooseStartStep([null, null]), 0);
});

test('validatePack rejects malformed or oversized packs', () => {
  assert.doesNotThrow(() => validatePack(JSON.parse(JSON.stringify(pack))));
  const bad = (mutate: (p: any) => void) => {
    const copy = JSON.parse(JSON.stringify(pack));
    mutate(copy);
    return () => validatePack(copy);
  };
  assert.throws(bad((p) => (p.format = 'other')), PackError);
  assert.throws(bad((p) => (p.version = 2)), PackError);
  assert.throws(bad((p) => (p.privacy.observe = ['everything'])), PackError);
  assert.throws(bad((p) => (p.mappings[0].strategies = [{ type: 'css', value: 'body *' }])), PackError);
  assert.throws(bad((p) => (p.workflows[0].steps = 'nope')), PackError);
  assert.throws(bad((p) => (p.application.name = 'x'.repeat(500))), PackError);
  assert.throws(() => validatePack(null), PackError);
});

test('pack builder: config validation, privacy rules and coverage report', async () => {
  assert.throws(() => parsePackConfig({ name: 'X' }), PackConfigError);
  assert.throws(() => parsePackConfig({ name: 'X', docs: ['a.md'], privacy: { neverCollect: [{ selector: '<script>' }] } }), PackConfigError);
  assert.throws(() => parsePackConfig({ name: 'X', docs: ['a.md'], supportEmail: 'nope' }), PackConfigError);
  assert.throws(() => parsePackConfig({ name: 'X', docs: ['a.md'], extra: true }), PackConfigError);
  assert.deepEqual(pack.privacy.blockedNavoroIds, ['billing.payment-region', 'settings.api-token']);
  assert.deepEqual(pack.privacy.blockedSelectors, ['[data-lumen-private]']);
  assert.ok(!pack.privacy.approvedNavoroIds.includes('billing.payment-region'));
  const { report } = await buildPack(parsePackConfig(JSON.parse(readFileSync(path.join(DEMO, 'navoro.config.json'), 'utf8'))), DEMO);
  assert.ok(report.stepsPointing >= 28);
  assert.ok(report.unmatchedLabels.some((miss) => miss.label === 'Last 7 days'));
});

test('pack builder without an element list: tagging is the opt-in, steps match by name at runtime', async () => {
  const { pack: loose, report } = await buildPack(parsePackConfig({ name: 'Lumen', docs: ['../server/seed/lumen-help-center.md'] }), DEMO);
  assert.deepEqual(loose.privacy.approvedNavoroIds, ['*']);
  assert.equal(report.unmatchedLabels.length, 0);
  const r = answerLocally(loose, { question: 'How do I create a report?', context: {}, requestId: 'r' }).result;
  assert.deepEqual(r.steps[1]?.target?.strategies.map((s) => s.type), ['aria_label', 'text']);
  assert.equal(r.steps[1]?.target?.strategies[0]?.value, 'New report');
});
