/**
 * Builds only the SDK bundle (same options as the `sdk` entry in scripts/build.ts).
 * Useful while other bundles are mid-development, and used by the SDK browser tests.
 *   node sdk/scripts/build-sdk.ts [outfile]
 */
import { build } from 'esbuild';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const version = (JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string }).version;

/** Bundles sdk/src/index.ts to an IIFE (globalName NavoroSDK). Returns the output path. */
export async function buildSdk(outfile = path.join(root, 'dist/sdk/navoro.js')): Promise<string> {
  await build({
    entryPoints: [path.join(root, 'sdk/src/index.ts')],
    outfile,
    bundle: true,
    sourcemap: true,
    format: 'iife',
    globalName: 'NavoroSDK',
    minify: true,
    target: ['es2022', 'chrome110', 'firefox115', 'safari16'],
    legalComments: 'none',
    logLevel: 'warning',
    define: { 'process.env.NODE_ENV': '"production"', __NAVORO_SDK_VERSION__: JSON.stringify(version) },
  });
  return outfile;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = await buildSdk(process.argv[2] ? path.resolve(process.argv[2]) : undefined);
  console.log(`[build-sdk] ${path.relative(root, out)} ${(statSync(out).size / 1024).toFixed(1)} KB`);
}
