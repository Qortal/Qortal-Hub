import assert from 'node:assert/strict';
import { SourceMap } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, test } from 'node:test';
import { build, loadConfigFromFile } from 'vite';

const source = `const ready = await Promise.resolve('ready');
export function profileProbe() {
  const marker = 'QORTAL_PROFILE_SOURCE_MAP_PROBE';
  return ready + ':' + marker;
}
export async function loadLazyProbe() {
  return (await import('./lazy.ts')).lazyProbe();
}
`;
const lazySource = `const ready = await Promise.resolve('lazy');
export function lazyProbe() {
  return ready + ':QORTAL_LAZY_SOURCE_MAP_PROBE';
}
`;
const directories = [];
const originalFlag = process.env.QORTAL_RENDERER_PROFILE_SOURCEMAP;

afterEach(async () => {
  if (originalFlag === undefined)
    delete process.env.QORTAL_RENDERER_PROFILE_SOURCEMAP;
  else process.env.QORTAL_RENDERER_PROFILE_SOURCEMAP = originalFlag;
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

for (const profiling of [true, false]) {
  test(`builds executable TLA modules with profiling=${profiling}`, async () => {
    process.env.QORTAL_RENDERER_PROFILE_SOURCEMAP = profiling ? '1' : '0';
    const { config } = await loadConfigFromFile(
      { command: 'build', mode: 'production' },
      path.resolve('vite.config.ts')
    );
    const plugins = config.plugins.flat(Infinity);
    assert.equal(
      plugins.some((plugin) => plugin.name === 'vite-plugin-top-level-await'),
      !profiling
    );
    assert.equal(config.build.sourcemap, profiling);
    assert.deepEqual(
      config.build.target,
      profiling
        ? 'es2022'
        : ['es2020', 'chrome94', 'edge94', 'firefox93', 'safari15.4']
    );

    const root = await mkdtemp(path.join(os.tmpdir(), 'qortal-profile-build-'));
    directories.push(root);
    await writeFile(path.join(root, 'entry.ts'), source);
    await writeFile(path.join(root, 'lazy.ts'), lazySource);
    const result = await build({
      ...config,
      configFile: false,
      root,
      publicDir: false,
      logLevel: 'silent',
      // Service-worker generation is unrelated to JS transforms and source maps.
      plugins: plugins.filter(
        (plugin) => !plugin.name.startsWith('vite-plugin-pwa')
      ),
      build: {
        ...config.build,
        outDir: path.join(root, 'dist'),
        rollupOptions: {
          input: path.join(root, 'entry.ts'),
          preserveEntrySignatures: 'strict',
          output: {
            entryFileNames: 'entry.mjs',
            chunkFileNames: '[name]-[hash].mjs',
          },
        },
      },
    });

    if (profiling) {
      for (const [marker, originalSource, file] of [
        ['QORTAL_PROFILE_SOURCE_MAP_PROBE', source, 'entry.ts'],
        ['QORTAL_LAZY_SOURCE_MAP_PROBE', lazySource, 'lazy.ts'],
      ]) {
        const chunk = result.output.find(
          (item) => item.type === 'chunk' && item.code.includes(marker)
        );
        assert.ok(chunk, `Missing ${marker}`);
        const prefix = chunk.code.slice(0, chunk.code.indexOf(marker));
        const generatedLines = prefix.split('\n');
        const map = new SourceMap(
          JSON.parse(
            await readFile(
              path.join(root, 'dist', `${chunk.fileName}.map`),
              'utf8'
            )
          )
        );
        const position = map.findEntry(
          generatedLines.length - 1,
          generatedLines.at(-1).length
        );
        assert.ok(
          position.originalSource.endsWith(`/${file}`),
          JSON.stringify(position)
        );
        assert.equal(
          position.originalLine,
          originalSource.split('\n').findIndex((line) => line.includes(marker))
        );
      }
    } else {
      assert.equal(
        result.output.some((item) => item.fileName.endsWith('.map')),
        false
      );
    }

    const entry = await import(
      pathToFileURL(path.join(root, 'dist', 'entry.mjs')).href
    );
    // The compatibility build exposes its initialization promise; native TLA
    // completes initialization before import resolves.
    await entry.__tla;
    assert.equal(entry.profileProbe(), 'ready:QORTAL_PROFILE_SOURCE_MAP_PROBE');
    assert.equal(
      await entry.loadLazyProbe(),
      'lazy:QORTAL_LAZY_SOURCE_MAP_PROBE'
    );
  });
}
