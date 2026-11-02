import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '../tests/e2e',
  // Unpacks Electron's binary once, before the workers that launch it start.
  globalSetup: '../tests/global-setup.ts',
  timeout: 30_000,
  fullyParallel: false,
  reporter: 'list',
  outputDir: '../test-results'
})
