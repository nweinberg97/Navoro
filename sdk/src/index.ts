/**
 * Navoro browser SDK entry point. Less searching. More doing.
 *
 * Install:
 *   <script src="https://NAVORO_ORIGIN/sdk/v1/navoro.js"
 *           data-navoro-key="nav_pk_…" data-navoro-env="development" defer></script>
 *
 * Or programmatically:  await window.Navoro.init({ publicKey, environment, apiOrigin })
 *
 * The SDK is read-only by design: it never clicks, types into, submits, changes
 * or steals focus from host elements (see controller.ts).
 */
import type { EnvironmentName, SanitizedContext } from '../../packages/contracts/src/sdk-types.ts';
import { NavoroController, type PanelListener, type StateListener } from './controller.ts';
import type { SessionState } from './state-machine.ts';
import { collectContext } from './context-collector.ts';
import { resolveTarget } from './resolver.ts';
import { sanitizeRoute } from './text.ts';

export interface NavoroInitOptions {
  /** Public key (nav_pk_…). Safe to embed. */
  publicKey: string;
  environment: EnvironmentName;
  /** Navoro API origin, e.g. https://app.navoro.io. */
  apiOrigin: string;
  /** Enables getLastPayload() outside development. */
  debug?: boolean;
  /** 'hidden' lets the host render its own trigger and call Navoro.open()/close(). */
  launcher?: 'default' | 'hidden';
  /** Where the assistance panel is anchored. Defaults to the workspace's launcher position. */
  panelPosition?: PanelPosition;
  /** Distance in px from the anchored edges (e.g. your header height). */
  panelOffset?: number;
}

export type PanelPosition = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

export type NavoroEventName = 'state' | 'panel';

/** Public API exposed as `window.Navoro`. */
export interface NavoroApi {
  readonly version: string;
  init(options: NavoroInitOptions): Promise<void>;
  open(): void;
  close(): void;
  /** Whether the assistance panel is currently open. */
  isOpen(): boolean;
  ask(question: string): Promise<void>;
  /** Removes every listener, observer, overlay and DOM node created by Navoro. */
  destroy(): void;
  /** Development/debug only: the last sanitized context payload sent. */
  getLastPayload(): SanitizedContext | null;
  /** Subscribe to session state changes. Returns an unsubscribe function. */
  on(event: 'state', callback: (state: SessionState) => void): () => void;
  /** Fires with `true`/`false` whenever the assistance panel opens or closes. */
  on(event: 'panel', callback: (open: boolean) => void): () => void;
}

const VERSION = typeof __NAVORO_SDK_VERSION__ === 'string' ? __NAVORO_SDK_VERSION__ : '0.0.0-dev';

let controller: NavoroController | null = null;
let initPromise: Promise<void> | null = null;
let initKey = '';
/** Survives re-init: every controller emits into this one set. */
const listeners = new Set<StateListener>();
const panelListeners = new Set<PanelListener>();

function teardown(): void {
  controller?.destroy();
  controller = null;
  initPromise = null;
  initKey = '';
}

function validateOptions(o: NavoroInitOptions): NavoroInitOptions {
  let apiOrigin = '';
  try {
    const url = new URL(o.apiOrigin);
    if (/^https?:$/.test(url.protocol)) apiOrigin = url.origin;
  } catch {
    // reported below
  }
  if (!o?.publicKey?.trim?.() || (o.environment !== 'development' && o.environment !== 'production') || !apiOrigin) {
    throw new TypeError('Navoro.init: expected { publicKey, environment: "development" | "production", apiOrigin: http(s) URL }');
  }
  const offset = typeof o.panelOffset === 'number' && Number.isFinite(o.panelOffset) && o.panelOffset > 0 ? Math.min(400, Math.round(o.panelOffset)) : undefined;
  return {
    publicKey: o.publicKey.trim(),
    environment: o.environment,
    apiOrigin,
    debug: o.debug === true,
    launcher: o.launcher === 'hidden' ? 'hidden' : 'default',
    ...(isPanelPosition(o.panelPosition ?? null) ? { panelPosition: o.panelPosition } : {}),
    ...(offset !== undefined ? { panelOffset: offset } : {}),
  };
}

export const Navoro: NavoroApi = {
  version: VERSION,

  init(options) {
    let opts: NavoroInitOptions;
    try {
      opts = validateOptions(options);
    } catch (err) {
      return Promise.reject(err);
    }
    const key = `${opts.publicKey}|${opts.environment}|${opts.apiOrigin}|${opts.debug}|${opts.launcher}|${opts.panelPosition ?? ''}|${opts.panelOffset ?? ''}`;
    // Double init with identical options is a no-op; different options re-init cleanly.
    if (initPromise && key === initKey) return initPromise;
    teardown();
    initKey = key;
    const ctl = new NavoroController(
      { ...opts, debug: opts.debug === true, launcher: opts.launcher ?? 'default', panelPosition: opts.panelPosition ?? null, panelOffset: opts.panelOffset ?? null, sdkVersion: VERSION },
      listeners,
      panelListeners,
    );
    controller = ctl;
    initPromise = ctl.start().catch((err: unknown) => {
      if (controller === ctl) teardown();
      throw err;
    });
    return initPromise;
  },

  open() {
    controller?.open();
  },

  close() {
    controller?.close();
  },

  isOpen() {
    return controller?.isOpen ?? false;
  },

  ask(question) {
    return controller ? controller.ask(String(question ?? '')) : Promise.resolve();
  },

  destroy() {
    teardown();
  },

  getLastPayload() {
    return controller?.getLastPayload() ?? null;
  },

  on(event: NavoroEventName, callback: ((state: SessionState) => void) | ((open: boolean) => void)) {
    if (typeof callback !== 'function') return () => undefined;
    if (event === 'state') {
      const cb = callback as StateListener;
      listeners.add(cb);
      return () => void listeners.delete(cb);
    }
    if (event === 'panel') {
      const cb = callback as PanelListener;
      panelListeners.add(cb);
      return () => void panelListeners.delete(cb);
    }
    return () => undefined;
  },
};

function isPanelPosition(value: string | null): value is PanelPosition {
  return value === 'bottom-right' || value === 'bottom-left' || value === 'top-right' || value === 'top-left';
}

/** Reads install attributes from the SDK's own <script> tag. */
export function readScriptConfig(script: HTMLScriptElement | null): NavoroInitOptions | null {
  if (!script) return null;
  const key = script.getAttribute('data-navoro-key');
  if (!key || script.getAttribute('data-navoro-auto') === 'false') return null;
  const env = script.getAttribute('data-navoro-env') === 'production' ? 'production' : 'development';
  let apiOrigin: string;
  try {
    apiOrigin = script.getAttribute('data-navoro-api') || new URL(script.src, location.href).origin;
  } catch {
    return null;
  }
  const panelAttr = script.getAttribute('data-navoro-panel');
  const offsetAttr = Number(script.getAttribute('data-navoro-panel-offset'));
  return {
    publicKey: key,
    environment: env,
    apiOrigin,
    debug: script.getAttribute('data-navoro-debug') === 'true',
    launcher: script.getAttribute('data-navoro-launcher') === 'hidden' ? 'hidden' : 'default',
    ...(isPanelPosition(panelAttr) ? { panelPosition: panelAttr } : {}),
    ...(Number.isFinite(offsetAttr) && offsetAttr > 0 ? { panelOffset: offsetAttr } : {}),
  };
}

function autoInit(script: HTMLScriptElement | null): void {
  const opts = readScriptConfig(script);
  if (!opts) return;
  const start = () =>
    Navoro.init(opts).catch((err: unknown) => {
      console.warn('[Navoro]', err instanceof Error ? err.message : err);
    });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void start(), { once: true });
  else void start();
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const w = window as unknown as { Navoro?: NavoroApi };
  if (!w.Navoro) {
    w.Navoro = Navoro;
    const current = document.currentScript as HTMLScriptElement | null;
    autoInit(current?.hasAttribute('data-navoro-key') ? current : document.querySelector<HTMLScriptElement>('script[data-navoro-key]'));
  }
}

/**
 * Read-only internals for automated tests (window.NavoroSDK.__test). Harmless:
 * these functions only read the DOM and return data to the caller; nothing is sent.
 */
export const __test = { collectContext, resolveTarget, sanitizeRoute };
