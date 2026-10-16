/**
 * Brand colour: Navoro's highlights, progress bar and checkmarks take the host app's
 * accent so the guide looks like part of the product.
 *
 * Order: explicit option (init / data-navoro-accent) → knowledge pack theme →
 * <meta name="theme-color"> → Navoro's default lime. A theme-color that is basically
 * white, black or grey is skipped (many apps set #ffffff there), and the text/icon
 * colour drawn on the accent is chosen for contrast.
 */

const INK = '#111210';
const PAPER = '#FAF8F3';

export interface Accent {
  accent: string;
  onAccent: string;
}

type Rgb = [number, number, number];

/** Normalises any CSS colour (or var(--name) from the host's root) to rgb, or null. */
export function parseColor(raw: string): { rgb: Rgb; alpha: number } | null {
  let value = raw.trim();
  const v = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value);
  if (v?.[1]) value = getComputedStyle(document.documentElement).getPropertyValue(v[1]).trim();
  if (!value || value.length > 64) return null;
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = document.createElement('canvas').getContext('2d');
  } catch {
    ctx = null;
  }
  if (!ctx) return null;
  // Canvas normalises valid colours and ignores invalid ones, so use two sentinels.
  ctx.fillStyle = '#000001';
  ctx.fillStyle = value;
  const a = String(ctx.fillStyle);
  ctx.fillStyle = '#000002';
  ctx.fillStyle = value;
  const b = String(ctx.fillStyle);
  if (a !== b) return null;
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(a);
  if (hex) return { rgb: [parseInt(hex[1] ?? '0', 16), parseInt(hex[2] ?? '0', 16), parseInt(hex[3] ?? '0', 16)], alpha: 1 };
  const m = /^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/.exec(a);
  if (!m) return null;
  return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], alpha: m[4] === undefined ? 1 : Number(m[4]) };
}

function luminance([r, g, b]: Rgb): number {
  const c = (x: number) => {
    const s = x / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

/** True for colours that carry no brand: near-white, near-black or grey. */
function isNeutral([r, g, b]: Rgb): boolean {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
  return l > 0.93 || l < 0.07 || s < 0.15;
}

function toAccent(rgb: Rgb): Accent {
  const ink: Rgb = [17, 18, 16];
  const paper: Rgb = [250, 248, 243];
  return { accent: `rgb(${rgb.join(', ')})`, onAccent: contrast(rgb, ink) >= contrast(rgb, paper) ? INK : PAPER };
}

/** Resolves the accent from explicit candidates, then the page's theme-color. Null → Navoro default. */
export function resolveAccent(explicit: Array<string | null | undefined>): Accent | null {
  for (const candidate of explicit) {
    if (!candidate) continue;
    const parsed = parseColor(candidate);
    if (parsed && parsed.alpha >= 0.5) return toAccent(parsed.rgb);
  }
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media]), meta[name="theme-color"]');
  const parsed = meta?.content ? parseColor(meta.content) : null;
  if (parsed && parsed.alpha >= 0.5 && !isNeutral(parsed.rgb)) return toAccent(parsed.rgb);
  return null;
}

export { INK as ACCENT_INK, PAPER as ACCENT_PAPER };
