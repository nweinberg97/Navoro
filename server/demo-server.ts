/**
 * Serves the fictional "Lumen Analytics" customer application on its own origin
 * (default http://localhost:4500) so the Navoro SDK is exercised cross-origin,
 * exactly as a real customer install would be.
 *
 * Its Content-Security-Policy is intentionally strict — it is also the reference
 * CSP we recommend to customers embedding Navoro (see docs/SECURITY.md).
 */
import http from 'node:http';
import path from 'node:path';
import { ROOT_DIR } from './config/env.ts';
import { baseSecurityHeaders, serveFile } from './http/static.ts';

export function demoCsp(navoroOrigin: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' ${navoroOrigin}`,
    `connect-src 'self' ${navoroOrigin}`,
    "style-src 'self'",
    "img-src 'self' data:",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "object-src 'none'",
  ].join('; ');
}

export function createDemoServer(options: { navoroOrigin: string }): http.Server {
  const demoDir = path.join(ROOT_DIR, 'demo');
  const distDir = path.join(ROOT_DIR, 'dist', 'demo');
  const csp = demoCsp(options.navoroOrigin);
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://demo.local');
    const pathname = url.pathname;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    if (pathname.startsWith('/assets/') && serveFile(res, distDir, pathname.slice('/assets/'.length))) return;
    // Local mode: the SDK and the knowledge pack are plain static files on the app's own origin.
    if (pathname === '/navoro/navoro.js' && serveFile(res, path.join(ROOT_DIR, 'dist', 'sdk'), 'navoro.js')) return;
    if (pathname === '/navoro/navoro-pack.json' && serveFile(res, distDir, 'navoro-pack.json', { 'content-type': 'application/json; charset=utf-8' })) return;
    if (pathname.startsWith('/help/') && pathname.endsWith('.md') && serveFile(res, path.join(demoDir, 'help'), pathname.slice('/help/'.length), { 'access-control-allow-origin': '*' })) return;
    if (pathname === '/' || pathname === '/index.html') {
      serveFile(res, demoDir, 'index.html', { 'content-security-policy': csp, 'x-frame-options': 'DENY' });
      return;
    }
    res.writeHead(404, { ...baseSecurityHeaders(), 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  });
}
