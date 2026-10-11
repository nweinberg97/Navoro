/**
 * Packages a self-contained, download-and-run copy of Navoro:
 *
 *   release/navoro/      the runnable folder (no node_modules needed)
 *   release/navoro.zip   what the landing page's "Download Navoro" button serves
 *
 * Run after `node scripts/build.ts --minify` (or simply `npm run release`).
 * The server has zero runtime npm dependencies (Node built-ins + type stripping),
 * so the package is: TypeScript server sources, prebuilt browser bundles, the
 * demo app's static files and the start.mjs launcher.
 *
 * Zipping uses the `zip` CLI when present, otherwise a small built-in writer
 * (DEFLATE via node:zlib + CRC-32) so it works anywhere Node does.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = path.join(root, 'release');
const outDir = path.join(releaseDir, 'navoro');
const zipPath = path.join(releaseDir, 'navoro.zip');

function fail(message: string): never {
  console.error(`[release] ${message}`);
  process.exit(1);
}

if (!existsSync(path.join(root, 'dist', 'sdk', 'navoro.js')) || !existsSync(path.join(root, 'dist', 'web', 'site.js'))) {
  fail('dist/ is missing. Run `node scripts/build.ts --minify` first (or `npm run release`).');
}

rmSync(releaseDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

/** Copies `rel` (file or directory) into the release folder, keeping only files that pass `keep`. */
function copy(rel: string, keep: (file: string) => boolean = () => true, required = true): void {
  const from = path.join(root, rel);
  if (!existsSync(from)) {
    if (required) fail(`missing ${rel}`);
    return;
  }
  cpSync(from, path.join(outDir, rel), {
    recursive: true,
    filter: (src) => {
      const name = path.basename(src);
      if (name === 'node_modules' || name === '.DS_Store' || (name.startsWith('.') && src !== from)) return false;
      return statSync(src).isDirectory() || keep(src);
    },
  });
}

copy('start.mjs');
copy('README.md', undefined, false);
copy('LICENSE', undefined, false);
copy('.env.example');
copy('docs', undefined, false);
copy('server', (file) => /\.(ts|sql|md)$/.test(file) && !/\.test\.ts$/.test(file));
copy('packages/contracts/src', (file) => file.endsWith('.ts'));
copy('packages/engine/src', (file) => file.endsWith('.ts'));
copy('scripts/navoro-pack.ts');
copy('demo/navoro.config.json');
copy('demo/navoro.elements.json');
copy('dist', (file) => !file.endsWith('.map'));
copy('demo/index.html');
copy('demo/help');
copy('web/public');

// A package.json that needs no install: no dependencies (everything browser-side
// is prebuilt into dist/, the server only uses Node built-ins) and only the
// scripts that work in a downloaded copy.
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as Record<string, unknown> & { scripts?: Record<string, string> };
const scripts = pkg.scripts ?? {};
const releasePkg: Record<string, unknown> = {
  name: pkg.name,
  version: pkg.version,
  private: true,
  description: pkg.description,
  license: pkg.license,
  type: 'module',
  engines: pkg.engines,
  scripts: {
    start: 'node start.mjs',
    ...(scripts['start'] ? { server: scripts['start'] } : {}),
    ...(scripts['navoro-pack'] ? { 'navoro-pack': scripts['navoro-pack'] } : {}),
  },
};
writeFileSync(path.join(outDir, 'package.json'), `${JSON.stringify(releasePkg, null, 2)}\n`);

// ---- Zip ------------------------------------------------------------------

function listFiles(dir: string, base = dir, out: string[] = []): string[] {
  for (const entry of readdirSync(dir).sort()) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) listFiles(full, base, out);
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = (CRC_TABLE[(crc ^ (buf[i] ?? 0)) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date): { time: number; date: number } {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((Math.max(date.getFullYear(), 1980) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/** Minimal PKZIP writer (STORE or DEFLATE per file, no zip64 — fine for a few MB). */
function writeZip(sourceDir: string, prefix: string, target: string): void {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  const stamp = dosDateTime(new Date());
  for (const rel of listFiles(sourceDir)) {
    const name = Buffer.from(`${prefix}/${rel}`, 'utf8');
    const data = readFileSync(path.join(sourceDir, rel));
    const deflated = deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, body);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE((3 << 8) | 20, 4); // made by: unix, v2.0
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(useDeflate ? 8 : 0, 10);
    entry.writeUInt16LE(stamp.time, 12);
    entry.writeUInt16LE(stamp.date, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt16LE(0, 30); // extra
    entry.writeUInt16LE(0, 32); // comment
    entry.writeUInt16LE(0, 34); // disk
    entry.writeUInt16LE(0, 36); // internal attrs
    entry.writeUInt32LE(((0o100644 << 16) >>> 0), 38); // external attrs: regular file rw-r--r--
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);

    offset += local.length + name.length + body.length;
  }
  const centralBuf = Buffer.concat(central);
  const count = central.length / 2;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  writeFileSync(target, Buffer.concat([...chunks, centralBuf, end]));
}

const forceBuiltin = process.argv.includes('--builtin-zip');
const zipCli = forceBuiltin ? null : spawnSync('zip', ['-v'], { stdio: 'ignore' });
if (zipCli && zipCli.status === 0) {
  const result = spawnSync('zip', ['-r', '-q', '-X', '-9', 'navoro.zip', 'navoro'], { cwd: releaseDir, stdio: 'inherit' });
  if (result.status !== 0) fail('zip failed');
} else {
  writeZip(outDir, 'navoro', zipPath);
}

const files = listFiles(outDir).length;
const size = statSync(zipPath).size;
console.log(`[release] ${path.relative(root, zipPath)} ✓  ${files} files, ${(size / 1024 / 1024).toFixed(2)} MB${zipCli && zipCli.status === 0 ? '' : ' (built-in zip)'}`);
console.log('[release] Unzip it anywhere and run `node start.mjs` (Node 22.18+, no npm install needed).');
