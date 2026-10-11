#!/usr/bin/env node
/**
 * One-command launcher for Navoro: `node start.mjs`.
 *
 * Deliberately plain JavaScript with no modern syntax requirements, so that it
 * runs on any Node version and can explain what's wrong (old Node, missing
 * bundles) before handing off to the TypeScript server in server/main.ts.
 *
 * Environment:
 *   PORT              dashboard/API port (default 4400)
 *   NAVORO_NO_OPEN=1  don't open a browser once the server is ready
 *   ...plus everything in .env.example
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

var MIN = [22, 18, 0];
var root = path.dirname(fileURLToPath(import.meta.url));

function fail(lines) {
  process.stderr.write('\n' + lines.map(function (l) { return l ? '  ' + l : ''; }).join('\n') + '\n\n');
  process.exit(1);
}

// 1. Node version ------------------------------------------------------------
var current = process.versions.node.split('.').map(Number);
var tooOld = false;
for (var i = 0; i < 3; i++) {
  if (current[i] > MIN[i]) break;
  if (current[i] < MIN[i]) { tooOld = true; break; }
}
if (tooOld) {
  fail([
    'Navoro needs Node.js ' + MIN.join('.') + ' or newer. You have ' + process.versions.node + '.',
    '',
    'Install the current LTS from https://nodejs.org, then run this again:',
    '  node start.mjs',
  ]);
}

// 2. Front-end bundles --------------------------------------------------------
if (!existsSync(path.join(root, 'dist', 'sdk', 'navoro.js'))) {
  fail([
    'The front-end bundles (dist/) are missing.',
    '',
    'Downloaded releases include them. In a git checkout, build them once with:',
    '  npm install && npm run build',
  ]);
}

// 3. Optional .env (e.g. ANTHROPIC_API_KEY). Real environment variables win. ------
var envFile = path.join(root, '.env');
if (existsSync(envFile) && typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(envFile);
  } catch (error) {
    fail(['Could not read .env: ' + error.message]);
  }
}

// 4. Start the server -----------------------------------------------------------
var port = Number(process.env.PORT) || 4400;
var origin = (process.env.NAVORO_PUBLIC_ORIGIN || 'http://localhost:' + port).replace(/\/$/, '');

var child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join('server', 'main.ts')], {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
});

var exiting = false;
['SIGINT', 'SIGTERM', 'SIGHUP'].forEach(function (signal) {
  process.on(signal, function () {
    if (child.exitCode !== null) return;
    if (exiting) {
      // Second Ctrl+C: stop immediately.
      child.kill('SIGKILL');
      return;
    }
    exiting = true;
    child.kill(signal);
    // Safety net if a graceful shutdown stalls (e.g. lingering keep-alive connections).
    setTimeout(function () {
      if (child.exitCode === null) child.kill('SIGKILL');
    }, 8000).unref();
  });
});

child.on('error', function (error) {
  fail(['Could not start Navoro: ' + error.message]);
});

child.on('exit', function (code, signal) {
  if (signal && !exiting) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code === null ? (exiting ? 0 : 1) : code);
});

// 5. Open the browser once healthy -------------------------------------------
function healthy(callback) {
  var req = http.get('http://127.0.0.1:' + port + '/api/health', { timeout: 1000 }, function (res) {
    res.resume();
    callback(res.statusCode === 200);
  });
  req.on('error', function () { callback(false); });
  req.on('timeout', function () { req.destroy(); });
}

function openBrowser(url) {
  var command;
  var args;
  if (process.platform === 'darwin') { command = 'open'; args = [url]; }
  else if (process.platform === 'win32') { command = 'cmd'; args = ['/c', 'start', '""', url]; }
  else { command = 'xdg-open'; args = [url]; }
  try {
    var opener = spawn(command, args, { stdio: 'ignore', detached: true });
    opener.on('error', function () {});
    opener.unref();
  } catch (_error) {
    // No browser available; the URLs are printed by the server anyway.
  }
}

var shouldOpen = process.env.NAVORO_NO_OPEN !== '1' && process.env.NAVORO_NO_OPEN !== 'true' && Boolean(process.stdout.isTTY) && !process.env.CI;
if (shouldOpen) {
  var deadline = Date.now() + 15000;
  var poll = function () {
    if (child.exitCode !== null || exiting) return;
    healthy(function (ok) {
      if (ok) openBrowser(origin + '/');
      else if (Date.now() < deadline) setTimeout(poll, 400);
    });
  };
  setTimeout(poll, 300);
}
