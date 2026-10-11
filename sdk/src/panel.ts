/**
 * Launcher button and assistance panel. A pure view: it renders a SessionState
 * and reports user intent through callbacks. All server-provided text is set via
 * textContent (see h.ts) — never innerHTML.
 *
 * The panel is a non-modal dialog (aria-modal="false"): it never traps focus or
 * blocks the host page.
 */
import type { GuidanceResult, PublicSdkConfig, SanitizedContext } from '../../packages/contracts/src/sdk-types.ts';
import { btn, closeBtn, h, ICON_CHECK, svg } from './h.ts';
import type { NavoroRoot } from './overlay.ts';
import { IN_FLIGHT, type SessionState } from './state-machine.ts';
import { markSvg } from './styles.ts';
import { safeHttpUrl } from './text.ts';

export interface PanelCallbacks {
  onOpen(): void;
  onClose(): void;
  onAsk(question: string): void;
  onStop(): void;
  onRetry(): void;
  onStartWalkthrough(): void;
  onFeedback(helpful: boolean): void;
  /** Fired whenever the panel opens or closes, by any path. */
  onToggle?(open: boolean): void;
}

export interface PanelExtras {
  /** Last transmitted payload — shown only in development. */
  lastPayload: SanitizedContext | null;
  showInspector: boolean;
  feedbackGiven: boolean;
}

const PHASE_TEXT: Record<string, string> = {
  retrieving: 'Looking through the docs…',
  reasoning: 'Working out the steps…',
  validating: 'Checking it against this page…',
};

export class Panel {
  readonly launcher: HTMLButtonElement;
  readonly #panel: HTMLDivElement;
  readonly #body: HTMLDivElement;
  readonly #input: HTMLInputElement;
  readonly #submit: HTMLButtonElement;
  readonly #live: HTMLDivElement;
  readonly #cb: PanelCallbacks;
  readonly #config: PublicSdkConfig;
  #open = false;
  #lastAnnounced = '';

  readonly #hiddenLauncher: boolean;
  /** Host element that opened the panel (hidden-launcher mode) so focus can return to it. */
  #opener: HTMLElement | null = null;

  constructor(root: NavoroRoot, config: PublicSdkConfig, hiddenLauncher: boolean, cb: PanelCallbacks) {
    this.#cb = cb;
    this.#config = config;
    this.#hiddenLauncher = hiddenLauncher;
    const titleId = 'navoro-panel-title';
    this.launcher = h(
      'button',
      {
        class: 'launcher',
        type: 'button',
        'aria-label': 'Open Navoro help',
        'aria-expanded': 'false',
        'aria-controls': 'navoro-panel',
        'data-navoro-launcher': '',
        onclick: () => (this.#open ? cb.onClose() : cb.onOpen()),
      },
      svg(markSvg(26)),
    );
    this.#input = h('input', {
      type: 'text',
      autocomplete: 'off',
      enterkeyhint: 'send',
      maxlength: 500,
      placeholder: 'Ask how to do something…',
      'aria-label': 'Your question',
    });
    this.#submit = h('button', { class: 'btn primary', type: 'submit' }, 'Ask');
    const form = h('form', { class: 'form', novalidate: true }, this.#input, this.#submit);
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const q = this.#input.value.trim();
      if (q) cb.onAsk(q);
    });
    this.#body = h('div', { class: 'body' });
    this.#live = h('div', { class: 'sr', role: 'status', 'aria-live': 'polite' });
    this.#panel = h(
      'div',
      {
        id: 'navoro-panel',
        class: 'panel',
        role: 'dialog',
        'aria-modal': 'false',
        'aria-labelledby': titleId,
        hidden: true,
        'data-navoro-panel': '',
      },
      h(
        'div',
        { class: 'head' },
        svg(markSvg(28, true)),
        h('div', { class: 'name' }, h('h2', { id: titleId }, config.applicationName || 'Help'), h('div', { class: 'by' }, 'Guided by Navoro')),
        closeBtn('Close help', () => cb.onClose()),
      ),
      this.#body,
      form,
      this.#live,
    );
    root.container.append(this.#panel);
    if (!hiddenLauncher) root.container.append(this.launcher);
  }

  get isOpen(): boolean {
    return this.#open;
  }

  /** Shows the panel and moves focus to the question input (our own UI only). */
  show(focusInput = true): void {
    if (!this.#open && this.#hiddenLauncher) {
      // Remember the host's trigger (whatever had focus outside Navoro) to restore focus on close.
      const active = document.activeElement;
      this.#opener = active instanceof HTMLElement && !active.closest('navoro-root') ? active : null;
    }
    this.#setOpen(true);
    if (focusInput) this.#input.focus({ preventScroll: true });
  }

  /** Hides the panel; optionally returns focus to the launcher (or the host's trigger). */
  hide(returnFocus = true): void {
    this.#setOpen(false);
    if (!returnFocus) return;
    if (this.#hiddenLauncher) {
      if (this.#opener?.isConnected) this.#opener.focus({ preventScroll: true });
    } else {
      this.launcher.focus({ preventScroll: true });
    }
  }

  #setOpen(open: boolean): void {
    const changed = this.#open !== open;
    this.#open = open;
    this.#panel.hidden = !open;
    this.launcher.setAttribute('aria-expanded', String(open));
    this.launcher.setAttribute('aria-label', `${open ? 'Close' : 'Open'} Navoro help`);
    if (changed) this.#cb.onToggle?.(open);
  }

  /** True when focus is currently inside the panel. */
  hasFocus(): boolean {
    const root = this.#panel.getRootNode();
    return root instanceof ShadowRoot && root.activeElement !== null && this.#panel.contains(root.activeElement);
  }

  #announce(text: string): void {
    if (text && text !== this.#lastAnnounced) {
      this.#lastAnnounced = text;
      this.#live.textContent = text;
    }
  }

  /** Re-renders the body for the given session state. */
  render(state: SessionState, extras: PanelExtras): void {
    const busy = IN_FLIGHT.has(state.status);
    this.#input.disabled = busy;
    this.#submit.disabled = busy;
    if (state.status === 'showing_guidance' && state.question) this.#input.value = '';

    const nodes: (Node | null)[] = [];
    const cfg = this.#config;
    if (!state.question || state.status === 'idle' || state.status === 'opening') {
      nodes.push(h('p', { class: 'greet' }, cfg.launcher.greeting || 'What are you trying to do?'));
      if (cfg.launcher.suggestions.length > 0) {
        nodes.push(
          h(
            'div',
            { class: 'chips', role: 'list', 'aria-label': 'Suggestions' },
            ...cfg.launcher.suggestions.slice(0, 6).map((s) =>
              h('div', { role: 'listitem' }, btn('chip', s, () => this.#cb.onAsk(s))),
            ),
          ),
        );
      }
    } else {
      nodes.push(h('div', { class: 'q' }, h('span', { class: 'sr' }, 'You asked: '), state.question));
    }

    if (busy) {
      const text = PHASE_TEXT[state.phase ?? 'retrieving'] ?? PHASE_TEXT.retrieving!;
      nodes.push(
        h(
          'div',
          { class: 'loading', 'aria-busy': 'true' },
          h('span', { class: 'dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
          h('span', { class: 'grow' }, text),
          btn('btn secondary', 'Stop', () => this.#cb.onStop()),
        ),
      );
      this.#announce(text);
    } else if (state.status === 'cancelled') {
      nodes.push(
        h(
          'div',
          { class: 'note' },
          'Stopped. ',
          btn('link', 'Ask again', () => this.#cb.onRetry()),
        ),
      );
      this.#announce('Request stopped.');
    } else if (state.status === 'error' && state.error) {
      nodes.push(
        h(
          'div',
          { class: 'err', role: 'alert' },
          h('span', {}, state.error.message || 'Something went wrong.'),
          state.error.retryable ? btn('btn secondary', 'Try again', () => this.#cb.onRetry()) : null,
        ),
      );
      if (cfg.supportUrl && safeHttpUrl(cfg.supportUrl)) nodes.push(this.#extLink('Contact support', cfg.supportUrl));
    } else if (state.result && (state.status === 'showing_guidance' || state.status === 'completed')) {
      if (state.status === 'completed') nodes.push(this.#completion(state.result));
      nodes.push(...this.#answer(state, state.result, extras));
    }

    if (extras.showInspector && extras.lastPayload) {
      nodes.push(
        h(
          'details',
          { class: 'inspect' },
          h('summary', {}, 'Inspect payload (dev only)'),
          h('pre', {}, JSON.stringify(extras.lastPayload, null, 2)),
        ),
      );
    }
    this.#body.replaceChildren(...nodes.filter((n): n is Node => n !== null));
  }

  #completion(result: GuidanceResult): HTMLElement {
    const title = result.workflow ? 'You’re back on track.' : 'All done.';
    this.#announce(title);
    return h(
      'div',
      { class: 'done', role: 'status' },
      h('span', { class: 'tick' }, svg(ICON_CHECK)),
      h('div', {}, h('strong', {}, title), h('span', {}, result.workflow ? `Finished “${result.workflow.title}”.` : 'Ask anything else.')),
    );
  }

  #answer(state: SessionState, result: GuidanceResult, extras: PanelExtras): HTMLElement[] {
    const out: HTMLElement[] = [];
    if (result.mode === 'demo') {
      out.push(h('span', { class: 'badge' }, 'Demo mode — answer assembled from your docs without a language model'));
    }
    if (state.status !== 'completed') {
      out.push(h('p', { class: 'answer' }, result.answer));
      this.#announce(result.answer.slice(0, 200));
    }
    if (!result.grounded || result.confidence < 0.5) {
      out.push(
        h(
          'div',
          { class: 'note' },
          result.grounded
            ? 'I’m not fully certain about this one — double-check before relying on it.'
            : 'I couldn’t find this in your documentation, so treat this as a best guess.',
        ),
      );
    }
    const n = result.steps.length;
    if (n > 0 && state.stepIndex === null) {
      const label = state.status === 'completed' ? 'Walk me through it again' : n === 1 ? 'Show me' : `Start walkthrough (${n} steps)`;
      out.push(h('div', { class: 'actions' }, btn('btn primary', label, () => this.#cb.onStartWalkthrough())));
    }
    if (result.fallback) {
      const url = safeHttpUrl(result.fallback.url);
      out.push(url ? this.#extLink(result.fallback.label, url) : h('div', { class: 'note' }, result.fallback.label));
    }
    if (result.citations.length > 0) {
      out.push(
        h(
          'details',
          { class: 'cites' },
          h('summary', {}, `Sources (${result.citations.length})`),
          ...result.citations.slice(0, 5).map((c) => h('div', { class: 'cite' }, h('b', {}, `From: ${c.sourceTitle}`), h('p', {}, c.excerpt))),
        ),
      );
    }
    out.push(
      extras.feedbackGiven
        ? h('div', { class: 'fb', role: 'status' }, 'Thanks for the feedback.')
        : h(
            'div',
            { class: 'fb' },
            h('span', { class: 'grow' }, 'Was this helpful?'),
            btn('btn ghost', 'Yes', () => this.#cb.onFeedback(true)),
            btn('btn ghost', 'No', () => this.#cb.onFeedback(false)),
          ),
    );
    return out;
  }

  #extLink(label: string, url: string): HTMLAnchorElement {
    return h('a', { class: 'link', href: url, target: '_blank', rel: 'noopener noreferrer' }, `${label} ↗`);
  }
}
