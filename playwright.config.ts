import { defineConfig } from '@playwright/test'

process.env.NO_PROXY = 'localhost,127.0.0.1'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    channel: 'chrome',
    headless: true,
    viewport: { width: 1280, height: 800 },
  },
  webServer: [
    { command: 'npm run dev:api', url: 'http://127.0.0.1:3000/api/health', reuseExistingServer: true, timeout: 60_000 },
    { command: 'npm run dev:web', url: 'http://127.0.0.1:5173', reuseExistingServer: true, timeout: 60_000 },
  ],
})
