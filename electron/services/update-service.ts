import type {
  InboxItem,
  RestartToUpdateMode,
  UpdateSettings,
  UpdateState,
  UpdatesOffReason
} from '@shared/ostler-api'
import { t } from '@shared/i18n'

/**
 * The parts of electron-updater's `autoUpdater` Ostler uses. Tests pass a fake;
 * main passes the real one, loaded only when updates can run, so development
 * and portable builds never load electron-updater at all.
 */
export interface Updater {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowPrerelease: boolean
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
  // electron-updater types each event's listener; one signature covers them all here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, listener: (...args: any[]) => void): unknown
}

/** What electron-updater says about a release (`UpdateInfo`, the parts used here). */
interface ReleaseInfo {
  version: string
  releaseNotes?: string | { version: string; note: string | null }[] | null
}

export interface UpdateServiceDependencies {
  /** Why updates never run in this copy, or null in an installed build. */
  offReason: UpdatesOffReason | null
  /** Loads the updater; called once, and never when `offReason` is set. */
  loadUpdater(): Updater
  settings(): UpdateSettings
  /** How many agents are working now (a restart would stop them). */
  agentsRunning(): number
  /** Called after quitting is under way, just before the installer takes over. */
  beforeInstall(): void
  /** The state changed: the renderer and the Inbox hear about it. */
  onChange(state: UpdateState): void
  log(message: string, error?: unknown): void
  now?: () => number
  /** How often a deferred restart looks again for running agents. */
  agentPollMs?: number
}

/**
 * Whether this copy may update itself (P10.1): never a development run, and
 * never the portable exe, which electron-builder starts with
 * `PORTABLE_EXECUTABLE_DIR` set and which has no installer to update with.
 * An unpacked `--dir` build has no `app-update.yml` to say where updates come
 * from, so it counts as development.
 */
export function updatesOffReason(
  env: NodeJS.ProcessEnv,
  packaged: boolean,
  hasUpdateFeed = true
): UpdatesOffReason | null {
  if (!packaged) return 'development'
  if (env.PORTABLE_EXECUTABLE_DIR) return 'portable'
  if (!hasUpdateFeed) return 'development'
  return null
}

/** An update failure in plain words. The raw error goes to main.log. */
export function updateErrorMessage(error: unknown): string {
  const text = error instanceof Error ? `${error.message} ${String(error.stack)}` : String(error)
  if (
    /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|net::ERR_|socket hang up/i.test(text)
  ) {
    return t('errors:updateService.couldntReachUpdateServer')
  }
  if (/sha512 checksum mismatch|checksum|blockmap/i.test(text)) {
    return t('errors:updateService.downloadedUpdateWasDamaged')
  }
  if (/\b404\b|latest\.yml|No published versions|Unable to find latest version/i.test(text)) {
    return t('errors:updateService.noUpdateInformationWas')
  }
  if (/\b403\b|rate limit/i.test(text)) {
    return t('errors:updateService.updateServerBusyTry')
  }
  if (/ENOSPC|disk full/i.test(text)) {
    return t('errors:updateService.thereNotEnoughDisk')
  }
  return t('errors:updateService.couldntUpdateTryAgain')
}

/**
 * Release notes as plain text. The GitHub provider hands over the release
 * body as HTML; a generic feed may give a list of notes per version.
 */
export function releaseNotesText(notes: ReleaseInfo['releaseNotes']): string {
  if (!notes) return ''
  const raw = Array.isArray(notes)
    ? notes.map((entry) => entry.note ?? '').join('\n\n')
    : String(notes)
  return raw
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<\/(p|li|h[1-6]|ul|ol|div)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const AGENT_POLL_MS = 30_000

/**
 * Updates (P10.1, roadmap D13): electron-updater against GitHub Releases.
 * Checks at start-up when the person allows it and whenever they ask,
 * downloads in the background when allowed, and never restarts on its own:
 * the person chooses "Restart now" or "Restart when agents finish".
 *
 * Unsigned builds (D14) update too. Nothing here checks a publisher name;
 * what protects an update is HTTPS to GitHub and the sha512 in `latest.yml`,
 * which electron-updater checks before it runs the installer.
 */
export class UpdateService {
  private updater: Updater | null = null
  private current: UpdateState
  private waitTimer: ReturnType<typeof setInterval> | null = null
  /** When the download finished: the Inbox item's time. */
  private readyAt = 0
  private lastError: unknown = null
  private readonly now: () => number

  constructor(private readonly deps: UpdateServiceDependencies) {
    this.now = deps.now ?? Date.now
    this.current = deps.offReason ? { status: 'off', reason: deps.offReason } : { status: 'idle' }
  }

  state(): UpdateState {
    if (this.current.status === 'ready') {
      return { ...this.current, agentsRunning: this.deps.agentsRunning() }
    }
    return this.current
  }

  /** At start-up: a check, when the person allows automatic checks. */
  start(): void {
    if (this.deps.offReason || !this.deps.settings().checkAutomatically) return
    void this.check()
  }

  /** "Check for updates". Resolves with the state once the check has answered. */
  async check(): Promise<UpdateState> {
    const updater = this.ensureUpdater()
    if (!updater) return this.state()
    if (['checking', 'downloading', 'ready'].includes(this.current.status)) return this.state()
    this.set({ status: 'checking' })
    try {
      await updater.checkForUpdates()
    } catch (error) {
      this.fail(error)
    }
    return this.state()
  }

  /** "Download" when automatic downloads are off. */
  async download(): Promise<UpdateState> {
    const updater = this.ensureUpdater()
    if (!updater || this.current.status !== 'available') return this.state()
    const { version, notes } = this.current
    this.set({ status: 'downloading', version, notes, percent: 0 })
    try {
      await updater.downloadUpdate()
    } catch (error) {
      this.fail(error)
    }
    return this.state()
  }

  /**
   * Restarts into the downloaded update: now, or once no agent is working.
   * Only ever called because the person chose it.
   */
  restart(mode: RestartToUpdateMode): UpdateState {
    if (this.current.status !== 'ready')
      throw new Error(t('errors:updateService.noUpdateReadyInstall'))
    if (mode === 'now' || this.deps.agentsRunning() === 0) {
      this.install()
      return this.state()
    }
    this.set({ ...this.current, restartWhenAgentsFinish: true })
    this.waitTimer ??= setInterval(() => {
      if (this.deps.agentsRunning() === 0) this.install()
    }, this.deps.agentPollMs ?? AGENT_POLL_MS)
    return this.state()
  }

  /** Settings › About changed: the beta channel and automatic downloads apply at once. */
  settingsChanged(): void {
    if (!this.updater) return
    const settings = this.deps.settings()
    this.updater.allowPrerelease = settings.receiveBeta
    this.updater.autoDownload = settings.downloadAutomatically
  }

  /** The Inbox's update source: one item while an update waits for a restart. */
  inboxItem(): InboxItem | null {
    if (this.current.status !== 'ready') return null
    return {
      key: `update:${this.current.version}`,
      kind: 'update',
      title: t('errors:updateService.updateReadyRestartUpdate'),
      body: t('errors:updateService.downloadedInstallsWhenRestart', {
        version: this.current.version
      }),
      projectId: null,
      taskId: null,
      createdAt: this.readyAt
    }
  }

  stop(): void {
    if (this.waitTimer) clearInterval(this.waitTimer)
    this.waitTimer = null
  }

  private ensureUpdater(): Updater | null {
    if (this.deps.offReason) return null
    if (this.updater) return this.updater
    const updater = this.deps.loadUpdater()
    const settings = this.deps.settings()
    updater.autoDownload = settings.downloadAutomatically
    updater.allowPrerelease = settings.receiveBeta
    // A restart happens only when the person chooses it, so quitting Ostler
    // does not install either; the download waits for "Restart to update".
    updater.autoInstallOnAppQuit = false
    updater.on('update-available', (info: ReleaseInfo) => {
      const notes = releaseNotesText(info.releaseNotes)
      this.set(
        updater.autoDownload
          ? { status: 'downloading', version: info.version, notes, percent: 0 }
          : { status: 'available', version: info.version, notes }
      )
    })
    updater.on('update-not-available', () => {
      this.set({ status: 'up-to-date', checkedAt: this.now() })
    })
    updater.on('download-progress', (progress: { percent: number }) => {
      if (this.current.status !== 'downloading') return
      this.set({ ...this.current, percent: Math.max(0, Math.min(100, progress.percent)) })
    })
    updater.on('update-downloaded', (info: ReleaseInfo) => {
      const notes = releaseNotesText(info.releaseNotes)
      this.readyAt = this.now()
      this.set({
        status: 'ready',
        version: info.version,
        notes: notes || ('notes' in this.current ? this.current.notes : ''),
        agentsRunning: this.deps.agentsRunning(),
        restartWhenAgentsFinish: false
      })
    })
    updater.on('error', (error: Error) => this.fail(error))
    this.updater = updater
    return updater
  }

  private install(): void {
    this.stop()
    this.deps.beforeInstall()
    // Silent, because the person already said yes; run Ostler again afterwards.
    this.updater?.quitAndInstall(true, true)
  }

  private fail(error: unknown): void {
    // electron-updater both emits 'error' and rejects with the same error.
    if (error === this.lastError) return
    this.lastError = error
    // The first line only: an HTTP error's message carries every response header.
    const detail = error instanceof Error ? error.message.split(/\r?\n/)[0] : String(error)
    this.deps.log(t('errors:updateService.updatingFailed', { detail }))
    // A failed check after a finished download keeps the download.
    if (this.current.status === 'ready') return
    this.set({ status: 'error', message: updateErrorMessage(error) })
  }

  private set(state: UpdateState): void {
    this.current = state
    try {
      this.deps.onChange(this.state())
    } catch (error) {
      this.deps.log('Update listener failed', error)
    }
  }
}
