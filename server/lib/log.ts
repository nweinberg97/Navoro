/**
 * Structured, redacted operational logging. Never log request bodies, question
 * text, page context, cookies, tokens or provider keys.
 */
const SECRET_PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]+/g,
  /nav_pk_[A-Za-z0-9_]+/g,
  /(authorization|cookie|x-api-key)["']?\s*[:=]\s*["']?[^"',\s}]+/gi,
  /Bearer\s+[A-Za-z0-9._-]+/g,
];

export function redact(value: string): string {
  let out = value;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (match) => (match.startsWith('nav_pk_') ? `${match.slice(0, 10)}…` : '[redacted]'));
  }
  return out;
}

type Level = 'debug' | 'info' | 'warn' | 'error';
let quiet = process.env.NODE_ENV === 'test';

export function setQuiet(value: boolean): void {
  quiet = value;
}

export function log(level: Level, message: string, fields: Record<string, unknown> = {}): void {
  if (quiet && level !== 'error') return;
  const entry = { t: new Date().toISOString(), level, msg: message, ...fields };
  const line = redact(JSON.stringify(entry));
  if (level === 'error' || level === 'warn') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}
