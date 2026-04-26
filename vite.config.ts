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
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        audioSurface: resolve(__dirname, 'audio-surface.html'),
      },
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
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
