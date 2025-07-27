/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// Import path module for resolving file paths
import fixReactVirtualized from 'esbuild-plugin-react-virtualized';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
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
  ],
  optimizeDeps: {
    esbuildOptions: {
      plugins: [fixReactVirtualized],
    },
  },
});
