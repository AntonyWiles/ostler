/**
 * A small world for sharing simulations: PCs, each with its own database and its own
 * copy of a synced folder, and a stand-in for the sync app that copies files between
 * those copies the way Google Drive, OneDrive or Dropbox does: late, in any order, half
 * a file at a time, with "conflicted copy" files, and not at all while a PC is offline.
 * A network share is the simple case: every PC uses one folder.
 *
 * Each PC runs the real SyncService over the real folder transport, with a real config
 * store for the project's own settings, wired as the app wires them (electron/app/services.ts);
 * only the sync app is pretend. Tests drive time by hand: nothing syncs until they say so.
 */
import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { attachChangeRecorder } from '../../electron/services/change-history/recorder'
import { ConfigStore } from '../../electron/config-store'
import { registerJoinedProject } from '../../electron/services/sync/joined-project'
import {
  receivedProjectUpdate,
  sharedProjectSettings
} from '../../electron/services/sync/shared-project-settings'
import { FolderTransport, isHiddenOrTemp } from '../../electron/services/sync/folder-transport'
import type { SyncTransport } from '../../electron/services/sync/folder-transport'
import type { LibraryFileStore } from '../../electron/services/sync/library-files'
import {
  isServerLocation,
  SharingError,
  type JoinResult,
  type MePerson
} from '../../electron/services/sync/sharing'
import { SyncService } from '../../electron/services/sync/sync-service'
import { createMigratedDatabase } from './database'

export const PROJECT = 'garden-project'
export const SETTINGS = { name: 'Garden', color: '#336699', notes: '', tags: [] }

const noLibrary: LibraryFileStore = {
  syncedOriginal: () => null,
  receiveSyncedOriginal: async () => undefined
}

/** One simulated PC: the sync service, a connection like the planning service's, and what it was told. */
export interface SimPc {
  name: string
  service: SyncService
  db: Database.Database
  /** Errors the service logged; a healthy run logs none. */
  errors: string[]
  /** Sign-offs asked of this PC's Me by other PCs, and answers to ones Me asked for (prompt 17). */
  signOffRequested: { signOffId: string; state: string }[]
  signOffAnswered: { signOffId: string; state: string }[]
  /** Where this PC's copy of the synced files is (its "My Drive", or the network share). */
  root: string
  me: MePerson
  /** This PC's config store: the project's name, colour, icon and so on, as the app keeps them. */
  store: ConfigStore
  /** Shares the project from this PC (registered here first, as the app has it). */
  share(folder: string): Promise<void>
  /** Joins with an invite and lists the project here, as the Join step does. */
  join(invite: string, folder: string): Promise<JoinResult>
}

export interface WorldOptions {
  /** Lets a server share be opened (sync server simulations). */
  openServer?: (location: string) => SyncTransport
}

/** Files under a folder, relative with `/`, the hidden and temporary ones left out (as the sync app ignores them). */
export function filesUnder(root: string): string[] {
  const out: string[] = []
  const walk = (folder: string, prefix: string) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(folder, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (isHiddenOrTemp(entry.name)) continue
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(path.join(folder, entry.name), relative)
      else if (entry.isFile()) out.push(relative)
    }
  }
  walk(root, '')
  return out.sort()
}

/** The real folder transport, without its watcher. */
export function quietFolder(folder: string): SyncTransport {
  const transport = new FolderTransport(folder)
  transport.watch = () => () => undefined
  return transport
}

export class SimWorld {
  readonly dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-sharing-sim-'))
  readonly pcs: SimPc[] = []

  constructor(private readonly options: WorldOptions = {}) {}

  /** A new PC. `root` is its synced folder; leave it out for a private one (a Drive copy). */
  async pc(name: string, root = path.join(this.dir, `${name}-drive`)): Promise<SimPc> {
    fs.mkdirSync(root, { recursive: true })
    const databasePath = await createMigratedDatabase(
      fs.mkdtempSync(path.join(this.dir, `${name}-db-`))
    )
    const errors: string[] = []
    const signOffRequested: SimPc['signOffRequested'] = []
    const signOffAnswered: SimPc['signOffAnswered'] = []
    const me: MePerson = {
      personId: `person-${name.toLowerCase()}`,
      name,
      initials: name[0],
      color: '#336699'
    }
    const store = new ConfigStore(path.join(this.dir, `${name}-config.json`))
    const projectOf = (projectId: string) =>
      store.getProjects().find((project) => project.id === projectId)
    const service = new SyncService({
      databasePath,
      library: noLibrary,
      projectSettings: (projectId) => {
        const project = projectOf(projectId)
        return project ? sharedProjectSettings(project) : null
      },
      applyProjectSettings: (projectId, settings) => {
        if (!projectOf(projectId)) return
        const shared = receivedProjectUpdate(settings)
        try {
          store.updateProject(
            projectId,
            { ...shared, ...(settings.taskPrefix ? { taskPrefix: settings.taskPrefix } : {}) },
            { received: true }
          )
        } catch {
          store.updateProject(projectId, shared, { received: true })
        }
      },
      onProjectChanged: () => undefined,
      onStateChanged: () => undefined,
      onSignOffRequested: (event) => signOffRequested.push(event),
      onSignOffAnswered: (event) => signOffAnswered.push(event),
      memberName: () => name,
      me: () => me,
      logError: (message, error) => errors.push(`${message}: ${String(error)}`),
      openServer: this.options.openServer,
      // No file watching: a pull starts only when the test says, never halfway through a check.
      openTransport: (folder) => {
        if (!isServerLocation(folder)) return quietFolder(folder)
        if (!this.options.openServer) throw new SharingError('no-sync-server')
        return this.options.openServer(folder)
      },
      pushCheckMs: 3_600_000,
      scanIntervalMs: 3_600_000
    })
    const db = new Database(databasePath)
    attachChangeRecorder(db)
    db.prepare(
      `INSERT INTO people (id, name, initials, color, is_me, archived_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, NULL, 1, 1)`
    ).run(me.personId, me.name, me.initials, me.color)
    store.isViewerOf = (projectId) => service.myRole(projectId) === 'viewer'
    service.start()
    const pc: SimPc = {
      name,
      service,
      db,
      errors,
      signOffRequested,
      signOffAnswered,
      root,
      me,
      store,
      share: async (folder) => {
        if (!projectOf(PROJECT)) {
          store.registerProject({ id: PROJECT, folder: null, ...SETTINGS })
        }
        await service.share(PROJECT, folder)
      },
      join: async (invite, folder) => {
        const joined = await service.join(invite, folder)
        registerJoinedProject(store, joined, SETTINGS.name)
        return joined
      }
    }
    this.pcs.push(pc)
    return pc
  }

  async close(): Promise<void> {
    for (const pc of this.pcs) {
      await pc.service.stop()
      pc.db.close()
    }
    fs.rmSync(this.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

export interface DeliverOptions {
  /** Only files this says yes to move this time (the rest wait for a later sync). */
  only?: (file: string) => boolean
  /** The order files land in: as listed, newest name first, or shuffled with a seed. */
  order?: 'listed' | 'reverse' | { seed: number }
  /** At most this many files move this time. */
  limit?: number
  /** Files that land only half written this time; the next sync finishes them. */
  partial?: (file: string) => boolean
}

/**
 * The sync app (Google Drive, OneDrive, Dropbox) in pretend: a cloud copy, and each PC's
 * copy of it. `sync(pc)` uploads what is new on that PC, then downloads what is new in
 * the cloud. An offline PC does neither.
 */
export class SimDrive {
  readonly cloud: string
  private readonly offline = new Set<string>()
  /** Files a PC has half of: finished on its next sync. */
  private readonly halfDone = new Map<string, Set<string>>()

  constructor(world: SimWorld, name = 'cloud') {
    this.cloud = path.join(world.dir, name)
    fs.mkdirSync(this.cloud, { recursive: true })
  }

  setOffline(pc: SimPc, offline: boolean): void {
    if (offline) this.offline.add(pc.name)
    else this.offline.delete(pc.name)
  }

  /** Uploads this PC's new files, then downloads the cloud's. */
  sync(pc: SimPc, options: DeliverOptions = {}): void {
    if (this.offline.has(pc.name)) return
    this.copyNew(pc.root, this.cloud, pc.name, 'up', options)
    this.copyNew(this.cloud, pc.root, pc.name, 'down', options)
  }

  /** Every online PC, in turn, twice: what one uploads reaches the ones before it. */
  syncAll(pcs: readonly SimPc[]): void {
    for (let round = 0; round < 2; round++) for (const pc of pcs) this.sync(pc)
  }

  /** Drops a "conflicted copy" of a file into a PC's copy, as sync apps do when two PCs write one name. */
  conflictCopy(pc: SimPc, file: string, label = `${pc.name}'s conflicted copy`): string {
    const ext = path.extname(file)
    const copy = `${file.slice(0, file.length - ext.length)} (${label})${ext}`
    fs.copyFileSync(path.join(pc.root, ...file.split('/')), path.join(pc.root, ...copy.split('/')))
    return copy
  }

  private copyNew(
    from: string,
    to: string,
    pcName: string,
    direction: 'up' | 'down',
    options: DeliverOptions
  ): void {
    const half = this.halfDone.get(pcName) ?? new Set<string>()
    this.halfDone.set(pcName, half)
    const have = new Set(filesUnder(to))
    let files = filesUnder(from).filter(
      (file) =>
        (!have.has(file) || (direction === 'down' && half.has(file))) &&
        (options.only?.(file) ?? true)
    )
    if (options.order === 'reverse') files = files.reverse()
    else if (options.order && typeof options.order === 'object')
      files = shuffle(files, options.order.seed)
    if (options.limit !== undefined) files = files.slice(0, options.limit)
    for (const file of files) {
      const source = path.join(from, ...file.split('/'))
      const target = path.join(to, ...file.split('/'))
      fs.mkdirSync(path.dirname(target), { recursive: true })
      const bytes = fs.readFileSync(source)
      if (direction === 'down' && !half.has(file) && options.partial?.(file)) {
        fs.writeFileSync(target, bytes.subarray(0, Math.floor(bytes.length / 2)))
        half.add(file)
        continue
      }
      fs.writeFileSync(target, bytes)
      half.delete(file)
    }
  }
}

function shuffle<T>(items: T[], seed: number): T[] {
  const out = [...items]
  let state = seed || 1
  const next = () => {
    state = (state * 1103515245 + 12345) % 2 ** 31
    return state / 2 ** 31
  }
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// ─── Reading and changing a PC's project ─────────────────────────────────

export function addTask(pc: SimPc, id: string, title: string): void {
  pc.db
    .prepare(
      `INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at)
       VALUES (?, ?, ?, 'ready', 'medium', 'human', 1, 1)`
    )
    .run(id, PROJECT, title)
}

export function renameTask(pc: SimPc, id: string, title: string): void {
  pc.db.prepare('UPDATE planning_work_items SET title = ? WHERE id = ?').run(title, id)
}

export function addComment(pc: SimPc, id: string, taskId: string, body: string): void {
  pc.db
    .prepare(
      `INSERT INTO planning_comments (id, project_id, work_item_id, author_person_id, author_kind, body, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'human', ?, 1, 1)`
    )
    .run(id, PROJECT, taskId, pc.me.personId, body)
}

/** The project's tasks on a PC, id → title, for comparing PCs. */
export function tasksOf(pc: SimPc): Record<string, string> {
  const rows = pc.db
    .prepare('SELECT id, title FROM planning_work_items WHERE project_id = ? ORDER BY id')
    .all(PROJECT) as { id: string; title: string }[]
  return Object.fromEntries(rows.map((row) => [row.id, row.title]))
}

export function commentsOf(pc: SimPc): Record<string, string> {
  const rows = pc.db
    .prepare('SELECT id, body FROM planning_comments WHERE project_id = ? ORDER BY id')
    .all(PROJECT) as { id: string; body: string }[]
  return Object.fromEntries(rows.map((row) => [row.id, row.body]))
}

/** Push and pull on every PC that has the project, twice, so every change reaches everyone. */
export async function syncEveryone(pcs: readonly SimPc[], drive?: SimDrive): Promise<void> {
  for (let round = 0; round < 2; round++) {
    for (const pc of pcs) {
      drive?.sync(pc)
      await pc.service.syncNow(PROJECT)
      drive?.sync(pc)
    }
  }
}
