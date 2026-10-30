import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'node',
    // Unpacks Electron's binary once, before any worker starts (startup-smoke runs it).
    globalSetup: ['./tests/global-setup.ts'],
    // A Windows CI runner is slow to set up a test's folders and Git repositories.
    hookTimeout: 60_000,
    // Database migrations and backups there run well past the 5s default.
    testTimeout: 30_000,
    // With a worker per core the runner gets so busy that a worker's messages
    // to vitest time out ("Timeout calling onTaskUpdate") though every test passes.
    maxWorkers: process.env.CI ? 2 : undefined,
    setupFiles: ['./tests/setup-components.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    alias: [
      { find: '@shared', replacement: resolve(__dirname, 'src/shared') },
      { find: '@renderer', replacement: resolve(__dirname, 'src/renderer') },
      // Tests run in Node, not Electron: see the file for what that means.
      {
        find: /^electron$/,
        replacement: resolve(__dirname, 'tests/helpers/electron-outside-electron.ts')
      }
    ]
  }
})
