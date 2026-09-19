/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
// Import path module for resolving file paths
import fixReactVirtualized from 'esbuild-plugin-react-virtualized';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  resolve: {
    alias:
      process.env.VITEST === 'true'
        ? {
            '@silentbot1/nat-api': resolve(
              __dirname,
              'src/test/mocks/natApi.ts'
            ),
            'better-sqlite3': resolve(
              __dirname,
              'src/test/mocks/betterSqlite3.ts'
            ),
            electron: resolve(__dirname, 'src/test/mocks/electron.ts'),
            'electron-serve': resolve(
              __dirname,
              'src/test/mocks/electronServe.ts'
            ),
            'electron-unhandled': resolve(
              __dirname,
              'src/test/mocks/electronUnhandled.ts'
            ),
            'electron-updater': resolve(
              __dirname,
              'src/test/mocks/electronUpdater.ts'
            ),
            'electron-window-state': resolve(
              __dirname,
              'src/test/mocks/electronWindowState.ts'
            ),
            selfsigned: resolve(__dirname, 'src/test/mocks/selfsigned.ts'),
          }
        : {},
  },
  build: {
    // Explicit runtime baseline for the PSBT dependencies (Object.hasOwn).
    // Also prevents the TLA plugin from reverting to its obsolete Safari 14 target.
    target: ['es2020', 'chrome94', 'edge94', 'firefox93', 'safari15.4'],
    rollupOptions: {
      onwarn(warning, warn) {
        const id = warning.id?.replace(/\\/g, '/');
        // Scure's documentation comment contains an example PURE annotation.
        // Keep warnings about actual misplaced annotations everywhere else.
        if (
          warning.code === 'INVALID_ANNOTATION' &&
          id?.endsWith('/node_modules/@scure/base/index.js') &&
          warning.message.includes('// Freeze the result of a thunk.')
        )
          return;
        // This Babel-only directive has no runtime effect.
        if (
          warning.code === 'MODULE_LEVEL_DIRECTIVE' &&
          id?.endsWith(
            '/node_modules/react-virtualized/dist/es/WindowScroller/utils/onScroll.js'
          ) &&
          warning.message.includes('no babel-plugin-flow-react-proptypes')
        )
          return;
        // bcrypt 2.4.3 catches its optional Node import and uses Web Crypto.
        // Do not hide other modules accidentally importing Node APIs.
        if (
          warning.code === 'PLUGIN_WARNING' &&
          warning.plugin === 'vite:resolve' &&
          /^(?:\[plugin vite:resolve\] )?Module "crypto" has been externalized for browser compatibility, imported by "[^"]*\/node_modules\/bcryptjs\/dist\/bcrypt\.js"\./.test(
            warning.message.replace(/\\/g, '/')
          )
        )
          return;
        warn(warning);
      },
      input: {
        main: resolve(__dirname, 'index.html'),
        audioSurface: resolve(__dirname, 'audio-surface.html'),
      },
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('/node_modules/phaser/')) {
              return 'phaser';
            }
            return 'vendor';
          }
        },
      },
    },
  },
  // The audio-decrypt worker dynamically imports `libsodium-wrappers-sumo` (WASM) to
  // split the ~180 KB payload off first paint. Rollup only allows worker code-splitting
  // with the ES module format; the default `iife` worker output rejects dynamic imports.
  worker: {
    format: 'es',
  },
  test: {
    environment: 'jsdom',
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.idea/**',
      '**/.git/**',
      '**/.cache/**',
      'electron/build/**',
      '.emsdk/**',
    ],
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'electron/src/**/*.test.ts'],
    environmentMatchGlobs: [['electron/**', 'node']],
  } as any,
  assetsInclude: ['**/*.wasm'],
  plugins: [
    react(),
    wasm(),
    topLevelAwait(),
    VitePWA({
      registerType: 'prompt',
      manifest: {
        name: 'Qortal Hub',
        short_name: 'Hub',
        description: 'Your easy access to the Qortal blockchain',
        start_url: '/',
        display: 'standalone',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        icons: [
          {
            src: '/qortal192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/qortal.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024, // 10MB limit
        disableDevLogs: true, // Suppresses logs in development
      },
    }),
    {
      name: 'electron-strip-pwa-injection',
      enforce: 'post',
      transformIndexHtml: {
        order: 'post',
        handler(html, ctx) {
          const isDesktopHtmlEntry =
            ctx.filename.endsWith('audio-surface.html') ||
            ctx.filename.endsWith('index.html');
          if (!isDesktopHtmlEntry) {
            return html;
          }
          return html
            .replace(/<link\s+rel="manifest"[^>]*>\s*/gi, '')
            .replace(
              /<script[^>]*id="vite-plugin-pwa:register-sw"[^>]*><\/script>\s*/gi,
              ''
            );
        },
      },
    },
  ],
  optimizeDeps: {
    esbuildOptions: {
      plugins: [fixReactVirtualized],
    },
  },
});
