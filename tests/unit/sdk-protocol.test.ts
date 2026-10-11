import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLineSplitter, EventQueue, parseStreamLine } from '../../sdk/src/api.ts';
import { isGuidanceResult, isSdkInitResponse } from '../../sdk/src/validate.ts';
import { placeCard } from '../../sdk/src/overlay.ts';
import type { SdkEvent } from '../../packages/contracts/src/sdk-types.ts';

const goodResult = {
  sessionId: 's',
  requestId: 'r',
  kind: 'workflow',
  answer: 'a',
  grounded: true,
  confidence: 0.8,
  workflow: { id: 'w', title: 'W' },
  steps: [
    {
      index: 0,
      title: 't',
      instruction: 'i',
      target: { key: 'k', label: 'L', strategies: [{ type: 'navoro_id', value: 'x' }], confidence: 1, validation: 'valid' },
      targetNote: null,
    },
  ],
  citations: [{ sourceId: 'c', sourceTitle: 'Doc', excerpt: 'e' }],
  mode: 'llm',
  fallback: null,
};

test('NDJSON splitter handles chunk boundaries and trailing data', () => {
  const lines: string[] = [];
  const s = createLineSplitter((l) => lines.push(l));
  s.push('{"a":1}\n{"b"');
  s.push(':2}\n\n  \n{"c":3}');
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}']);
  s.end();
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}', '{"c":3}']);
});

test('parseStreamLine validates events and rejects malformed lines', () => {
  assert.deepEqual(parseStreamLine('{"type":"status","phase":"retrieving"}'), { type: 'status', phase: 'retrieving' });
  assert.equal(parseStreamLine('{"type":"status","phase":"hacking"}'), null);
  assert.equal(parseStreamLine('not json'), null);
  assert.equal(parseStreamLine('{"type":"error","code":"timeout","message":"m","retryable":"yes"}'), null);
  assert.ok(parseStreamLine('{"type":"error","code":"rate_limited","message":"m","retryable":true}'));
  assert.ok(parseStreamLine(JSON.stringify({ type: 'result', result: goodResult })));
});

test('isGuidanceResult rejects bad shapes', () => {
  assert.equal(isGuidanceResult(goodResult), true);
  assert.equal(isGuidanceResult({ ...goodResult, mode: 'magic' }), false);
  assert.equal(isGuidanceResult({ ...goodResult, answer: 42 }), false);
  assert.equal(isGuidanceResult({ ...goodResult, steps: [{ ...goodResult.steps[0], target: { strategies: [{ type: 'css', value: 'body' }] } }] }), false);
  assert.equal(
    isGuidanceResult({ ...goodResult, steps: [{ ...goodResult.steps[0], target: { ...goodResult.steps[0]!.target, strategies: [{ type: 'eval', value: 'x' }] } }] }),
    false,
  );
  assert.equal(isGuidanceResult(null), false);
});

test('isSdkInitResponse requires allowlistOnly and known categories', () => {
  const ok = {
    apiVersion: 1,
    sessionToken: 't',
    expiresAt: new Date().toISOString(),
    config: {
      applicationName: 'App',
      environment: 'development',
      configVersion: 1,
      privacy: { observe: ['route'], transmit: ['route'], blockedNavoroIds: [], blockedSelectors: [], approvedNavoroIds: [], allowlistOnly: true },
      analyticsEnabled: false,
      discoveryEnabled: false,
      launcher: { position: 'bottom-right', greeting: 'Hi', suggestions: [] },
      supportUrl: null,
    },
  };
  assert.equal(isSdkInitResponse(ok), true);
  assert.equal(isSdkInitResponse({ ...ok, config: { ...ok.config, privacy: { ...ok.config.privacy, allowlistOnly: false } } }), false);
  assert.equal(isSdkInitResponse({ ...ok, config: { ...ok.config, privacy: { ...ok.config.privacy, observe: ['keystrokes'] } } }), false);
  assert.equal(isSdkInitResponse({ ...ok, apiVersion: 2 }), false);
});

test('EventQueue strips unknown fields (never question text) and batches', async () => {
  const batches: SdkEvent[][] = [];
  const q = new EventQueue((events) => batches.push(events), 5);
  q.push({ type: 'guidance_shown', sessionId: 's', question: 'my secret question' } as SdkEvent);
  q.push({ type: 'step_viewed', stepIndex: 0, workflowId: 'w', mappingKey: 'k' });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0], [
    { type: 'guidance_shown', sessionId: 's' },
    { type: 'step_viewed', workflowId: 'w', stepIndex: 0, mappingKey: 'k' },
  ]);
  assert.ok(!JSON.stringify(batches).includes('secret'));
  q.dispose();
});

test('placeCard flips to stay inside the viewport', () => {
  const vp = { width: 1000, height: 800 };
  const card = { width: 300, height: 150 };
  const mk = (top: number, left: number, w = 100, hh = 30) => ({ top, left, bottom: top + hh, right: left + w, width: w, height: hh });
  assert.equal(placeCard(mk(100, 400), card, vp).placement, 'below');
  assert.equal(placeCard(mk(700, 400), card, vp).placement, 'above');
  const right = placeCard(mk(10, 10, 100, 780), card, vp);
  assert.equal(right.placement, 'right');
  const clamped = placeCard(mk(100, 950, 40), card, vp);
  assert.ok(clamped.left + card.width <= vp.width - 8 + 0.001);
  assert.ok(clamped.left >= 8);
});
