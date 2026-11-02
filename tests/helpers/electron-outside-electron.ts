/**
 * What `import ... from 'electron'` gives a Vitest test: Electron outside Electron.
 *
 * Tests run in Node, where the real `electron` package is not Electron's API but
 * the path to its binary (and requiring it unpacks that binary on first use). So a
 * service imported by a test sees no Electron API here either: `safeStorage`,
 * `nativeImage` and the rest are undefined, exactly as with the real package in
 * Node, and nothing is unpacked or started. A test that needs an Electron API
 * mocks `electron` itself (`vi.mock('electron', ...)`), which replaces this.
 *
 * config/vitest.config.ts points `electron` here.
 */
export const OUTSIDE_ELECTRON = true
