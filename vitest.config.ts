import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: ['tests/e2e/**', '.scratch/**', 'node_modules/**', 'dist/**'],
    passWithNoTests: true,
  },
})
