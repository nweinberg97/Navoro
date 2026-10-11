/**
 * Static assets, HTML shells and security headers for the dashboard/website.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import type { ServerResponse } from 'node:http';

const MIME: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.html': 'text/html; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

export function baseSecurityHeaders(): Record<string, string> {
  return {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'cross-origin-opener-policy': 'same-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  };
}

export function dashboardCsp(extraConnect: string[] = []): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    // React sets inline style attributes; no inline <script> is ever allowed.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' ${extraConnect.join(' ')}`.trim(),
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}

/** Serves a file from `root` if `relative` resolves inside it. Returns false if not found. */
export function serveFile(
  res: ServerResponse,
  root: string,
  relative: string,
  headers: Record<string, string> = {},
  cacheControl = 'no-cache',
): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(relative);
  } catch {
    return false;
  }
  if (decoded.includes('\0')) return false;
  const filePath = path.resolve(root, `.${path.sep}${decoded}`);
  if (!filePath.startsWith(path.resolve(root) + path.sep)) return false;
  if (!existsSync(filePath)) return false;
  const stat = statSync(filePath);
  if (!stat.isFile()) return false;
  res.writeHead(200, {
    ...baseSecurityHeaders(),
    'content-type': MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
    'content-length': String(stat.size),
    'cache-control': cacheControl,
    ...headers,
  });
  createReadStream(filePath).pipe(res);
  return true;
}

export function htmlShell(options: { title: string; description: string; script: string; style: string; bodyClass?: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${options.title}</title>
<meta name="description" content="${options.description}">
<meta name="theme-color" content="#111210">
<link rel="icon" href="/brand/navoro-mark.svg" type="image/svg+xml">
<link rel="stylesheet" href="${options.style}">
</head>
<body${options.bodyClass ? ` class="${options.bodyClass}"` : ''}>
<div id="root"></div>
<noscript>Navoro needs JavaScript enabled.</noscript>
<script type="module" src="${options.script}"></script>
</body>
</html>`;
}

export function sendHtml(res: ServerResponse, html: string, csp: string): void {
  res.writeHead(200, {
    ...baseSecurityHeaders(),
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-cache',
    'content-security-policy': csp,
    'x-frame-options': 'DENY',
  });
  res.end(html);
}
