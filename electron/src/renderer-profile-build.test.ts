import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { it } from 'vitest';

// Vite/esbuild must run in Node's realm, not the suite's jsdom realm.
// Exercise the real config, emitted maps, and module initialization together.
it('preserves source mappings and TLA behavior in real builds', async () => {
  await promisify(execFile)(process.execPath, [
    '--test',
    'electron/scripts/test-renderer-profile-build.mjs',
  ]);
}, 30_000);
