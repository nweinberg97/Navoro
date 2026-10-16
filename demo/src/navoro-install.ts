/**
 * Installs the Navoro SDK exactly the way a customer would, in one of two modes:
 *
 *   hosted (default): one <script> tag pointing at the Navoro server, with a public key.
 *   local (?navoroMode=local): the SDK file and a knowledge pack served from THIS site.
 *     No Navoro server, works offline, nothing about the user leaves the browser.
 *
 * The app exposes nothing else to the SDK and works fully without it.
 */
import { h } from './ui.ts';

export interface NavoroConfig {
  mode: string;
  origin: string;
  key: string;
  env: string;
}

// Hosted mode needs a Navoro server on this machine; anywhere else (e.g. the public
// demo on GitHub Pages) the app defaults to local mode, which needs no server at all.
const IS_LOCALHOST = ['localhost', '127.0.0.1'].includes(location.hostname);
const DEFAULTS: NavoroConfig = { mode: IS_LOCALHOST ? 'hosted' : 'local', origin: 'http://localhost:4400', key: 'nav_pk_demo_lumen_dev', env: 'development' };
const LS = { mode: 'lumen-demo.navoroMode', origin: 'lumen-demo.navoroOrigin', key: 'lumen-demo.navoroKey', env: 'lumen-demo.navoroEnv' } as const;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — the query string still works for this load */
  }
}

export function resolveConfig(): NavoroConfig {
  const q = new URLSearchParams(location.search);
  const out = { ...DEFAULTS };
  for (const [field, param] of [['mode', 'navoroMode'], ['origin', 'navoroOrigin'], ['key', 'navoroKey'], ['env', 'navoroEnv']] as const) {
    const fromQuery = q.get(param)?.trim();
    if (fromQuery) {
      out[field] = field === 'origin' ? fromQuery.replace(/\/+$/, '') : fromQuery;
      write(LS[field], out[field]);
    } else {
      out[field] = read(LS[field]) || DEFAULTS[field];
    }
  }
  if (out.mode !== 'local') out.mode = 'hosted';
  return out;
}

export function saveKey(key: string): void {
  write(LS.key, key.trim());
  // Drop any stale query override so the stored value wins after reload.
  const q = new URLSearchParams(location.search);
  q.delete('navoroKey');
  const qs = q.toString();
  history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`);
  location.reload();
}

export function resetConfig(): void {
  for (const k of Object.values(LS)) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  }
  history.replaceState(null, '', `${location.pathname}${location.hash}`);
  location.reload();
}

export function installNavoro(config: NavoroConfig, onError: () => void): void {
  if (config.mode === 'local') {
    // Local mode: both files are served by this site. This is the whole install.
    // Relative paths, so the same build works at / and under a sub-path like /Navoro/demo/.
    // The app's own Help (?) button in the top bar carries data-navoro-trigger (see main.ts), so
    // Navoro hides its floating launcher and opens the panel just under it. Highlights use
    // Lumen's brand colour, read from its --accent CSS variable.
    const local = h('script', {
      src: 'navoro/navoro.js',
      'data-navoro-pack': 'navoro/navoro-pack.json',
      'data-navoro-accent': 'var(--accent)',
      defer: true,
    });
    local.addEventListener('error', onError);
    document.head.append(local);
    return;
  }
  const script = h('script', {
    src: `${config.origin}/sdk/v1/navoro.js`,
    'data-navoro-key': config.key,
    'data-navoro-env': config.env,
    defer: true,
  });
  script.addEventListener('error', onError);
  document.head.append(script);
}

