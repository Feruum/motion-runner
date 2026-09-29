import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  testMatch: '**/mirror-coach.spec.ts',
  testIgnore: [],
  workers: 1,
  timeout: 140_000,
  outputDir: '../../.video-review/mirror-coach-results',
  reporter: 'list',
  use: { ...base.use, baseURL: 'http://127.0.0.1:4197' },
  webServer: {
    command: 'bun x vite build --outDir ../../.video-review/mirror-coach-dist && bun x vite preview --outDir ../../.video-review/mirror-coach-dist --host 127.0.0.1 --port 4197 --strictPort',
    url: 'http://127.0.0.1:4197',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
