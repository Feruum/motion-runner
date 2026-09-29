import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  worker: { format: 'es' },
  server: {
    port: 5175,
    strictPort: false,
    proxy: { '/api': { target: 'http://127.0.0.1:3002', ws: true } },
  },
  preview: { port: 4173, strictPort: true },
  test: { include: ['tests/**/*.test.ts'] },
  build: { chunkSizeWarningLimit: 1200 },
});
