import { randomUUID } from 'node:crypto'
import { defineConfig } from '@playwright/test'

process.env.NO_PROXY = 'localhost,127.0.0.1'
process.env.EXPLORATION_UI_RUN_ID ??= randomUUID()

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['exploration-workspace.spec.ts', 'exploration-decisions.spec.ts'],
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  globalTeardown: './tests/e2e/fixtures/exploration-teardown.mjs',
  use: {
    baseURL: 'http://127.0.0.1:5174', channel: 'chrome', headless: true,
    viewport: { width: 1280, height: 800 },
  },
  webServer: [
    { command: 'node tests/e2e/fixtures/exploration-server.mjs', url: 'http://127.0.0.1:3104/api/health', reuseExistingServer: false, timeout: 60_000 },
    { command: 'node tests/e2e/fixtures/exploration-web.mjs', url: 'http://127.0.0.1:5174', reuseExistingServer: false, timeout: 60_000 },
  ],
})
