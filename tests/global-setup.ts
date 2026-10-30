import { ensureElectronBinary } from '../scripts/ensure-electron.cjs'

/**
 * Runs once in the main process before any test worker starts (Vitest's and
 * Playwright's `globalSetup`): Electron's binary is unpacked here, once, never
 * by several workers at the same time (scripts/ensure-electron.cjs).
 */
export default function globalSetup(): void {
  ensureElectronBinary()
}
