import { defineConfig } from '@playwright/test'

process.env.NO_PROXY = 'localhost,127.0.0.1'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'map-motion.spec.ts',
  timeout: 30_000,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5175',
    channel: 'chrome',
    headless: true,
    viewport: { width: 1440, height: 700 },
  },
  webServer: {
    command: 'npm run dev:web -- --host 127.0.0.1 --port 5175 --strictPort',
    url: 'http://127.0.0.1:5175',
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
