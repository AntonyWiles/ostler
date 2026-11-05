/**
 * Advanced sync on the PC: copies the personal space folder (and the project share folders beside
 * it) to and from a Cloudflare R2 bucket, file for file, so a phone can sync through the bucket
 * while this PC keeps syncing through its folder as before. Nothing about sharing changes: every
 * project this PC has is already in the personal space, so it reaches the phone by itself.
 *
 * Sync files are written once and never changed or deleted, so copying is a set difference each
 * way: files here that the bucket lacks go up, files in the bucket this folder lacks come down.
 * A key in the bucket is the file's path from the folder that holds the space (`Ostler/Personal/…`),
 * below the configured prefix; that is also how the phone names places (`r2:Ostler/…`).
 *
 * Costs (R2's free tier counts operations): the bucket is listed only when its change marker moved
 * (one HEAD per check, at the interval the person chose), on the first run, and on Sync now. What
 * this PC wrote goes up without a listing, against what the last listing showed. The bucket's
 * settings are kept in `r2-sync.json` in the data folder, the secret sealed with Windows'
 * protection; it never goes to the renderer or a log.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { R2SyncState, SetR2SyncInput } from '@shared/ostler-api'
import { t } from '@shared/i18n'
import { FolderTransport, SyncTransportError } from './folder-transport'
import { SharingError } from './sharing'
import {
  checkedR2Config,
  R2Changes,
  R2Client,
  R2Error,
  r2Location,
  R2Transport,
  type R2Config
} from './r2-transport'
import {
  checkedMinutes,
  newSetupPassphrase,
  openR2Setup,
  R2SetupCodeError,
  sealR2Setup,
  DEFAULT_R2_CHECK_MINUTES
} from './r2-setup-code'

export interface R2BridgeDependencies {
  dataDir: string
  seal(secret: string): string
  open(sealed: string): string
  fetch(url: string, init: RequestInit): Promise<Response>
  /** The personal space's folder on this PC; null when there is none or it is not a folder. */
  spaceFolder(): string | null
  /** Every project share's folder on this PC (any kind of place; only folders are copied). */
  shareFolders(): string[]
  /** Something came down from the bucket: the sync service should look at its folders. */
  onDownloaded?(): void
  onStateChanged?(): void
  log(message: string, error?: unknown): void
  now?(): number
}

interface Saved {
  accountId: string
  bucket: string
  prefix: string
  endpoint?: string
  accessKeyId: string
  secretSealed: string
  checkMinutes: number
  uploadSoon: boolean
  enabled: boolean
}

interface Mapped {
  /** The path from the space's parent folder, `/` between segments. */
  rel: string
  local: string
}

const FILE_NAME = 'r2-sync.json'
const UPLOAD_SOON_MS = 30_000
/** File events drive the upload pass; the folder scan behind them only needs to catch what they miss. */
const LOCAL_SCAN_MS = 5 * 60_000

export class R2Bridge {
  private saved: Saved | null
  private client: R2Client | null = null
  private changes: R2Changes | null = null
  private stopChanges: () => void = () => undefined
  private stopLocalWatch: () => void = () => undefined
  private repeat: ReturnType<typeof setInterval> | null = null
  private soonTimer: ReturnType<typeof setTimeout> | null = null
  /** What the last listing (plus this PC's own uploads since) says the bucket holds, by folder. */
  private remote = new Map<string, Set<string>>()
  private queue: Promise<void> = Promise.resolve()
  private running = false
  private lastRunAt: number | null = null
  private lastError: string | null = null
  private lastUploaded = 0
  private lastDownloaded = 0
  private started = false
  /** The bucket as a sync place (`r2:` shares and personal spaces): one client and one change marker. */
  private direct: { client: R2Client; changes: R2Changes } | null = null

  constructor(private readonly deps: R2BridgeDependencies) {
    this.saved = this.load()
  }

  state(): R2SyncState {
    const saved = this.saved
    const mapped = this.mapped()
    return {
      configured: saved !== null,
      enabled: saved?.enabled ?? false,
      accountId: saved?.accountId ?? '',
      bucket: saved?.bucket ?? '',
      prefix: saved?.prefix ?? '',
      endpoint: saved?.endpoint ?? '',
      accessKeyId: saved?.accessKeyId ?? '',
      hasSecret: Boolean(saved?.secretSealed),
      checkMinutes: saved?.checkMinutes ?? DEFAULT_R2_CHECK_MINUTES,
      uploadSoon: saved?.uploadSoon ?? true,
      spaceFolder: this.deps.spaceFolder(),
      skippedFolders: mapped.skipped,
      running: this.running,
      lastRunAt: this.lastRunAt,
      lastError: this.lastError,
      lastUploaded: this.lastUploaded,
      lastDownloaded: this.lastDownloaded
    }
  }

  /** Starts copying when it is on; call once the sync service runs. */
  start(): void {
    this.started = true
    this.restart()
  }

  stop(): void {
    this.started = false
    this.halt()
    this.direct?.changes.stop()
    this.direct = null
  }

  set(input: SetR2SyncInput): R2SyncState {
    const config = this.configFrom(input)
    let secretSealed: string
    try {
      secretSealed = this.deps.seal(config.secretAccessKey)
    } catch {
      throw new Error(t('errors:r2Sync.cannotSeal'))
    }
    this.save({
      accountId: config.accountId,
      bucket: config.bucket,
      prefix: config.prefix,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      accessKeyId: config.accessKeyId,
      secretSealed,
      checkMinutes: checkedMinutes(input.checkMinutes),
      uploadSoon: input.uploadSoon !== false,
      enabled: input.enabled !== false
    })
    return this.state()
  }

  clear(): R2SyncState {
    this.halt()
    this.saved = null
    this.direct?.changes.stop()
    this.direct = null
    fs.rmSync(path.join(this.deps.dataDir, FILE_NAME), { force: true })
    this.lastError = null
    this.lastRunAt = null
    return this.state()
  }

  /** Tries a listing with these settings, or the saved ones. */
  async test(input?: SetR2SyncInput): Promise<void> {
    const config = input ? this.configFrom(input) : this.savedConfig()
    if (!config) throw new Error(t('errors:r2Sync.notSetUp'))
    try {
      await new R2Client(config, { fetch: this.deps.fetch }).test()
    } catch (error) {
      throw new Error(errorText(error))
    }
  }

  /** Copies both ways now, listing the bucket whatever the marker says. */
  async syncNow(): Promise<R2SyncState> {
    if (!this.saved) throw new Error(t('errors:r2Sync.notSetUp'))
    // With the space itself in the bucket there is no folder to copy, only places to look at.
    const copy = !this.direct || this.deps.spaceFolder() !== null
    if (copy && !this.client) this.restart(true)
    await Promise.all([copy ? this.enqueue(true) : null, this.direct?.changes.check(true)])
    return this.state()
  }

  exportSetup(): { code: string; passphrase: string } {
    const config = this.savedConfig()
    if (!config) throw new Error(t('errors:r2Sync.notSetUp'))
    const space = this.deps.spaceFolder()
    const passphrase = newSetupPassphrase()
    const code = sealR2Setup(
      {
        config,
        space: space ? path.basename(space) : 'Ostler',
        checkMinutes: this.saved?.checkMinutes ?? DEFAULT_R2_CHECK_MINUTES
      },
      passphrase
    )
    return { code, passphrase }
  }

  importSetup(code: string, passphrase: string): R2SyncState {
    let setup
    try {
      setup = openR2Setup(String(code ?? ''), String(passphrase ?? ''))
    } catch (error) {
      throw new Error(
        t(
          error instanceof R2SetupCodeError && error.reason === 'wrong-passphrase'
            ? 'errors:r2Sync.wrongPassphrase'
            : 'errors:r2Sync.notACode'
        )
      )
    }
    return this.set({
      ...setup.config,
      checkMinutes: setup.checkMinutes,
      uploadSoon: this.saved?.uploadSoon ?? true,
      enabled: true
    })
  }

  /**
   * Opens an `r2:` place straight in the saved bucket, the way the phone does, whether or not the
   * folder copying is on. Every place shares one `R2Changes`, so watching any of them (shares, the
   * pairing folder) costs one HEAD of the change marker per check, at the chosen interval.
   */
  openPlace(place: string): R2Transport {
    if (!this.direct) {
      const config = this.savedConfig()
      if (!config) throw new SharingError('no-r2-bucket')
      const client = new R2Client(config, { fetch: this.deps.fetch, now: this.deps.now })
      const minutes = this.saved?.checkMinutes ?? DEFAULT_R2_CHECK_MINUTES
      const changes = new R2Changes(client, {
        intervalMs: minutes > 0 ? minutes * 60_000 : null,
        log: (message, error) => this.deps.log(message, error)
      })
      this.direct = { client, changes }
    }
    return new R2Transport(this.direct.client, place, this.direct.changes)
  }

  // ─── Running ────────────────────────────────────────────────────────

  private restart(force = false): void {
    this.halt()
    const config = this.savedConfig()
    if (!this.started || !config || (!this.saved?.enabled && !force)) return
    const client = new R2Client(config, { fetch: this.deps.fetch, now: this.deps.now })
    this.client = client
    this.remote.clear()
    // The bridge drives the checks itself, so they share one timer with the upload pass.
    const changes = new R2Changes(client, {
      intervalMs: null,
      log: (message, error) => this.deps.log(message, error)
    })
    this.changes = changes
    this.stopChanges = changes.subscribe(() => void this.enqueue(true))
    const minutes = this.saved?.checkMinutes ?? DEFAULT_R2_CHECK_MINUTES
    if (minutes > 0) {
      this.repeat = setInterval(() => {
        void this.enqueue(false).then(() => changes.check())
      }, minutes * 60_000)
    }
    if (this.saved?.uploadSoon) {
      const space = this.deps.spaceFolder()
      if (space) {
        try {
          this.stopLocalWatch = new FolderTransport(space, { scanIntervalMs: LOCAL_SCAN_MS }).watch(
            () => this.uploadSoon()
          )
        } catch (error) {
          this.deps.log('Could not watch the personal space folder for R2:', error)
        }
      }
    }
    // The first run lists the bucket, so what other devices wrote while this PC was off comes down.
    void this.enqueue(true).then(() => changes.check())
  }

  private halt(): void {
    this.stopChanges()
    this.stopChanges = () => undefined
    this.stopLocalWatch()
    this.stopLocalWatch = () => undefined
    this.changes?.stop()
    this.changes = null
    this.client = null
    if (this.repeat) clearInterval(this.repeat)
    this.repeat = null
    if (this.soonTimer) clearTimeout(this.soonTimer)
    this.soonTimer = null
  }

  private uploadSoon(): void {
    if (this.soonTimer) return
    this.soonTimer = setTimeout(() => {
      this.soonTimer = null
      void this.enqueue(false)
    }, UPLOAD_SOON_MS)
  }

  private enqueue(listBucket: boolean): Promise<void> {
    this.queue = this.queue.then(() => this.pass(listBucket))
    return this.queue
  }

  /** One copy pass: up always, down when `listBucket` (the bucket is listed for it). */
  private async pass(listBucket: boolean): Promise<void> {
    const client = this.client
    const changes = this.changes
    if (!client) return
    this.running = true
    this.deps.onStateChanged?.()
    let uploaded = 0
    let downloaded = 0
    try {
      const { folders } = this.mapped()
      if (folders.length === 0) throw new Error(t('errors:r2Sync.noSpaceFolder'))
      for (const folder of folders) {
        if (this.client !== client) return
        const local = new FolderTransport(folder.local)
        const bucket = new R2Transport(client, r2Location(folder.rel))
        const here = new Set(await local.list(''))
        let there = this.remote.get(folder.rel)
        if (!there || listBucket) {
          there = new Set(await bucket.list(''))
          this.remote.set(folder.rel, there)
        }
        for (const file of here) {
          if (there.has(file)) continue
          try {
            await bucket.writeOnce(file, await local.read(file))
            uploaded += 1
          } catch (error) {
            if (!(error instanceof SyncTransportError && error.reason === 'exists')) throw error
          }
          there.add(file)
        }
        if (!listBucket) continue
        for (const file of there) {
          if (here.has(file)) continue
          try {
            await local.writeOnce(file, await bucket.read(file))
            downloaded += 1
          } catch (error) {
            if (!(error instanceof SyncTransportError && error.reason === 'exists')) throw error
          }
        }
      }
      if (uploaded > 0) await changes?.mark()
      this.lastError = null
    } catch (error) {
      this.lastError = errorText(error)
      this.deps.log('R2 sync failed:', error instanceof R2Error ? error.reason : error)
    } finally {
      this.running = false
      this.lastRunAt = this.deps.now?.() ?? Date.now()
      if (uploaded > 0 || downloaded > 0 || listBucket) {
        this.lastUploaded = uploaded
        this.lastDownloaded = downloaded
      }
      if (downloaded > 0) this.deps.onDownloaded?.()
      this.deps.onStateChanged?.()
    }
  }

  /** The space folder and the share folders below its parent, by their path from that parent. */
  private mapped(): { folders: Mapped[]; skipped: number } {
    const space = this.deps.spaceFolder()
    if (!space) return { folders: [], skipped: 0 }
    const root = path.dirname(path.resolve(space))
    const folders: Mapped[] = [{ rel: path.basename(space), local: path.resolve(space) }]
    let skipped = 0
    for (const share of this.deps.shareFolders()) {
      if (!path.isAbsolute(share)) continue // A Drive or server place: not a folder here.
      const full = path.resolve(share)
      const rel = path.relative(root, full)
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
        skipped += 1
        continue
      }
      const inSpace = path.relative(path.resolve(space), full)
      if (inSpace === '' || (!inSpace.startsWith('..') && !path.isAbsolute(inSpace))) continue
      const segments = rel.split(path.sep)
      if (segments.some((part) => part === '' || part.includes(':'))) {
        skipped += 1
        continue
      }
      folders.push({ rel: segments.join('/'), local: full })
    }
    return { folders, skipped }
  }

  private configFrom(input: SetR2SyncInput): R2Config {
    const secret =
      typeof input?.secretAccessKey === 'string' && input.secretAccessKey.trim()
        ? input.secretAccessKey
        : (this.savedConfig()?.secretAccessKey ?? '')
    try {
      return checkedR2Config({ ...input, secretAccessKey: secret })
    } catch {
      throw new Error(t('errors:r2Sync.badConfig'))
    }
  }

  private savedConfig(): R2Config | null {
    const saved = this.saved
    if (!saved) return null
    try {
      return checkedR2Config({ ...saved, secretAccessKey: this.deps.open(saved.secretSealed) })
    } catch {
      return null
    }
  }

  private save(saved: Saved): void {
    this.saved = saved
    // `r2:` places opened before keep the old bucket until the sync service opens them again.
    this.direct?.changes.stop()
    this.direct = null
    const file = path.join(this.deps.dataDir, FILE_NAME)
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(saved, null, 2), { mode: 0o600 })
    fs.renameSync(`${file}.tmp`, file)
    this.lastError = null
    this.restart()
  }

  private load(): Saved | null {
    try {
      const parsed = JSON.parse(
        fs.readFileSync(path.join(this.deps.dataDir, FILE_NAME), 'utf8')
      ) as Partial<Saved>
      if (typeof parsed.secretSealed !== 'string' || typeof parsed.bucket !== 'string') return null
      return {
        accountId: String(parsed.accountId ?? ''),
        bucket: parsed.bucket,
        prefix: String(parsed.prefix ?? ''),
        ...(parsed.endpoint ? { endpoint: String(parsed.endpoint) } : {}),
        accessKeyId: String(parsed.accessKeyId ?? ''),
        secretSealed: parsed.secretSealed,
        checkMinutes: checkedMinutes(parsed.checkMinutes),
        uploadSoon: parsed.uploadSoon !== false,
        enabled: parsed.enabled !== false
      }
    } catch {
      return null
    }
  }
}

/** What went wrong, in the person's words. */
function errorText(error: unknown): string {
  if (error instanceof R2Error) return t(`errors:r2Sync.call.${error.reason}`)
  if (error instanceof Error && error.message) return error.message
  return t('errors:r2Sync.call.unreachable')
}
