/**
 * Origin handling for the SDK. Registered origins are normalized to
 * scheme://host[:port]. CORS headers are only an access-control hint for
 * browsers — the server independently rejects requests whose Origin is not
 * registered for the application environment (CORS is not authentication).
 */

export function normalizeOrigin(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    if ((url.pathname && url.pathname !== '/') || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function isOriginAllowed(origin: string | undefined, allowed: string[]): boolean {
  if (!origin) return false;
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  return allowed.includes(normalized);
}
