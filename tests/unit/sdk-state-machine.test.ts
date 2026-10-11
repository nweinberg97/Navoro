import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, SessionMachine, transition, type SessionState } from '../../sdk/src/state-machine.ts';
import type { GuidanceResult } from '../../packages/contracts/src/sdk-types.ts';

function result(requestId: string, steps = 2, kind: GuidanceResult['kind'] = 'workflow'): GuidanceResult {
  return {
    sessionId: 'sess_1',
    requestId,
    kind,
    answer: 'Do the thing.',
    grounded: true,
    confidence: 0.9,
    workflow: kind === 'workflow' ? { id: 'wf_1', title: 'Create report' } : null,
    steps: Array.from({ length: steps }, (_, i) => ({ index: i, title: `S${i}`, instruction: 'x', target: null, targetNote: null })),
    citations: [],
    mode: 'demo',
    fallback: null,
  };
}

function run(events: Parameters<typeof transition>[1][], from: SessionState = initialState): SessionState {
  let s = from;
  for (const e of events) {
    const r = transition(s, e);
    assert.equal(r.accepted, true, `expected ${e.type} accepted from ${s.status} (${r.reason})`);
    s = r.state;
  }
  return s;
}

test('happy path: open → ask → stream → result → targets → steps → complete', () => {
  let s = run([{ type: 'OPEN' }]);
  assert.equal(s.status, 'opening');
  s = run([{ type: 'OPEN', question: 'how?', requestId: 'r1' }], s);
  assert.equal(s.status, 'collecting_context');
  assert.equal(s.requestId, 'r1');
  s = run(
    [
      { type: 'CONTEXT_READY', requestId: 'r1' },
      { type: 'REQUEST_SENT', requestId: 'r1' },
      { type: 'STREAM_EVENT', requestId: 'r1', phase: 'reasoning' },
    ],
    s,
  );
  assert.equal(s.status, 'streaming');
  assert.equal(s.phase, 'reasoning');
  s = run([{ type: 'RESULT', requestId: 'r1', result: result('r1') }], s);
  assert.equal(s.status, 'resolving_targets');
  assert.equal(s.sessionId, 'sess_1');
  s = run([{ type: 'TARGETS_RESOLVED', requestId: 'r1' }], s);
  assert.equal(s.status, 'showing_guidance');
  assert.equal(s.stepIndex, 0, 'workflow auto-starts the first step');
  s = run([{ type: 'NEXT_STEP' }], s);
  assert.equal(s.stepIndex, 1);
  assert.equal(transition(s, { type: 'NEXT_STEP' }).accepted, false, 'cannot step past the end');
  s = run([{ type: 'PREV_STEP' }, { type: 'COMPLETE' }], s);
  assert.equal(s.status, 'completed');
  const again = run([{ type: 'NEXT_STEP' }], s);
  assert.equal(again.status, 'showing_guidance');
  assert.equal(again.stepIndex, 0, 'walkthrough can be restarted after completion');
});

test('answer results without steps go straight to showing_guidance with no active step', () => {
  const s = run([
    { type: 'OPEN', question: 'q', requestId: 'r1' },
    { type: 'CONTEXT_READY', requestId: 'r1' },
    { type: 'RESULT', requestId: 'r1', result: result('r1', 0, 'answer') },
  ]);
  assert.equal(s.status, 'showing_guidance');
  assert.equal(s.stepIndex, null);
});

test('non-workflow results with steps wait for the user to start', () => {
  const s = run([
    { type: 'OPEN', question: 'q', requestId: 'r1' },
    { type: 'CONTEXT_READY', requestId: 'r1' },
    { type: 'RESULT', requestId: 'r1', result: result('r1', 1, 'troubleshooting') },
    { type: 'TARGETS_RESOLVED', requestId: 'r1' },
  ]);
  assert.equal(s.stepIndex, null);
  assert.equal(run([{ type: 'NEXT_STEP' }], s).stepIndex, 0);
});

test('stale responses are dropped', () => {
  let s = run([
    { type: 'OPEN', question: 'first', requestId: 'r1' },
    { type: 'CONTEXT_READY', requestId: 'r1' },
    { type: 'CANCEL' },
    { type: 'OPEN', question: 'second', requestId: 'r2' },
    { type: 'CONTEXT_READY', requestId: 'r2' },
  ]);
  const stale = transition(s, { type: 'RESULT', requestId: 'r1', result: result('r1') });
  assert.equal(stale.accepted, false);
  assert.equal(stale.reason, 'stale');
  assert.equal(stale.state, s);
  // Event id matches but the embedded result id does not → still stale.
  assert.equal(transition(s, { type: 'RESULT', requestId: 'r2', result: result('r1') }).reason, 'stale');
  assert.equal(transition(s, { type: 'STREAM_EVENT', requestId: 'r1', phase: 'retrieving' }).reason, 'stale');
  assert.equal(transition(s, { type: 'FAIL', requestId: 'r1', error: { code: 'internal', message: '', retryable: true } }).reason, 'stale');
  s = run([{ type: 'RESULT', requestId: 'r2', result: result('r2', 0) }], s);
  assert.equal(s.question, 'second');
});

test('cancel is allowed while in flight and blocks late results', () => {
  for (const steps of [
    [{ type: 'OPEN', question: 'q', requestId: 'r1' }],
    [{ type: 'OPEN', question: 'q', requestId: 'r1' }, { type: 'CONTEXT_READY', requestId: 'r1' }],
    [{ type: 'OPEN', question: 'q', requestId: 'r1' }, { type: 'CONTEXT_READY', requestId: 'r1' }, { type: 'REQUEST_SENT', requestId: 'r1' }],
  ] as Parameters<typeof transition>[1][][]) {
    const s = run([...steps, { type: 'CANCEL' }]);
    assert.equal(s.status, 'cancelled');
    assert.equal(transition(s, { type: 'RESULT', requestId: 'r1', result: result('r1') }).accepted, false);
  }
  assert.equal(transition(initialState, { type: 'CANCEL' }).accepted, false);
});

test('errors: retryable errors can be retried with a new request id; non-retryable cannot', () => {
  const base = run([
    { type: 'OPEN', question: 'q', requestId: 'r1' },
    { type: 'CONTEXT_READY', requestId: 'r1' },
  ]);
  const retryable = run([{ type: 'FAIL', requestId: 'r1', error: { code: 'timeout', message: 't', retryable: true } }], base);
  assert.equal(retryable.status, 'error');
  const retried = run([{ type: 'RETRY', requestId: 'r2' }], retryable);
  assert.equal(retried.status, 'collecting_context');
  assert.equal(retried.requestId, 'r2');
  assert.equal(retried.question, 'q');
  assert.equal(retried.error, null);
  const fatal = run([{ type: 'FAIL', requestId: 'r1', error: { code: 'invalid_request', message: 'x', retryable: false } }], base);
  assert.equal(transition(fatal, { type: 'RETRY', requestId: 'r2' }).accepted, false);
  // but a fresh question is still allowed
  assert.equal(transition(fatal, { type: 'OPEN', question: 'new', requestId: 'r3' }).accepted, true);
});

test('dismiss: steps scope closes walkthrough only; session scope returns to idle keeping sessionId', () => {
  const s = run([
    { type: 'OPEN', question: 'q', requestId: 'r1' },
    { type: 'CONTEXT_READY', requestId: 'r1' },
    { type: 'RESULT', requestId: 'r1', result: result('r1') },
    { type: 'TARGETS_RESOLVED', requestId: 'r1' },
  ]);
  const steps = run([{ type: 'DISMISS', scope: 'steps' }], s);
  assert.equal(steps.status, 'showing_guidance');
  assert.equal(steps.stepIndex, null);
  const idle = run([{ type: 'DISMISS' }], s);
  assert.equal(idle.status, 'idle');
  assert.equal(idle.sessionId, 'sess_1');
  assert.equal(transition(initialState, { type: 'DISMISS' }).accepted, false);
});

test('invalid transitions never throw and return the same state', () => {
  const events: Parameters<typeof transition>[1][] = [
    { type: 'CONTEXT_READY', requestId: 'x' },
    { type: 'REQUEST_SENT', requestId: 'x' },
    { type: 'TARGETS_RESOLVED', requestId: 'x' },
    { type: 'NEXT_STEP' },
    { type: 'PREV_STEP' },
    { type: 'COMPLETE' },
    { type: 'RETRY', requestId: 'x' },
    { type: 'OPEN', question: 'q' }, // missing requestId
    { type: 'BOGUS' } as unknown as Parameters<typeof transition>[1],
  ];
  for (const e of events) {
    const r = transition(initialState, e);
    assert.equal(r.accepted, false, e.type);
    assert.equal(r.state, initialState);
  }
  const busy = run([{ type: 'OPEN', question: 'q', requestId: 'r1' }]);
  assert.equal(transition(busy, { type: 'OPEN', question: 'q2', requestId: 'r2' }).accepted, false, 'cannot ask while in flight');
  assert.equal(transition(busy, { type: 'OPEN' }).accepted, false);
});

test('RESET always returns to the initial state', () => {
  const s = run([{ type: 'OPEN', question: 'q', requestId: 'r1' }]);
  assert.deepEqual(run([{ type: 'RESET' }], s), initialState);
});

test('SessionMachine notifies only on accepted transitions', () => {
  const m = new SessionMachine();
  const seen: string[] = [];
  const off = m.subscribe((s) => seen.push(s.status));
  m.send({ type: 'NEXT_STEP' });
  m.send({ type: 'OPEN' });
  m.send({ type: 'OPEN' });
  off();
  m.send({ type: 'RESET' });
  assert.deepEqual(seen, ['opening']);
});
