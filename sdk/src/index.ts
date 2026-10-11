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
import { NavoroController, type StateListener } from './controller.ts';
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
}

export type NavoroEventName = 'state';

/** Public API exposed as `window.Navoro`. */
export interface NavoroApi {
  readonly version: string;
  init(options: NavoroInitOptions): Promise<void>;
  open(): void;
  close(): void;
  ask(question: string): Promise<void>;
  /** Removes every listener, observer, overlay and DOM node created by Navoro. */
  destroy(): void;
  /** Development/debug only: the last sanitized context payload sent. */
  getLastPayload(): SanitizedContext | null;
  /** Subscribe to session state changes. Returns an unsubscribe function. */
  on(event: NavoroEventName, callback: (state: SessionState) => void): () => void;
}

const VERSION = typeof __NAVORO_SDK_VERSION__ === 'string' ? __NAVORO_SDK_VERSION__ : '0.0.0-dev';

let controller: NavoroController | null = null;
let initPromise: Promise<void> | null = null;
let initKey = '';
/** Survives re-init: every controller emits into this one set. */
const listeners = new Set<StateListener>();

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
  return { publicKey: o.publicKey.trim(), environment: o.environment, apiOrigin, debug: o.debug === true };
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
    const key = `${opts.publicKey}|${opts.environment}|${opts.apiOrigin}|${opts.debug}`;
    // Double init with identical options is a no-op; different options re-init cleanly.
    if (initPromise && key === initKey) return initPromise;
    teardown();
    initKey = key;
    const ctl = new NavoroController({ ...opts, debug: opts.debug === true, sdkVersion: VERSION }, listeners);
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

  ask(question) {
    return controller ? controller.ask(String(question ?? '')) : Promise.resolve();
  },

  destroy() {
    teardown();
  },

  getLastPayload() {
    return controller?.getLastPayload() ?? null;
  },

  on(event, callback) {
    if (event !== 'state' || typeof callback !== 'function') return () => undefined;
    listeners.add(callback);
    return () => void listeners.delete(callback);
  },
};

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
  return { publicKey: key, environment: env, apiOrigin, debug: script.getAttribute('data-navoro-debug') === 'true' };
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
