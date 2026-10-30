import { app } from 'electron'
import { readFile } from 'fs/promises'
import { join } from 'path'
import * as os from 'os'
import { type RendererErrorReport } from '@shared/ostler-api'
import { BRAND } from '@shared/brand'
import type { ConfigStore } from '../config-store'
import { LATEST_SCHEMA_VERSION } from '../services/database/migrations'
import { appLog, getLog } from '../app/logging'
import { buildDiagnosticsText, configSecrets } from '../app/diagnostics'
import { openExternalUrl } from '../app/security'
import { handleApi } from './handle-ipc'
import { copyText } from '../app/clipboard'

export interface DiagnosticsHandlerDependencies {
  configStore: ConfigStore
}

const MAX_MESSAGE_CHARS = 2_000
const MAX_STACK_CHARS = 8_000
const MAX_REPORTS_PER_MINUTE = 20

/**
 * Caps how much a renderer can write to main.log: a page stuck in an error
 * loop must not fill the disk or rotate away the lines that explain it.
 */
export function createRendererErrorGate(
  limit = MAX_REPORTS_PER_MINUTE,
  windowMs = 60_000,
  now = () => Date.now()
) {
  let windowStart = now()
  let count = 0
  let dropped = 0
  return {
    /** Whether this report may be written; also returns how many were dropped before it. */
    admit(): { ok: boolean; dropped: number } {
      const time = now()
      if (time - windowStart >= windowMs) {
        windowStart = time
        count = 0
      }
      if (count >= limit) {
        dropped += 1
        return { ok: false, dropped: 0 }
      }
      count += 1
      const before = dropped
      dropped = 0
      return { ok: true, dropped: before }
    }
  }
}

const clip = (text: unknown, max: number): string => {
  const value = typeof text === 'string' ? text : ''
  return value.length > max ? `${value.slice(0, max)}… [truncated]` : value
}

/** Registers renderer error forwarding, Copy diagnostics, Report a problem and the version. */
export function registerDiagnosticsHandlers({ configStore }: DiagnosticsHandlerDependencies): void {
  const gate = createRendererErrorGate()

  handleApi('logRendererError', (_event, report: RendererErrorReport) => {
    const admitted = gate.admit()
    if (!admitted.ok) return
    if (admitted.dropped > 0) {
      getLog()?.warn(`${admitted.dropped} renderer error report(s) dropped by the rate limit`)
    }
    const kind =
      report?.kind === 'unhandledrejection' || report?.kind === 'boundary' ? report.kind : 'error'
    const location = clip(report?.location, 300)
    const stack = clip(report?.stack, MAX_STACK_CHARS)
    // The file only: the console already has the renderer's own copy.
    getLog()?.error(
      `Renderer ${kind}: ${clip(report?.message, MAX_MESSAGE_CHARS)}${location ? ` (at ${location})` : ''}`,
      stack || undefined
    )
  })

  const copyDiagnostics = () => {
    const config = configStore.get()
    const text = buildDiagnosticsText(
      {
        appVersion: app.getVersion(),
        versions: process.versions,
        os: `${os.version()} (${os.release()})`,
        schemaVersion: LATEST_SCHEMA_VERSION,
        config,
        logLines: getLog()?.tail(200) ?? []
      },
      { userName: os.userInfo().username, secrets: configSecrets(config) }
    )
    copyText(text)
    appLog.info('Diagnostics copied to the clipboard')
  }

  handleApi('copyDiagnostics', copyDiagnostics)
  // Help › Report a problem (P8.1): the diagnostics go to the clipboard, never
  // into the page; the person decides whether to paste them.
  handleApi('reportProblem', async () => {
    copyDiagnostics()
    await openExternalUrl(`${BRAND.issuesUrl}/new`)
  })
  handleApi('getAppVersion', () => app.getVersion())
  // The installer ships the notices beside the app (extraResources); a
  // development run reads the copy `npm run dev` or `npm run build` wrote to out/.
  handleApi('getThirdPartyNotices', () =>
    readFile(
      app.isPackaged
        ? join(process.resourcesPath, 'THIRD_PARTY_NOTICES.md')
        : join(app.getAppPath(), 'out', 'THIRD_PARTY_NOTICES.md'),
      'utf8'
    )
  )
}
