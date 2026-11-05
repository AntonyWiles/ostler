import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { attachChangeRecorder } from '../../electron/services/change-history/recorder'
import { recordChanges } from '../../electron/services/change-history/context'
import {
  attachSyncCapture,
  releaseSyncCapture,
  withSyncApplying
} from '../../electron/services/sync/capture'
import {
  markProjectSeen,
  markTasksSeen,
  unseenTasks
} from '../../electron/services/sync/task-unseen'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'
import type { EditDb } from '../../mobile/src/data/edits'
import type { QueryDb } from '../../mobile/src/data/queries'

const plan = await import('../../mobile/src/data/plan')

/** New and changed marks (MOP-82): only what someone or something else did marks a task. */
describe('task new and changed marks', () => {
  const tempDir = useTempDir('ostler-task-unseen-')
  let dbPath: string
  let db: Database.Database

  beforeEach(async () => {
    dbPath = await createMigratedDatabase(tempDir())
    db = new Database(dbPath)
    attachChangeRecorder(db)
  })

  afterEach(() => {
    db.close()
  })

  const insert = (target: Database.Database, id: string) =>
    target
      .prepare(
        `INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at)
         VALUES (?, 'p-1', 'A task', 'ready', 'medium', 'human', 1, 1)`
      )
      .run(id)
  const rename = (target: Database.Database, id: string, title: string) =>
    target.prepare('UPDATE planning_work_items SET title = ? WHERE id = ?').run(title, id)
  const asPerson = (run: () => void) =>
    recordChanges('test', async () => {
      run()
    })

  it('starts with nothing marked', () => {
    expect(unseenTasks(db, 'p-1')).toEqual({})
  })

  it('leaves the person’s own new and changed tasks unmarked', async () => {
    await asPerson(() => insert(db, 't-1'))
    await asPerson(() => rename(db, 't-1', 'Renamed'))
    expect(unseenTasks(db, 'p-1')).toEqual({})
  })

  it('marks a task an agent or the automation API makes, then changes', () => {
    insert(db, 't-1')
    expect(unseenTasks(db, 'p-1')).toEqual({ 't-1': 'new' })
    rename(db, 't-1', 'Renamed')
    expect(unseenTasks(db, 'p-1')).toEqual({ 't-1': 'new' })
    markTasksSeen(db, ['t-1'])
    rename(db, 't-1', 'Again')
    expect(unseenTasks(db, 'p-1')).toEqual({ 't-1': 'changed' })
  })

  it('marks a change from another device, even during the person’s own call', async () => {
    await asPerson(() => insert(db, 't-1'))
    await asPerson(() => withSyncApplying(() => rename(db, 't-1', 'From the phone')))
    expect(unseenTasks(db, 'p-1')).toEqual({ 't-1': 'changed' })
  })

  it('ignores bookkeeping such as the order', async () => {
    await asPerson(() => insert(db, 't-1'))
    db.prepare(
      "UPDATE planning_work_items SET order_key = 'b', updated_at = 9 WHERE id = 't-1'"
    ).run()
    expect(unseenTasks(db, 'p-1')).toEqual({})
  })

  it('clears the mark when the person changes the task, or it is deleted', async () => {
    insert(db, 't-1')
    insert(db, 't-2')
    await asPerson(() => rename(db, 't-1', 'Seen by editing'))
    expect(unseenTasks(db, 'p-1')).toEqual({ 't-2': 'new' })
    db.prepare("DELETE FROM planning_work_items WHERE id = 't-2'").run()
    expect(unseenTasks(db, 'p-1')).toEqual({})
  })

  it('clears every mark in a project', () => {
    insert(db, 't-1')
    insert(db, 't-2')
    markProjectSeen(db, 'p-1')
    expect(unseenTasks(db, 'p-1')).toEqual({})
  })

  it('marks changes applied on the phone, whose connection answers from tables', () => {
    const phone = new Database(dbPath)
    try {
      attachSyncCapture(phone, { answers: 'tables' })
      insert(phone, 't-1')
      expect(unseenTasks(phone, 'p-1')).toEqual({})
      withSyncApplying(() => rename(phone, 't-1', 'From the PC'))
      expect(unseenTasks(phone, 'p-1')).toEqual({ 't-1': 'changed' })
    } finally {
      releaseSyncCapture(phone)
      phone.close()
    }
  })

  it('shows the mark on the phone’s task rows until the task is opened', () => {
    insert(db, 't-1')
    expect(plan.taskRowDetails(db as unknown as QueryDb, 'p-1').get('t-1')?.unseen).toBe('new')
    expect(plan.markTaskSeen(db as unknown as EditDb, 't-1')).toBe(true)
    expect(plan.markTaskSeen(db as unknown as EditDb, 't-1')).toBe(false)
    expect(plan.taskRowDetails(db as unknown as QueryDb, 'p-1').get('t-1')?.unseen).toBeNull()
  })
})
