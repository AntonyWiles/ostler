import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditDb } from '../../mobile/src/data/edits'
import type { QueryDb } from '../../mobile/src/data/queries'
import { useTempDir } from '../helpers/temp-dir'

const { PlanningService } = await import('../../electron/services/planning-service')
const { PeopleService } = await import('../../electron/services/people-service')
const { createMigratedDatabase } = await import('../helpers/database')
const review = await import('../../mobile/src/data/weekly-review')
const status = await import('../../mobile/src/data/status-updates')
const edits = await import('../../mobile/src/data/edits')

// The phone's weekly review and status updates run the desktop's own services over its database.

const human = { kind: 'human' as const }
const PROJECT = 'p1'
const NOW = new Date(2026, 9, 16, 9, 0)
const info = { name: () => 'House', color: () => '#336699' }

describe('weekly review and status updates on the phone', () => {
  const tempDir = useTempDir('ostler-mobile-review-')
  let db: Database.Database
  const ids: Record<string, string> = {}
  let me: string

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 1, 9, 0))
    const path = await createMigratedDatabase(tempDir())
    const planning = new PlanningService(path, () => [PROJECT])
    const people = new PeopleService(path)
    me = people.create({ name: 'Robin Example' }).id
    ids.overdue = planning.createWorkItem(
      PROJECT,
      { title: 'Fit sink', targetDate: '2026-10-10' },
      human
    ).id
    ids.blocked = planning.createWorkItem(
      PROJECT,
      { title: 'Order tiles', status: 'blocked' },
      human
    ).id
    ids.someday = planning.createWorkItem(PROJECT, { title: 'Build a shed' }, human).id
    planning.updateWorkItem(ids.someday, { someday: true }, human)
    ids.soon = planning.createWorkItem(
      PROJECT,
      { title: 'Paint hall', targetDate: '2026-10-20' },
      human
    ).id
    planning.close()
    people.close()
    db = new Database(path)
    db.prepare('UPDATE people SET is_me = 1 WHERE id = ?').run(me)
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    db.close()
    vi.useRealTimers()
  })

  const phone = () => db as unknown as EditDb & QueryDb

  it('lists each step as the PC does', () => {
    const steps = review.weeklyReview(phone(), info, '2026-10-16')
    expect(steps.overdue.map((task) => task.id)).toEqual([ids.overdue])
    expect(steps.overdue[0].projectName).toBe('House')
    expect(steps.blocked.map((task) => task.id)).toEqual([ids.blocked])
    expect(steps.someday.map((task) => task.id)).toEqual([ids.someday])
    expect(steps.upcoming.flatMap((day) => day.tasks.map((task) => task.id))).toEqual([ids.soon])
  })

  it('a task moved on the phone leaves its step, and a finished review is recorded', () => {
    edits.setTaskDueDate(phone(), ids.overdue, '2026-10-17')
    const steps = review.weeklyReview(phone(), info, '2026-10-16')
    expect(steps.overdue).toEqual([])
    const record = review.finishWeeklyReview(phone(), info, { overdue: { shown: 1, changed: 1 } })
    expect(review.lastWeeklyReview(phone(), info)).toEqual(record)
  })

  it('posts a status update as Me, lists it, deletes and restores it', () => {
    const id = status.postStatusUpdate(phone(), PROJECT, 'at-risk', ' Tiles are late. ')
    const [update] = status.statusUpdates(phone(), PROJECT)
    expect(update).toMatchObject({
      id,
      health: 'at-risk',
      note: 'Tiles are late.',
      authorKind: 'human',
      authorPersonId: me,
      authorName: 'Robin Example'
    })
    status.deleteStatusUpdate(phone(), id)
    expect(status.statusUpdates(phone(), PROJECT)).toEqual([])
    status.restoreStatusUpdate(phone(), id)
    expect(status.statusUpdates(phone(), PROJECT)).toHaveLength(1)
  })

  it('refuses a note that is too long', () => {
    expect(() => status.postStatusUpdate(phone(), PROJECT, 'on-track', 'x'.repeat(2001))).toThrow(
      edits.EditRefused
    )
  })
})
