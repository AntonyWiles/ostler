import { defineConfig } from '@playwright/test'

/** The performance suite (P9.1): `npm run perf`. Not part of `npm run verify`. */
export default defineConfig({
  testDir: '../tests/perf',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  outputDir: '../test-results'
})
