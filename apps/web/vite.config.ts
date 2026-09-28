import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  worker: { format: 'es' },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:3001' },
  },
  preview: { port: 4173, strictPort: true },
  test: { include: ['tests/**/*.test.ts'] },
  build: { chunkSizeWarningLimit: 1200 },
});
