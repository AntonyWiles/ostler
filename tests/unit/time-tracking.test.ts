import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PlanningService } from '../../electron/services/planning-service'
import { PeopleService } from '../../electron/services/people-service'
import { deleteProjectRows } from '../../electron/services/project-removal-service'
import { buildTasksCsv } from '../../electron/services/export-service'
import type { TimeEntry, WatchedProject } from '../../src/shared/ostler-api'
import {
  csvHours,
  durationInputText,
  formatTimerClock,
  parseDuration
} from '../../src/shared/time/duration'
import {
  dayRange,
  entryDay,
  timesheetTotals,
  weekDays,
  weekStart
} from '../../src/shared/time/timesheet'
import { timeEntriesToCsv } from '../../src/shared/export/time-csv'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

describe('durations', () => {
  it('reads each form, with the region decimal separator', () => {
    expect(parseDuration('1h 30m', '.')).toBe(5400)
    expect(parseDuration('1h30m', '.')).toBe(5400)
    expect(parseDuration('1.5h', '.')).toBe(5400)
    expect(parseDuration('1,5h', ',')).toBe(5400)
    expect(parseDuration('90m', '.')).toBe(5400)
    expect(parseDuration('90 min', '.')).toBe(5400)
    expect(parseDuration(' 2H ', '.')).toBe(7200)
    expect(parseDuration('0.25h', '.')).toBe(900)
    expect(parseDuration('1h 7,5m', ',')).toBe(3600 + 450)
  })

  it('refuses nonsense', () => {
    for (const text of [
      '',
      'abc',
      '90',
      '1.5',
      'h',
      'm',
      '0m',
      '0h',
      '-1h',
      '1x',
      '1h 30',
      '30m 1h'
    ])
      expect(parseDuration(text, '.'), text).toBeNull()
    // The other region's separator is not read as a decimal.
    expect(parseDuration('1,5h', '.')).toBeNull()
    expect(parseDuration('1.5h', ',')).toBeNull()
    // More than a week.
    expect(parseDuration('169h', '.')).toBeNull()
  })

  it('writes durations back in a form the parser reads, and as hours for CSV', () => {
    expect(durationInputText(5400)).toBe('1h 30m')
    expect(durationInputText(7200)).toBe('2h')
    expect(durationInputText(2700)).toBe('45m')
    expect(parseDuration(durationInputText(5400), '.')).toBe(5400)
    expect(csvHours(5400)).toBe('1.5')
    expect(csvHours(1000)).toBe('0.28')
    expect(formatTimerClock(4_000)).toBe('0:04')
    expect(formatTimerClock(3_909_000)).toBe('1:05:09')
  })
})

function entry(partial: Partial<TimeEntry> & Pick<TimeEntry, 'startedAt'>): TimeEntry {
  return {
    id: Math.random().toString(36),
    projectId: 'p1',
    workItemId: 't1',
    workItemTitle: 'Task',
    personId: 'me',
    durationSeconds: 3600,
    note: '',
    source: 'manual',
    billable: false,
    billingId: null,
    createdAt: 0,
    updatedAt: 0,
    ...partial
  }
}

describe('timesheet totals', () => {
  const originalTz = process.env.TZ
  beforeEach(() => {
    process.env.TZ = 'Europe/London'
  })
  afterEach(() => {
    process.env.TZ = originalTz
  })

  it('totals by local day, project, task and person', () => {
    const at = (day: number, hour: number) => new Date(2026, 9, day, hour).getTime()
    const entries = [
      entry({ startedAt: at(12, 9), durationSeconds: 3600 }),
      entry({ startedAt: at(12, 14), durationSeconds: 1800, workItemId: 't2' }),
      entry({ startedAt: at(13, 9), durationSeconds: 900, projectId: 'p2', personId: null })
    ]
    const totals = timesheetTotals(entries, at(20, 0))
    expect(totals.total).toBe(6300)
    expect(totals.byDay).toEqual({ '2026-10-12': 5400, '2026-10-13': 900 })
    expect(totals.byProject).toEqual({ p1: 5400, p2: 900 })
    expect(totals.byTask).toEqual({ t1: 4500, t2: 1800 })
    expect(totals.byPerson).toEqual({ me: 5400, '': 900 })
  })

  it('counts a running timer up to now', () => {
    const start = new Date(2026, 9, 12, 9).getTime()
    const totals = timesheetTotals(
      [entry({ startedAt: start, durationSeconds: null })],
      start + 90_000
    )
    expect(totals.total).toBe(90)
  })

  it('keeps an entry on the local day it started, across midnight', () => {
    const lateStart = new Date(2026, 9, 12, 23, 30).getTime()
    const late = entry({ startedAt: lateStart, durationSeconds: 3600 })
    expect(entryDay(late)).toBe('2026-10-12')
    expect(timesheetTotals([late], lateStart).byDay).toEqual({ '2026-10-12': 3600 })
  })

  it('builds weeks across a daylight-saving change from local days', () => {
    // The clocks go back in London on Sunday 25 October 2026: that day has 25 hours.
    expect(weekStart(new Date(2026, 9, 25, 12))).toBe('2026-10-19')
    expect(weekStart(new Date(2026, 9, 26, 0, 30))).toBe('2026-10-26')
    expect(weekDays('2026-10-19')).toEqual([
      '2026-10-19',
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
      '2026-10-25'
    ])
    const { from, to } = dayRange('2026-10-19', '2026-10-25')
    expect(to - from).toBe(7 * 24 * 3600_000 + 3600_000)
    // An entry late on the long Sunday is still that Sunday, and inside the week.
    const lateSunday = new Date(2026, 9, 25, 23, 45).getTime()
    expect(lateSunday).toBeLessThan(to)
    expect(entryDay(entry({ startedAt: lateSunday }))).toBe('2026-10-25')
  })
})

describe('time entries CSV', () => {
  it('writes date, project, task, person, hours as a number and the note', () => {
    const text = timeEntriesToCsv(
      [
        entry({ startedAt: new Date(2026, 9, 13, 9).getTime(), durationSeconds: 900, note: 'b' }),
        entry({
          startedAt: new Date(2026, 9, 12, 9).getTime(),
          durationSeconds: 5400,
          note: 'a, b'
        })
      ],
      { projectName: () => 'Shop', personName: () => 'Ann', now: 0 }
    )
    expect(text).toBe(
      String.fromCharCode(0xfeff) +
        'Date,Project,Task,Person,Duration (hours),Note\r\n' +
        '2026-10-12,Shop,Task,Ann,1.5,"a, b"\r\n' +
        '2026-10-13,Shop,Task,Ann,0.25,b\r\n'
    )
  })
})

describe('PlanningService time tracking', () => {
  const tempDir = useTempDir('ostler-time-')
  let dbPath: string
  let service: PlanningService
  const human = { kind: 'human' } as const
  const projectIds = ['p1', 'p2']

  beforeEach(async () => {
    dbPath = await createMigratedDatabase(tempDir())
    service = new PlanningService(dbPath, () => projectIds)
  })

  afterEach(() => {
    service.close()
  })

  const task = (projectId = 'p1', title = 'T') =>
    service.createWorkItem(projectId, { title }, human)

  it('adds, edits, deletes and restores an entry by hand', () => {
    const t1 = task()
    const created = service.time.create('p1', {
      workItemId: t1.id,
      startedAt: 1_000_000,
      durationSeconds: 5400,
      note: ' call '
    })
    expect(created).toMatchObject({
      workItemTitle: 'T',
      durationSeconds: 5400,
      note: 'call',
      source: 'manual'
    })
    const updated = service.time.update('p1', created.id, { durationSeconds: 600, note: 'x' })
    expect(updated).toMatchObject({ durationSeconds: 600, note: 'x' })
    expect(service.time.totals('p1')).toEqual({ [t1.id]: 600 })
    const deleted = service.time.delete('p1', created.id)
    expect(service.time.listForWorkItem(t1.id)).toEqual([])
    service.time.restore('p1', deleted)
    expect(service.time.listForWorkItem(t1.id).map((e) => e.id)).toEqual([created.id])
  })

  it('refuses a bad duration, a task of another project and an archived task', () => {
    const t1 = task()
    const t2 = task('p2')
    const base = { startedAt: 1_000_000, durationSeconds: 60 }
    expect(() =>
      service.time.create('p1', { ...base, workItemId: t1.id, durationSeconds: 0 })
    ).toThrow()
    expect(() => service.time.create('p1', { ...base, workItemId: t2.id })).toThrow()
    expect(() =>
      service.time.getForProject('p2', service.time.create('p1', { ...base, workItemId: t1.id }).id)
    ).toThrow()
    const done = service.updateWorkItem(t1.id, { status: 'done' }, human)
    service.archiveWorkItem(done.id, human)
    expect(() => service.time.startTimer('p1', t1.id)).toThrow()
  })

  it('runs one timer at a time: starting another stops the first, and undo puts it back', () => {
    const a = task('p1', 'A')
    const b = task('p2', 'B')
    const first = service.time.startTimer('p1', a.id, 1_000_000)
    expect(first.stopped).toBeNull()
    const second = service.time.startTimer('p2', b.id, 1_000_000 + 60_000)
    expect(second.stopped).toMatchObject({ id: first.started.id, durationSeconds: 60 })
    expect(service.time.timerState().running?.id).toBe(second.started.id)

    const state = service.time.undoStart(second.started.id, first.started.id)
    expect(state.running).toMatchObject({ id: first.started.id, durationSeconds: null })
    expect(service.time.listForWorkItem(b.id)).toEqual([])

    const stopped = service.time.stopTimer(1_000_000 + 120_000)
    expect(stopped).toMatchObject({ durationSeconds: 120, source: 'timer' })
    expect(service.time.timerState().running).toBeNull()
  })

  it('on restart, keeps a timer that was running, or stops it at the time Ostler closed', () => {
    const a = task()
    const start = Date.now() - 3_600_000
    service.time.startTimer('p1', a.id, start)
    service.time.heartbeat(start + 600_000)
    service.close()

    service = new PlanningService(dbPath, () => projectIds)
    const found = service.time.timerState()
    expect(found.interrupted).toEqual({ entryId: found.running?.id, closedAt: start + 600_000 })
    // The answer is pending: the heartbeat must not move the close time.
    service.time.heartbeat(Date.now())
    expect(service.time.timerState().interrupted?.closedAt).toBe(start + 600_000)
    const kept = service.time.resolveInterrupted('keep')
    expect(kept.interrupted).toBeNull()
    expect(kept.running?.durationSeconds).toBeNull()
    service.close()

    // Again, and this time stop it at the close.
    service = new PlanningService(dbPath, () => projectIds)
    service.time.heartbeat(start + 900_000)
    expect(service.time.timerState().interrupted?.closedAt).toBe(start + 600_000)
    const stopped = service.time.resolveInterrupted('stop')
    expect(stopped.running).toBeNull()
    expect(service.time.listForWorkItem(a.id)[0].durationSeconds).toBe(600)
  })

  it('lists entries across projects by range and person', () => {
    const a = task('p1')
    const b = task('p2')
    const people = new PeopleService(dbPath)
    const ann = people.create({ name: 'Ann' })
    people.close()
    service.time.create('p1', {
      workItemId: a.id,
      startedAt: 1000,
      durationSeconds: 60,
      personId: ann.id
    })
    service.time.create('p2', {
      workItemId: b.id,
      startedAt: 5000,
      durationSeconds: 60,
      personId: null
    })
    expect(service.time.list({ from: 0, to: 10_000 }, projectIds)).toHaveLength(2)
    expect(service.time.list({ from: 0, to: 2000 }, projectIds)).toHaveLength(1)
    expect(service.time.list({ from: 0, to: 10_000, personId: null }, projectIds)).toHaveLength(1)
    expect(service.time.list({ from: 0, to: 10_000, personId: ann.id }, projectIds)).toHaveLength(1)
    expect(service.time.list({ from: 0, to: 10_000 }, ['p1'])).toHaveLength(1)
  })

  it('adds a Time logged column to the task CSV when the project has entries', () => {
    const a = task()
    const project = { id: 'p1', name: 'P', estimateUnit: 'hours' } as WatchedProject
    expect(buildTasksCsv(service, project).text).not.toContain('Time logged')
    service.time.create('p1', { workItemId: a.id, startedAt: 1000, durationSeconds: 5400 })
    const text = buildTasksCsv(service, project).text
    expect(text).toContain('Time logged (hours)')
    expect(text.trim().split('\r\n')[1].endsWith(',1.5')).toBe(true)
  })

  it('goes with the project when it is removed, and with its task', () => {
    const a = task()
    const b = task()
    service.time.create('p1', { workItemId: a.id, startedAt: 1000, durationSeconds: 60 })
    service.time.create('p1', { workItemId: b.id, startedAt: 1000, durationSeconds: 60 })
    service.moveWorkItemToBin(b.id, human)
    service.purgeRecycleBin('p1', Date.now() + 31 * 86_400_000)
    expect(service.time.listForProject('p1')).toHaveLength(1)
    const deleted = deleteProjectRows(service.database, 'p1')
    expect(deleted.map((row) => row.table)).toContain('planning_time_entries')
    expect(
      service.database.prepare('SELECT COUNT(*) AS n FROM planning_time_entries').get()
    ).toEqual({ n: 0 })
  })
})
