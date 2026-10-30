import { defineConfig } from '@playwright/test'

// `npm run monkey`: the GUI monkey (tests/monkey/README.md). A tool that writes a
// report, not a test suite, so the default Playwright run never picks it up.
export default defineConfig({
  testDir: './tests/monkey',
  testMatch: 'monkey.spec.ts',
  timeout: 0,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: 'test-results/monkey'
})
