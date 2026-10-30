/**
 * The phone's sync loop: joins a shared project from an invite and keeps it in step with the
 * other devices through Google Drive. Plain TypeScript with injected dependencies, no React Native
 * imports, so the desktop's Vitest can run it against a better-sqlite3 database and a fake Drive
 * (`tests/unit/mobile-phone-sync.test.ts`).
 *
 * It does what `SyncService` does for a project share, using only the engine's core files: `join`
 * is `SyncService.join`, a pull is the project half of `SyncService.pullStep`, a push is the project
 * half of `pushStep`. What it leaves out on purpose: library files (no file store on the phone yet),
 * snapshots (the PCs write them) and background sync. Once the phone is paired (phone-pairing.ts) it
 * also runs the personal share, which only reads: the projects the person's other devices list there
 * are joined here (the "every project arrives" half of `SyncService`).
 *
 * The database cannot register SQL functions on the phone, so capture runs in its table mode
 * (`attachSyncCapture(db, { answers: 'tables' })`, capture.ts).
 */
import { retryWaiting } from '../../../electron/services/sync/apply'
import { attachSyncCapture, releaseSyncCapture } from '../../../electron/services/sync/capture'
import type { DriveFile } from '../../../electron/services/sync/drive-client'
import { isDriveLocation } from '../../../electron/services/sync/drive-transport'
import type { SyncTransport } from '../../../electron/services/sync/folder-transport'
import { refreshLeft } from '../../../electron/services/sync/leaving'
import { pullRecords, pushRecords } from '../../../electron/services/sync/records'
import { refreshRoles } from '../../../electron/services/sync/roles'
import { inviteShareId, readShareEntries } from '../../../electron/services/sync/pairing'
import { refreshKeys } from '../../../electron/services/sync/rotation'
import {
  joinShare,
  parseInvite,
  refreshMembers,
  SharingError,
  type JoinResult
} from '../../../electron/services/sync/sharing'
import { PERSONAL_PROJECT_ID } from '../../../electron/services/sync/synced-tables'
import {
  identityKeys,
  keyGenerationOf,
  projectKeyFor,
  projectKeyring
} from '../../../electron/services/sync/sync-keys'
import { pullChanges, pushChanges } from '../../../electron/services/sync/sync-runner'
import { drivePlaceFor, myDriveFolder } from './my-drive-path'

/** The database the engine's core files take (the phone passes its adapter, cast to this). */
export type SyncDatabase = Parameters<typeof attachSyncCapture>[0]

/** How long after a local write the push goes out, so a burst of edits leaves as one change file. */
export const PUSH_DEBOUNCE_MS = 2000

export type PhoneSyncStatus = 'catching-up' | 'up-to-date' | 'problems' | 'cannot-reach-drive'

export interface PhoneSyncOptions {
  db: SyncDatabase
  /** Opens a Drive place (`gdrive:<folderId>/…`) as a transport on the phone's one Drive client and poller. */
  openTransport(place: string): SyncTransport
  /**
   * Finds a folder in the root of My Drive, so an invite from a PC that shares through Drive for
   * desktop (a `…\My Drive\…` path) can be joined at the same folder in Drive (my-drive-path.ts).
   */
  findInRoot?(name: string): Promise<DriveFile[]>
  /** The account's one poller; `kick()` asks Drive what changed right after a push. */
  poller: { kick(): void }
  now(): number
  /** This phone's name as the other members see it. */
  deviceName: string
  log(message: string, error?: unknown): void
  /** Called after a pull brought changes in, or a share's status changed. */
  onChanged?(projectId: string): void
  /** Called after this phone joined a project, by invite or from the personal share's list. */
  onJoined?(result: JoinResult): void
  setTimer?(fn: () => void, ms: number): unknown
  clearTimer?(handle: unknown): void
}

/** An invite the phone cannot use. */
export class PhoneJoinError extends Error {
  constructor(readonly reason: 'not-a-drive-invite') {
    super(`Join refused: ${reason}`)
    this.name = 'PhoneJoinError'
  }
}

/** The `mobile:` translation key that explains why a join failed. */
export function joinErrorKey(error: unknown): string {
  if (error instanceof PhoneJoinError) return 'mobile:join.errors.notDriveInvite'
  if (error instanceof SharingError) {
    switch (error.reason) {
      case 'not-an-invite':
        return 'mobile:join.errors.notAnInvite'
      case 'already-shared':
        return 'mobile:join.errors.alreadyShared'
      case 'wrong-folder':
      case 'not-a-share-folder':
        return 'mobile:join.errors.wrongFolder'
      case 'old-invite':
        return 'mobile:join.errors.oldInvite'
      case 'no-snapshot':
        return 'mobile:join.errors.noSnapshot'
      case 'invite-does-not-fit':
        return 'mobile:join.errors.doesNotFit'
      case 'no-drive-account':
        return 'mobile:join.errors.noDriveAccount'
      default:
        return 'mobile:join.errors.failed'
    }
  }
  return 'mobile:join.errors.failed'
}

export interface SharedProject {
  projectId: string
  shareId: string
  place: string
  status: PhoneSyncStatus
  lastSyncedAt: number | null
  /** Tasks of the project in this phone's database. */
  taskCount: number
}

interface ShareRow {
  project_id: string
  share_id: string
  folder: string
  last_synced_at: number | null
}

interface Running {
  projectId: string
  shareId: string
  place: string
  transport: SyncTransport
  status: PhoneSyncStatus
  /** One step at a time. */
  queue: Promise<void>
  stopWatch: () => void
  /** Another member removed this phone: it stops sending. */
  removed: boolean
  /** The personal share: read only, and it joins the projects its entries list. */
  personal: boolean
}

/** Tasks of a project in `db`. */
export function countTasks(db: SyncDatabase, projectId: string): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM planning_work_items WHERE project_id = ?')
    .get(projectId) as { n: number }
  return row.n
}

export class PhoneSync {
  private readonly db: SyncDatabase
  private readonly running = new Map<string, Running>()
  private started = false
  private pushTimer: unknown = null

  constructor(private readonly options: PhoneSyncOptions) {
    this.db = options.db
    attachSyncCapture(this.db, { answers: 'tables' })
  }

  /** The project shares this phone has joined (from `sync_shares`), with their state. */
  shares(): SharedProject[] {
    return this.shareRows().map((share) => ({
      projectId: share.project_id,
      shareId: share.share_id,
      place: share.folder,
      status: this.running.get(share.project_id)?.status ?? 'catching-up',
      lastSyncedAt: share.last_synced_at,
      taskCount: countTasks(this.db, share.project_id)
    }))
  }

  /**
   * Joins the share an invite is for. Only a Drive place can work on a phone: a folder inside My Drive
   * (Drive for desktop) is joined at the same folder in Drive, and any other folder or a sync server is refused with a `PhoneJoinError`. Other failures are the engine's `SharingError`.
   */
  async join(inviteText: string, placeHint?: string): Promise<JoinResult> {
    const invite = parseInvite(inviteText)
    const written = invite.location ?? placeHint
    const findInRoot = this.options.findInRoot
    const place =
      written === undefined
        ? null
        : findInRoot
          ? await drivePlaceFor(written, findInRoot)
          : isDriveLocation(written)
            ? written
            : null
    if (place === null) {
      throw new PhoneJoinError('not-a-drive-invite')
    }
    const transport = this.options.openTransport(place)
    const result = await joinShare(this.db, transport, inviteText, {
      folder: place,
      memberName: this.options.deviceName,
      me: this.paired() ? this.meOf() : null
    })
    const share = this.shareRows().find((row) => row.project_id === result.projectId)
    if (share) this.open(share, transport)
    this.options.onJoined?.(result)
    this.options.onChanged?.(result.projectId)
    return result
  }

  /** Whether this phone has joined the person's personal share (phone-pairing.ts). */
  paired(): boolean {
    return this.personalRow() !== null
  }

  /** Runs the personal share now (call right after pairing finished); a no-op until the loop is started. */
  startPersonal(): void {
    const personal = this.personalRow()
    if (personal) this.open(personal)
  }

  /** Pushes this phone's changes, then reads everyone else's, for one project; resolves when both are done. */
  async syncNow(projectId: string): Promise<void> {
    const running = this.running.get(projectId)
    if (!running) return
    void this.enqueue(running, () => this.pushStep(running))
    await this.enqueue(running, () => this.pullStep(running))
  }

  /** Opens every joined share: watches its Drive folder and reads what is new. Call when the app comes to the foreground. */
  start(): void {
    this.started = true
    for (const share of this.shareRows()) this.open(share)
    this.startPersonal()
  }

  /** Stops watching and waits for the step in hand. Call when the app goes to the background. */
  async stop(): Promise<void> {
    this.started = false
    if (this.pushTimer !== null) this.clear(this.pushTimer)
    this.pushTimer = null
    const pending = [...this.running.values()].map((running) => {
      running.stopWatch()
      return running.queue
    })
    this.running.clear()
    await Promise.allSettled(pending)
  }

  /** Stops syncing and lets go of the database's capture state; call before closing the database. */
  async dispose(): Promise<void> {
    await this.stop()
    releaseSyncCapture(this.db)
  }

  /**
   * Something wrote to a shared project on this phone. The push goes out about 2 s later (a burst of
   * edits is one change file), and then the poller is asked to check Drive.
   */
  noteLocalWrite(): void {
    if (!this.started) return
    if (this.pushTimer !== null) this.clear(this.pushTimer)
    this.pushTimer = this.timer(() => {
      this.pushTimer = null
      this.pushAll()
    }, PUSH_DEBOUNCE_MS)
  }

  // ─── Running shares ─────────────────────────────────────────────────────

  private open(share: ShareRow, transport?: SyncTransport): void {
    if (!this.started || this.running.has(share.project_id)) return
    const opened = transport ?? this.options.openTransport(share.folder)
    const running: Running = {
      projectId: share.project_id,
      shareId: share.share_id,
      place: share.folder,
      transport: opened,
      status: 'catching-up',
      queue: Promise.resolve(),
      stopWatch: () => undefined,
      removed: false,
      personal: share.project_id === PERSONAL_PROJECT_ID
    }
    this.running.set(share.project_id, running)
    try {
      running.stopWatch = opened.watch(() => {
        void this.enqueue(running, () => this.pullStep(running))
      })
    } catch (error) {
      this.setStatus(running, 'cannot-reach-drive')
      this.options.log('Could not watch a shared Drive folder:', error)
    }
    // What this phone wrote while it was closed goes out, and what others wrote comes in.
    void this.enqueue(running, () => this.pushStep(running))
    void this.enqueue(running, () => this.pullStep(running))
  }

  private pushAll(): void {
    for (const running of this.running.values()) {
      void this.enqueue(running, () => this.pushStep(running))
    }
  }

  private enqueue(running: Running, step: () => Promise<void>): Promise<void> {
    running.queue = running.queue.then(async () => {
      if (this.running.get(running.projectId) !== running) return
      try {
        await step()
      } catch (error) {
        this.setStatus(running, 'cannot-reach-drive')
        this.options.log('Shared project sync failed:', error)
      }
    })
    return running.queue
  }

  private setStatus(running: Running, status: PhoneSyncStatus): void {
    if (running.status === status) return
    running.status = status
    this.options.onChanged?.(running.projectId)
  }

  private keysFor(
    projectId: string
  ): { projectKey: Buffer; keyGeneration: number; privateKey: string } | null {
    const projectKey = projectKeyFor(this.db, projectId)
    if (!projectKey) return null
    return {
      projectKey,
      keyGeneration: keyGenerationOf(this.db, projectId),
      privateKey: identityKeys(this.db).privateKey
    }
  }

  /** The project half of `SyncService.pushStep`, without library files and snapshots. */
  private async pushStep(running: Running): Promise<void> {
    const keys = this.keysFor(running.projectId)
    if (!keys || running.removed || running.personal) return
    // People and settings first, so the changes that name them find them.
    await pushRecords(this.db, running.transport, running.projectId, keys, null)
    let pushed = 0
    for (;;) {
      const result = await pushChanges(this.db, running.transport, running.projectId, keys)
      pushed += result.written
      if (result.written === 0) break
    }
    if (pushed > 0) this.options.poller.kick()
  }

  /** The project half of `SyncService.pullStep`, without library files. */
  private async pullStep(running: Running): Promise<void> {
    if (!this.keysFor(running.projectId)) return
    this.setStatus(running, 'catching-up')
    // Key changes first: they can bring a new key and members from before them.
    const keyChanges = await refreshKeys(this.db, running.transport, running.projectId)
    if (keyChanges.removed) {
      running.removed = true
      this.setStatus(running, 'problems')
      return
    }
    const keys = { projectKey: projectKeyring(this.db, running.projectId) }
    const members = await refreshMembers(
      this.db,
      running.transport,
      running.shareId,
      keys.projectKey
    )
    if (running.personal) {
      await this.followEntries(running)
      this.setStatus(running, members.problems.length > 0 ? 'problems' : 'up-to-date')
      return
    }
    // Roles after members (they name the signers) and before changes (they decide what a change may do).
    const roles = await refreshRoles(this.db, running.transport, running.shareId, keys.projectKey)
    const left = await refreshLeft(this.db, running.transport, running.shareId, keys.projectKey)
    const records = await pullRecords(this.db, running.transport, running.projectId, keys)
    if (records.people > 0) retryWaiting(this.db, running.shareId)
    const pulled = await pullChanges(this.db, running.transport, running.projectId, keys)
    const problems =
      keyChanges.problems.length +
      members.problems.length +
      left.problems.length +
      roles.problems.length +
      records.problems.length +
      pulled.problems.length
    this.setStatus(running, problems > 0 ? 'problems' : 'up-to-date')
    if (pulled.files > 0 || records.people > 0 || records.project) {
      this.options.onChanged?.(running.projectId)
    }
  }

  /**
   * Reads the personal share's entries and joins each project this phone does not have yet. An entry
   * whose folder is not readable yet is tried again on the next pull. Projects the person removed on
   * another device are not left here (leaving from the phone is not built yet).
   */
  private async followEntries(running: Running): Promise<void> {
    const { entries, problems } = await readShareEntries(this.db, running.transport)
    for (const problem of problems) {
      this.options.log(`A shared project entry could not be read: ${problem.reason}`)
    }
    for (const entry of entries) {
      if (entry.removed || !inviteShareId(entry.invite)) continue
      if (this.shareRows().some((row) => row.project_id === entry.projectId)) continue
      try {
        await this.join(entry.invite, (await this.entryPlace(entry)) ?? undefined)
      } catch (error) {
        // Not an error the person can act on: the project may still be arriving in Drive.
        this.options.log('A project from the personal space could not be joined yet:', error)
      }
    }
  }

  /**
   * Where an entry's project is: its sync server or Drive address, else its folder relative to the
   * root that holds the personal space, which on a phone is My Drive (the PC's `findEntryFolder`).
   */
  private async entryPlace(entry: {
    location: string | null
    folderRelativeToRoot: string | null
  }): Promise<string | null> {
    if (entry.location) return entry.location
    const findInRoot = this.options.findInRoot
    if (!entry.folderRelativeToRoot || !findInRoot) return null
    const segments = entry.folderRelativeToRoot.split('/').filter((part) => part !== '')
    return myDriveFolder(segments, findInRoot)
  }

  /** The Me person of this phone's database (set when pairing adopted the person's Me). */
  private meOf(): { personId: string; name: string; initials: string; color: string } | null {
    const row = this.db
      .prepare('SELECT id AS personId, name, initials, color FROM people WHERE is_me = 1')
      .get() as { personId: string; name: string; initials: string; color: string } | undefined
    return row ?? null
  }

  private personalRow(): ShareRow | null {
    return (
      (this.db
        .prepare(
          "SELECT project_id, share_id, folder, last_synced_at FROM sync_shares WHERE kind = 'personal'"
        )
        .get() as ShareRow | undefined) ?? null
    )
  }

  private shareRows(): ShareRow[] {
    return this.db
      .prepare(
        "SELECT project_id, share_id, folder, last_synced_at FROM sync_shares WHERE kind = 'project'"
      )
      .all() as ShareRow[]
  }

  private timer(fn: () => void, ms: number): unknown {
    return (this.options.setTimer ?? ((f, m) => setTimeout(f, m)))(fn, ms)
  }

  private clear(handle: unknown): void {
    if (this.options.clearTimer) this.options.clearTimer(handle)
    else clearTimeout(handle as ReturnType<typeof setTimeout>)
  }
}
