#!/usr/bin/env node
/**
 * Run every scenario and summarise.
 *
 * Each scenario runs in its own process, because scenarios install process-wide
 * state (temp databases, worker pools) and one failure must not take the rest
 * with it. Exit code is 1 if any scenario failed, 0 if all passed.
 *
 * Usage:
 *   node electron/scenarios/run-all.mjs
 *   node electron/scenarios/run-all.mjs --filter notification-
 */

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER = join(HERE, 'runner.mjs');

const filterIndex = process.argv.indexOf('--filter');
const filter = filterIndex >= 0 ? process.argv[filterIndex + 1] : null;

function listScenarios() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [RUNNER, '--list'], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let out = '';
    child.stdout.on('data', (chunk) => {
      out += chunk.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`--list exited ${code}`));
        return;
      }
      resolve(out.trim().split('\n').filter(Boolean));
    });
  });
}

/**
 * A scenario may declare `knownFailure: '<reason>'`. It still runs and still
 * reports, but does not fail the suite — a tracked gap rather than a green tick
 * over a red assertion. `--include-known-failures` makes them fatal again.
 */
async function readKnownFailure(name) {
  try {
    const module = await import(
      new URL(`./scenarios/${name}.mjs`, import.meta.url).href
    );
    return module.default?.knownFailure ?? null;
  } catch {
    return null;
  }
}

function runScenario(name) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [RUNNER, name], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let out = '';
    child.stdout.on('data', (chunk) => {
      out += chunk.toString();
    });
    child.on('error', () =>
      resolve({ name, ok: false, summary: 'spawn failed' })
    );
    child.on('exit', (code) => {
      // The scenario's own last line already starts with PASS/FAIL, so store it
      // without the verdict to avoid "PASS  PASS  name: ...".
      const summaryLine = out
        .split('\n')
        .reverse()
        .find((line) => /^\s*(PASS|FAIL)\s+\S+:/.test(line));
      const summary = summaryLine
        ? summaryLine.trim().replace(/^(PASS|FAIL)\s+/, '')
        : `exit ${code}`;
      resolve({ name, ok: code === 0, summary });
    });
  });
}

const all = await listScenarios();
const selected = filter ? all.filter((name) => name.includes(filter)) : all;

if (selected.length === 0) {
  console.error(
    filter ? `no scenarios match "${filter}"` : 'no scenarios found'
  );
  process.exit(1);
}

console.log(`Running ${selected.length} scenario(s)\n`);

const fatalKnownFailures = process.argv.includes('--include-known-failures');

const results = [];
for (const name of selected) {
  const knownFailure = await readKnownFailure(name);
  const result = await runScenario(name);
  results.push({ ...result, knownFailure });
}

console.log('\n--- scenarios ---');
for (const result of results) {
  const label = result.ok ? 'PASS' : result.knownFailure ? 'KNOWN' : 'FAIL';
  console.log(`${label.padEnd(5)} ${result.summary || result.name}`);
  if (!result.ok && result.knownFailure) {
    console.log(`      known failure: ${result.knownFailure}`);
  }
}

const failed = results.filter((result) => !result.ok && !result.knownFailure);
const known = results.filter((result) => !result.ok && result.knownFailure);
const passed = results.length - failed.length - known.length;

console.log(
  `\n${passed}/${results.length} scenarios passed` +
    (known.length ? `, ${known.length} known failure(s)` : '')
);

if (fatalKnownFailures && known.length > 0) {
  console.error(
    `\n--include-known-failures: ${known.length} known failure(s) treated as fatal`
  );
  process.exit(1);
}
process.exit(failed.length === 0 ? 0 : 1);
