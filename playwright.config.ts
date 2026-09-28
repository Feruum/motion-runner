import { defineConfig } from '@playwright/test';

declare const process: { platform: string; env: Record<string, string | undefined> };

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45000,
  expect: { timeout: 20000 },
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    headless: true,
    launchOptions: {
      executablePath: process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : undefined,
      args: ['--enable-unsafe-swiftshader'],
    },
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
