import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueryDb } from '../../mobile/src/data/queries'
import { useTempDir } from '../helpers/temp-dir'

const { PlanningService } = await import('../../electron/services/planning-service')
const { PeopleService } = await import('../../electron/services/people-service')
const { createMigratedDatabase } = await import('../helpers/database')
const { myWork } = await import('../../mobile/src/data/home')

// The phone's My Day runs the desktop's HomeService.getMyWork over its database.

const human = { kind: 'human' as const }
const PROJECT = 'p1'
const info = { name: () => 'House', color: () => '#336699' }

describe("Home's lists on the phone", () => {
  const tempDir = useTempDir('ostler-mobile-home-')
  let db: Database.Database

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 14, 10, 0))
    const path = await createMigratedDatabase(tempDir())
    const planning = new PlanningService(path, () => [PROJECT])
    const people = new PeopleService(path)
    const me = people.create({ name: 'Robin Example' }).id
    const other = people.create({ name: 'Sam Example' }).id
    planning.createWorkItem(PROJECT, { title: 'Late', targetDate: '2026-10-15' }, human)
    planning.createWorkItem(
      PROJECT,
      { title: 'Due today', targetDate: '2026-10-16', assigneeId: me },
      human
    )
    planning.createWorkItem(
      PROJECT,
      { title: 'Soon', targetDate: '2026-10-18', assigneeId: me },
      human
    )
    planning.createWorkItem(
      PROJECT,
      { title: 'Not mine', targetDate: '2026-10-16', assigneeId: other },
      human
    )
    planning.close()
    people.close()
    db = new Database(path)
    db.prepare('UPDATE people SET is_me = 1 WHERE id = ?').run(me)
    vi.setSystemTime(new Date(2026, 9, 16, 10, 0))
  })

  afterEach(() => {
    db.close()
    vi.useRealTimers()
  })

  it("lists Today (Me's or nobody's) and the coming days", () => {
    const work = myWork(db as unknown as QueryDb, info, '2026-10-16')
    expect(work.today.map((task) => [task.title, task.reason])).toEqual([
      ['Late', 'overdue'],
      ['Due today', 'today']
    ])
    expect(work.today[0].projectName).toBe('House')
    expect(work.upcoming.map((day) => [day.date, day.tasks.map((task) => task.title)])).toEqual([
      ['2026-10-18', ['Soon']]
    ])
  })
})
