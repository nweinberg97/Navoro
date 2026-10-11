/**
 * Guidance session state machine. Pure: no DOM, no timers, no network.
 *
 * Transition table (anything not listed is rejected with `reason: 'invalid'`):
 *
 *   from                                   event                → to
 *   ─────────────────────────────────────  ───────────────────  ─────────────────────────
 *   idle                                   OPEN (no question)   opening
 *   idle|opening|showing_guidance|
 *     completed|cancelled|error            OPEN {question}      collecting_context  (new requestId)
 *   collecting_context                     CONTEXT_READY        requesting
 *   requesting                             REQUEST_SENT         streaming
 *   requesting|streaming                   STREAM_EVENT         streaming (phase updated)
 *   requesting|streaming                   RESULT  (steps > 0)  resolving_targets
 *   requesting|streaming                   RESULT  (no steps)   showing_guidance
 *   resolving_targets                      TARGETS_RESOLVED     showing_guidance (workflow → step 0)
 *   showing_guidance                       NEXT_STEP            showing_guidance (step + 1, bounded)
 *   completed (result has steps)           NEXT_STEP            showing_guidance (restart at step 0)
 *   showing_guidance                       PREV_STEP            showing_guidance (step - 1, ≥ 0)
 *   showing_guidance                       COMPLETE             completed
 *   opening|collecting_context|requesting|
 *     streaming|resolving_targets          CANCEL               cancelled
 *   showing_guidance  DISMISS {scope:'steps'}                   showing_guidance (walkthrough closed)
 *   opening|showing_guidance|completed|
 *     cancelled|error                      DISMISS              idle
 *   collecting_context|requesting|
 *     streaming|resolving_targets          FAIL                 error
 *   error|cancelled                        RETRY                collecting_context  (new requestId, same question)
 *   *                                      RESET                idle
 *
 * Events that belong to a request (CONTEXT_READY, REQUEST_SENT, STREAM_EVENT, RESULT,
 * TARGETS_RESOLVED, FAIL) carry a requestId; a mismatch with the active request is
 * rejected with `reason: 'stale'` so late responses can never overwrite newer state.
 */
import type { GuidanceErrorCode, GuidanceResult } from '../../packages/contracts/src/sdk-types.ts';

export type SessionStatus =
  | 'idle'
  | 'opening'
  | 'collecting_context'
  | 'requesting'
  | 'streaming'
  | 'resolving_targets'
  | 'showing_guidance'
  | 'completed'
  | 'cancelled'
  | 'error';

export type StreamPhase = 'retrieving' | 'reasoning' | 'validating';

/** Client-side error codes in addition to the server's. */
export type SessionErrorCode = GuidanceErrorCode | 'network' | 'invalid_response';

export interface SessionError {
  code: SessionErrorCode;
  message: string;
  retryable: boolean;
}

export interface SessionState {
  status: SessionStatus;
  requestId: string | null;
  question: string | null;
  /** Server session id, carried across follow-up questions. */
  sessionId: string | null;
  phase: StreamPhase | null;
  result: GuidanceResult | null;
  /** Active walkthrough step, or null while showing the answer view. */
  stepIndex: number | null;
  error: SessionError | null;
}

export type SessionEvent =
  | { type: 'OPEN'; question?: string; requestId?: string }
  | { type: 'CONTEXT_READY'; requestId: string }
  | { type: 'REQUEST_SENT'; requestId: string }
  | { type: 'STREAM_EVENT'; requestId: string; phase: StreamPhase }
  | { type: 'RESULT'; requestId: string; result: GuidanceResult }
  | { type: 'TARGETS_RESOLVED'; requestId: string }
  | { type: 'NEXT_STEP' }
  | { type: 'PREV_STEP' }
  | { type: 'COMPLETE' }
  | { type: 'CANCEL' }
  | { type: 'DISMISS'; scope?: 'session' | 'steps' }
  | { type: 'FAIL'; requestId: string; error: SessionError }
  | { type: 'RETRY'; requestId: string }
  | { type: 'RESET' };

export interface TransitionResult {
  state: SessionState;
  accepted: boolean;
  reason?: 'invalid' | 'stale';
}

export const initialState: SessionState = Object.freeze({
  status: 'idle',
  requestId: null,
  question: null,
  sessionId: null,
  phase: null,
  result: null,
  stepIndex: null,
  error: null,
}) as SessionState;

/** States in which a request is in flight and can be stopped by the user. */
export const IN_FLIGHT: ReadonlySet<SessionStatus> = new Set<SessionStatus>([
  'collecting_context',
  'requesting',
  'streaming',
  'resolving_targets',
]);

/** Statuses from which a new question may be asked / the session dismissed. */
const SETTLED = 'opening showing_guidance completed cancelled error';
const isSettled = (s: SessionStatus): boolean => ` ${SETTLED} `.includes(` ${s} `);
function reject(state: SessionState, reason: 'invalid' | 'stale'): TransitionResult {
  return { state, accepted: false, reason };
}

function accept(state: SessionState): TransitionResult {
  return { state, accepted: true };
}

/** Starts a fresh request, keeping the server session id for follow-ups. */
function beginRequest(state: SessionState, question: string, requestId: string): SessionState {
  return {
    ...initialState,
    status: 'collecting_context',
    question,
    requestId,
    sessionId: state.sessionId,
  };
}

/** Pure reducer. Never throws; invalid or stale events return the same state with `accepted: false`. */
export function transition(state: SessionState, event: SessionEvent): TransitionResult {
  const s = state.status;
  switch (event.type) {
    case 'OPEN': {
      const question = event.question?.trim();
      if (question) {
        if ((s !== 'idle' && !isSettled(s)) || !event.requestId) return reject(state, 'invalid');
        return accept(beginRequest(state, question, event.requestId));
      }
      return s === 'idle' ? accept({ ...state, status: 'opening' }) : reject(state, 'invalid');
    }
    case 'CONTEXT_READY':
      if (s !== 'collecting_context') return reject(state, 'invalid');
      if (event.requestId !== state.requestId) return reject(state, 'stale');
      return accept({ ...state, status: 'requesting' });
    case 'REQUEST_SENT':
      if (event.requestId !== state.requestId) return reject(state, 'stale');
      if (s !== 'requesting') return reject(state, 'invalid');
      return accept({ ...state, status: 'streaming' });
    case 'STREAM_EVENT':
      if (event.requestId !== state.requestId) return reject(state, 'stale');
      if (s !== 'requesting' && s !== 'streaming') return reject(state, 'invalid');
      return accept({ ...state, status: 'streaming', phase: event.phase });
    case 'RESULT': {
      if (event.requestId !== state.requestId || event.result.requestId !== state.requestId) {
        return reject(state, 'stale');
      }
      if (s !== 'requesting' && s !== 'streaming') return reject(state, 'invalid');
      const hasSteps = event.result.steps.length > 0;
      return accept({
        ...state,
        status: hasSteps ? 'resolving_targets' : 'showing_guidance',
        result: event.result,
        sessionId: event.result.sessionId || state.sessionId,
        phase: null,
        stepIndex: null,
      });
    }
    case 'TARGETS_RESOLVED':
      if (event.requestId !== state.requestId) return reject(state, 'stale');
      if (s !== 'resolving_targets' || !state.result) return reject(state, 'invalid');
      return accept({
        ...state,
        status: 'showing_guidance',
        stepIndex: state.result.kind === 'workflow' ? 0 : null,
      });
    case 'NEXT_STEP': {
      if (!state.result || state.result.steps.length === 0) return reject(state, 'invalid');
      if (s === 'completed') return accept({ ...state, status: 'showing_guidance', stepIndex: 0 });
      if (s !== 'showing_guidance') return reject(state, 'invalid');
      const last = state.result.steps.length - 1;
      if (state.stepIndex === null) return accept({ ...state, stepIndex: 0 });
      if (state.stepIndex >= last) return reject(state, 'invalid');
      return accept({ ...state, stepIndex: state.stepIndex + 1 });
    }
    case 'PREV_STEP':
      if (s !== 'showing_guidance' || state.stepIndex === null || state.stepIndex <= 0) {
        return reject(state, 'invalid');
      }
      return accept({ ...state, stepIndex: state.stepIndex - 1 });
    case 'COMPLETE':
      if (s !== 'showing_guidance') return reject(state, 'invalid');
      return accept({ ...state, status: 'completed', stepIndex: null });
    case 'CANCEL':
      if (s !== 'opening' && !IN_FLIGHT.has(s)) return reject(state, 'invalid');
      return accept({ ...state, status: 'cancelled', phase: null });
    case 'DISMISS':
      if (event.scope === 'steps') {
        if (s !== 'showing_guidance' || state.stepIndex === null) return reject(state, 'invalid');
        return accept({ ...state, stepIndex: null });
      }
      if (!isSettled(s)) return reject(state, 'invalid');
      return accept({ ...initialState, sessionId: state.sessionId });
    case 'FAIL':
      if (event.requestId !== state.requestId) return reject(state, 'stale');
      if (!IN_FLIGHT.has(s)) return reject(state, 'invalid');
      return accept({ ...state, status: 'error', phase: null, error: event.error });
    case 'RETRY': {
      const canRetry = (s === 'error' && state.error?.retryable === true) || s === 'cancelled';
      if (!canRetry || !state.question) return reject(state, 'invalid');
      return accept(beginRequest(state, state.question, event.requestId));
    }
    case 'RESET':
      return accept(initialState);
    default:
      return reject(state, 'invalid');
  }
}

/** Small observable wrapper around the reducer. */
export class SessionMachine {
  #state: SessionState = initialState;
  #listeners = new Set<(state: SessionState, event: SessionEvent) => void>();

  get state(): SessionState {
    return this.#state;
  }

  /** Applies an event; listeners are notified only when the transition is accepted. */
  send(event: SessionEvent): TransitionResult {
    const result = transition(this.#state, event);
    if (result.accepted) {
      this.#state = result.state;
      for (const listener of [...this.#listeners]) listener(this.#state, event);
    }
    return result;
  }

  subscribe(listener: (state: SessionState, event: SessionEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  clear(): void {
    this.#listeners.clear();
  }
}
