import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueryDb } from '../../mobile/src/data/queries'
import { useTempDir } from '../helpers/temp-dir'

const { PlanningService } = await import('../../electron/services/planning-service')
const { createMigratedDatabase } = await import('../helpers/database')
const { schedule } = await import('../../mobile/src/data/schedule')

const human = { kind: 'human' as const }
const PROJECT = 'p1'

describe("a project's schedule on the phone", () => {
  const tempDir = useTempDir('ostler-mobile-schedule-')
  let db: Database.Database

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 16, 10, 0))
    const path = await createMigratedDatabase(tempDir())
    const planning = new PlanningService(path, () => [PROJECT])
    planning.createWorkItem(PROJECT, { title: 'Late', targetDate: '2026-10-10' }, human)
    planning.createWorkItem(PROJECT, { title: 'This week', targetDate: '2026-10-17' }, human)
    planning.createWorkItem(PROJECT, { title: 'Next week', targetDate: '2026-10-21' }, human)
    planning.createWorkItem(PROJECT, { title: 'Started', startDate: '2026-10-01' }, human)
    planning.createWorkItem(PROJECT, { title: 'Undated' }, human)
    planning.createWorkItem(
      PROJECT,
      { title: 'Done', targetDate: '2026-10-17', status: 'done' },
      human
    )
    planning.createMilestone(PROJECT, { name: 'Handover', targetDate: '2026-10-22' })
    planning.close()
    db = new Database(path)
  })

  afterEach(() => {
    db.close()
    vi.useRealTimers()
  })

  it('puts overdue work first, then each week with its milestones and tasks', () => {
    const plan = schedule(db as unknown as QueryDb, PROJECT, '2026-10-16')
    expect(plan.overdue.map((task) => task.title)).toEqual(['Late'])
    expect(plan.undated).toBe(1)
    expect(
      plan.weeks.map((week) => [
        week.weekStart,
        week.entries.map((entry) => (entry.kind === 'task' ? entry.title : `◆ ${entry.name}`))
      ])
    ).toEqual([
      ['2026-10-12', ['Started', 'This week']],
      ['2026-10-19', ['Next week', '◆ Handover']]
    ])
  })
})
