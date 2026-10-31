import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attachChangeRecorder } from '../../electron/services/change-history/recorder'
import { applyChanges, retryWaiting } from '../../electron/services/sync/apply'
import { withSyncApplying } from '../../electron/services/sync/capture'
import {
  newIdentityKeys,
  newProjectKey,
  type IdentityKeys
} from '../../electron/services/sync/change-file'
import { FolderTransport } from '../../electron/services/sync/folder-transport'
import { loadSnapshot, readSnapshot } from '../../electron/services/sync/snapshots'
import { pullRecords, pushRecords } from '../../electron/services/sync/records'
import { PERSONAL_PROJECT_ID } from '../../electron/services/sync/synced-tables'
import { pullChanges, pushChanges } from '../../electron/services/sync/sync-runner'
import { deleteProjectRows } from '../../electron/services/project-removal-service'
import { openSecret, sealSecret } from '../../electron/safe-storage'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

// Sealing needs Electron's safeStorage; a reversible stand-in lets the test seal and open for real.
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`enc:${value}`),
    decryptString: (buffer: Buffer) => buffer.toString('utf8').replace(/^enc:/, '')
  }
}))

const PROJECT = 'shared-project'
const PERSONAL_SHARE = 'share-personal'
const PROJECT_SHARE = 'share-project'

describe('personal tables travel in the personal share', () => {
  const tempDir = useTempDir('ostler-sync-personal-')
  let personalFolder: string
  let projectFolder: string
  let dbA: Database.Database
  let dbB: Database.Database
  let personalKey: Buffer
  let projectKey: Buffer
  let keysA: IdentityKeys
  let keysB: IdentityKeys

  const personalTransport = (): FolderTransport => new FolderTransport(personalFolder)
  const projectTransport = (): FolderTransport => new FolderTransport(projectFolder)

  /** A PC of one person: the personal share (and, unless `personal` is false, the project share). */
  const openPc = async (
    name: string,
    member: string,
    device: string,
    { personal = true }: { personal?: boolean } = {}
  ) => {
    const dir = fs.mkdtempSync(path.join(tempDir(), `${name}-`))
    const db = new Database(await createMigratedDatabase(dir))
    db.prepare(
      `INSERT INTO sync_shares (project_id, share_id, folder, member_id, device_id, format_version, created_at)
       VALUES (?, ?, ?, ?, ?, 1, 1)`
    ).run(PROJECT, PROJECT_SHARE, projectFolder, member, device)
    if (personal) {
      db.prepare(
        `INSERT INTO sync_shares (project_id, share_id, folder, member_id, device_id, format_version, created_at, kind)
         VALUES (?, ?, ?, ?, ?, 1, 1, 'personal')`
      ).run(PERSONAL_PROJECT_ID, PERSONAL_SHARE, personalFolder, member, device)
    }
    for (const share of [PROJECT_SHARE, PERSONAL_SHARE]) {
      for (const [memberId, publicKey] of [
        ['m-a', keysA.publicKey],
        ['m-b', keysB.publicKey]
      ]) {
        db.prepare(
          `INSERT INTO sync_members (share_id, member_id, person_id, name, public_key, joined_at)
           VALUES (?, ?, NULL, ?, ?, 1)`
        ).run(share, memberId, memberId, publicKey)
      }
    }
    attachChangeRecorder(db)
    return db
  }

  const personalPush = (db: Database.Database, keys: IdentityKeys) =>
    pushChanges(db, personalTransport(), PERSONAL_PROJECT_ID, {
      projectKey: personalKey,
      privateKey: keys.privateKey
    })
  const personalPull = (db: Database.Database) =>
    pullChanges(db, personalTransport(), PERSONAL_PROJECT_ID, { projectKey: personalKey })

  /** A person row. Unless `captured`, it is written as if it came from the project share: not captured. */
  const addPerson = (
    db: Database.Database,
    id: string,
    name: string,
    isMe = 0,
    captured = false
  ) => {
    const insert = () =>
      db
        .prepare(
          `INSERT INTO people (id, name, initials, color, is_me, created_at, updated_at)
           VALUES (?, ?, ?, '#123456', ?, 1, 1)`
        )
        .run(id, name, name.slice(0, 2).toUpperCase(), isMe)
    if (captured) insert()
    else withSyncApplying(insert)
  }

  const nameOf = (db: Database.Database, id: string): string | undefined =>
    (db.prepare('SELECT name FROM people WHERE id = ?').get(id) as { name: string } | undefined)
      ?.name

  const countOf = (db: Database.Database, sql: string, ...args: unknown[]): number =>
    (db.prepare(sql).get(...args) as { n: number }).n

  const filesUnder = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name)
      return entry.isDirectory() ? filesUnder(full) : [full]
    })

  beforeEach(async () => {
    personalFolder = path.join(tempDir(), 'personal')
    projectFolder = path.join(tempDir(), 'project')
    fs.mkdirSync(personalFolder)
    fs.mkdirSync(projectFolder)
    personalKey = newProjectKey()
    projectKey = newProjectKey()
    keysA = newIdentityKeys()
    keysB = newIdentityKeys()
    dbA = await openPc('pc-a', 'm-a', 'dev-a')
    dbB = await openPc('pc-b', 'm-b', 'dev-b')
  })

  afterEach(() => {
    dbA.close()
    dbB.close()
  })

  it('carries a My Day entry, a reminder, a contact, a goal and a day off from A to B, with edits and deletes', async () => {
    // The task itself comes through the project share; both PCs have it.
    for (const db of [dbA, dbB]) {
      withSyncApplying(() =>
        db
          .prepare(
            `INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at)
             VALUES ('item-1', ?, 'Paint hall', 'ready', 'medium', 'human', 1, 1)`
          )
          .run(PROJECT)
      )
    }
    dbA.exec(`
      INSERT INTO my_day_entries (day, work_item_id, project_id, order_key, added_at)
        VALUES ('2026-10-24', 'item-1', '${PROJECT}', 'a0', 1);
      INSERT INTO reminders (id, project_id, work_item_id, remind_at, kind)
        VALUES ('rem-1', '${PROJECT}', 'item-1', 5, 'due');
      INSERT INTO contacts (id, name, created_at, updated_at) VALUES ('c-1', 'Carla', 1, 1);
      INSERT INTO personal_goals (id, title, created_at, updated_at) VALUES ('g-1', 'Run', 1, 1);
      INSERT INTO days_off (id, first_date, last_date, name, created_at, updated_at)
        VALUES ('off-1', '2026-12-24', '2026-12-26', 'Christmas', 1, 1),
               ('off-2', '2027-01-04', '2027-01-04', 'Wrong day', 1, 1);
    `)

    await personalPush(dbA, keysA)
    const pulled = await personalPull(dbB)
    expect(pulled).toMatchObject({ applied: 6, problems: [] })
    expect(countOf(dbB, 'SELECT COUNT(*) AS n FROM my_day_entries')).toBe(1)
    expect(countOf(dbB, 'SELECT COUNT(*) AS n FROM reminders')).toBe(1)
    expect(nameOf(dbB, 'c-1')).toBeUndefined()
    expect(countOf(dbB, "SELECT COUNT(*) AS n FROM contacts WHERE name = 'Carla'")).toBe(1)
    expect(countOf(dbB, 'SELECT COUNT(*) AS n FROM personal_goals')).toBe(1)
    expect(countOf(dbB, 'SELECT COUNT(*) AS n FROM days_off')).toBe(2)
    expect(countOf(dbB, 'SELECT COUNT(*) AS n FROM sync_outbox')).toBe(0)

    // Edit one row and delete another on A; both follow to B.
    dbA.exec(`
      UPDATE contacts SET name = 'Carla Ng' WHERE id = 'c-1';
      DELETE FROM days_off WHERE id = 'off-2';
    `)
    await personalPush(dbA, keysA)
    await personalPull(dbB)
    expect(countOf(dbB, "SELECT COUNT(*) AS n FROM contacts WHERE name = 'Carla Ng'")).toBe(1)
    expect(countOf(dbB, "SELECT COUNT(*) AS n FROM days_off WHERE id = 'off-2'")).toBe(0)
    expect(countOf(dbB, "SELECT COUNT(*) AS n FROM days_off WHERE id = 'off-1'")).toBe(1)
  })

  it('keeps exactly one Me on each device and does not send a Me row', async () => {
    addPerson(dbA, 'me-a', 'Ann', 1, true)
    addPerson(dbA, 'bob', 'Bob', 0, true)
    addPerson(dbB, 'me-b', 'Ben', 1, true)

    await personalPush(dbA, keysA)
    await personalPull(dbB)

    expect(dbB.prepare('SELECT id FROM people WHERE is_me = 1').all()).toEqual([{ id: 'me-b' }])
    expect(nameOf(dbB, 'bob')).toBe('Bob')
    expect(nameOf(dbB, 'me-a')).toBeUndefined()
    expect(dbA.prepare('SELECT id FROM people WHERE is_me = 1').all()).toEqual([{ id: 'me-a' }])
  })

  it('carries a team and its members from A to B, and never into the project share (teams, D1)', async () => {
    // Bob is in both address books already.
    addPerson(dbA, 'bob', 'Bob')
    addPerson(dbB, 'bob', 'Bob')
    dbA.exec(`
      INSERT INTO teams (id, name, color, lead_person_id, position, created_at, updated_at)
        VALUES ('team-1', 'Design', '#3b82f6', 'bob', 0, 1, 1);
      INSERT INTO team_members (team_id, person_id) VALUES ('team-1', 'bob');
    `)

    // Only the personal share has anything to send.
    expect(
      countOf(
        dbA,
        'SELECT COUNT(*) AS n FROM sync_outbox WHERE project_id = ? AND table_name IN (?, ?)',
        PROJECT,
        'teams',
        'team_members'
      )
    ).toBe(0)

    await personalPush(dbA, keysA)
    await personalPull(dbB)
    expect(
      dbB.prepare('SELECT name, lead_person_id FROM teams WHERE id = ?').get('team-1')
    ).toEqual({ name: 'Design', lead_person_id: 'bob' })
    expect(
      dbB.prepare('SELECT person_id FROM team_members WHERE team_id = ?').all('team-1')
    ).toEqual([{ person_id: 'bob' }])

    // A rename and a removed member follow too.
    dbA.exec(`
      UPDATE teams SET name = 'Design crew' WHERE id = 'team-1';
      DELETE FROM team_members WHERE team_id = 'team-1' AND person_id = 'bob';
    `)
    await personalPush(dbA, keysA)
    await personalPull(dbB)
    expect(countOf(dbB, "SELECT COUNT(*) AS n FROM teams WHERE name = 'Design crew'")).toBe(1)
    expect(countOf(dbB, 'SELECT COUNT(*) AS n FROM team_members')).toBe(0)
  })

  it('opens a connected account token on A and seals it again on B, with no plain token in the folder', async () => {
    const token = 'tok-SECRET-123'
    dbA
      .prepare(
        `INSERT INTO connected_accounts (id, provider, label, secret, created_at, updated_at)
         VALUES ('acc-1', 'google', 'ann@example.com', ?, 1, 1)`
      )
      .run(sealSecret(token))
    dbA
      .prepare(
        `INSERT INTO account_apps (provider, client_id, client_secret, updated_at)
         VALUES ('google', 'client-1', ?, 1)`
      )
      .run(sealSecret('app-SECRET-456'))
    // Waiting to be sent, the tokens stay sealed in the database.
    const waiting = dbA.prepare('SELECT columns FROM sync_outbox').all() as { columns: string }[]
    expect(waiting.length).toBeGreaterThan(0)
    for (const row of waiting) {
      expect(row.columns).not.toContain(token)
      expect(row.columns).not.toContain('app-SECRET-456')
    }

    await personalPush(dbA, keysA)
    await personalPull(dbB)

    const account = dbB
      .prepare("SELECT secret FROM connected_accounts WHERE id = 'acc-1'")
      .get() as { secret: string }
    expect(account.secret).not.toBe(token)
    expect(openSecret(account.secret)).toBe(token)
    const app = dbB
      .prepare("SELECT client_secret FROM account_apps WHERE provider = 'google'")
      .get() as { client_secret: string }
    expect(openSecret(app.client_secret)).toBe('app-SECRET-456')

    const bytes = Buffer.concat(filesUnder(personalFolder).map((file) => fs.readFileSync(file)))
    expect(bytes.length).toBeGreaterThan(0)
    expect(bytes.includes(Buffer.from(token))).toBe(false)
    expect(bytes.includes(Buffer.from('app-SECRET-456'))).toBe(false)
  })

  it('refuses a personal-table change in a project share and a project-table change in the personal share', () => {
    const stamp = '000000000000001-000000-dev-a'
    const contact = {
      table: 'contacts',
      rowKey: '["c-x"]',
      op: 'upsert' as const,
      columns: { id: 'c-x', name: 'X', created_at: 1, updated_at: 1 },
      stamp,
      actor: { kind: 'system' }
    }
    const item = {
      table: 'planning_work_items',
      rowKey: '["item-z"]',
      op: 'upsert' as const,
      columns: { id: 'item-z', project_id: PROJECT, title: 'Z' },
      stamp,
      actor: { kind: 'system' }
    }

    const inProject = applyChanges(dbB, PROJECT_SHARE, [contact])
    expect(inProject).toMatchObject({ applied: 0, skipped: 1, pending: 0 })
    expect(countOf(dbB, "SELECT COUNT(*) AS n FROM contacts WHERE id = 'c-x'")).toBe(0)

    const inPersonal = applyChanges(dbB, PERSONAL_SHARE, [item])
    expect(inPersonal).toMatchObject({ applied: 0, skipped: 1, pending: 0 })
    expect(countOf(dbB, "SELECT COUNT(*) AS n FROM planning_work_items WHERE id = 'item-z'")).toBe(
      0
    )
  })

  it('ends with the newest name on both PCs when one person is renamed through the project share, then the personal share', async () => {
    // Bob exists on both PCs without being captured (he came from the project share).
    addPerson(dbA, 'bob', 'Bob')
    addPerson(dbB, 'bob', 'Bob')
    dbA
      .prepare(
        `INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at, assignee_id)
         VALUES ('item-1', ?, 'Paint hall', 'ready', 'medium', 'human', 1, 1, 'bob')`
      )
      .run(PROJECT)

    // A renames Bob, and the project share's person file carries the older name.
    await pushRecords(
      dbA,
      projectTransport(),
      PROJECT,
      { projectKey, privateKey: keysA.privateKey },
      null
    )
    dbA.prepare("UPDATE people SET name = 'Robert' WHERE id = 'bob'").run()
    await personalPush(dbA, keysA)

    // B takes A's rename, then renames Bob itself a moment later.
    await personalPull(dbB)
    dbB.prepare("UPDATE people SET name = 'Bobby' WHERE id = 'bob'").run()
    await personalPush(dbB, keysB)

    // A reads its personal share and the project share's older person file; the older file loses.
    await personalPull(dbA)
    await pullRecords(dbA, projectTransport(), PROJECT, { projectKey })
    expect(nameOf(dbA, 'bob')).toBe('Bobby')

    // B reads the older person file after its own newer change: the newest name still stands.
    const record = await pullRecords(dbB, projectTransport(), PROJECT, { projectKey })
    expect(record.people).toBe(0)
    expect(nameOf(dbB, 'bob')).toBe('Bobby')
  })

  it("puts the personal tables in a snapshot, with secrets opened and this PC's own columns left out, and loads them back", () => {
    addPerson(dbA, 'me-a', 'Ann', 1, true)
    addPerson(dbA, 'bob', 'Bob', 0, true)
    dbA
      .prepare(
        `INSERT INTO connected_accounts (id, provider, label, secret, created_at, updated_at)
         VALUES ('acc-s', 'google', 'ann@example.com', ?, 1, 1)`
      )
      .run(sealSecret('tok-SNAP'))

    const snapshot = readSnapshot(dbA, PERSONAL_PROJECT_ID)
    const people = snapshot.rows.people as Record<string, unknown>[]
    expect(people.map((row) => row.id)).toEqual(['bob'])
    expect(people[0]).not.toHaveProperty('is_me')
    const account = (snapshot.rows.connected_accounts as Record<string, unknown>[])[0]
    expect(account.secret).toBe('tok-SNAP')

    loadSnapshot(dbB, PERSONAL_PROJECT_ID, snapshot)
    expect(nameOf(dbB, 'bob')).toBe('Bob')
    expect(nameOf(dbB, 'me-a')).toBeUndefined()
    const stored = dbB
      .prepare("SELECT secret FROM connected_accounts WHERE id = 'acc-s'")
      .get() as {
      secret: string
    }
    expect(openSecret(stored.secret)).toBe('tok-SNAP')
  })

  it('loads a personal snapshot whose reminder is on a task not here yet, and applies the reminder once the project is loaded', () => {
    withSyncApplying(() =>
      dbA
        .prepare(
          `INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at)
           VALUES ('item-1', ?, 'Paint hall', 'ready', 'medium', 'human', 1, 1)`
        )
        .run(PROJECT)
    )
    dbA.exec(`
      INSERT INTO reminders (id, project_id, work_item_id, remind_at, kind)
        VALUES ('rem-1', '${PROJECT}', 'item-1', 5, 'due');
      INSERT INTO contacts (id, name, created_at, updated_at) VALUES ('c-1', 'Carla', 1, 1);
    `)

    // A new device loads the personal snapshot before it has joined the project.
    const personal = readSnapshot(dbA, PERSONAL_PROJECT_ID)
    const loaded = loadSnapshot(dbB, PERSONAL_PROJECT_ID, personal)
    expect(loaded.rows).toBe(1)
    expect(countOf(dbB, 'SELECT COUNT(*) AS n FROM contacts')).toBe(1)
    expect(countOf(dbB, 'SELECT COUNT(*) AS n FROM reminders')).toBe(0)
    expect(
      dbB.prepare('SELECT table_name, row_key, waiting_for FROM sync_pending').all()
    ).toEqual([{ table_name: 'reminders', row_key: '["rem-1"]', waiting_for: 'parent' }])
    expect(
      countOf(
        dbB,
        "SELECT COUNT(*) AS n FROM sync_field_stamps WHERE table_name = 'reminders'"
      )
    ).toBe(0)

    loadSnapshot(dbB, PROJECT, readSnapshot(dbA, PROJECT))
    const retried = retryWaiting(dbB, PERSONAL_SHARE)
    expect(retried.pending).toBe(0)
    expect(dbB.prepare("SELECT work_item_id, remind_at FROM reminders WHERE id = 'rem-1'").get()).toEqual({
      work_item_id: 'item-1',
      remind_at: 5
    })
    expect(countOf(dbB, 'SELECT COUNT(*) AS n FROM sync_pending')).toBe(0)
  })

  it('captures nothing for personal tables while no personal share exists', async () => {
    const solo = await openPc('pc-solo', 'm-a', 'dev-solo', { personal: false })
    try {
      solo
        .prepare(
          "INSERT INTO contacts (id, name, created_at, updated_at) VALUES ('c-9', 'Solo', 1, 1)"
        )
        .run()
      solo
        .prepare(
          "INSERT INTO personal_goals (id, title, created_at, updated_at) VALUES ('g-9', 'Read', 1, 1)"
        )
        .run()
      expect(countOf(solo, 'SELECT COUNT(*) AS n FROM sync_outbox')).toBe(0)
      expect(countOf(solo, 'SELECT COUNT(*) AS n FROM sync_field_stamps')).toBe(0)
    } finally {
      solo.close()
    }
  })

  it('leaves the personal share alone when a project is removed', async () => {
    dbA.exec("INSERT INTO contacts (id, name, created_at, updated_at) VALUES ('c-2', 'Dana', 1, 1)")
    dbA.exec(
      "INSERT INTO personal_goals (id, title, created_at, updated_at) VALUES ('g-2', 'Swim', 1, 1)"
    )
    const outboxBefore = countOf(
      dbA,
      'SELECT COUNT(*) AS n FROM sync_outbox WHERE project_id = ?',
      PERSONAL_PROJECT_ID
    )
    expect(outboxBefore).toBeGreaterThan(0)

    deleteProjectRows(dbA, PROJECT)

    expect(
      countOf(
        dbA,
        'SELECT COUNT(*) AS n FROM sync_outbox WHERE project_id = ?',
        PERSONAL_PROJECT_ID
      )
    ).toBe(outboxBefore)
    expect(countOf(dbA, "SELECT COUNT(*) AS n FROM contacts WHERE id = 'c-2'")).toBe(1)
    expect(countOf(dbA, "SELECT COUNT(*) AS n FROM personal_goals WHERE id = 'g-2'")).toBe(1)
    expect(countOf(dbA, "SELECT COUNT(*) AS n FROM sync_shares WHERE kind = 'personal'")).toBe(1)
    expect(() => deleteProjectRows(dbA, PERSONAL_PROJECT_ID)).toThrow(/personal share/)
  })
})
