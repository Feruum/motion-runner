import { defineConfig } from 'vite';
import base from './vite.config';

export default defineConfig({
  ...base,
  preview: {
    host: '127.0.0.1', port: 4190, strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:4193', ws: true } },
  },
});
