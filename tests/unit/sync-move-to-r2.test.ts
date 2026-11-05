import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { attachChangeRecorder } from '../../electron/services/change-history/recorder'
import type { LibraryFileStore } from '../../electron/services/sync/library-files'
import { r2PlaceFor, planMove } from '../../electron/services/sync/move-to-r2'
import { R2Bridge } from '../../electron/services/sync/r2-bridge'
import { isR2Location } from '../../electron/services/sync/r2-transport'
import { SharingError } from '../../electron/services/sync/sharing'
import { PERSONAL_PROJECT_ID } from '../../electron/services/sync/synced-tables'
import { SyncService } from '../../electron/services/sync/sync-service'
import { createMigratedDatabase } from '../helpers/database'
import { FAKE_R2, FakeR2 } from '../helpers/fake-r2'
import { useTempDir } from '../helpers/temp-dir'

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`enc:${value}`),
    decryptString: (buffer: Buffer) => buffer.toString('utf8').replace(/^enc:/, '')
  }
}))

const HOUSE = 'a1b2c3d4-0000-4000-8000-000000000002'
const noLibrary: LibraryFileStore = {
  syncedOriginal: () => null,
  receiveSyncedOriginal: async () => undefined
}
const config = { ...FAKE_R2, prefix: '' }

async function until(check: () => boolean | Promise<boolean>, tries = 300): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('timed out')
}

describe('where each place goes when the space moves into R2', () => {
  const root = path.resolve('/sync/OneDrive')
  const space = path.join(root, 'Ostler')

  it('maps the space, its folders and the shares beside it like a space started in the bucket', () => {
    expect(r2PlaceFor(space, space)).toBe('r2:Ostler')
    expect(r2PlaceFor(space, path.join(space, 'Personal'))).toBe('r2:Ostler/Personal')
    expect(r2PlaceFor(space, path.join(space, 'Projects', 'House (a1b2c3d4)'))).toBe(
      'r2:Ostler/Projects/House (a1b2c3d4)'
    )
    // Beside the space: where the R2 bridge has always copied it.
    expect(r2PlaceFor(space, path.join(root, 'Shared', 'Garden'))).toBe('r2:Shared/Garden')
    expect(r2PlaceFor(space, path.resolve('/elsewhere/Garden'))).toBeNull()
    expect(r2PlaceFor(space, 'https://sync.example.com/space/1')).toBeNull()
  })

  it('maps a Drive space by its path inside Ostler’s folder', () => {
    const drive = 'gdrive:folder1234567'
    expect(r2PlaceFor(drive, 'gdrive:folder1234567/Personal')).toBe('r2:Ostler/Personal')
    expect(r2PlaceFor(drive, 'gdrive:folder1234567/Projects/House (a1b2c3d4)')).toBe(
      'r2:Ostler/Projects/House (a1b2c3d4)'
    )
    expect(r2PlaceFor(drive, 'gdrive:other4567890/Projects/House')).toBeNull()
    const plan = planMove(drive, [
      { project_id: PERSONAL_PROJECT_ID, folder: 'gdrive:folder1234567/Personal' },
      { project_id: HOUSE, folder: 'gdrive:other4567890/House' }
    ])
    expect(plan.moves.map((move) => move.to)).toEqual(['r2:Ostler/devices', 'r2:Ostler/Personal'])
    expect(plan.kept).toBe(1)
  })
})

describe('moving a folder personal space into R2', () => {
  const tempDir = useTempDir('ostler-move-r2-')
  const closers: (() => unknown)[] = []

  afterEach(async () => {
    for (const close of closers.splice(0).reverse()) await close()
  })

  const desktop = async (
    name: string,
    root: string,
    fetch: (url: string, init: RequestInit) => Promise<Response>
  ) => {
    const databasePath = await createMigratedDatabase(
      fs.mkdtempSync(path.join(tempDir(), `${name}-`))
    )
    const projects = new Map<string, string>()
    const errors: string[] = []
    let bridge: R2Bridge | null = null
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
      syncedRoots: () => [root],
      onProjectChanged: () => undefined,
      onStateChanged: () => undefined,
      memberName: () => name,
      logError: (message, error) => errors.push(`${message} ${String(error)}`),
      openR2: (place) => {
        if (!bridge) throw new SharingError('no-r2-bucket')
        return bridge.openPlace(place)
      },
      onSpaceMoved: () => bridge?.stopCopying(),
      pushCheckMs: 60_000,
      scanIntervalMs: 60_000
    })
    bridge = new R2Bridge({
      dataDir: fs.mkdtempSync(path.join(tempDir(), 'data-')),
      seal: (secret) => secret,
      open: (sealed) => sealed,
      fetch,
      spaceFolder: () => {
        const space = service.personalSpaceFolder()
        return space && path.isAbsolute(space) ? space : null
      },
      shareFolders: () => service.shareFolders(),
      log: (message, error) => errors.push(`${message} ${String(error)}`)
    })
    bridge.set({ ...config, checkMinutes: 0, uploadSoon: false, enabled: true })
    service.start()
    const db = new Database(databasePath)
    attachChangeRecorder(db)
    const pc = { name, service, bridge, db, projects, errors }
    closers.push(async () => {
      pc.bridge.stop()
      await service.stop()
      db.close()
    })
    return pc
  }

  const seedTask = (db: Database.Database, id: string, title: string): void => {
    db.prepare(
      `INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at)
       VALUES (?, ?, ?, 'ready', 'medium', 'human', 1, 1)`
    ).run(id, HOUSE, title)
  }

  const titles = (db: Database.Database): string[] =>
    (
      db
        .prepare('SELECT title FROM planning_work_items WHERE project_id = ? ORDER BY title')
        .all(HOUSE) as { title: string }[]
    ).map((row) => row.title)

  it('copies the space and its projects, switches every device to r2:, and leaves the old folder', async () => {
    const bucket = new FakeR2()
    const root = path.join(tempDir(), 'root')
    fs.mkdirSync(root)
    const a = await desktop('pc-a', root, bucket.fetch)
    const b = await desktop('pc-b', root, bucket.fetch)
    a.projects.set(HOUSE, 'House')
    await a.service.createPersonalSpace(root, 'Ann laptop')
    await a.service.shareUnsharedProjects()
    const space = a.service.personalSpaceFolder() as string
    const device = await b.service.requestPairing(space, 'pc-b')
    await a.service.allowDevice(space, device)
    expect(await b.service.completePairing(space)).toBe('paired')
    await a.service.syncNow(PERSONAL_PROJECT_ID)
    await b.service.syncNow(PERSONAL_PROJECT_ID)
    expect([...b.projects.keys()]).toEqual([HOUSE])
    seedTask(a.db, 'task-1', 'Paint hall')
    await a.service.syncNow(HOUSE)
    const oldFiles = fs.readdirSync(path.join(space, 'Personal'), { recursive: true }).length

    const progress: number[] = []
    const result = await a.service.moveSpaceToR2((step) => progress.push(step.copied))
    expect(result.copied).toBeGreaterThan(0)
    expect(progress.at(-1)).toBe(result.copied)
    expect(a.service.personalSpaceFolder()).toBe('r2:Ostler')
    expect(a.service.shareFolders()).toEqual(['r2:Ostler/Projects/House (a1b2c3d4)'])
    expect(bucket.keys()).toContain('Ostler/Personal/share.json')
    expect(bucket.keys().some((key) => key.startsWith('Ostler/devices/'))).toBe(true)
    expect(bucket.keys().some((key) => key.startsWith('Ostler/Projects/House (a1b2c3d4)/'))).toBe(
      true
    )
    // The bridge stops; the old copy stays (one "moved" entry is added for the other devices).
    expect(a.bridge.state().enabled).toBe(false)
    expect(a.bridge.state().configured).toBe(true)
    expect(
      fs.readdirSync(path.join(space, 'Personal'), { recursive: true }).length
    ).toBeGreaterThanOrEqual(oldFiles)

    // Moving again does nothing more.
    expect(await a.service.moveSpaceToR2()).toEqual({ copied: 0, kept: 0 })

    // B reads the old personal share, finds the "moved" entry and follows.
    await b.service.syncNow(PERSONAL_PROJECT_ID)
    await until(() => b.service.personalSpaceFolder() === 'r2:Ostler' && !b.bridge.state().enabled)
    expect(b.service.shareFolders().every(isR2Location)).toBe(true)
    expect(b.bridge.state().enabled).toBe(false)

    // Both now sync through the bucket.
    await b.service.syncNow(HOUSE)
    expect(titles(b.db)).toEqual(['Paint hall'])
    seedTask(b.db, 'task-2', 'Fix gate')
    await b.service.syncNow(HOUSE)
    await a.service.syncNow(HOUSE)
    expect(titles(a.db)).toEqual(['Fix gate', 'Paint hall'])
    expect(a.errors).toEqual([])
    expect(b.errors).toEqual([])
  })

  it('stays on the folder when the copy fails half way, and finishes when tried again', async () => {
    const bucket = new FakeR2()
    let puts = 0
    let failAfter = 3
    const fetch = (url: string, init: RequestInit): Promise<Response> => {
      if (init.method === 'PUT' && ++puts > failAfter) return Promise.reject(new TypeError('down'))
      return bucket.fetch(url, init)
    }
    const root = path.join(tempDir(), 'root')
    fs.mkdirSync(root)
    const a = await desktop('pc-a', root, fetch)
    a.bridge.stopCopying()
    a.projects.set(HOUSE, 'House')
    await a.service.createPersonalSpace(root, 'Ann laptop')
    await a.service.shareUnsharedProjects()
    const space = a.service.personalSpaceFolder() as string

    await expect(a.service.moveSpaceToR2()).rejects.toThrow()
    expect(a.service.personalSpaceFolder()).toBe(space)
    const partly = bucket.keys().length
    expect(partly).toBeGreaterThan(0)

    failAfter = Number.POSITIVE_INFINITY
    const result = await a.service.moveSpaceToR2()
    expect(a.service.personalSpaceFolder()).toBe('r2:Ostler')
    expect(result.copied).toBeGreaterThan(0)
    expect(bucket.keys().length).toBeGreaterThan(partly)
  })
})
