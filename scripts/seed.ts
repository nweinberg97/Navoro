/**
 * Creates the synthetic Lumen demo workspace through the real pipeline
 * (ingestion job, extraction, publishing). `--reset` deletes the database first.
 */
import { rmSync } from 'node:fs';
import { loadConfig } from '../server/config/env.ts';
import { createNavoroApp } from '../server/app.ts';
import { DEMO_EMAIL, DEMO_PASSWORD, seedDemoWorkspace } from '../server/seed/seed.ts';
import { setQuiet } from '../server/lib/log.ts';

setQuiet(true);
const config = loadConfig();
if (process.argv.includes('--reset')) {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${config.databasePath}${suffix}`, { force: true });
  console.log(`Removed ${config.databasePath}`);
}
const app = createNavoroApp(config, { provider: null, startWorker: false });
const result = await seedDemoWorkspace(app, { demoPort: config.demoPort });
console.log(result.created ? `Seeded demo workspace (org ${result.orgId}, app ${result.appId}).` : 'Demo workspace already exists; nothing changed.');
console.log(`Sign in with ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
await app.close();
