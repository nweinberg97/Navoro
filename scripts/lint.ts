/**
 * Project-specific static checks that encode Navoro's security invariants.
 * (No ESLint dependency: these are the rules that matter most for this codebase.)
 *
 *  1. Route handlers (server/api) never touch the raw database handle — all data
 *     access goes through tenant-scoped repositories.
 *  2. No dynamic code execution anywhere (eval / new Function / string timers).
 *  3. The SDK never assigns innerHTML except the audited constant-SVG helper.
 *  4. The dashboard/website never use dangerouslySetInnerHTML.
 *  5. No secrets or .env files are committed.
 *  6. The SDK never calls host-element actions (click/submit/focus on host nodes) — read-only by design.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures: string[] = [];

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(entry)) out.push(full);
  }
  return out;
}

function check(files: string[], pattern: RegExp, message: string, allow: (file: string, line: string) => boolean = () => false): void {
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (pattern.test(line) && !allow(file, line) && !/^\s*(\*|\/\/)/.test(line)) {
        failures.push(`${path.relative(root, file)}:${index + 1}  ${message}\n    ${line.trim()}`);
      }
    });
  }
}

const serverApi = walk(path.join(root, 'server', 'api'));
const allSource = [...walk(path.join(root, 'server')), ...walk(path.join(root, 'sdk')), ...walk(path.join(root, 'web', 'src')), ...walk(path.join(root, 'demo', 'src')), ...walk(path.join(root, 'scripts'))];
const sdk = walk(path.join(root, 'sdk', 'src'));
const web = walk(path.join(root, 'web', 'src'));

check(serverApi, /server\.db\.(get|all|run)\(|\.raw\.(exec|prepare)\(/, 'route handlers must use tenant-scoped repositories, not the raw database');
check(serverApi, /from '\.\.\/db\/database\.ts'/, 'route handlers may only import helpers (newId/now/parseJson) from the database module', (_file, line) => /^import type /.test(line) || /import \{ ?(newId|now|parseJson)(, ?(newId|now|parseJson))* ?\}/.test(line));
check(allSource, /\beval\(|new Function\(|setTimeout\(\s*['"`]|setInterval\(\s*['"`]/, 'dynamic code execution is forbidden', (file) => file.endsWith('lint.ts'));
check(sdk, /\.innerHTML\s*=/, 'SDK must build DOM with textContent; only h.ts svg() may use innerHTML with constant markup', (file) => file.endsWith(`${path.sep}h.ts`));
check(sdk, /\.(click|submit|requestSubmit)\(\)|dispatchEvent\(/, 'SDK is read-only: it must never act on host elements');
check(web, /dangerouslySetInnerHTML/, 'never render HTML from data in the dashboard or website');
check(allSource, /sk-ant-[A-Za-z0-9]{8,}/, 'possible API key committed', (file) => file.endsWith('lint.ts') || file.endsWith('log.ts'));

for (const name of ['.env', '.env.local', '.env.production']) {
  if (existsSync(path.join(root, name))) {
    try {
      const tracked = readFileSync(path.join(root, '.gitignore'), 'utf8').includes('.env');
      if (!tracked) failures.push(`${name} exists and .gitignore does not exclude it`);
    } catch {
      failures.push(`${name} exists without a .gitignore`);
    }
  }
}

if (failures.length) {
  console.error(`lint: ${failures.length} problem(s)\n\n${failures.join('\n\n')}`);
  process.exit(1);
}
console.log(`lint: ok (${allSource.length} files checked)`);
