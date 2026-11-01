import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditDb } from '../../mobile/src/data/edits'
import type { QueryDb } from '../../mobile/src/data/queries'
import { useTempDir } from '../helpers/temp-dir'

const { PlanningService } = await import('../../electron/services/planning-service')
const { PeopleService } = await import('../../electron/services/people-service')
const { createMigratedDatabase } = await import('../helpers/database')
const time = await import('../../mobile/src/data/time')

// Time on the phone runs the desktop's own TimeTracking over its database.

const human = { kind: 'human' as const }
const PROJECT = 'p1'
// Thursday 16 October 2026, 10:00 local time.
const NOW = new Date(2026, 9, 16, 10, 0)

describe('time tracking on the phone', () => {
  const tempDir = useTempDir('ostler-mobile-time-')
  let db: Database.Database
  let me: string
  const ids: Record<string, string> = {}

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    const path = await createMigratedDatabase(tempDir())
    const planning = new PlanningService(path, () => [PROJECT])
    const people = new PeopleService(path)
    me = people.create({ name: 'Robin Example' }).id
    ids.sink = planning.createWorkItem(PROJECT, { title: 'Fit sink' }, human).id
    ids.tiles = planning.createWorkItem(PROJECT, { title: 'Pick tiles' }, human).id
    planning.close()
    people.close()
    db = new Database(path)
    db.prepare('UPDATE people SET is_me = 1 WHERE id = ?').run(me)
  })

  afterEach(() => {
    db.close()
    vi.useRealTimers()
  })

  const phone = () => db as unknown as EditDb & QueryDb

  it('runs one timer at a time, for Me, and stops it', () => {
    const first = time.startTimer(phone(), PROJECT, ids.sink)
    expect(first.started.personId).toBe(me)
    expect(time.taskTime(phone(), ids.sink).running?.id).toBe(first.started.id)
    vi.setSystemTime(NOW.getTime() + 20 * 60_000)
    const second = time.startTimer(phone(), PROJECT, ids.tiles)
    expect(second.stopped?.durationSeconds).toBe(20 * 60)
    expect(time.runningTimer(phone())?.workItemId).toBe(ids.tiles)
    time.undoTimerStart(phone(), second)
    expect(time.runningTimer(phone())?.workItemId).toBe(ids.sink)
    vi.setSystemTime(NOW.getTime() + 30 * 60_000)
    expect(time.stopTimer(phone())?.durationSeconds).toBe(30 * 60)
    expect(time.taskTime(phone(), ids.sink)).toMatchObject({
      loggedSeconds: 30 * 60,
      running: null
    })
  })

  it('logs time by hand on a day, and the timesheet puts it on that day', () => {
    time.logTime(phone(), PROJECT, ids.sink, 90, '2026-10-14', 'Plumbing')
    time.logTime(phone(), PROJECT, ids.tiles, 30, '2026-10-16')
    const sheet = time.timesheet(phone(), time.weekStartOf('2026-10-16'), NOW.getTime())
    expect(sheet.weekStart).toBe('2026-10-12')
    expect(sheet.days.map((day) => day.seconds)).toEqual([0, 0, 5400, 0, 1800, 0, 0])
    expect(sheet.seconds).toBe(7200)
    expect(sheet.byProject).toEqual([{ projectId: PROJECT, seconds: 7200 }])
    expect(sheet.days[2].entries[0]).toMatchObject({ workItemTitle: 'Fit sink', note: 'Plumbing' })
  })

  it('deletes an entry and brings it back', () => {
    const entry = time.logTime(phone(), PROJECT, ids.sink, 15, '2026-10-16')
    time.deleteTimeEntry(phone(), PROJECT, entry.id)
    expect(time.taskTime(phone(), ids.sink).entries).toEqual([])
    time.restoreTimeEntry(phone(), entry)
    expect(time.taskTime(phone(), ids.sink).loggedSeconds).toBe(15 * 60)
  })

  it('writes hours and minutes', () => {
    expect(time.hoursAndMinutes(0)).toBe('0:00')
    expect(time.hoursAndMinutes(65 * 60 + 59)).toBe('1:05')
  })
})
