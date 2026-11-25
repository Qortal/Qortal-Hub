/**
 * Loader support for scenarios that import renderer TypeScript directly.
 *
 * Node can execute renderer `.ts` files by stripping types, but that stripping
 * does not add a file extension to relative imports, and the renderer is written
 * for a bundler — `from './events'` with no `.ts`. This registers a resolve hook that
 * retries a failed relative resolution with `.ts` appended, so a scenario can
 * import the shipping renderer module instead of a copy of its logic.
 *
 * The hook is installed on first use and only for `.ts` candidates that actually
 * exist on disk, so it cannot change the meaning of any import that already
 * resolves.
 *
 * Not a scenario: no default export, and the runner filters `-support`.
 */

import { existsSync } from 'node:fs';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HOOK_SOURCE = `
import { existsSync } from 'node:fs';

export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (error) {
    if (specifier.startsWith('.') && context.parentURL) {
      const candidate = new URL(specifier + '.ts', context.parentURL);
      if (existsSync(candidate)) return next(candidate.href, context);
    }
    throw error;
  }
}
`;

let registered = false;

function ensureHook() {
  if (registered) return;
  const hookUrl = `data:text/javascript,${encodeURIComponent(HOOK_SOURCE)}`;
  register(hookUrl);
  registered = true;
}

/**
 * Minimal DOM stand-in.
 *
 * `src/utils/events.ts` is a thin wrapper over `document.dispatchEvent` and the
 * `addEventListener` family. Modules that import it also touch `window` at
 * import time in places, so both are stubbed before any renderer module loads.
 * Nothing here is asked to do anything but not throw: the scenario reads return
 * values from pure functions, not from the event bus.
 */
export function installRendererShims() {
  if (typeof globalThis.document === 'undefined') {
    /** @type {Map<string, Set<Function>>} */
    const listeners = new Map();
    globalThis.document = {
      dispatchEvent(event) {
        const set = listeners.get(event?.type);
        if (set) for (const fn of [...set]) fn(event);
        return true;
      },
      addEventListener(type, fn) {
        const set = listeners.get(type) ?? new Set();
        set.add(fn);
        listeners.set(type, set);
      },
      removeEventListener(type, fn) {
        listeners.get(type)?.delete(fn);
      },
    };
  }
  if (typeof globalThis.window === 'undefined') {
    globalThis.window = globalThis;
  }
}

/**
 * Import a renderer module by repo-relative path, e.g.
 * `importRenderer('src/utils/qChatNotificationSettings.ts')`.
 */
export async function importRenderer(relativePath) {
  installRendererShims();
  ensureHook();
  // This file lives in `electron/scenarios/scenarios/`; the repo root is three
  // levels up, and `relativePath` is repo-relative (e.g. `src/utils/...`).
  const here = dirname(fileURLToPath(import.meta.url));
  const absolute = join(here, '..', '..', '..', relativePath);
  if (!existsSync(absolute)) {
    throw new Error(`renderer module not found: ${relativePath}`);
  }
  return import(pathToFileURL(absolute).href);
}
