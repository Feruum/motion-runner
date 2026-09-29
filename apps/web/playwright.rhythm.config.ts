import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  testMatch:'**/rhythm.spec.ts',
  testIgnore:[],
  workers:1,
  outputDir:'../../.video-review/rhythm-stars-results',
  use:{...base.use,baseURL:'http://127.0.0.1:4196'},
  webServer:{
    command:'bun x vite build --outDir ../../.video-review/rhythm-stars-dist && bun x vite preview --outDir ../../.video-review/rhythm-stars-dist --host 127.0.0.1 --port 4196 --strictPort',
    url:'http://127.0.0.1:4196',reuseExistingServer:false,timeout:60000,
  },
});
