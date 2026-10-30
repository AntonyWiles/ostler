import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { recordChanges } from '../../electron/services/change-history/context'
import { attachChangeRecorder } from '../../electron/services/change-history/recorder'
import type { LibraryFileStore } from '../../electron/services/sync/library-files'
import type { AssignedToMe } from '../../electron/services/sync/sync-runner'
import { SyncService } from '../../electron/services/sync/sync-service'
import { PERSONAL_PROJECT_ID } from '../../electron/services/sync/synced-tables'
import { createMigratedDatabase } from '../helpers/database'
import { quietFolder } from '../helpers/sync-simulation'
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

const noLibrary: LibraryFileStore = {
  syncedOriginal: () => null,
  receiveSyncedOriginal: async () => undefined
}

/** A write made by the person at the keyboard: captured with their Me as its author (D10). */
const asPerson = (write: () => void) => recordChanges('test.person-edit', async () => write())

/** One PC: its database, its sync service, the projects in its config store and what it was told. */
interface Pc {
  name: string
  meId: string
  db: Database.Database
  service: SyncService
  projects: Map<string, string>
  assigned: AssignedToMe[]
  errors: string[]
}

/**
 * The whole plan in one story (docs/plans/people-and-devices, prompt 15): Ann has two paired PCs,
 * A1 and A2. Bob joins her project as an Editor and Cat as a Viewer. Bob assigns Ann a task, Cat
 * tries to edit and comments, Ann makes a new project on A1, then removes A2.
 */
describe('people and devices: the end-to-end scenario (prompt 15)', () => {
  const tempDir = useTempDir('ostler-people-and-devices-')
  let root: string
  let pcs: Pc[]
  let a1: Pc
  let a2: Pc
  let b: Pc
  let c: Pc

  const openPc = async (name: string, meId: string, meName: string): Promise<Pc> => {
    const databasePath = await createMigratedDatabase(fs.mkdtempSync(path.join(tempDir(), name)))
    const db = new Database(databasePath)
    db.prepare(
      `INSERT INTO people (id, name, initials, color, is_me, archived_at, created_at, updated_at)
       VALUES (?, ?, ?, '#336699', 1, NULL, 1, 1)`
    ).run(meId, meName, meName[0])
    attachChangeRecorder(db)
    const projects = new Map<string, string>()
    const assigned: AssignedToMe[] = []
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
      syncedRoots: () => [root],
      onProjectChanged: () => undefined,
      onStateChanged: () => undefined,
      onAssigned: (event) => assigned.push(event),
      memberName: () => name,
      // As the app does (services.ts): this PC's Me row, which pairing may change (F4).
      me: () => {
        const me = db
          .prepare('SELECT id, name, initials, color FROM people WHERE is_me = 1')
          .get() as { id: string; name: string; initials: string; color: string } | undefined
        return me
          ? { personId: me.id, name: me.name, initials: me.initials, color: me.color }
          : null
      },
      logError: (message, error) => errors.push(`${message} ${String(error)}`),
      // No file watching: a pull starts only when the test says, so its problems are that pull's.
      openTransport: quietFolder,
      pushCheckMs: 60_000,
      scanIntervalMs: 60_000
    })
    service.start()
    const pc = { name, meId, db, service, projects, assigned, errors }
    pcs.push(pc)
    return pc
  }

  /** Every PC pulls and pushes the project, twice, so each has read what the others wrote. */
  const syncAll = async (projectId: string, among: Pc[] = pcs) => {
    for (let round = 0; round < 2; round++) {
      for (const pc of among) await pc.service.syncNow(projectId)
    }
  }

  const titleOf = (pc: Pc, id: string): string | undefined =>
    (
      pc.db.prepare('SELECT title FROM planning_work_items WHERE id = ?').get(id) as
        { title: string } | undefined
    )?.title

  const assigneeOf = (pc: Pc, id: string): string | null | undefined =>
    (
      pc.db.prepare('SELECT assignee_id FROM planning_work_items WHERE id = ?').get(id) as
        { assignee_id: string | null } | undefined
    )?.assignee_id

  const assigneeActivity = (pc: Pc, id: string) =>
    pc.db
      .prepare(
        `SELECT to_value, actor_kind, actor_person_id FROM planning_field_changes
         WHERE work_item_id = ? AND field = 'assignee'`
      )
      .all(id)

  const commentOf = (pc: Pc, id: string): string | undefined =>
    (
      pc.db.prepare('SELECT body FROM planning_comments WHERE id = ?').get(id) as
        { body: string } | undefined
    )?.body

  beforeEach(async () => {
    root = path.join(tempDir(), 'My Drive')
    fs.mkdirSync(root)
    pcs = []
    a1 = await openPc('ann-laptop', 'ann-1', 'Ann')
    a2 = await openPc('ann-desktop', 'ann-2', 'Ann')
    b = await openPc('bob-pc', 'bob', 'Bob')
    c = await openPc('cat-pc', 'cat', 'Cat')

    // Ann keeps her devices in step: every project is shared into her space, and A2 is paired.
    a1.projects.set(HOUSE, 'House')
    await a1.service.createPersonalSpace(root, 'Ann laptop')
    await a1.service.shareUnsharedProjects()
    const space = a1.service.personalSpaceFolder() as string
    const request = await a2.service.requestPairing(space, 'Ann desktop')
    await a1.service.allowDevice(space, request)
    expect(await a2.service.completePairing(space)).toBe('paired')
    await a1.service.syncNow(PERSONAL_PROJECT_ID)
    await a2.service.syncNow(PERSONAL_PROJECT_ID)
    expect(a2.projects.get(HOUSE)).toBe('House')

    // Ann invites Bob as an Editor and Cat as a Viewer, through the project's own folder.
    const houseFolder = a1.service.stateOf(HOUSE)?.folder as string
    await b.service.join(a1.service.invite(HOUSE, 'editor') as string, houseFolder)
    await c.service.join(a1.service.invite(HOUSE, 'viewer') as string, houseFolder)

    await asPerson(() =>
      a1.db
        .prepare(
          `INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at)
           VALUES ('item-1', ?, 'Paint hall', 'ready', 'medium', 'human', 1, 1)`
        )
        .run(HOUSE)
    )
    await syncAll(HOUSE)
  })

  afterEach(async () => {
    for (const pc of pcs) {
      await pc.service.stop()
      pc.db.close()
    }
  })

  it('every PC lists three people with their roles, and the task reached all of them', () => {
    for (const pc of pcs) {
      const people = pc.service.stateOf(HOUSE)?.members ?? []
      expect(people.map((person) => [person.name, person.role, person.devices.length])).toEqual([
        ['Ann', 'owner', 2],
        ['Bob', 'editor', 1],
        ['Cat', 'viewer', 1]
      ])
      expect(titleOf(pc, 'item-1')).toBe('Paint hall')
    }
    expect(c.service.stateOf(HOUSE)?.myRole).toBe('viewer')
    expect(b.service.stateOf(HOUSE)?.myRole).toBe('editor')
    expect(a2.service.stateOf(HOUSE)?.myRole).toBe('owner')
  })

  it("Bob assigns Ann a task: both of Ann's PCs show it with activity naming Bob, and Ann is told", async () => {
    await asPerson(() =>
      b.db.prepare("UPDATE planning_work_items SET assignee_id = 'ann-1' WHERE id = 'item-1'").run()
    )
    await syncAll(HOUSE, [b, a1, a2])

    for (const pc of [a1, a2]) {
      expect(assigneeOf(pc, 'item-1')).toBe('ann-1')
      expect(assigneeActivity(pc, 'item-1')).toEqual([
        { to_value: JSON.stringify('ann-1'), actor_kind: 'human', actor_person_id: 'bob' }
      ])
    }
    expect(a1.assigned).toEqual([{ projectId: HOUSE, taskId: 'item-1', byPersonId: 'bob' }])
    expect(b.assigned).toEqual([])
    expect(c.assigned).toEqual([])
  })

  it("Ann's other PC is told too, because the task is assigned to the same Me there (F4)", async () => {
    await asPerson(() =>
      b.db.prepare("UPDATE planning_work_items SET assignee_id = 'ann-1' WHERE id = 'item-1'").run()
    )
    await syncAll(HOUSE, [b, a1, a2])
    expect(a2.assigned).toEqual([{ projectId: HOUSE, taskId: 'item-1', byPersonId: 'bob' }])
    expect(
      b.db.prepare("SELECT id FROM people WHERE name = 'Ann' AND archived_at IS NULL").all()
    ).toEqual([{ id: 'ann-1' }])
  })

  it("Cat's edit is refused at home and left out by the others, while her comment arrives", async () => {
    expect(() =>
      c.db
        .prepare("UPDATE planning_work_items SET title = 'Paint hall red' WHERE id = 'item-1'")
        .run()
    ).toThrow(/ostler:read-only/)

    // A Viewer's PC without the guard (an older build, or a changed copy) still sends the edit:
    // every other PC leaves it out by her role (D9).
    c.db.prepare("UPDATE sync_shares SET my_role = 'editor' WHERE project_id = ?").run(HOUSE)
    await asPerson(() =>
      c.db
        .prepare("UPDATE planning_work_items SET title = 'Paint hall red' WHERE id = 'item-1'")
        .run()
    )
    await c.service.syncNow(HOUSE)
    expect(c.service.stateOf(HOUSE)?.myRole).toBe('viewer')
    // The pull that reads her file reports it (problems are those of the latest pull).
    for (const pc of [a1, a2, b]) {
      await pc.service.syncNow(HOUSE)
      expect(titleOf(pc, 'item-1')).toBe('Paint hall')
      expect(pc.service.stateOf(HOUSE)?.problems).toContainEqual({
        kind: 'change',
        reason: 'not-allowed'
      })
    }

    await asPerson(() =>
      c.db
        .prepare(
          `INSERT INTO planning_comments (id, project_id, work_item_id, author_person_id, author_kind, body, created_at, updated_at)
           VALUES ('comment-1', ?, 'item-1', 'cat', 'human', 'Blue would be nicer', 1, 1)`
        )
        .run(HOUSE)
    )
    await syncAll(HOUSE)

    for (const pc of [a1, a2, b]) {
      expect(titleOf(pc, 'item-1')).toBe('Paint hall')
      expect(commentOf(pc, 'comment-1')).toBe('Blue would be nicer')
    }
  })

  it('a project Ann makes on A1 appears on A2', async () => {
    a1.projects.set(GARDEN, 'Garden')
    a1.service.projectsChanged(GARDEN)
    await a1.service.shareUnsharedProjects()
    await a2.service.syncNow(PERSONAL_PROJECT_ID)

    expect(a2.projects.get(GARDEN)).toBe('Garden')
    expect(a2.service.stateOf(GARDEN)?.inPersonalSpace).toBe(true)
  })

  it('after Ann removes A2, A2 receives nothing new while Bob still does', async () => {
    const space = a1.service.personalSpaceFolder() as string
    const device = a1.service.personalDevices().find((entry) => !entry.isThisDevice)
    expect(device?.name).toBe('Ann desktop')
    await a1.service.removePersonalDevice(space, device!.deviceId)

    await asPerson(() =>
      a1.db
        .prepare("UPDATE planning_work_items SET title = 'Paint hall white' WHERE id = 'item-1'")
        .run()
    )
    await syncAll(HOUSE)

    expect(titleOf(b, 'item-1')).toBe('Paint hall white')
    expect(titleOf(a2, 'item-1')).toBe('Paint hall')
    expect(
      a1.service.stateOf(HOUSE)?.members.find((person) => person.name === 'Ann')?.devices
    ).toHaveLength(1)
    expect(a1.service.personalDevices().find((entry) => !entry.isThisDevice)?.revoked).toBe(true)
  })

  it('no PC logged an error', async () => {
    await syncAll(HOUSE)
    for (const pc of pcs) expect(pc.errors).toEqual([])
  })
})
