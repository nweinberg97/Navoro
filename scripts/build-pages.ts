/**
 * Builds the static landing page for GitHub Pages into pages/:
 *
 *   pages/index.html, 404.html   HTML shell (relative asset paths: works under /Navoro/)
 *   pages/site.js, site.css      the public site in 'static' mode
 *   pages/brand/navoro-mark.svg  favicon
 *   pages/demo/                  the Lumen demo app running Navoro in local mode:
 *                                demo app + SDK + knowledge pack, all static, no server
 *   pages/.nojekyll
 *
 * In static mode every CTA leads to the downloadable release zip and the
 * "Run Navoro on your machine" section; nothing references localhost as a link
 * target except the documented local URLs inside that section.
 *
 * Env overrides: NAVORO_REPO_URL, NAVORO_DOWNLOAD_URL, NAVORO_PAGES_URL.
 */
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'pages');

const repoUrl = (process.env.NAVORO_REPO_URL || 'https://github.com/nweinberg97/Navoro').replace(/\/$/, '');
const downloadUrl = process.env.NAVORO_DOWNLOAD_URL || `${repoUrl}/releases/latest/download/navoro.zip`;
const pagesEnv = process.env.NAVORO_PAGES_URL ?? '';
const pagesUrl = (/^https?:\/\/[^/]/.test(pagesEnv) ? pagesEnv : 'https://nweinberg97.github.io/Navoro/').replace(/\/*$/, '/');

rmSync(out, { recursive: true, force: true });
mkdirSync(path.join(out, 'brand'), { recursive: true });

await build({
  entryPoints: { site: path.join(root, 'web/src/site/main.tsx') },
  outdir: out,
  bundle: true,
  format: 'esm',
  jsx: 'automatic',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'warning',
  target: ['es2022', 'chrome110', 'firefox115', 'safari16'],
  loader: { '.svg': 'text' },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    __NAVORO_SITE_MODE__: JSON.stringify('static'),
    __NAVORO_DOWNLOAD_URL__: JSON.stringify(downloadUrl),
    __NAVORO_REPO_URL__: JSON.stringify(repoUrl),
  },
});

copyFileSync(path.join(root, 'web/public/navoro-mark.svg'), path.join(out, 'brand/navoro-mark.svg'));

// ── Live demo: Lumen + Navoro in local mode ─────────────────────────────────
// Everything Navoro needs is static, so the full end-user experience runs on Pages.
{
  const demoOut = path.join(out, 'demo');
  mkdirSync(path.join(demoOut, 'assets'), { recursive: true });
  mkdirSync(path.join(demoOut, 'navoro'), { recursive: true });
  await build({
    entryPoints: { demo: path.join(root, 'demo/src/main.ts') },
    outdir: path.join(demoOut, 'assets'),
    bundle: true,
    format: 'esm',
    minify: true,
    sourcemap: false,
    legalComments: 'none',
    logLevel: 'warning',
    target: ['es2022', 'chrome110', 'firefox115', 'safari16'],
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  });
  const { buildSdk } = await import('../sdk/scripts/build-sdk.ts');
  await buildSdk(path.join(demoOut, 'navoro', 'navoro.js'));
  rmSync(path.join(demoOut, 'navoro', 'navoro.js.map'), { force: true });
  const { buildPack, parsePackConfig } = await import('../server/knowledge/pack-builder.ts');
  const configPath = path.join(root, 'demo', 'navoro.config.json');
  const { pack } = await buildPack(parsePackConfig(JSON.parse(readFileSync(configPath, 'utf8'))), path.dirname(configPath));
  writeFileSync(path.join(demoOut, 'navoro', 'navoro-pack.json'), JSON.stringify(pack));
  copyFileSync(path.join(root, 'demo/index.html'), path.join(demoOut, 'index.html'));
  console.log(`[pages] live demo → demo/ (local mode, ${pack.workflows.length} workflows)`);
}

const title = 'Navoro: less searching, more doing';
const description =
  'Navoro lives inside your product, answers your users’ questions, and points to the exact control they need. Download it and run it locally with one command.';
const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<meta name="description" content="${escape(description)}">
<meta name="theme-color" content="#111210">
<link rel="canonical" href="${escape(pagesUrl)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Navoro">
<meta property="og:title" content="${escape(title)}">
<meta property="og:description" content="${escape(description)}">
<meta property="og:url" content="${escape(pagesUrl)}">
<meta name="twitter:card" content="summary">
<link rel="icon" href="brand/navoro-mark.svg" type="image/svg+xml">
<link rel="stylesheet" href="site.css">
</head>
<body>
<div id="root"></div>
<noscript>Navoro’s site needs JavaScript. Download Navoro directly: <a href="${escape(downloadUrl)}">navoro.zip</a> · <a href="${escape(repoUrl)}">GitHub</a></noscript>
<script type="module" src="site.js"></script>
</body>
</html>
`;

writeFileSync(path.join(out, 'index.html'), html);
// GitHub Pages serves 404.html for any unknown path (possibly nested), so it pins
// relative URLs to the site root with <base>; its #anchors then lead back to the landing page.
const basePath = new URL(pagesUrl).pathname.replace(/\/?$/, '/');
writeFileSync(path.join(out, '404.html'), html.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n<base href="${escape(basePath)}">`));
writeFileSync(path.join(out, '.nojekyll'), '');

console.log(`[pages] built ${path.relative(root, out)}/ (static mode) → ${pagesUrl}`);
