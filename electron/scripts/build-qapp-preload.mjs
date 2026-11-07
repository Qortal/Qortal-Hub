import { build } from '../../node_modules/esbuild/lib/main.js';
import { fileURLToPath } from 'node:url';

// Sandboxed preloads cannot require local modules. Keep Electron external and
// bundle the browser-only binary transport into the preload itself. Use
// distinct output paths so a later tsc run cannot replace the bundles with
// unbundled CommonJS output.
await build({
  entryPoints: [
    fileURLToPath(new URL('../src/qapp-guest-preload.ts', import.meta.url)),
  ],
  outfile: fileURLToPath(
    new URL('../build/src/qapp-guest-preload.bundle.js', import.meta.url)
  ),
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  external: ['electron'],
  target: 'chrome140',
});

await build({
  entryPoints: [
    fileURLToPath(
      new URL('../src/qapp-file-worker-preload.ts', import.meta.url)
    ),
  ],
  outfile: fileURLToPath(
    new URL('../build/src/qapp-file-worker-preload.bundle.js', import.meta.url)
  ),
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  external: ['electron'],
  target: 'chrome140',
});
