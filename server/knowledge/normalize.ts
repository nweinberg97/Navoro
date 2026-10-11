/**
 * Normalization of incoming knowledge material into clean Markdown-ish text.
 * All inputs (documentation, web pages, transcripts) are treated as untrusted
 * data: we never execute or render them as HTML, only extract text.
 */
import { createHash } from 'node:crypto';

export const MAX_SOURCE_CHARS = 400_000;

export function contentHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 32);
}

/** Normalizes line endings, strips control characters and collapses excess blank lines. */
export function normalizeText(input: string): string {
  return input
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '  ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g, '')
    .replace(/[  ]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_SOURCE_CHARS);
}

const ENTITY_MAP: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    }
    return ENTITY_MAP[entity.toLowerCase()] ?? match;
  });
}

/**
 * Converts an HTML document to Markdown-ish text. Drops scripts, styles,
 * navigation chrome and comments; keeps headings, list items, paragraphs and
 * bold text (used as UI-label hints). This is text extraction, not rendering.
 */
export function htmlToText(html: string): { text: string; title: string | null } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch?.[1] ? decodeEntities(titleMatch[1]).replace(/\s+/g, ' ').trim() || null : null;
  let body = html;
  const mainMatch = /<(main|article)\b[^>]*>([\s\S]*?)<\/\1>/i.exec(body);
  if (mainMatch?.[2]) body = mainMatch[2];
  body = body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|template|svg|iframe|nav|footer|header|form)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<(br|hr)\s*\/?>/gi, '\n')
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level: string, inner: string) => `\n\n${'#'.repeat(Number(level))} ${inner.replace(/<[^>]+>/g, '').trim()}\n\n`)
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _tag: string, inner: string) => `**${inner.replace(/<[^>]+>/g, '').trim()}**`)
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|section|ul|ol|li|table|tr|h[1-6]|blockquote|pre)>/gi, '\n')
    .replace(/<(p|div|section|ul|ol|table|tr|blockquote|pre)\b[^>]*>/gi, '\n')
    .replace(/<\/?(td|th)\b[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '');
  // Re-number list items inside "ordered" lists heuristically: keep "- " bullets; the extractor accepts both.
  return { text: normalizeText(decodeEntities(body)), title };
}

/** Best-effort title for pasted/written content: first heading or first line. */
export function inferTitle(text: string, fallback: string): string {
  const heading = /^#{1,3}\s+(.+)$/m.exec(text);
  const candidate = (heading?.[1] ?? text.split('\n').find((line) => line.trim()) ?? '').replace(/[#*_`]/g, '').trim();
  return (candidate || fallback).slice(0, 120);
}
