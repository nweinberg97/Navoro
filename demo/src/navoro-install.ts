/**
 * Installs the Navoro SDK exactly the way a customer would: one <script> tag
 * pointing at the Navoro origin, carrying the public key and environment.
 * The app exposes nothing else to the SDK and works fully without it.
 */
import { h } from './ui.ts';

export interface NavoroConfig {
  origin: string;
  key: string;
  env: string;
}

const DEFAULTS: NavoroConfig = { origin: 'http://localhost:4400', key: 'nav_pk_demo_lumen_dev', env: 'development' };
const LS = { origin: 'lumen-demo.navoroOrigin', key: 'lumen-demo.navoroKey', env: 'lumen-demo.navoroEnv' } as const;

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
  for (const [field, param] of [['origin', 'navoroOrigin'], ['key', 'navoroKey'], ['env', 'navoroEnv']] as const) {
    const fromQuery = q.get(param)?.trim();
    if (fromQuery) {
      out[field] = field === 'origin' ? fromQuery.replace(/\/+$/, '') : fromQuery;
      write(LS[field], out[field]);
    } else {
      out[field] = read(LS[field]) || DEFAULTS[field];
    }
  }
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
  const script = h('script', {
    src: `${config.origin}/sdk/v1/navoro.js`,
    'data-navoro-key': config.key,
    'data-navoro-env': config.env,
    defer: true,
  });
  script.addEventListener('error', onError);
  document.head.append(script);
}
