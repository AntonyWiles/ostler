import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as net from 'node:net'
import type { Page } from 'playwright'
import {
  DEFAULT_CONFIG,
  type OstlerConfig,
  type WatchedProject
} from '../../../src/shared/ostler-api'
import { launchOstler, type LaunchedOstler } from './launch'

const root = path.resolve(__dirname, '../../..')
const APP_VERSION = (
  JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string }
).version

export interface DashboardDataOptions {
  ai?: Partial<OstlerConfig['ai']>
  /** "Use AI agents" (D10); off, as on a new install, unless a test drives agents. */
  agents?: boolean
  /** A brand-new install: no config.json at all, so the welcome shows (P8.1). */
  fresh?: boolean
}

/** A port the system has just handed out and nothing listens on. */
function reservePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      if (!address || typeof address === 'string') {
        probe.close()
        reject(new Error('Failed to reserve an E2E port'))
        return
      }
      probe.close((error) => (error ? reject(error) : resolve(address.port)))
    })
  })
}

/**
 * A fresh data folder for one test. Unless `fresh`, it holds a config.json
 * past the welcome, watching `project` when one is given.
 */
export async function makeDashboardDataDir(
  project?: WatchedProject,
  options?: DashboardDataOptions
): Promise<string> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-e2e-'))
  if (options?.fresh) return dataDir
  const port = await reservePort()
  // The automation API needs moving too. It defaults to 8935, so leaving it
  // alone makes this suite bind the same port as a developer's own
  // `npm run dev` instance; the app then dies on an EADDRINUSE dialog in the
  // main process, which surfaces here only as an unexplained test timeout.
  const automationPort = await reservePort()
  fs.writeFileSync(
    path.join(dataDir, 'config.json'),
    JSON.stringify(
      {
        ...DEFAULT_CONFIG,
        projects: project ? [project] : [],
        // Past the welcome, with this version's What's new already seen (P8.1).
        ui: { ...DEFAULT_CONFIG.ui, firstRunCompleted: true, lastSeenVersion: APP_VERSION },
        ai: { ...DEFAULT_CONFIG.ai, ...options?.ai },
        harness: { ...DEFAULT_CONFIG.harness, enabled: options?.agents ?? false, port },
        automationApi: {
          ...DEFAULT_CONFIG.automationApi,
          enabled: options?.agents ?? false,
          port: automationPort
        }
      },
      null,
      2
    )
  )
  return dataDir
}

/** Starts Ostler off screen on `dataDir`, with the large window the dashboard spec uses. */
export function startDashboard(
  dataDir: string,
  environment?: Record<string, string>
): Promise<LaunchedOstler> {
  return launchOstler({ dataDir, env: environment, viewport: { width: 1600, height: 1200 } })
}

/**
 * The toast stack. A toast's words are also in the app's live region (P9.2),
 * so a toast is looked for here, not on the whole page.
 */
export function notifications(window: Page) {
  return window.getByRole('region', { name: 'Notifications' })
}
