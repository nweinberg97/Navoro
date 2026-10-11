/**
 * navoro-pack — build an offline knowledge pack for Navoro's local mode.
 *
 *   node scripts/navoro-pack.ts [path/to/navoro.config.json] [--out file] [--check] [--allow-private-urls]
 *
 * Reads your docs, approved elements and privacy rules, writes a static
 * navoro-pack.json for the SDK to load from your own origin, and prints a
 * coverage report. --check exits non-zero if any documented step can't point at
 * an approved control (useful in CI after UI changes — "Refresh Learning" offline).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { buildPack, PackConfigError, parsePackConfig } from '../server/knowledge/pack-builder.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const configPath = path.resolve(args.find((arg, i) => !arg.startsWith('--') && args[i - 1] !== '--out') ?? 'navoro.config.json');

if (flag('--help') || flag('-h')) {
  process.stdout.write(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0]?.replace(/^\/\*\*?|^ \* ?/gm, '') ?? '');
  process.exit(0);
}

async function main(): Promise<void> {
  if (!existsSync(configPath)) throw new PackConfigError(`No config at ${configPath}. Create a navoro.config.json (see README → Local mode).`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    throw new PackConfigError(`${configPath} is not valid JSON.`);
  }
  const config = parsePackConfig(raw);
  const baseDir = path.dirname(configPath);
  const { pack, report } = await buildPack(config, baseDir, { allowPrivateUrls: flag('--allow-private-urls') });
  const out = path.resolve(baseDir, option('--out') ?? config.out ?? 'navoro-pack.json');
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(pack)}\n`);

  const lines: string[] = [];
  lines.push(`navoro-pack: ${pack.application.name}`);
  for (const doc of report.docs) {
    lines.push(`  · ${doc.title} — ${doc.workflows} workflow(s), ${doc.items} rule(s)/term(s)`);
    for (const warning of doc.warnings) lines.push(`      ! ${warning}`);
  }
  lines.push(`  ${report.workflows} workflows, ${report.stepsPointing}/${report.steps} steps point at an approved control`);
  if (report.unmatchedLabels.length) {
    lines.push('  Steps that will not point at a tagged control:');
    for (const miss of report.unmatchedLabels) lines.push(`      ✗ ${miss.workflow} → "${miss.step}" (label "${miss.label}"): ${miss.detail}`);
  }
  if (report.unusedElements.length) lines.push(`  Approved elements no doc mentions: ${report.unusedElements.join(', ')}`);
  lines.push(`  Never read: ${[...pack.privacy.blockedNavoroIds, ...pack.privacy.blockedSelectors].join(', ') || '(only built-in exclusions)'}`);
  lines.push(`  Observes: ${pack.privacy.observe.join(', ')}`);
  lines.push(`  Wrote ${path.relative(process.cwd(), out)} (${(report.bytes / 1024).toFixed(1)} KB, hash ${pack.hash.slice(0, 10)})`);
  process.stdout.write(`${lines.join('\n')}\n`);
  if (flag('--check') && report.unmatchedLabels.length) {
    process.stderr.write(`navoro-pack --check: ${report.unmatchedLabels.length} step(s) can't point at an approved control.\n`);
    process.exit(2);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof PackConfigError ? error.message : (error as Error).message;
  process.stderr.write(`navoro-pack: ${message}\n`);
  process.exit(1);
});
