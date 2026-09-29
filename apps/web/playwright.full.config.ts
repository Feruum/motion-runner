import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  testIgnore: [],
  workers: 1,
  timeout: 200_000,
  metadata: { liveApi: true },
  outputDir: '../../.video-review/full-audit-results',
  reporter: [['list'], ['json', { outputFile: '../../.video-review/full-audit-results.json' }]],
  use: { ...base.use, baseURL: 'http://127.0.0.1:4190' },
  webServer: [
    {
      command: 'bun ../api/src/index.ts',
      env: { API_PORT: '4193', API_HOST: '127.0.0.1', LEADERBOARD_STORAGE: 'sqlite', DATABASE_PATH: '../../.video-review/full-audit.sqlite' },
      url: 'http://127.0.0.1:4193/api/health', reuseExistingServer: false, timeout: 30_000,
    },
    {
      command: 'bun x vite build --config vite.full.config.ts --outDir ../../.video-review/full-audit-dist && bun x vite preview --config vite.full.config.ts --outDir ../../.video-review/full-audit-dist',
      env: { VITE_RACE_SERVER_URL: 'http://127.0.0.1:4190' },
      url: 'http://127.0.0.1:4190', reuseExistingServer: false, timeout: 60_000,
    },
  ],
});
