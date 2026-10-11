/**
 * Navoro server entry point.
 *   - Navoro dashboard, website, API and SDK bundle on NAVORO_PUBLIC_ORIGIN (default http://localhost:4400)
 *   - Lumen demo customer app on http://localhost:4500 (development only)
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ConfigError, describeConfig, loadConfig, ROOT_DIR } from './config/env.ts';
import { createNavoroApp } from './app.ts';
import { createDemoServer } from './demo-server.ts';
import { DEMO_EMAIL, DEMO_PASSWORD, seedDemoWorkspace } from './seed/seed.ts';
import { log } from './lib/log.ts';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`\nConfiguration error: ${error.message}\nSee .env.example for all settings.\n\n`);
      process.exit(1);
    }
    throw error;
  }

  if (!existsSync(path.join(ROOT_DIR, 'dist', 'sdk', 'navoro.js'))) {
    process.stderr.write('\nFront-end bundles are missing. Run "npm install && npm run build" first (downloaded releases include them).\n\n');
    process.exit(1);
  }

  const app = createNavoroApp(config);
  await app.listen();

  let seeded = false;
  const hasUsers = Boolean(app.context.db.get('SELECT 1 FROM users LIMIT 1'));
  if (!hasUsers && process.env.NAVORO_SEED !== 'false' && config.nodeEnv !== 'production') {
    const result = await seedDemoWorkspace(app, { demoPort: config.demoPort });
    seeded = result.created;
  }

  let demoServer: ReturnType<typeof createDemoServer> | null = null;
  if (config.serveDemo) {
    demoServer = createDemoServer({ navoroOrigin: config.publicOrigin });
    await new Promise<void>((resolve, reject) => {
      demoServer?.once('error', reject);
      demoServer?.listen(config.demoPort, config.host, resolve);
    }).catch((error: NodeJS.ErrnoException) => {
      log('warn', 'demo.unavailable', { reason: error.code === 'EADDRINUSE' ? `port ${config.demoPort} is in use` : error.message });
      demoServer = null;
    });
  }

  log('info', 'navoro.started', describeConfig(config));
  const lines = [
    '',
    '  navoro is running',
    '',
    `  Website & dashboard   ${config.publicOrigin}`,
    `  Sign in               ${config.publicOrigin}/login`,
    demoServer ? `  Lumen demo app        http://localhost:${config.demoPort}   (Navoro SDK installed)` : null,
    config.nodeEnv !== 'production' ? `  Demo account          ${DEMO_EMAIL} / ${DEMO_PASSWORD}${seeded ? '   (just created)' : ''}` : null,
    `  AI provider           ${app.context.provider ? `${app.context.provider.name} · ${app.context.provider.model}` : 'none — demo mode (set ANTHROPIC_API_KEY to enable)'}`,
    '',
    '  Press Ctrl+C to stop.',
    '',
  ].filter((line): line is string => line !== null);
  process.stdout.write(`${lines.join('\n')}\n`);

  const shutdown = async (signal: string) => {
    log('info', 'navoro.stopping', { signal });
    demoServer?.close();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main().catch((error: unknown) => {
  process.stderr.write(`\nNavoro failed to start: ${(error as Error).message}\n`);
  if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') process.stderr.write('Another process is using the port. Set PORT=4401 (and NAVORO_PUBLIC_ORIGIN) to use a different one.\n');
  process.exit(1);
});
