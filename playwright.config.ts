import {defineConfig, devices} from '@playwright/test';

const baseURL = process.env.BASE_URL ?? process.env.APP_ORIGIN ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  timeout: 60_000,
  reporter: process.env.CI ? [['list'], ['html', {open: 'never'}]] : 'list',
  use: {...devices['Desktop Chrome'], baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure'},
});