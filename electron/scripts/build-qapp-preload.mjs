import { build } from '../../node_modules/esbuild/lib/main.js';
import { fileURLToPath } from 'node:url';

// Sandboxed preloads cannot require local modules. Keep Electron external and
// bundle the browser-only binary transport into the preload itself. Keep the
// original filename: an already-running main process retains that path while
// rebuilding. This step must run after tsc, replacing its unbundled output.
await build({
  entryPoints: [
    fileURLToPath(new URL('../src/qapp-guest-preload.ts', import.meta.url)),
  ],
  outfile: fileURLToPath(
    new URL('../build/src/qapp-guest-preload.js', import.meta.url)
  ),
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  external: ['electron'],
  target: 'chrome140',
});
