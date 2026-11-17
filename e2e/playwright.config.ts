import { defineConfig } from '@playwright/test';

// One Electron app per test, each on its own user-data directory. One worker:
// the apps share the machine's audio and display, and a session test is not
// CPU-bound enough for a second worker to pay for the flakiness it invites.
export default defineConfig({
  testDir: './specs',
  outputDir: './test-results',
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { outputFolder: './report', open: 'never' }]],
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
