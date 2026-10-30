import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { attachChangeRecorder } from '../../electron/services/change-history/recorder'
import type { LibraryFileStore } from '../../electron/services/sync/library-files'
import type { MePerson } from '../../electron/services/sync/sharing'
import type { AssignedToMe } from '../../electron/services/sync/sync-runner'
import { SyncService } from '../../electron/services/sync/sync-service'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

const PROJECT = 'house-project'
const SETTINGS = { name: 'House', color: '#336699', notes: '', tags: [] }

const noLibrary: LibraryFileStore = {
  syncedOriginal: () => null,
  receiveSyncedOriginal: async () => undefined
}

describe('the sync service', () => {
  const tempDir = useTempDir('ostler-sync-service-')
  let folder: string
  let pcs: {
    service: SyncService
    db: Database.Database
    changed: string[]
    states: string[]
    assigned: AssignedToMe[]
    left: { projectId: string; name: string }[]
  }[]

  const openPc = async (name: string, memberName: string, me: MePerson | null = null) => {
    const databasePath = await createMigratedDatabase(fs.mkdtempSync(path.join(tempDir(), name)))
    const changed: string[] = []
    const states: string[] = []
    const assigned: AssignedToMe[] = []
    const left: { projectId: string; name: string }[] = []
    const service = new SyncService({
      databasePath,
      library: noLibrary,
      projectSettings: () => SETTINGS,
      onProjectChanged: (projectId) => changed.push(projectId),
      onStateChanged: (projectId) => states.push(projectId),
      onAssigned: (event) => assigned.push(event),
      onMemberLeft: (event) => left.push(event),
      memberName: () => memberName,
      me: () => me,
      logError: (message, error) => {
        throw new Error(`${message} ${String(error)}`)
      },
      pushCheckMs: 60_000,
      scanIntervalMs: 60_000
    })
    // Another connection, as the planning service has: its writes are captured.
    const db = new Database(databasePath)
    attachChangeRecorder(db)
    const pc = { service, db, changed, states, assigned, left }
    pcs.push(pc)
    return pc
  }

  const insertItem = (db: Database.Database, id: string, title: string) =>
    db
      .prepare(
        `INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at)
         VALUES (?, ?, ?, 'ready', 'medium', 'human', 1, 1)`
      )
      .run(id, PROJECT, title)

  const titleOf = (db: Database.Database, id: string): string | undefined =>
    (
      db.prepare('SELECT title FROM planning_work_items WHERE id = ?').get(id) as
        { title: string } | undefined
    )?.title

  beforeEach(() => {
    folder = path.join(tempDir(), 'shared')
    fs.mkdirSync(folder)
    pcs = []
  })

  afterEach(async () => {
    for (const pc of pcs) {
      await pc.service.stop()
      pc.db.close()
    }
  })

  it('shares, joins, and keeps both PCs in step', async () => {
    const a = await openPc('pc-a-', 'Ann')
    const b = await openPc('pc-b-', 'Ben')
    a.service.start()
    b.service.start()

    insertItem(a.db, 'item-1', 'Paint hall')
    await a.service.share(PROJECT, folder)
    const invite = a.service.invite(PROJECT)
    expect(invite).toMatch(/^ostler-invite:1:/)

    const joined = await b.service.join(invite!, folder)
    expect(joined.project).toEqual(SETTINGS)
    expect(titleOf(b.db, 'item-1')).toBe('Paint hall')

    b.db
      .prepare('UPDATE planning_work_items SET title = ? WHERE id = ?')
      .run('Paint the hall', 'item-1')
    expect(b.service.stateOf(PROJECT)?.waitingToSend).toBe(1)
    await b.service.syncNow(PROJECT)
    expect(b.service.stateOf(PROJECT)?.waitingToSend).toBe(0)

    await a.service.syncNow(PROJECT)
    expect(titleOf(a.db, 'item-1')).toBe('Paint the hall')
    expect(a.changed).toContain(PROJECT)

    const state = a.service.stateOf(PROJECT)
    expect(state).toMatchObject({ status: 'up-to-date', folder, problems: [] })
    expect(state?.members.map((member) => [member.name, member.isMe])).toEqual([
      ['Ann', true],
      ['Ben', false]
    ])
  })

  it('tells the person once when another PC assigns a task to their Me', async () => {
    const a = await openPc('pc-a-', 'Ann', {
      personId: 'person-ann',
      name: 'Ann',
      initials: 'A',
      color: '#336699'
    })
    const b = await openPc('pc-b-', 'Ben')
    a.service.start()
    b.service.start()
    a.db
      .prepare(
        "INSERT INTO people (id, name, initials, color, is_me, archived_at, created_at, updated_at) VALUES ('person-ann', 'Ann', 'A', '#336699', 1, NULL, 1, 1)"
      )
      .run()
    insertItem(a.db, 'item-1', 'Paint hall')
    await a.service.share(PROJECT, folder)
    await b.service.join(a.service.invite(PROJECT)!, folder)
    await a.service.syncNow(PROJECT)

    b.db
      .prepare("UPDATE planning_work_items SET assignee_id = 'person-ann' WHERE id = 'item-1'")
      .run()
    await b.service.syncNow(PROJECT)
    await a.service.syncNow(PROJECT)
    expect(a.assigned).toEqual([{ projectId: PROJECT, taskId: 'item-1', byPersonId: null }])

    // A later pull with nothing new says nothing again.
    await a.service.syncNow(PROJECT)
    expect(a.assigned).toHaveLength(1)
  })

  it('removes a member: the others carry on, and the removed PC says so', async () => {
    const a = await openPc('pc-a-', 'Ann')
    const b = await openPc('pc-b-', 'Ben')
    a.service.start()
    b.service.start()
    insertItem(a.db, 'item-1', 'Paint hall')
    await a.service.share(PROJECT, folder)
    await b.service.join(a.service.invite(PROJECT)!, folder)
    await a.service.syncNow(PROJECT)

    const ben = a.service.stateOf(PROJECT)!.members.find((member) => !member.isMe)!
    await a.service.removeMember(PROJECT, ben.devices[0].memberId)
    expect(a.service.stateOf(PROJECT)?.members.map((member) => member.name)).toEqual(['Ann'])
    expect(fs.readdirSync(path.join(folder, 'keys'))).toEqual(['1.ostlerrotation'])

    await b.service.syncNow(PROJECT)
    expect(b.service.stateOf(PROJECT)).toMatchObject({ removed: true, status: 'problems' })
    b.db
      .prepare('UPDATE planning_work_items SET title = ? WHERE id = ?')
      .run('Knock it down', 'item-1')
    await b.service.syncNow(PROJECT)
    // Nothing more is sent from a removed PC.
    expect(b.service.stateOf(PROJECT)?.waitingToSend).toBe(1)

    a.db
      .prepare('UPDATE planning_work_items SET title = ? WHERE id = ?')
      .run('Paint the hall', 'item-1')
    await a.service.syncNow(PROJECT)
    expect(a.service.stateOf(PROJECT)).toMatchObject({ status: 'up-to-date', removed: false })
  })

  /** Simulates pairing: the second PC gets the first one's person key before it joins. */
  const copyPersonKey = (from: Database.Database, to: Database.Database) => {
    const row = from
      .prepare('SELECT public_key, private_key, created_at, source FROM sync_person WHERE id = 1')
      .get()
    to.prepare(
      `INSERT OR REPLACE INTO sync_person (id, public_key, private_key, created_at, source)
       VALUES (1, @public_key, @private_key, @created_at, @source)`
    ).run(row)
  }

  it('lists two devices of one person once, named from their Me card', async () => {
    const me: MePerson = { personId: 'me-ann', name: 'Ann Wiles', initials: 'AW', color: '#336699' }
    const a = await openPc('pc-a-', 'Ann', me)
    const b = await openPc('pc-b-', 'Ann', me)
    const c = await openPc('pc-c-', 'Ben')
    for (const pc of [a, b, c]) pc.service.start()

    await a.service.share(PROJECT, folder)
    copyPersonKey(a.db, b.db)
    await b.service.join(a.service.invite(PROJECT)!, folder)
    await c.service.join(a.service.invite(PROJECT)!, folder)

    const people = c.service.stateOf(PROJECT)!.members
    expect(people.map((person) => [person.name, person.devices.length, person.isMe])).toEqual([
      ['Ann Wiles', 2, false],
      ['Ben', 1, true]
    ])
    expect(people[0].devices.map((device) => device.isThisPc)).toEqual([false, false])
  })

  it('removes every device of another person, refuses this PC, and the others keep syncing', async () => {
    const a = await openPc('pc-a-', 'Ann')
    const b = await openPc('pc-b-', 'Ben')
    const c = await openPc('pc-c-', 'Ben')
    for (const pc of [a, b, c]) pc.service.start()
    insertItem(a.db, 'item-1', 'Paint hall')

    await a.service.share(PROJECT, folder)
    await b.service.join(a.service.invite(PROJECT)!, folder)
    copyPersonKey(b.db, c.db)
    await c.service.join(a.service.invite(PROJECT)!, folder)
    await a.service.syncNow(PROJECT)

    const people = a.service.stateOf(PROJECT)!.members
    const ann = people.find((person) => person.isMe)!
    const ben = people.find((person) => !person.isMe)!
    expect(ben.devices).toHaveLength(2)
    await expect(a.service.removePerson(PROJECT, ann.personKey)).rejects.toThrow('this-pc')

    await a.service.removePerson(PROJECT, ben.personKey)
    expect(a.service.stateOf(PROJECT)?.members.map((person) => person.name)).toEqual(['Ann'])

    // The removed devices say so when they next sync; the remaining PC keeps going.
    await b.service.syncNow(PROJECT)
    await c.service.syncNow(PROJECT)
    expect(b.service.stateOf(PROJECT)).toMatchObject({ removed: true })
    expect(c.service.stateOf(PROJECT)).toMatchObject({ removed: true })
    a.db
      .prepare('UPDATE planning_work_items SET title = ? WHERE id = ?')
      .run('Paint the hall', 'item-1')
    await a.service.syncNow(PROJECT)
    expect(a.service.stateOf(PROJECT)).toMatchObject({ status: 'up-to-date', waitingToSend: 0 })
  })

  it('stops sharing on this PC and keeps the project rows', async () => {
    const a = await openPc('pc-a-', 'Ann')
    a.service.start()
    insertItem(a.db, 'item-1', 'Paint hall')
    await a.service.share(PROJECT, folder)
    expect(a.service.isShared(PROJECT)).toBe(true)

    await a.service.leave(PROJECT)
    expect(a.service.isShared(PROJECT)).toBe(false)
    expect(a.service.stateOf(PROJECT)).toBeNull()
    expect(titleOf(a.db, 'item-1')).toBe('Paint hall')
    insertItem(a.db, 'item-2', 'Fix door')
    expect(a.db.prepare('SELECT COUNT(*) AS n FROM sync_outbox').get()).toEqual({ n: 0 })
  })

  it('tells the others once when someone leaves, and lists them as left', async () => {
    const a = await openPc('pc-a-', 'Ann')
    const b = await openPc('pc-b-', 'Ben')
    a.service.start()
    b.service.start()
    insertItem(a.db, 'item-1', 'Paint hall')
    await a.service.share(PROJECT, folder)
    await b.service.join(a.service.invite(PROJECT)!, folder)
    b.db
      .prepare("UPDATE planning_work_items SET title = 'Paint the hall' WHERE id = 'item-1'")
      .run()
    await b.service.syncNow(PROJECT)
    await a.service.syncNow(PROJECT)
    expect(
      a.service.stateOf(PROJECT)?.members.find((member) => member.name === 'Ben')?.leftAt
    ).toBeUndefined()

    await b.service.leave(PROJECT)
    // Ben keeps his copy, and it no longer syncs.
    expect(b.service.stateOf(PROJECT)).toBeNull()
    expect(titleOf(b.db, 'item-1')).toBe('Paint the hall')

    await a.service.syncNow(PROJECT)
    expect(a.left).toEqual([{ projectId: PROJECT, name: 'Ben' }])
    const ben = a.service.stateOf(PROJECT)?.members.find((member) => member.name === 'Ben')
    expect(ben?.leftAt).toEqual(expect.any(Number))
    // What Ben did stays.
    expect(titleOf(a.db, 'item-1')).toBe('Paint the hall')
    expect(a.service.stateOf(PROJECT)?.problems).toEqual([])

    // Said once.
    await a.service.syncNow(PROJECT)
    expect(a.left).toHaveLength(1)
  })

  it('gives a member with no Me card a person, the same one on every PC', async () => {
    const a = await openPc('pc-a-', 'Ann')
    const b = await openPc('pc-b-', 'Ben')
    const c = await openPc('pc-c-', 'Cat')
    for (const pc of [a, b, c]) pc.service.start()
    await a.service.share(PROJECT, folder)
    const invite = a.service.invite(PROJECT)!
    await b.service.join(invite, folder)
    await c.service.join(invite, folder)
    await a.service.syncNow(PROJECT)
    await c.service.syncNow(PROJECT)

    const personOf = (db: Database.Database, name: string) =>
      db
        .prepare(
          `SELECT p.id, p.name, p.is_me FROM sync_members m JOIN people p ON p.id = m.person_id
           WHERE m.name = ?`
        )
        .get(name) as { id: string; name: string; is_me: number } | undefined
    const onA = personOf(a.db, 'Ben')
    expect(onA).toMatchObject({ name: 'Ben', is_me: 0 })
    expect(personOf(c.db, 'Ben')).toEqual(onA)
    // A PC gives its own member no second person.
    expect(personOf(b.db, 'Ben')).toBeUndefined()
  })

  it('picks up shares already in the database when it starts', async () => {
    const a = await openPc('pc-a-', 'Ann')
    await a.service.share(PROJECT, folder)
    await a.service.stop()
    pcs.splice(pcs.indexOf(a), 1)
    a.db.close()

    const databasePath = (a.db as unknown as { name: string }).name
    const again = new SyncService({
      databasePath,
      library: noLibrary,
      projectSettings: () => SETTINGS,
      onProjectChanged: () => undefined,
      onStateChanged: () => undefined,
      logError: () => undefined,
      pushCheckMs: 60_000,
      scanIntervalMs: 60_000
    })
    again.start()
    await again.syncNow(PROJECT)
    expect(again.stateOf(PROJECT)?.status).toBe('up-to-date')
    await again.stop()
  })
})
