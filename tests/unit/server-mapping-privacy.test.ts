import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLabel, revalidateMapping, strategiesFromAdmin, mappingKeyForLabel } from '../../server/knowledge/mapping.ts';
import { enforceContextPolicy } from '../../server/services/guidance.ts';
import { defaultPrivacyPolicy, type CatalogRow, type ConfigSnapshot, type MappingRow } from '../../server/data/types.ts';
import type { MatchStrategy } from '../../packages/contracts/src/sdk-types.ts';

const recent = new Date().toISOString();

function element(navoroId: string, label: string | null, extra: Partial<CatalogRow> = {}): CatalogRow {
  return {
    id: `el_${navoroId}`, org_id: 'org', app_id: 'app', navoro_id: navoroId, label, role: 'button', route: '/reports',
    source: 'manual', approved: 1, first_seen_at: recent, last_seen_at: recent, ...extra,
  };
}

function mapping(label: string, strategies: MatchStrategy[], extra: Partial<MappingRow> = {}): MappingRow {
  return {
    id: 'map_1', org_id: 'org', app_id: 'app', key: mappingKeyForLabel(label), label, strategies: JSON.stringify(strategies),
    provenance: 'developer_id', confidence: 0.95, validation: 'valid', validation_detail: null, updated_at: recent, ...extra,
  };
}

describe('resolveLabel', () => {
  test('unique approved match → navoro_id strategy first, valid', () => {
    const resolution = resolveLabel('New Report', [element('reports.new', 'New report'), element('reports.save', 'Save')]);
    assert.equal(resolution.validation, 'valid');
    assert.equal(resolution.provenance, 'developer_id');
    assert.deepEqual(resolution.strategies[0], { type: 'navoro_id', value: 'reports.new' });
    assert.ok(resolution.confidence >= 0.9);
  });

  test('ambiguous label → uncertain with only a text strategy', () => {
    const resolution = resolveLabel('Save', [element('a.save', 'Save'), element('b.save', 'Save')]);
    assert.equal(resolution.validation, 'uncertain');
    assert.deepEqual(resolution.strategies, [{ type: 'text', value: 'Save' }]);
    assert.match(resolution.detail ?? '', /2 approved elements/);
  });

  test('ambiguity is broken by the route hint or by a single interactive role', () => {
    const catalog = [element('a.save', 'Save', { route: '/a' }), element('b.save', 'Save', { route: '/b' })];
    assert.deepEqual(resolveLabel('Save', catalog, '/b').strategies[0], { type: 'navoro_id', value: 'b.save' });
    const roles = [element('h.reports', 'Reports', { role: 'heading' }), element('nav.reports', 'Reports', { role: 'link' })];
    assert.deepEqual(resolveLabel('Reports', roles).strategies[0], { type: 'navoro_id', value: 'nav.reports' });
  });

  test('empty catalog → unverified with aria/text strategies', () => {
    const resolution = resolveLabel('New report', []);
    assert.equal(resolution.validation, 'unverified');
    assert.deepEqual(resolution.strategies.map((s) => s.type), ['aria_label', 'text']);
  });

  test('unapproved elements are ignored', () => {
    const unapproved = [element('reports.new', 'New report', { approved: 0 })];
    assert.equal(resolveLabel('New report', unapproved).validation, 'unverified');
    const mixed = [...unapproved, element('other', 'Other')];
    const resolution = resolveLabel('New report', mixed);
    assert.equal(resolution.validation, 'uncertain');
    assert.ok(!resolution.strategies.some((s) => s.type === 'navoro_id'));
  });
});

describe('revalidateMapping', () => {
  const navoro: MatchStrategy[] = [{ type: 'navoro_id', value: 'reports.new' }, { type: 'text', value: 'New report' }];

  test('valid when the navoro id is approved, fresh and labelled the same', () => {
    assert.equal(revalidateMapping(mapping('New report', navoro), [element('reports.new', 'New report')]).validation, 'valid');
  });

  test('missing navoro id → broken (when there is approved metadata)', () => {
    const resolution = revalidateMapping(mapping('New report', navoro), [element('other', 'Other')]);
    assert.equal(resolution.validation, 'broken');
    assert.match(resolution.detail ?? '', /not present/);
  });

  test('missing navoro id with no approved metadata → unverified', () => {
    assert.equal(revalidateMapping(mapping('New report', navoro), []).validation, 'unverified');
  });

  test('label changed → uncertain', () => {
    const resolution = revalidateMapping(mapping('New report', navoro), [element('reports.new', 'Create report')]);
    assert.equal(resolution.validation, 'uncertain');
    assert.match(resolution.detail ?? '', /now labelled "Create report"/);
  });

  test('stale element → uncertain', () => {
    const old = new Date(Date.now() - 45 * 86_400_000).toISOString();
    const resolution = revalidateMapping(mapping('New report', navoro), [element('reports.new', 'New report', { last_seen_at: old })]);
    assert.equal(resolution.validation, 'uncertain');
    assert.match(resolution.detail ?? '', /Not seen by the SDK for 45 days/);
  });

  test('extracted mapping whose element was unapproved → broken', () => {
    const resolution = revalidateMapping(mapping('New report', navoro), [element('reports.new', 'New report', { approved: 0 }), element('x', 'X')]);
    assert.equal(resolution.validation, 'broken');
    assert.match(resolution.detail ?? '', /no longer approved/);
  });

  test('admin mapping to a discovered-but-unapproved element → uncertain', () => {
    const admin = mapping('New report', navoro, { provenance: 'admin' });
    assert.equal(revalidateMapping(admin, [element('reports.new', 'New report', { approved: 0 })]).validation, 'uncertain');
  });

  test('admin mapping keeps its strategies and provenance', () => {
    const admin = mapping('New report', navoro, { provenance: 'admin', confidence: 0.9 });
    const resolution = revalidateMapping(admin, [element('reports.new', 'New report')]);
    assert.equal(resolution.provenance, 'admin');
    assert.deepEqual(resolution.strategies, navoro);
    const textOnly = mapping('New report', [{ type: 'text', value: 'New report' }], { provenance: 'admin' });
    const kept = revalidateMapping(textOnly, [element('reports.new', 'New report')]);
    assert.equal(kept.provenance, 'admin');
    assert.deepEqual(kept.strategies, [{ type: 'text', value: 'New report' }]);
    assert.equal(kept.validation, 'uncertain');
  });

  test('extracted mapping without navoro id is upgraded when the label becomes resolvable', () => {
    const extracted = mapping('New report', [{ type: 'text', value: 'New report' }], { provenance: 'extracted', validation: 'unverified' });
    const resolution = revalidateMapping(extracted, [element('reports.new', 'New report')]);
    assert.equal(resolution.validation, 'valid');
    assert.deepEqual(resolution.strategies[0], { type: 'navoro_id', value: 'reports.new' });
  });
});

describe('strategiesFromAdmin', () => {
  test('orders navoro id, aria label, text and applies role', () => {
    assert.deepEqual(strategiesFromAdmin({ navoroId: ' a.b ', ariaLabel: 'Save', text: 'Save it', role: 'button' }), [
      { type: 'navoro_id', value: 'a.b' },
      { type: 'aria_label', value: 'Save', role: 'button' },
      { type: 'text', value: 'Save it', role: 'button' },
    ]);
  });

  test('blank inputs produce no strategies', () => {
    assert.deepEqual(strategiesFromAdmin({ navoroId: '  ', text: '', role: '  ' }), []);
    assert.deepEqual(strategiesFromAdmin({ text: 'Go', role: ' ' }), [{ type: 'text', value: 'Go' }]);
  });
});

describe('enforceContextPolicy', () => {
  function snapshot(patch: Partial<ConfigSnapshot['privacy']> = {}, approved: string[] = ['ok', 'blocked']): ConfigSnapshot {
    return {
      privacy: { ...defaultPrivacyPolicy(), ...patch },
      workflowIds: [],
      approvedNavoroIds: approved,
      launcher: { greeting: 'hi', suggestions: [], supportUrl: null },
    };
  }
  const blockRule = { id: 'r1', kind: 'navoro_id' as const, value: 'blocked', label: 'Secret', createdAt: recent };
  const context = {
    route: '/reports',
    pageTitle: 'Reports',
    headings: ['Reports'],
    fieldLabels: ['Name'],
    elements: [
      { navoroId: 'ok', role: 'button', label: 'Save', disabled: false, invalid: false },
      { navoroId: 'blocked', role: 'textbox', label: 'SSN', disabled: false, invalid: false },
      { navoroId: 'unapproved', role: 'button', label: 'Hidden', disabled: false, invalid: false },
    ],
    visibleErrors: [
      { code: 'E1', message: 'Visible', nearNavoroId: 'ok' },
      { code: 'E2', message: 'Near secret', nearNavoroId: 'blocked' },
      { code: 'E3', message: 'Free floating', nearNavoroId: null },
    ],
  };

  test('drops categories that are not transmitted (default omits fieldLabels)', () => {
    const out = enforceContextPolicy(context, snapshot());
    assert.equal(out.fieldLabels, undefined);
    assert.equal(out.route, '/reports');
    const narrow = enforceContextPolicy(context, snapshot({ transmit: ['route'] }));
    assert.deepEqual(Object.keys(narrow), ['route']);
  });

  test('transmit categories that are not observed are dropped too', () => {
    const out = enforceContextPolicy(context, snapshot({ observe: ['route'], transmit: ['route', 'pageTitle'] }));
    assert.deepEqual(out, { route: '/reports' });
  });

  test('drops unapproved and blocked elements, and errors near blocked elements', () => {
    const out = enforceContextPolicy(context, snapshot({ neverCollect: [blockRule] }));
    assert.deepEqual(out.elements?.map((e) => e.navoroId), ['ok']);
    assert.deepEqual(out.visibleErrors?.map((e) => e.code), ['E1', 'E3']);
  });

  test('truncates long values and list lengths', () => {
    const big = {
      route: 'r'.repeat(500),
      pageTitle: 't'.repeat(500),
      headings: Array.from({ length: 10 }, () => 'h'.repeat(200)),
      elements: [{ navoroId: 'ok', role: 'r'.repeat(100), label: 'l'.repeat(300), disabled: false, invalid: false }],
      visibleErrors: Array.from({ length: 8 }, () => ({ code: 'c'.repeat(100), message: 'm'.repeat(400), nearNavoroId: null })),
    };
    const out = enforceContextPolicy(big, snapshot());
    assert.equal(out.route?.length, 200);
    assert.equal(out.pageTitle?.length, 120);
    assert.equal(out.headings?.length, 6);
    assert.equal(out.headings?.[0]?.length, 80);
    assert.equal(out.elements?.[0]?.label?.length, 80);
    assert.equal(out.elements?.[0]?.role?.length, 30);
    assert.equal(out.visibleErrors?.length, 5);
    assert.equal(out.visibleErrors?.[0]?.code?.length, 60);
    assert.equal(out.visibleErrors?.[0]?.message?.length, 160);
  });
});
