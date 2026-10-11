/**
 * Builds every browser bundle with esbuild:
 *   dist/web/site.{js,css}   public website        (web/src/site/main.tsx)
 *   dist/web/app.{js,css}    dashboard SPA         (web/src/app/main.tsx)
 *   dist/sdk/navoro.js       embeddable SDK (IIFE) (sdk/src/index.ts)
 *   dist/demo/demo.{js,css}  Lumen demo app        (demo/src/main.ts)
 *
 * The server runs directly from TypeScript sources via Node type stripping, so
 * only browser code needs a build step.
 */
import { build, type BuildOptions } from 'esbuild';
import { rmSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const production = process.env.NODE_ENV === 'production' || process.argv.includes('--minify');
const sdkVersion = (JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string }).version;

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const shared: BuildOptions = {
  bundle: true,
  sourcemap: true,
  target: ['es2022', 'chrome110', 'firefox115', 'safari16'],
  logLevel: 'warning',
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development') },
};

interface Entry {
  name: string;
  options: BuildOptions;
  required: boolean;
}

const entries: Entry[] = [
  {
    name: 'site',
    required: true,
    options: {
      ...shared,
      entryPoints: { site: path.join(root, 'web/src/site/main.tsx') },
      outdir: path.join(dist, 'web'),
      format: 'esm',
      jsx: 'automatic',
      minify: production,
      loader: { '.svg': 'text' },
    },
  },
  {
    name: 'app',
    required: true,
    options: {
      ...shared,
      entryPoints: { app: path.join(root, 'web/src/app/main.tsx') },
      outdir: path.join(dist, 'web'),
      format: 'esm',
      jsx: 'automatic',
      minify: production,
      loader: { '.svg': 'text' },
    },
  },
  {
    name: 'sdk',
    required: true,
    options: {
      ...shared,
      entryPoints: { navoro: path.join(root, 'sdk/src/index.ts') },
      outdir: path.join(dist, 'sdk'),
      format: 'iife',
      globalName: 'NavoroSDK',
      minify: true,
      define: { ...shared.define, __NAVORO_SDK_VERSION__: JSON.stringify(sdkVersion) },
    },
  },
  {
    name: 'demo',
    required: true,
    options: {
      ...shared,
      entryPoints: { demo: path.join(root, 'demo/src/main.ts') },
      outdir: path.join(dist, 'demo'),
      format: 'esm',
      minify: production,
    },
  },
];

const started = Date.now();
for (const entry of entries) {
  const entryPoints = entry.options.entryPoints as Record<string, string>;
  const missing = Object.values(entryPoints).filter((file) => !existsSync(file));
  if (missing.length > 0) {
    if (entry.required && !process.argv.includes('--allow-missing')) {
      console.error(`[build] ${entry.name}: missing entry ${missing.join(', ')}`);
      process.exit(1);
    }
    console.warn(`[build] ${entry.name}: skipped (missing entry)`);
    continue;
  }
  await build(entry.options);
  console.log(`[build] ${entry.name} ✓`);
}
console.log(`[build] done in ${Date.now() - started}ms${production ? ' (minified)' : ''}`);
