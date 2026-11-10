import { defineConfig } from '@playwright/test'

/**
 * P17 end-to-end runner.
 * Uses the Chrome already installed on the machine (`channel: 'chrome'`).
 * Do not download Playwright's own browsers.
 */
export default defineConfig({
  testDir: 'e2e',
  testMatch: /.*\.pw\.ts/,
  timeout: 360_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: 'e2e-results',
  use: {
    channel: 'chrome',
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1280, height: 800 },
    trace: 'off',
    screenshot: 'only-on-failure',
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
  },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 180_000,
  },
  projects: [
    {
      name: 'desktop',
      use: { viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'mobile',
      testMatch: /demo\.pw\.ts/,
      use: { viewport: { width: 375, height: 812 } },
    },
  ],
})
