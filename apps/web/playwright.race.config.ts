import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  testMatch: '**/party-race.spec.ts',
  testIgnore: [],
  outputDir: '../../.video-review/party-race-results',
  workers: 1,
  timeout: 200_000,
  use: { ...base.use, baseURL:'http://127.0.0.1:4188' },
  webServer: [
    { command:'bun ../api/src/index.ts',env:{API_PORT:'4192',API_HOST:'127.0.0.1'},url:'http://127.0.0.1:4192/api/health',reuseExistingServer:false,timeout:30000 },
    { command:'bun x vite build --outDir ../../.video-review/race-e2e-dist && bun x vite preview --outDir ../../.video-review/race-e2e-dist --host 127.0.0.1 --port 4188 --strictPort',env:{VITE_RACE_SERVER_URL:'http://127.0.0.1:4192'},url:'http://127.0.0.1:4188',reuseExistingServer:false,timeout:60000 },
  ],
});
