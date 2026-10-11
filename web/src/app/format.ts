const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const nf = new Intl.NumberFormat('en');

export function formatNumber(n: number): string {
  return nf.format(n);
}

export function compactNumber(n: number): string {
  if (Math.abs(n) < 1000) return String(n);
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'Never';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const diff = (t - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return 'Just now';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  return formatDate(iso);
}

export function duration(startIso: string | null, endIso: string | null): string {
  if (!startIso) return '—';
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  const s = Math.max(0, Math.round((end - start) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${formatNumber(n)} ${n === 1 ? one : many}`;
}

/** Validates a URL origin like https://app.example.com or http://localhost:4500 (no path). */
export function validateOrigin(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return `“${value}” isn’t a valid URL.`;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return `“${value}” must start with http:// or https://.`;
  if (url.origin !== value.replace(/\/$/, '')) return `“${value}” should be an origin only (scheme, host and port — no path).`;
  return null;
}

export function parseLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Returns the first error for a newline-separated list of origins, normalized list otherwise. */
export function parseOrigins(text: string): { origins: string[]; error: string | null } {
  const lines = parseLines(text);
  for (const l of lines) {
    const err = validateOrigin(l);
    if (err) return { origins: [], error: err };
  }
  return { origins: Array.from(new Set(lines.map((l) => l.replace(/\/$/, '')))), error: null };
}
