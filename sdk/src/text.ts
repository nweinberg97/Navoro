/**
 * Pure string helpers shared by the collector, resolver and UI. No DOM access.
 */

/** Collapse whitespace runs and trim. */
export function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Normalize for comparisons: collapsed whitespace, lower-case. */
export function normalizeForMatch(value: string): string {
  return normalizeSpace(value).toLowerCase();
}

/** Truncate to `max` characters (including the ellipsis). */
export function truncate(value: string, max: number): string {
  const clean = normalizeSpace(value);
  if (clean.length <= max) return clean;
  return clean.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const EMAIL_RE = /[^\s/@]+@[^\s/@]+\.[^\s/@]+/;
/** Whole-numeric segments (/customers/42) or long digit runs inside a segment. */
const DIGIT_RUN_RE = /^\d+$|\d{5,}/;
const HEX_RE = /^[0-9a-f]{12,}$/i;

/** True when a path segment looks like an identifier, token or personal data. */
export function isIdLikeSegment(segment: string): boolean {
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    // keep raw segment
  }
  if (UUID_RE.test(decoded) || EMAIL_RE.test(decoded) || DIGIT_RUN_RE.test(decoded) || HEX_RE.test(decoded)) {
    return true;
  }
  // Opaque tokens: long, no separators, mixing letters and digits (e.g. base64/ULID/nanoid).
  if (decoded.length >= 16 && !/[-_.~ ]/.test(decoded) && /\d/.test(decoded) && /[a-z]/i.test(decoded)) return true;
  if (decoded.length >= 32 && !/\s/.test(decoded)) return true;
  return false;
}

function sanitizePath(path: string): string {
  return path
    .split('/')
    .map((segment) => (segment && isIdLikeSegment(segment) ? ':id' : segment))
    .join('/');
}

/**
 * Builds a privacy-safe route from `location.pathname` + `location.hash`.
 * The query string is always dropped (including any query inside the hash), and
 * segments that look like ids, tokens, UUIDs or emails are replaced with `:id`.
 */
export function sanitizeRoute(pathname: string, hash = ''): string {
  const path = sanitizePath((pathname.split('?')[0] ?? '') || '/');
  let fragment = '';
  if (hash && hash !== '#') {
    const raw = (hash.startsWith('#') ? hash.slice(1) : hash).split('?')[0] ?? '';
    if (raw) {
      // Hash routes (#/a/b) are sanitized per segment; plain anchors as a single segment.
      fragment = '#' + (raw.includes('/') ? sanitizePath(raw) : isIdLikeSegment(raw) ? ':id' : raw);
    }
  }
  const route = path + fragment;
  return route.length > 200 ? route.slice(0, 200) : route;
}

/** Only http(s) URLs may be opened from server data. Returns the normalized URL or null. */
/** http(s) links, plus mailto: to a single plain address (support hand-off). */
export function safeLinkUrl(value: string | null | undefined): string | null {
  if (value && /^mailto:[^\s@<>()"?]+@[^\s@<>()"?]+\.[^\s@<>()"?]+(\?[^\s<>"]*)?$/i.test(value)) return value;
  return safeHttpUrl(value);
}

export function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}
