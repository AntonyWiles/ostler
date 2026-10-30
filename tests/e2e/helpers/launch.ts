import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import * as path from 'path'
import { createRequire } from 'module'
import { electronArgs } from '../electron-args'

const moduleRequire = createRequire(__filename)
const root = path.resolve(__dirname, '../../..')

/** Names that would put the window in front of the person: never passed on. */
const ON_SCREEN_NAMES = [
  'OSTLER_ON_SCREEN',
  // Its name before the rename (legacy-names.ts); the app no longer reads it.
  'NEXUS_ON_SCREEN'
] as const

export interface LaunchOstlerOptions {
  /** The data folder Ostler runs on (OSTLER_USER_DATA). */
  dataDir: string
  /**
   * Extra environment, over this process's own. A name set to `undefined` is
   * removed. It cannot bring the window on screen.
   */
  env?: Record<string, string | undefined>
  /** The first window's page size; left as the app sizes it when not given. */
  viewport?: { width: number; height: number }
}

export interface LaunchedOstler {
  app: ElectronApplication
  /** The first window, loaded as far as `domcontentloaded`. */
  window: Page
}

/**
 * Starts the built Ostler the way every e2e spec does: off screen and never
 * focused (OSTLER_OFF_SCREEN=1 and no OSTLER_ON_SCREEN, whatever the shell
 * has), as Electron rather than Node (no ELECTRON_RUN_AS_NODE), production
 * mode, no GPU, on `dataDir`. Returns once the first window has loaded.
 */
export async function launchOstler(options: LaunchOstlerOptions): Promise<LaunchedOstler> {
  const merged: Record<string, string | undefined> = {
    ...process.env,
    NODE_ENV: 'production',
    ELECTRON_DISABLE_GPU: '1',
    ...options.env,
    OSTLER_USER_DATA: options.dataDir,
    OSTLER_OFF_SCREEN: '1'
  }
  delete merged.ELECTRON_RUN_AS_NODE
  for (const name of ON_SCREEN_NAMES) delete merged[name]
  const env: Record<string, string> = {}
  for (const [name, value] of Object.entries(merged)) if (value !== undefined) env[name] = value

  const app = await electron.launch({
    executablePath: moduleRequire('electron') as string,
    args: electronArgs(root),
    env
  })
  const window = await app.firstWindow()
  if (options.viewport) await window.setViewportSize(options.viewport)
  await window.waitForLoadState('domcontentloaded')
  return { app, window }
}
