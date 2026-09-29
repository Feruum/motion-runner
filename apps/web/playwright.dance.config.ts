import { defineConfig } from '@playwright/test';
import base from './playwright.config';

const runId = 'dance-duo-progress-retry-20260930';

export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: ['pose-modes.spec.ts', 'six-seven.spec.ts', 'dance-presentation.spec.ts'],
  workers: 1,
  timeout: 200_000,
  expect: { ...base.expect, timeout: 20_000 },
  metadata: { liveApi: true, validationRun: runId },
  outputDir: `../../.video-review/${runId}-results`,
  reporter: [
    ['list'],
    ['json', { outputFile: `../../.video-review/${runId}-report.json` }],
  ],
  use: { ...base.use, baseURL: 'http://127.0.0.1:4190' },
  webServer: [
    {
      command: 'bun ../api/src/index.ts',
      env: {
        API_PORT: '4193',
        API_HOST: '127.0.0.1',
        LEADERBOARD_STORAGE: 'sqlite',
        DATABASE_PATH: `../../.video-review/${runId}.sqlite`,
      },
      url: 'http://127.0.0.1:4193/api/health',
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `bun x vite build --config vite.full.config.ts --outDir ../../.video-review/${runId}-dist && bun x vite preview --config vite.full.config.ts --outDir ../../.video-review/${runId}-dist`,
      env: { VITE_RACE_SERVER_URL: 'http://127.0.0.1:4190' },
      url: 'http://127.0.0.1:4190',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
