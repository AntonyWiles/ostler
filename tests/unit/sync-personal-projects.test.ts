import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attachChangeRecorder } from '../../electron/services/change-history/recorder'
import type { LibraryFileStore } from '../../electron/services/sync/library-files'
import { SyncService } from '../../electron/services/sync/sync-service'
import { PERSONAL_PROJECT_ID } from '../../electron/services/sync/synced-tables'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

// Sealing needs Electron's safeStorage; a reversible stand-in lets the services seal and open for real.
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`enc:${value}`),
    decryptString: (buffer: Buffer) => buffer.toString('utf8').replace(/^enc:/, '')
  }
}))

const HOUSE = 'a1b2c3d4-0000-4000-8000-000000000001'
const GARDEN = 'a1b2c3d4-0000-4000-8000-000000000002'
const SHED = 'e5f6a7b8-0000-4000-8000-000000000003'
const LOFT = 'c9d0e1f2-0000-4000-8000-000000000004'
const TRIP = 'd3e4f5a6-0000-4000-8000-000000000005'

/**
 * Moves a folder, trying again while Windows refuses with EPERM: the indexer or
 * antivirus can hold a folder that was just written for a moment under load.
 */
async function moveFolder(from: string, to: string): Promise<void> {
  const deadline = Date.now() + 10_000
  for (;;) {
    try {
      fs.renameSync(from, to)
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM' || Date.now() > deadline) throw error
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
}

const noLibrary: LibraryFileStore = {
  syncedOriginal: () => null,
  receiveSyncedOriginal: async () => undefined
}

/** One PC: its own database, its sync service, the projects in its config store, and what it was told. */
interface Pc {
  name: string
  db: Database.Database
  service: SyncService
  projects: Map<string, string>
  left: string[]
  errors: string[]
}

describe('every project on every device (people and devices, prompt 11)', () => {
  const tempDir = useTempDir('ostler-personal-projects-')
  let root: string
  let pcs: Pc[]

  const openPc = async (name: string): Promise<Pc> => {
    const databasePath = await createMigratedDatabase(fs.mkdtempSync(path.join(tempDir(), name)))
    const db = new Database(databasePath)
    attachChangeRecorder(db)
    const projects = new Map<string, string>()
    const left: string[] = []
    const errors: string[] = []
    const service = new SyncService({
      databasePath,
      library: noLibrary,
      projectSettings: (projectId) => {
        const projectName = projects.get(projectId)
        return projectName === undefined
          ? null
          : { name: projectName, color: '#336699', notes: '', tags: [] }
      },
      projectIds: () => [...projects.keys()],
      registerJoinedProject: (joined) => {
        projects.set(joined.projectId, joined.project?.name ?? 'Shared project')
      },
      onLeftShare: (projectId) => left.push(projectId),
      syncedRoots: () => [root],
      onProjectChanged: () => undefined,
      onStateChanged: () => undefined,
      memberName: () => name,
      logError: (message, error) => errors.push(`${message} ${String(error)}`),
      pushCheckMs: 60_000,
      scanIntervalMs: 60_000
    })
    service.start()
    const pc = { name, db, service, projects, left, errors }
    pcs.push(pc)
    return pc
  }

  /** Pairs `b` with `a`'s personal space, the way the app does it, and lets `a` read `b`'s member. */
  const pair = async (a: Pc, b: Pc): Promise<void> => {
    const space = a.service.personalSpaceFolder() as string
    const device = await b.service.requestPairing(space, b.name)
    await a.service.allowDevice(space, device)
    expect(await b.service.completePairing(space)).toBe('paired')
    await a.service.syncNow(PERSONAL_PROJECT_ID)
  }

  const seedTask = (db: Database.Database, projectId: string, id: string, title: string): void => {
    db.prepare(
      `INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at)
       VALUES (?, ?, ?, 'ready', 'medium', 'human', 1, 1)`
    ).run(id, projectId, title)
  }

  const taskTitles = (db: Database.Database, projectId: string): string[] =>
    (
      db
        .prepare('SELECT title FROM planning_work_items WHERE project_id = ? ORDER BY title')
        .all(projectId) as { title: string }[]
    ).map((row) => row.title)

  const spaceFolder = (pc: Pc): string => pc.service.personalSpaceFolder() as string

  beforeEach(() => {
    root = path.join(tempDir(), 'root')
    fs.mkdirSync(root)
    pcs = []
  })

  afterEach(async () => {
    for (const pc of pcs) {
      await pc.service.stop()
      pc.db.close()
    }
  })

  it('shares every project into Ostler/Projects, joins them on the other device, and carries tasks both ways', async () => {
    const a = await openPc('pc-a')
    const b = await openPc('pc-b')
    a.projects.set(HOUSE, 'House')
    a.projects.set(GARDEN, 'Garden')
    await a.service.createPersonalSpace(root, 'Ann laptop')
    await a.service.shareUnsharedProjects()

    const space = spaceFolder(a)
    expect(a.service.stateOf(HOUSE)?.folder).toBe(path.join(space, 'Projects', 'House (a1b2c3d4)'))
    expect(a.service.stateOf(GARDEN)?.inPersonalSpace).toBe(true)

    await pair(a, b)
    // A third project, made after pairing.
    a.projects.set(SHED, 'Shed')
    a.service.projectsChanged(SHED)
    await a.service.shareUnsharedProjects()

    seedTask(a.db, HOUSE, 'task-1', 'Paint hall')
    await a.service.syncNow(HOUSE)
    await b.service.syncNow(PERSONAL_PROJECT_ID)
    expect([...b.projects.keys()].sort()).toEqual([GARDEN, HOUSE, SHED].sort())
    await b.service.syncNow(HOUSE)
    expect(taskTitles(b.db, HOUSE)).toEqual(['Paint hall'])

    // (b) A task made on B appears on A.
    seedTask(b.db, HOUSE, 'task-2', 'Fix gate')
    await b.service.syncNow(HOUSE)
    await a.service.syncNow(HOUSE)
    expect(taskTitles(a.db, HOUSE)).toEqual(['Fix gate', 'Paint hall'])
    expect(a.errors).toEqual([])
    expect(b.errors).toEqual([])
  })

  it('joins a share another person shared with this person as their Editor, on each device of the person', async () => {
    const a = await openPc('pc-a')
    const b = await openPc('pc-b')
    const carl = await openPc('pc-carl')
    a.projects.set(HOUSE, 'House')
    await a.service.createPersonalSpace(root, 'Ann laptop')
    await a.service.shareUnsharedProjects()
    await pair(a, b)

    // Carl shares a trip with Ann, who joins as an Editor.
    const trip = path.join(root, 'Shared', 'Trip')
    fs.mkdirSync(path.dirname(trip))
    carl.projects.set(TRIP, 'Trip')
    await carl.service.share(TRIP, trip)
    const invite = carl.service.invite(TRIP, 'editor') as string
    await a.service.join(invite, trip)
    expect(a.projects.get(TRIP)).toBe('Trip')
    await a.service.publishShares()

    // B joins the trip too, from A's entry.
    await b.service.syncNow(PERSONAL_PROJECT_ID)
    expect(b.projects.has(TRIP)).toBe(true)

    await carl.service.syncNow(TRIP)
    const people = carl.service.stateOf(TRIP)?.members ?? []
    const ann = people.find((person) => person.devices.length === 2)
    expect(people).toHaveLength(2)
    expect(ann?.role).toBe('editor')
    expect(b.service.stateOf(TRIP)?.myRole).toBe('editor')
    expect(a.errors).toEqual([])
    expect(b.errors).toEqual([])
  })

  it('leaves a project that another device deleted, and keeps its copy', async () => {
    const a = await openPc('pc-a')
    const b = await openPc('pc-b')
    a.projects.set(HOUSE, 'House')
    a.projects.set(GARDEN, 'Garden')
    await a.service.createPersonalSpace(root, 'Ann laptop')
    await a.service.shareUnsharedProjects()
    await pair(a, b)
    await b.service.syncNow(PERSONAL_PROJECT_ID)
    expect(b.service.stateOf(GARDEN)).not.toBeNull()
    seedTask(b.db, GARDEN, 'task-g', 'Mow lawn')
    await b.service.syncNow(GARDEN)

    a.projects.delete(GARDEN)
    a.service.projectsChanged(GARDEN)
    await vi.waitFor(() => expect(a.service.stateOf(GARDEN)).toBeNull())

    await b.service.syncNow(PERSONAL_PROJECT_ID)
    expect(b.service.stateOf(GARDEN)).toBeNull()
    expect(b.left).toEqual([GARDEN])
    // B keeps what it had: nothing is deleted on another device.
    expect(b.projects.has(GARDEN)).toBe(true)
    expect(taskTitles(b.db, GARDEN)).toEqual(['Mow lawn'])
  })

  it('retries a share whose folder has not arrived on this device, and joins it when the folder appears', async () => {
    const a = await openPc('pc-a')
    const b = await openPc('pc-b')
    a.projects.set(HOUSE, 'House')
    await a.service.createPersonalSpace(root, 'Ann laptop')
    await a.service.shareUnsharedProjects()
    await pair(a, b)

    a.projects.set(LOFT, 'Loft')
    await a.service.shareUnsharedProjects()
    const loftFolder = a.service.stateOf(LOFT)?.folder as string
    const parked = path.join(tempDir(), 'parked-loft')
    await moveFolder(loftFolder, parked)

    await b.service.syncNow(PERSONAL_PROJECT_ID)
    expect(b.projects.has(LOFT)).toBe(false)
    expect(b.service.stateOf(LOFT)).toBeNull()

    await moveFolder(parked, loftFolder)
    await b.service.syncNow(PERSONAL_PROJECT_ID)
    expect(b.projects.has(LOFT)).toBe(true)
    expect(b.service.stateOf(LOFT)).not.toBeNull()
  })
})
