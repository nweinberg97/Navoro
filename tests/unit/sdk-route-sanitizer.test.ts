import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isIdLikeSegment, safeHttpUrl, sanitizeRoute, truncate } from '../../sdk/src/text.ts';

test('drops the query string', () => {
  assert.equal(sanitizeRoute('/reports?token=abc&email=a@b.co'), '/reports');
  assert.equal(sanitizeRoute('/reports', '#/list?filter=jordan'), '/reports#/list');
});

test('replaces ids, uuids, emails and tokens with :id', () => {
  assert.equal(sanitizeRoute('/customers/123456/edit'), '/customers/:id/edit');
  assert.equal(sanitizeRoute('/customers/42'), '/customers/:id');
  assert.equal(sanitizeRoute('/acct-0012345678'), '/:id');
  assert.equal(sanitizeRoute('/u/3f2504e0-4f89-11d3-9a0c-0305e82c3301'), '/u/:id');
  assert.equal(sanitizeRoute('/users/jordan.avery%40example.com/profile'), '/users/:id/profile');
  assert.equal(sanitizeRoute('/users/jordan@example.com'), '/users/:id');
  assert.equal(sanitizeRoute('/invite/aB3dE5fG7hJ9kL1mN'), '/invite/:id');
  assert.equal(sanitizeRoute('/obj/5f8d0d55b54764421b7156c3'), '/obj/:id');
  assert.equal(sanitizeRoute('/', '#/orders/99887766/items'), '/#/orders/:id/items');
  assert.equal(sanitizeRoute('/a', '#3f2504e0-4f89-11d3-9a0c-0305e82c3301'), '/a#:id');
});

test('keeps ordinary readable segments', () => {
  assert.equal(sanitizeRoute('/settings/billing'), '/settings/billing');
  assert.equal(sanitizeRoute('/reports/q3-2024'), '/reports/q3-2024');
  assert.equal(sanitizeRoute('/api/v1/new-report'), '/api/v1/new-report');
  assert.equal(sanitizeRoute('/docs', '#getting-started'), '/docs#getting-started');
  assert.equal(sanitizeRoute(''), '/');
  assert.equal(sanitizeRoute('/x', '#'), '/x');
});

test('isIdLikeSegment handles bad percent-encoding', () => {
  assert.equal(isIdLikeSegment('%E0%A4%A'), false);
  assert.equal(isIdLikeSegment('1234'), true);
  assert.equal(isIdLikeSegment('v2'), false);
});

test('bounds route length', () => {
  assert.ok(sanitizeRoute('/' + 'segment/'.repeat(60)).length <= 200);
});

test('truncate collapses whitespace and adds ellipsis', () => {
  assert.equal(truncate('  a \n b  ', 10), 'a b');
  assert.equal(truncate('abcdefghij', 5), 'abcd…');
  assert.equal(truncate('abcdefghij', 5).length, 5);
});

test('safeHttpUrl only allows http(s)', () => {
  assert.equal(safeHttpUrl('https://docs.example.com/x'), 'https://docs.example.com/x');
  assert.equal(safeHttpUrl('javascript:alert(1)'), null);
  assert.equal(safeHttpUrl('data:text/html,hi'), null);
  assert.equal(safeHttpUrl('/relative'), null);
  assert.equal(safeHttpUrl(null), null);
});
