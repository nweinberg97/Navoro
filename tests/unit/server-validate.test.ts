import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { v } from '../../server/lib/validate.ts';

describe('validator', () => {
  test('strict objects reject unknown keys and report their path', () => {
    const schema = v.object({ inner: v.object({ a: v.string() }) });
    const result = schema.parse({ inner: { a: 'x', extra: 1 }, top: true });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.deepEqual(result.issues.map((issue) => issue.path).sort(), ['inner.extra', 'top']);
    assert.ok(result.issues.every((issue) => issue.message === 'Unknown field'));
  });

  test('allowUnknown objects keep only known keys', () => {
    const result = v.object({ a: v.number() }, { allowUnknown: true }).parse({ a: 1, b: 2 });
    assert.deepEqual(result, { ok: true, value: { a: 1 } });
  });

  test('non-objects are rejected', () => {
    for (const input of [null, [], 'x', 1]) assert.equal(v.object({}).parse(input).ok, false);
  });

  test('string bounds, trimming and patterns', () => {
    const schema = v.string({ min: 2, max: 4 });
    assert.deepEqual(schema.parse('  ab  '), { ok: true, value: 'ab' });
    assert.equal(schema.parse('a').ok, false);
    assert.equal(schema.parse('abcde').ok, false);
    assert.equal(schema.parse(5).ok, false);
    assert.deepEqual(v.string({ trim: false, min: 3 }).parse(' a '), { ok: true, value: ' a ' });
    const pattern = v.string({ pattern: /^x+$/, patternMessage: 'only x' }).parse('xy');
    assert.deepEqual(pattern, { ok: false, issues: [{ path: '(root)', message: 'only x' }] });
    assert.deepEqual(v.string({ min: 1 }).parse(''), { ok: false, issues: [{ path: '(root)', message: 'Required' }] });
  });

  test('number bounds and integer checks', () => {
    const schema = v.number({ min: 1, max: 10, integer: true });
    assert.equal(schema.parse(5).ok, true);
    assert.equal(schema.parse(0).ok, false);
    assert.equal(schema.parse(11).ok, false);
    assert.equal(schema.parse(1.5).ok, false);
    assert.equal(schema.parse(Number.NaN).ok, false);
    assert.equal(schema.parse(Infinity).ok, false);
    assert.equal(schema.parse('5').ok, false);
  });

  test('boolean, literal and oneOf', () => {
    assert.equal(v.boolean().parse('true').ok, false);
    assert.equal(v.literal('a').parse('b').ok, false);
    assert.deepEqual(v.oneOf(['a', 'b'] as const).parse('b'), { ok: true, value: 'b' });
    assert.equal(v.oneOf(['a', 'b'] as const).parse('c').ok, false);
  });

  test('optional allows undefined (omitting the key), nullable allows null', () => {
    const schema = v.object({ a: v.optional(v.string()), b: v.nullable(v.number()) });
    assert.deepEqual(schema.parse({ b: null }), { ok: true, value: { b: null } });
    assert.equal(schema.parse({ a: null, b: 1 }).ok, false);
    assert.equal(schema.parse({}).ok, false, 'nullable is still required');
  });

  test('arrays enforce min/max, validate items with indexed paths, and dedupe when unique', () => {
    const schema = v.array(v.number(), { min: 1, max: 3 });
    assert.equal(schema.parse([]).ok, false);
    assert.equal(schema.parse([1, 2, 3, 4]).ok, false);
    const bad = schema.parse([1, 'x']);
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.equal(bad.issues[0]?.path, '[1]');
    assert.deepEqual(v.array(v.string(), { unique: true }).parse(['a', 'a', 'b']), { ok: true, value: ['a', 'b'] });
    assert.equal(v.array(v.string()).parse('nope').ok, false);
  });

  test('refine runs only after a successful parse and keeps optionality', () => {
    const even = v.refine(v.number(), (n) => (n % 2 ? 'must be even' : null));
    assert.deepEqual(even.parse(3), { ok: false, issues: [{ path: '(root)', message: 'must be even' }] });
    assert.equal(even.parse(4).ok, true);
    assert.equal(even.parse('x').ok, false);
    const optional = v.refine(v.optional(v.number()), () => null);
    assert.equal(optional.isOptional, true);
  });

  test('union accepts either branch', () => {
    const schema = v.union(v.number(), v.string());
    assert.equal(schema.parse(1).ok, true);
    assert.equal(schema.parse('a').ok, true);
    const bad = schema.parse(true);
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.equal(bad.issues.length, 2);
  });
});
