#!/usr/bin/env node
/**
 * Scenario runner.
 *
 * Usage:
 *   node electron/scenarios/runner.mjs <scenario-name>
 *   node electron/scenarios/runner.mjs --list
 *
 * A scenario module default-exports `{ name, delivery, run }`. `run` receives a
 * context with identity/router/manager helpers, records assertions with
 * `ctx.check`, and returns when done. The runner enforces a wall-clock budget,
 * guarantees teardown, prints one line per assertion, and exits non-zero if any
 * assertion failed.
 */

import { readdirSync } from 'node:fs';
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCENARIO_DIR = join(HERE, 'scenarios');
const DEFAULT_TIMEOUT_MS = 30_000;

// `electron/` is a separate npm project; resolve its compiled output from there.
const req = createRequire(join(HERE, '..', 'package.json'));

async function loadScenario(name) {
  const candidates = [
    join(SCENARIO_DIR, `${name}.mjs`),
    join(SCENARIO_DIR, `${name}.js`),
  ];
  const path = candidates.find((candidate) => {
    try {
      readdirSync(dirname(candidate)).includes(candidate.split('/').pop());
      return true;
    } catch {
      return false;
    }
  });
  if (!path) throw new Error(`no scenario named "${name}" in ${SCENARIO_DIR}`);
  const module = await import(pathToFileURL(path).href);
  const scenario = module.default;
  if (!scenario || typeof scenario.run !== 'function') {
    throw new Error(`scenario "${name}" must default-export { run }`);
  }
  return scenario;
}

function listScenarios() {
  let files = [];
  try {
    files = readdirSync(SCENARIO_DIR)
      .filter((file) => file.endsWith('.mjs') || file.endsWith('.js'))
      .map((file) => file.replace(/\.(mjs|js)$/, ''))
      .sort();
  } catch {
    return [];
  }
  // Support modules live beside scenarios. A file with no `run` export is not a
  // scenario, and must not appear in --list or be selectable by name.
  return files.filter((name) => {
    if (name.endsWith('-support') || name.startsWith('_')) return false;
    return true;
  });
}

function createContext(scenarioName) {
  const checks = [];
  const cleanups = [];

  const ctx = {
    /** Record an assertion. Throwing inside `fn` is a failure. */
    async check(name, fn) {
      try {
        const detail = await fn();
        checks.push({ name, ok: true, detail });
        console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
      } catch (error) {
        const detail = String(error?.message || error);
        checks.push({ name, ok: false, detail });
        console.log(`  FAIL  ${name}`);
        console.log(`        ${detail}`);
      }
    },

    /** Register teardown, run in reverse order even if the scenario throws. */
    onCleanup(fn) {
      cleanups.push(fn);
    },

    /** Temp directory removed at teardown. */
    workDir: null,

    get failures() {
      return checks.filter((entry) => !entry.ok);
    },

    get total() {
      return checks.length;
    },
  };

  ctx.scenarioName = scenarioName;
  return { ctx, checks, cleanups };
}

async function main() {
  const argument = process.argv[2];
  if (!argument || argument === '--list') {
    const names = listScenarios();
    console.log(names.length ? names.join('\n') : '(no scenarios)');
    process.exit(0);
  }

  const scenarioName = argument.replace(/\.(mjs|js)$/, '');
  console.log(`\nScenario: ${scenarioName}`);

  const scenario = await loadScenario(scenarioName);
  const { ctx, checks, cleanups } = createContext(scenarioName);

  const timeoutMs = scenario.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    console.log(`  FAIL  wall-clock budget of ${timeoutMs}ms exceeded`);
  }, timeoutMs);

  try {
    const module = await import(pathToFileURL(join(HERE, 'manager.mjs')).href);
    ctx.makeIdentity = (
      await import(pathToFileURL(join(HERE, 'identity.mjs')).href)
    ).makeIdentity;
    ctx.signEvent = (
      await import(pathToFileURL(join(HERE, 'identity.mjs')).href)
    ).signEvent;
    const routerModule = await import(
      pathToFileURL(join(HERE, 'router.mjs')).href
    );
    ctx.createRouter = routerModule.createRouter;
    ctx.checkBridgeContract = routerModule.checkBridgeContract;
    Object.assign(ctx, {
      makeManager: module.makeManager,
      makeWorkDir: module.makeWorkDir,
      joinGroup: module.joinGroup,
      joinGroups: module.joinGroups,
      exchangeSubscriptions: module.exchangeSubscriptions,
      waitForEvent: module.waitForEvent,
      historyIds: module.historyIds,
      deliverEventDirect: module.deliverEventDirect,
      settle: module.settle,
      chat: module.chat,
      RETICULUM_CHAT_DEFAULT_CHANNEL_ID:
        module.RETICULUM_CHAT_DEFAULT_CHANNEL_ID,
      /**
       * The same hash the manager uses to decide a mention targets a local
       * address. Scenarios must derive it, never hardcode a flag: the round trip
       * would drop anything that is not a real wire field.
       */
      hashMentionAddress: module.hashReticulumChatMentionAddress,
      createChannel: module.createChannel,
    });

    const notifications = await import(
      pathToFileURL(join(HERE, 'notifications.mjs')).href
    );
    const { QChatNotificationSink } = req(
      './build/src/qchat-notification-sink.js'
    );
    Object.assign(ctx, {
      loadNotificationPlan: notifications.loadNotificationPlan,
      planForEvent: notifications.planForEvent,
      emitForPlan: notifications.emitForPlan,
      notifyForEvent: notifications.notifyForEvent,
      eventNameForPlan: notifications.eventNameForPlan,
      NOTIFICATION_EVENT_BY_KIND: notifications.NOTIFICATION_EVENT_BY_KIND,
      /** A fresh sink per scenario; registers entries without presenting them. */
      makeNotificationSink: (options = {}) =>
        new QChatNotificationSink(options),
    });

    ctx.workDir = module.makeWorkDir(scenarioName);
    cleanups.push(() => {
      try {
        rmSync(ctx.workDir, { recursive: true, force: true });
      } catch {
        // Best effort; a leftover temp directory is not a scenario failure.
      }
    });

    await scenario.run(ctx);
  } catch (error) {
    console.log(`  FAIL  scenario threw`);
    console.log(
      `        ${String(error?.stack || error)
        .split('\n')
        .slice(0, 8)
        .join('\n        ')}`
    );
    checks.push({ name: 'scenario completed without throwing', ok: false });
  } finally {
    clearTimeout(timer);
    for (const cleanup of cleanups.reverse()) {
      try {
        await cleanup();
      } catch {
        // Teardown errors must not mask the scenario result.
      }
    }
  }

  const failed = checks.filter((entry) => !entry.ok).length;
  const status = failed === 0 && !timedOut ? 'PASS' : 'FAIL';
  console.log(
    `\n${status}  ${scenarioName}: ${checks.length - failed}/${checks.length} assertions`
  );
  process.exit(status === 'PASS' ? 0 : 1);
}

main().catch((error) => {
  console.error(`runner failed: ${String(error?.stack || error)}`);
  process.exit(2);
});
