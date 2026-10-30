import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { attachChangeRecorder } from '../../electron/services/change-history/recorder'
import { FolderTransport } from '../../electron/services/sync/folder-transport'
import { refreshKeys } from '../../electron/services/sync/rotation'
import {
  inviteFor,
  joinShare,
  refreshMembers,
  shareProject
} from '../../electron/services/sync/sharing'
import { refreshRoles, writeRoleChange } from '../../electron/services/sync/roles'
import { pullChanges, pushChanges } from '../../electron/services/sync/sync-runner'
import {
  identityKeys,
  keyGenerationOf,
  personKeys,
  projectKeyFor,
  projectKeyring
} from '../../electron/services/sync/sync-keys'
import { createMigratedDatabase } from '../helpers/database'

/*
 * A Contributor (D5) changes only tasks assigned to them, the checks, time blocks and blockers
 * of those tasks, their own time entries and their own comments. The database refuses
 * everything else on their PC (`ostler:contributor-only`), and every receiving PC skips it.
 */

const SHARED = 'shared-project'
const ME = 'person-me'
const THEM = 'person-them'
const CONTRIBUTOR_ONLY = /ostler:contributor-only/

describe('a Contributor PC changes only its own work', () => {
  let tempDir: string
  let db: Database.Database

  const insertItem = (id: string, title: string) =>
    db
      .prepare(
        `INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at)
         VALUES (?, ?, ?, 'ready', 'medium', 'human', 1, 1)`
      )
      .run(id, SHARED, title)

  const insertTime = (id: string, taskId: string, person: string) =>
    db
      .prepare(
        `INSERT INTO planning_time_entries (id, project_id, work_item_id, person_id, started_at, duration_seconds, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, 60, 'manual', 1, 1)`
      )
      .run(id, SHARED, taskId, person)

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-contributor-'))
    db = new Database(await createMigratedDatabase(tempDir))
    db.prepare(
      `INSERT INTO sync_shares (project_id, share_id, folder, member_id, device_id, format_version, created_at)
       VALUES (?, 'share-1', 'x', 'm1', 'dev-a', 1, 1)`
    ).run(SHARED)
    db.prepare(
      `INSERT INTO people (id, name, initials, color, is_me, created_at, updated_at)
       VALUES (?, 'Me', 'M', '#000', 1, 1, 1), (?, 'Them', 'T', '#000', 0, 1, 1)`
    ).run(ME, THEM)
    attachChangeRecorder(db)
    // Content is made while this PC is an Editor; the Contributor role is set afterwards.
    insertItem('mine', 'My task')
    insertItem('theirs', "Someone else's task")
    db.prepare("UPDATE planning_work_items SET assignee_id = ? WHERE id = 'mine'").run(ME)
    db.prepare("UPDATE planning_work_items SET assignee_id = ? WHERE id = 'theirs'").run(THEM)
    db.prepare(
      `INSERT INTO planning_checklist_checks (work_item_id, project_id, criterion_text, checked_at)
       VALUES ('theirs', ?, 'Done', 1)`
    ).run(SHARED)
    insertTime('t-them', 'mine', THEM)
    db.prepare("UPDATE sync_shares SET my_role = 'contributor' WHERE project_id = ?").run(SHARED)
  })

  afterEach(() => {
    db.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('lets them change the status and title of their own task', () => {
    expect(() =>
      db
        .prepare(
          "UPDATE planning_work_items SET status = 'done', title = 'Mine, done' WHERE id = 'mine'"
        )
        .run()
    ).not.toThrow()
  })

  it('refuses reassigning their task, and changing or taking someone else’s', () => {
    expect(() =>
      db.prepare('UPDATE planning_work_items SET assignee_id = ? WHERE id = ?').run(THEM, 'mine')
    ).toThrow(CONTRIBUTOR_ONLY)
    expect(() =>
      db.prepare("UPDATE planning_work_items SET title = 'Hijack' WHERE id = 'theirs'").run()
    ).toThrow(CONTRIBUTOR_ONLY)
    expect(() =>
      db.prepare('UPDATE planning_work_items SET assignee_id = ? WHERE id = ?').run(ME, 'theirs')
    ).toThrow(CONTRIBUTOR_ONLY)
  })

  it('refuses creating and deleting a task', () => {
    expect(() => insertItem('new', 'New')).toThrow(CONTRIBUTOR_ONLY)
    expect(() => db.prepare("DELETE FROM planning_work_items WHERE id = 'mine'").run()).toThrow(
      CONTRIBUTOR_ONLY
    )
  })

  it('lets them tick a check and add a time block on their task, not on someone else’s', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO planning_checklist_checks (work_item_id, project_id, criterion_text, checked_at)
           VALUES ('mine', ?, 'Sanded', 1)`
        )
        .run(SHARED)
    ).not.toThrow()
    const block = (taskId: string) =>
      db
        .prepare(
          `INSERT INTO planning_time_blocks (id, project_id, work_item_id, day, start_minute, length_minutes, created_at)
           VALUES (?, ?, ?, '2026-10-29', 540, 60, 1)`
        )
        .run(`block-${taskId}`, SHARED, taskId)
    expect(() => block('mine')).not.toThrow()
    expect(() => block('theirs')).toThrow(CONTRIBUTOR_ONLY)
    expect(() =>
      db.prepare("DELETE FROM planning_checklist_checks WHERE work_item_id = 'theirs'").run()
    ).toThrow(CONTRIBUTOR_ONLY)
  })

  it('lets them log time for themselves, not for someone else', () => {
    expect(() => insertTime('t-me', 'theirs', ME)).not.toThrow()
    expect(() => insertTime('t-other', 'mine', THEM)).toThrow(CONTRIBUTOR_ONLY)
    expect(() =>
      db.prepare("UPDATE planning_time_entries SET note = 'x' WHERE id = 't-them'").run()
    ).toThrow(CONTRIBUTOR_ONLY)
  })

  it('lets them comment as themselves only', () => {
    const comment = (id: string, author: string) =>
      db
        .prepare(
          `INSERT INTO planning_comments (id, project_id, work_item_id, author_person_id, author_kind, body, created_at, updated_at)
           VALUES (?, ?, 'theirs', ?, 'human', 'Note', 1, 1)`
        )
        .run(id, SHARED, author)
    expect(() => comment('c-me', ME)).not.toThrow()
    expect(() => comment('c-other', THEM)).toThrow(CONTRIBUTOR_ONLY)
  })

  it('refuses the Library and the project budget', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO library_items (id, project_id, kind, title, ai_access, created_at, updated_at)
           VALUES ('lib-1', ?, 'note', 'Brief', 'read', '2026-10-24', '2026-10-24')`
        )
        .run(SHARED)
    ).toThrow(CONTRIBUTOR_ONLY)
    expect(() =>
      db
        .prepare(
          "INSERT INTO project_budgets (project_id, amount, currency, updated_at) VALUES (?, 5, 'NZD', 1)"
        )
        .run(SHARED)
    ).toThrow(CONTRIBUTOR_ONLY)
  })
})

const PROJECT = 'house-project'
const SETTINGS = { name: 'House', color: '#336699', notes: '', tags: [] }
const person = (personId: string, name: string) => ({
  personId,
  name,
  initials: name[0],
  color: '#336699'
})

describe('every PC keeps only a Contributor’s allowed changes', () => {
  let tempDir: string
  let folder: string
  let dbA: Database.Database
  let dbB: Database.Database
  let dbC: Database.Database
  let shareId: string
  const opened: Database.Database[] = []

  const transport = (): FolderTransport => new FolderTransport(folder)
  const personOf = (d: Database.Database): string => personKeys(d).publicKey

  const openPc = async (name: string) => {
    const d = new Database(await createMigratedDatabase(fs.mkdtempSync(path.join(tempDir, name))))
    attachChangeRecorder(d)
    opened.push(d)
    return d
  }

  const push = (d: Database.Database) =>
    pushChanges(d, transport(), PROJECT, {
      projectKey: projectKeyFor(d, PROJECT)!,
      keyGeneration: keyGenerationOf(d, PROJECT),
      privateKey: identityKeys(d).privateKey
    })

  const pull = async (d: Database.Database) => {
    const through = transport()
    await refreshKeys(d, through, PROJECT)
    const keyring = projectKeyring(d, PROJECT)
    await refreshMembers(d, through, shareId, keyring)
    await refreshRoles(d, through, shareId, keyring)
    return pullChanges(d, through, PROJECT, { projectKey: keyring })
  }

  const titleOf = (d: Database.Database, id: string): string | undefined =>
    (
      d.prepare('SELECT title FROM planning_work_items WHERE id = ?').get(id) as
        { title: string } | undefined
    )?.title

  const rename = (d: Database.Database, id: string, title: string) =>
    d.prepare('UPDATE planning_work_items SET title = ? WHERE id = ?').run(title, id)

  const logTime = (d: Database.Database, id: string, taskId: string, who: string) =>
    d
      .prepare(
        `INSERT INTO planning_time_entries (id, project_id, work_item_id, person_id, started_at, duration_seconds, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, 60, 'manual', 1, 1)`
      )
      .run(id, PROJECT, taskId, who)

  const timeIds = (d: Database.Database): string[] =>
    (d.prepare('SELECT id FROM planning_time_entries ORDER BY id').all() as { id: string }[]).map(
      (row) => row.id
    )

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-sync-contributor-'))
    folder = path.join(tempDir, 'shared')
    fs.mkdirSync(folder)
    dbA = await openPc('pc-a-')
    dbB = await openPc('pc-b-')
    dbC = await openPc('pc-c-')
    for (const d of [dbA, dbB, dbC]) {
      d.prepare(
        `INSERT INTO people (id, name, initials, color, is_me, created_at, updated_at)
         VALUES ('person-ann', 'Ann', 'A', '#000', 0, 1, 1), ('person-ben', 'Ben', 'B', '#000', 0, 1, 1)`
      ).run()
    }
    for (const id of ['item-1', 'item-2', 'item-3']) {
      dbA
        .prepare(
          `INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at)
           VALUES (?, ?, ?, 'ready', 'medium', 'human', 1, 1)`
        )
        .run(id, PROJECT, id)
    }
    dbA
      .prepare("UPDATE planning_work_items SET assignee_id = 'person-ben' WHERE id = 'item-2'")
      .run()
    dbA
      .prepare("UPDATE planning_work_items SET assignee_id = 'person-ann' WHERE id = 'item-3'")
      .run()
    await shareProject(dbA, transport(), PROJECT, {
      folder,
      memberName: 'Ann',
      project: SETTINGS,
      me: person('person-ann', 'Ann')
    })
    shareId = (dbA.prepare('SELECT share_id FROM sync_shares').get() as { share_id: string })
      .share_id
    await joinShare(dbB, transport(), inviteFor(dbA, PROJECT, 'editor')!, {
      folder,
      memberName: 'Ben',
      me: person('person-ben', 'Ben')
    })
    await joinShare(dbC, transport(), inviteFor(dbA, PROJECT, 'viewer')!, {
      folder,
      memberName: 'Cat',
      me: person('person-cat', 'Cat')
    })
    await pull(dbA)
    await pull(dbB)
    await pull(dbC)
    await pull(dbA)
  })

  afterEach(() => {
    for (const d of opened.splice(0)) d.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('applies a Contributor’s changes to their task and time and skips the rest (forged)', async () => {
    await writeRoleChange(dbA, transport(), PROJECT, personOf(dbB), 'contributor')
    // B has not read the demotion, so its own guard lets these through: they are forged as far as A can tell.
    rename(dbB, 'item-2', 'Ben’s task, renamed')
    rename(dbB, 'item-3', 'Ann’s task, hijacked')
    logTime(dbB, 'time-ben', 'item-3', 'person-ben')
    logTime(dbB, 'time-fake', 'item-2', 'person-ann')
    await push(dbB)

    const atA = await pull(dbA)
    expect(atA.problems).toEqual([expect.objectContaining({ reason: 'not-allowed' })])
    expect(titleOf(dbA, 'item-2')).toBe('Ben’s task, renamed')
    expect(titleOf(dbA, 'item-3')).toBe('item-3')
    expect(timeIds(dbA)).toEqual(['time-ben'])

    await pull(dbC)
    expect(titleOf(dbC, 'item-2')).toBe('Ben’s task, renamed')
    expect(titleOf(dbC, 'item-3')).toBe('item-3')
    expect(timeIds(dbC)).toEqual(['time-ben'])
  })

  it('refuses a forged reassignment of their own task', async () => {
    await writeRoleChange(dbA, transport(), PROJECT, personOf(dbB), 'contributor')
    dbB
      .prepare("UPDATE planning_work_items SET assignee_id = 'person-ann' WHERE id = 'item-2'")
      .run()
    await push(dbB)
    const atA = await pull(dbA)
    expect(atA.problems).toEqual([expect.objectContaining({ reason: 'not-allowed' })])
    const assignee = dbA
      .prepare("SELECT assignee_id FROM planning_work_items WHERE id = 'item-2'")
      .get() as { assignee_id: string }
    expect(assignee.assignee_id).toBe('person-ben')
  })

  it('still applies edits made while they were an Editor, before the demotion', async () => {
    rename(dbB, 'item-3', 'Edited as Editor')
    await push(dbB)
    await pull(dbA)
    await writeRoleChange(dbA, transport(), PROJECT, personOf(dbB), 'contributor')
    const atA = await pull(dbA)
    expect(atA.problems).toEqual([])
    expect(titleOf(dbA, 'item-3')).toBe('Edited as Editor')
  })
})
