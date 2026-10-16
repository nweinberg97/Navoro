/**
 * NavoroController: wires the state machine to networking, context collection,
 * target resolution and the UI. One instance per `init()`.
 *
 * READ-ONLY BY DESIGN: Navoro observes and points; it never acts. The SDK must
 * never click, type into, submit, change, or steal focus from host elements. The
 * only effect it has on the host page is (a) appending its own shadow host and
 * (b) scrolling a highlighted target into view. Focus only moves between
 * Navoro's own controls in response to the user interacting with them.
 */
import type {
  EnvironmentName,
  GuidanceResult,
  GuidanceStep,
  KnowledgePack,
  PublicSdkConfig,
  SanitizedContext,
  SdkEvent,
  SdkEventType,
} from '../../packages/contracts/src/sdk-types.ts';
import { ApiError, EventQueue, NavoroApi } from './api.ts';
import { collectContext } from './context-collector.ts';
import { DiscoveryScheduler } from './discovery.ts';
import { resolveAccent } from './theme.ts';
import { HelpButtons, type HelpButtonOptions } from './help-button.ts';
import { createRoot, Overlay, type NavoroRoot } from './overlay.ts';
import { Panel } from './panel.ts';
import { resolveTarget } from './resolver.ts';
import { IN_FLIGHT, SessionMachine, type SessionError, type SessionEvent, type SessionState } from './state-machine.ts';
import { LocalSource } from './local.ts';
import { listen, voiceAvailability, type Listening, type VoiceMode } from './voice.ts';
import { chooseStartStep } from '../../packages/engine/src/pack.ts';

export interface ControllerOptions {
  publicKey: string;
  environment: EnvironmentName;
  apiOrigin: string;
  debug: boolean;
  sdkVersion: string;
  /** 'hidden': the host renders its own trigger. */
  launcher: 'default' | 'hidden';
  panelPosition: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | null;
  panelOffset: number | null;
  /** Brand colour override (CSS colour or var(--name)). */
  accent?: string | null;
  /** Where Navoro places its (?) Help button in the host page. */
  button?: HelpButtonOptions | null;
  /** Local mode: knowledge pack URL or object. Null → hosted mode. */
  pack: string | KnowledgePack | null;
  voice: VoiceMode;
}

export type StateListener = (state: SessionState) => void;
export type PanelListener = (open: boolean) => void;

function newRequestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }
}

const ERROR_MESSAGES: Record<string, string> = {
  rate_limited: 'Too many questions at once. Try again shortly.',
  timeout: 'That took longer than expected.',
  network: 'Couldn’t reach Navoro. Check your connection.',
  provider_unavailable: 'The assistant is temporarily unavailable.',
  invalid_response: 'Navoro sent an unexpected response.',
  unauthorized: 'Your session expired.',
};

export class NavoroController {
  readonly options: ControllerOptions;
  readonly #m = new SessionMachine();
  readonly #api: NavoroApi;
  #config: PublicSdkConfig | null = null;
  #root: NavoroRoot | null = null;
  #buttons: HelpButtons | null = null;
  #panel: Panel | null = null;
  #overlay: Overlay | null = null;
  #events: EventQueue | null = null;
  #discovery: DiscoveryScheduler | null = null;
  #abort: AbortController | null = null;
  #lastPayload: SanitizedContext | null = null;
  #feedbackGiven: 'helpful' | 'not_helpful' | null = null;
  readonly #local: LocalSource | null;
  #listening: Listening | null = null;
  #voiceHow: 'local' | 'local-download' | 'cloud' | null = null;
  /** "Start where you are": the step a walkthrough began at, shown once with a note. */
  #resume: { requestId: string; index: number } | null = null;
  #shownStepKey = '';
  #followCleanup: (() => void) | null = null;
  #destroyed = false;
  readonly #stateListeners: ReadonlySet<StateListener>;
  readonly #onKeyDown = (ev: KeyboardEvent) => this.#handleKey(ev);
  readonly #onPageHide = () => this.#events?.flush(true);

  readonly #panelListeners: ReadonlySet<PanelListener>;

  /** Listener sets are owned by the caller (index.ts) so subscriptions survive re-init. */
  constructor(options: ControllerOptions, listeners: ReadonlySet<StateListener>, panelListeners: ReadonlySet<PanelListener> = new Set()) {
    this.options = options;
    this.#stateListeners = listeners;
    this.#panelListeners = panelListeners;
    this.#api = new NavoroApi(options);
    this.#local = options.pack ? new LocalSource(options.pack, options.environment) : null;
  }

  get isDevelopment(): boolean {
    // Server config is authoritative once loaded; the script attribute is a hint until then.
    return (this.#config?.environment ?? this.options.environment) === 'development';
  }

  /** Fetches config and mounts the UI. Resolves once ready (or once disabled on 403). */
  async start(): Promise<void> {
    let config: PublicSdkConfig;
    try {
      config = this.#local ? await this.#local.load() : await this.#api.init();
    } catch (err) {
      if (this.#local) {
        console.warn(`[Navoro] ${err instanceof Error ? err.message : 'Knowledge pack could not be loaded.'} Navoro stays hidden.`);
        return;
      }
      if (err instanceof ApiError && err.kind === 'origin_not_allowed') {
        console.warn(`[Navoro] Origin ${location.origin} is not allowed for this key; add it in the dashboard. Navoro stays hidden.`);
        return;
      }
      throw err;
    }
    if (this.#destroyed) return;
    this.#config = config;
    this.#mount(config);
  }

  get isOpen(): boolean {
    return this.#panel?.isOpen ?? false;
  }

  #mount(config: PublicSdkConfig): void {
    const accent = resolveAccent([this.options.accent, config.theme?.accent]);
    // A placed (?) button or an app's own [data-navoro-trigger] replaces the floating launcher,
    // and the panel opens next to it unless the app chose a position.
    const buttonOpts = this.options.button ?? null;
    const useButtons = HelpButtons.wanted(buttonOpts);
    let position = this.options.panelPosition ?? config.launcher.position;
    let offset = this.options.panelOffset;
    if (useButtons) {
      this.#buttons = new HelpButtons({ open: () => this.open(), close: () => this.close(), isOpen: () => this.isOpen }, buttonOpts, accent?.accent ?? null);
      const rect = this.#buttons.anchor?.getBoundingClientRect();
      if (!this.options.panelPosition && rect && rect.height > 0) {
        const top = rect.top < window.innerHeight / 2;
        position = top ? 'top-right' : 'bottom-right';
        offset ??= Math.round(top ? rect.bottom + 8 : window.innerHeight - rect.top + 8);
      }
    }
    const root = createRoot(position, offset, accent);
    this.#root = root;
    this.#overlay = new Overlay(root);
    this.#panel = new Panel(root, config, this.options.launcher === 'hidden' || useButtons, {
      onOpen: () => this.open(),
      onClose: () => this.close(),
      onAsk: (q) => void this.ask(q),
      onStop: () => this.stop(),
      onRetry: () => this.#retry(),
      onStartWalkthrough: () => this.#startWalkthrough(),
      onFeedback: (helpful) => this.#feedback(helpful),
      onToggle: (open) => {
        if (open) this.#checkVoice();
        if (!open) this.#stopListening();
        this.#emitPanel(open);
      },
      onVoice: () => void this.#toggleVoice(),
    });
    this.#m.subscribe((state, event) => this.#onState(state, event));
    root.shadow.addEventListener('keydown', this.#onKeyDown as EventListener);
    document.addEventListener('keydown', this.#onKeyDown);
    if (config.analyticsEnabled) {
      this.#events = new EventQueue((events, keepalive) => void this.#api.postEvents(events, keepalive));
      addEventListener('pagehide', this.#onPageHide);
    }
    if (config.discoveryEnabled && config.environment === 'development') {
      this.#discovery = new DiscoveryScheduler(
        () => (this.#config ?? config).privacy,
        (req) => void this.#api.postDiscovery(req),
      );
    }
    this.#render();
  }

  /** Probes voice support once, lazily, the first time the panel opens (never at page load). */
  #voiceChecked = false;
  #checkVoice(): void {
    if (this.#voiceChecked || this.options.voice === 'off') return;
    this.#voiceChecked = true;
    void voiceAvailability(this.options.voice).then((how) => {
      if (this.#destroyed || !this.#panel) return;
      this.#voiceHow = how;
      const where = how === 'cloud' ? 'Speech is recognised by your browser’s speech service.' : 'Speech is recognised on this device.';
      this.#panel.setVoice(how !== null, how ? where : '');
    });
  }

  // ── voice ─────────────────────────────────────────────────────────────────

  async #toggleVoice(): Promise<void> {
    if (this.#listening) {
      this.#stopListening();
      return;
    }
    const panel = this.#panel;
    if (!panel || !this.#voiceHow) return;
    panel.setListening(true);
    let finalText = '';
    this.#listening = await listen(
      this.#voiceHow,
      (text, final) => {
        panel.setDraft(text);
        if (final) finalText = text;
      },
      (error) => {
        this.#listening = null;
        panel.setListening(false);
        if (!error && finalText) void this.ask(finalText);
      },
    );
  }

  #stopListening(): void {
    this.#listening?.stop();
    this.#listening = null;
    this.#panel?.setListening(false);
  }

  // ── public surface ────────────────────────────────────────────────────────

  open(): void {
    if (!this.#panel || this.#panel.isOpen) return;
    this.#m.send({ type: 'OPEN' });
    this.#panel.show();
    this.#track('launcher_opened');
    this.#render();
  }

  close(): void {
    if (!this.#panel) return;
    if (IN_FLIGHT.has(this.#m.state.status)) this.stop();
    const s = this.#m.state;
    if (s.result && s.status === 'showing_guidance') this.#track('guidance_dismissed');
    if (s.status === 'opening' || s.status === 'cancelled' || s.status === 'error') this.#m.send({ type: 'DISMISS' });
    if (this.#panel.isOpen) this.#panel.hide(true);
  }

  /** Stops the in-flight request (aborts the fetch). */
  stop(): void {
    if (!IN_FLIGHT.has(this.#m.state.status)) return;
    this.#abort?.abort();
    this.#abort = null;
    if (this.#m.send({ type: 'CANCEL' }).accepted) this.#track('request_cancelled');
  }

  /** Asks a question: collects sanitized context, streams guidance, resolves targets. */
  async ask(question: string): Promise<void> {
    const q = question.trim().slice(0, 500);
    if (!q || !this.#panel) return;
    if (!this.#panel.isOpen) {
      this.#m.send({ type: 'OPEN' });
      this.#panel.show(false);
    }
    if (IN_FLIGHT.has(this.#m.state.status)) this.stop();
    const requestId = newRequestId();
    if (!this.#m.send({ type: 'OPEN', question: q, requestId }).accepted) return;
    await this.#run(requestId, q);
  }

  getLastPayload(): SanitizedContext | null {
    if (!this.isDevelopment && !this.options.debug && !this.#local) return null;
    return this.#lastPayload ? (JSON.parse(JSON.stringify(this.#lastPayload)) as SanitizedContext) : null;
  }

  /** Removes every listener, observer, timer, overlay and DOM node. */
  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#abort?.abort();
    this.#abort = null;
    this.#stopFollowing();
    this.#stopListening();
    this.#events?.flush(true);
    this.#events?.dispose();
    this.#discovery?.dispose();
    this.#buttons?.destroy();
    this.#overlay?.destroy();
    this.#root?.shadow.removeEventListener('keydown', this.#onKeyDown as EventListener);
    document.removeEventListener('keydown', this.#onKeyDown);
    removeEventListener('pagehide', this.#onPageHide);
    this.#root?.destroy();
    this.#m.clear();
    this.#root = this.#panel = this.#overlay = this.#events = this.#discovery = null;
  }

  /** Current session state (read-only snapshot). */
  get state(): SessionState {
    return this.#m.state;
  }

  // ── request pipeline ──────────────────────────────────────────────────────

  async #run(requestId: string, question: string): Promise<void> {
    const config = this.#config;
    if (!config) return;
    this.#feedbackGiven = null;
    let context: SanitizedContext;
    try {
      context = collectContext(document, config.privacy);
    } catch {
      context = {};
    }
    this.#lastPayload = context;
    if (!this.#m.send({ type: 'CONTEXT_READY', requestId }).accepted) return;

    const controller = new AbortController();
    this.#abort = controller;
    if (this.#local) {
      // Local mode: the on-device engine answers; nothing is sent anywhere.
      this.#m.send({ type: 'REQUEST_SENT', requestId });
      this.#m.send({ type: 'STREAM_EVENT', requestId, phase: 'retrieving' });
      await new Promise((resolve) => setTimeout(resolve, 0)); // let the UI paint and Stop/Escape register
      if (controller.signal.aborted || this.#abort !== controller) return;
      this.#abort = null;
      try {
        const result = this.#local.answer({ question, context, requestId, ...(this.#m.state.sessionId ? { sessionId: this.#m.state.sessionId } : {}) });
        this.#handleResult(requestId, result);
      } catch {
        this.#m.send({ type: 'FAIL', requestId, error: { code: 'invalid_response', message: 'Navoro couldn’t read its knowledge pack.', retryable: false } });
      }
      return;
    }
    const fail = (error: SessionError) => this.#m.send({ type: 'FAIL', requestId, error });
    let settled = false;
    const send = (event: SessionEvent) => this.#m.send(event);
    try {
      const pending = this.#api.streamGuidance(
        { question, context, requestId, ...(this.#m.state.sessionId ? { sessionId: this.#m.state.sessionId } : {}) },
        controller.signal,
        (event) => {
          if (controller.signal.aborted || settled) return;
          if (event.type === 'status') send({ type: 'STREAM_EVENT', requestId, phase: event.phase });
          else if (event.type === 'result') {
            settled = true;
            this.#handleResult(requestId, event.result);
          } else {
            settled = true;
            fail({ code: event.code, message: ERROR_MESSAGES[event.code] ?? event.message, retryable: event.retryable });
          }
        },
      );
      send({ type: 'REQUEST_SENT', requestId });
      await pending;
      if (!settled && !controller.signal.aborted) fail({ code: 'invalid_response', message: ERROR_MESSAGES.invalid_response!, retryable: true });
    } catch (err) {
      if (controller.signal.aborted && !(err instanceof ApiError && err.kind === 'timeout')) return;
      if (err instanceof ApiError && err.kind === 'origin_not_allowed') {
        console.warn('[Navoro] This origin is no longer allowed. Navoro will stay hidden.');
        this.destroy();
        return;
      }
      const kind = err instanceof ApiError ? err.kind : 'network';
      const code = kind === 'timeout' ? 'timeout' : kind === 'unauthorized' ? 'unauthorized' : kind === 'invalid_response' ? 'invalid_response' : 'network';
      fail({ code, message: ERROR_MESSAGES[code] ?? 'Something went wrong.', retryable: true });
    } finally {
      if (this.#abort === controller) this.#abort = null;
    }
  }

  #handleResult(requestId: string, result: GuidanceResult): void {
    if (!this.#m.send({ type: 'RESULT', requestId, result }).accepted) return; // stale → dropped
    this.#track('guidance_shown');
    if (result.steps.length === 0) return;
    // "Start where you are": check which steps' controls are on screen right now and
    // begin at the step the user has already reached. Read-only, local.
    let startAt = 0;
    if (result.kind === 'workflow') {
      startAt = chooseStartStep(result.steps.map((step) => (step.target ? resolveTarget(step.target).element !== null : null)));
    }
    this.#resume = startAt > 0 ? { requestId, index: startAt } : null;
    // Later targets are resolved lazily per step because the host DOM changes as the
    // user moves through a workflow; see #syncSteps.
    this.#m.send({ type: 'TARGETS_RESOLVED', requestId, startAt });
  }

  #retry(): void {
    const requestId = newRequestId();
    const question = this.#m.state.question;
    if (question && this.#m.send({ type: 'RETRY', requestId }).accepted) void this.#run(requestId, question);
  }

  #startWalkthrough(): void {
    // From the answer view or the completion view (restart); both start at step 0.
    if (this.#m.state.stepIndex === null) this.#m.send({ type: 'NEXT_STEP' });
  }

  #emitPanel(open: boolean): void {
    this.#buttons?.setOpen(open);
    for (const listener of [...this.#panelListeners]) {
      try {
        listener(open);
      } catch (err) {
        console.error('[Navoro] panel listener failed', err);
      }
    }
  }

  #feedback(helpful: boolean): void {
    this.#feedbackGiven = helpful ? 'helpful' : 'not_helpful';
    this.#track(helpful ? 'feedback_helpful' : 'feedback_not_helpful');
    this.#render();
  }

  // ── state → view ──────────────────────────────────────────────────────────

  #onState(state: SessionState, event: SessionEvent): void {
    this.#syncSteps(state, event);
    this.#render();
    if (this.#destroyed) return;
    for (const listener of [...this.#stateListeners]) {
      try {
        listener(state);
      } catch (err) {
        console.error('[Navoro] state listener failed', err);
      }
    }
  }

  #syncSteps(state: SessionState, event: SessionEvent): void {
    const overlay = this.#overlay;
    const panel = this.#panel;
    if (!overlay || !panel) return;
    const result = state.result;
    if (state.status !== 'showing_guidance' || state.stepIndex === null || !result) {
      this.#stopFollowing();
      if (overlay.active) {
        const cardHadFocus = this.#root?.shadow.activeElement && overlay.card?.contains(this.#root.shadow.activeElement);
        overlay.hide();
        this.#shownStepKey = '';
        if (state.status === 'completed' || event.type === 'DISMISS') {
          panel.show(Boolean(cardHadFocus));
        }
      }
      if (state.status === 'completed' && event.type === 'COMPLETE') this.#track('workflow_completed');
      return;
    }
    const key = `${state.requestId}:${state.stepIndex}`;
    if (key === this.#shownStepKey) return;
    this.#shownStepKey = key;
    this.#stopFollowing();
    const index = state.stepIndex;
    const step = result.steps[index];
    if (!step) return;
    // The panel gives way to the step card so it never covers the target.
    const panelHadFocus = panel.hasFocus();
    if (panel.isOpen) panel.hide(false);
    const resolve = () => resolveTarget(step.target).element;
    const element = resolve();
    overlay.show(
      {
        step,
        index,
        total: result.steps.length,
        element,
        lookingFor: this.#lookingFor(step),
        onBack: () => this.#m.send({ type: 'PREV_STEP' }),
        onNext: () => {
          const cur = this.#m.state;
          if (cur.result && cur.stepIndex !== null && cur.stepIndex >= cur.result.steps.length - 1) this.#m.send({ type: 'COMPLETE' });
          else this.#m.send({ type: 'NEXT_STEP' });
        },
        onClose: () => this.#dismissSteps(),
        relocate: resolve,
        note: this.#resumeNote(state.requestId, index),
      },
      panelHadFocus || undefined,
    );
    this.#track('step_viewed', index, step);
    if (element) this.#follow(key, element);
    else this.#awaitTarget(key, index, step, resolve);
  }

  #advanceFrom(key: string): void {
    if (key !== this.#shownStepKey) return;
    const cur = this.#m.state;
    if (!cur.result || cur.stepIndex === null) return;
    if (cur.stepIndex >= cur.result.steps.length - 1) this.#m.send({ type: 'COMPLETE' });
    else this.#m.send({ type: 'NEXT_STEP' });
  }

  /**
   * Follow-along: while a step is highlighted, passively notice when the user
   * activates that exact control (click for buttons/links, change for fields)
   * and move to the next step. Navoro never reads values and never acts itself;
   * listeners are scoped to the one highlighted element and removed on step change.
   */
  #follow(key: string, element: Element): void {
    const isField = element.matches('input:not([type=button]):not([type=submit]):not([type=checkbox]):not([type=radio]), select, textarea, fieldset, [role=radiogroup], [role=combobox], [role=textbox]');
    let timer: ReturnType<typeof setTimeout> | null = null;
    const advance = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => this.#advanceFrom(key), isField ? 150 : 60);
    };
    const type = isField ? 'change' : 'click';
    element.addEventListener(type, advance, { passive: true });
    this.#followCleanup = () => {
      element.removeEventListener(type, advance);
      if (timer) clearTimeout(timer);
    };
  }

  /** The target may appear shortly after navigation; wait briefly before reporting it missing. */
  #awaitTarget(key: string, index: number, step: GuidanceStep, resolve: () => Element | null): void {
    if (!step.target) return;
    const started = Date.now();
    let reported = false;
    const reportMissing = () => {
      if (reported) return;
      reported = true;
      this.#track('step_target_missing', index, step);
    };
    const interval = setInterval(() => {
      if (key !== this.#shownStepKey) return clearInterval(interval);
      const element = resolve();
      if (element) {
        clearInterval(interval);
        reported = true; // found in time: nothing to report
        this.#overlay?.relocate();
        this.#follow(key, element);
      } else if (Date.now() - started > 2500) {
        // Keep looking (the user may open the menu later); just record that it was slow to appear.
        reportMissing();
      }
    }, 150);
    // Leaving the step (next/back/dismiss/complete) before the target appeared still counts as missing.
    this.#followCleanup = () => {
      clearInterval(interval);
      reportMissing();
    };
  }

  #stopFollowing(): void {
    this.#followCleanup?.();
    this.#followCleanup = null;
  }

  #resumeNote(requestId: string | null, index: number): string | null {
    const resume = this.#resume;
    if (!resume || resume.requestId !== requestId || resume.index !== index) return null;
    this.#resume = null; // only the first time this step is shown
    return index === 1 ? 'You’ve already done step 1, so let’s pick up here.' : `You’ve already done steps 1–${index}, so let’s pick up here.`;
  }

  #dismissSteps(): void {
    if (this.#m.send({ type: 'DISMISS', scope: 'steps' }).accepted) this.#track('guidance_dismissed');
  }

  #lookingFor(step: GuidanceStep): string | null {
    const t = step.target;
    if (!t) return null;
    const text = t.strategies.find((s) => s.type !== 'navoro_id');
    return t.label || text?.value || null;
  }

  #render(): void {
    if (!this.#panel) return;
    this.#panel.render(this.#m.state, {
      lastPayload: this.#lastPayload,
      // Local mode always lets people see what was read: it never leaves the device.
      showInspector: this.isDevelopment || this.#local !== null,
      feedbackGiven: this.#feedbackGiven,
      local: this.#local !== null,
    });
  }

  #handleKey(ev: KeyboardEvent): void {
    if (ev.key !== 'Escape' || ev.defaultPrevented) return;
    const host = this.#root?.host;
    const fromNavoro = host ? ev.composedPath().includes(host) : false;
    // Document-level listener also receives events from our shadow root; handle once.
    if (fromNavoro && ev.currentTarget === document) return;
    const s = this.#m.state;
    if (IN_FLIGHT.has(s.status)) {
      this.stop();
    } else if (this.#overlay?.active) {
      this.#dismissSteps();
    } else if (fromNavoro && this.#panel?.isOpen) {
      this.close();
    } else {
      return;
    }
    if (fromNavoro) ev.stopPropagation();
  }

  #track(type: SdkEventType, stepIndex?: number, step?: GuidanceStep): void {
    if (!this.#events) return;
    const s = this.#m.state;
    const event: SdkEvent = { type };
    if (s.sessionId) event.sessionId = s.sessionId;
    if (s.result?.workflow) event.workflowId = s.result.workflow.id;
    if (typeof stepIndex === 'number') event.stepIndex = stepIndex;
    if (step?.target) event.mappingKey = step.target.key;
    this.#events.push(event);
  }
}
