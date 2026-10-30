import { afterEach, describe, expect, it } from 'vitest'
import {
  dateToX,
  dayWidth,
  stepZoom,
  timelineRange,
  timelineTicks,
  weekendDays,
  xToDate,
  TIMELINE_ZOOMS
} from '@renderer/ui/timeline-scale'
import {
  dependencyConflicts,
  editTaskDates,
  previousTaskDateChange,
  scheduleTaskOn,
  taskTimelineBar
} from '@shared/planning/timeline'
import { buildTimelineRows } from '@renderer/views/planning/timeline/timeline-rows'
import type { PlanningMilestone, Person } from '@shared/ostler-api'
import { makeWorkItem } from '../renderer/fixtures/planning-records'

const ORIGINAL_TZ = process.env.TZ
afterEach(() => {
  process.env.TZ = ORIGINAL_TZ
})

const task = (
  id: string,
  dates: { startDate?: string | null; targetDate?: string | null },
  dependencyIds: string[] = []
) => ({
  id,
  startDate: dates.startDate ?? null,
  targetDate: dates.targetDate ?? null,
  dependencyIds
})

describe('timeline scale', () => {
  for (const zoom of TIMELINE_ZOOMS) {
    it(`maps dates to x and back at ${zoom} zoom`, () => {
      const origin = '2026-10-01'
      for (const date of ['2026-10-01', '2026-10-02', '2026-10-31', '2027-02-28', '2028-02-29']) {
        const x = dateToX(date, origin, zoom)
        expect(xToDate(x, origin, zoom)).toBe(date)
        // Anywhere inside the day is still that day.
        expect(xToDate(x + dayWidth(zoom) - 0.5, origin, zoom)).toBe(date)
      }
      expect(dateToX('2026-10-11', origin, zoom)).toBe(10 * dayWidth(zoom))
      expect(xToDate(-1, origin, zoom)).toBe('2026-09-30')
    })
  }

  it('narrows days as the zoom goes out, and steps within the zooms', () => {
    expect(dayWidth('week')).toBeGreaterThan(dayWidth('month'))
    expect(dayWidth('month')).toBeGreaterThan(dayWidth('quarter'))
    expect(stepZoom('week', -1)).toBe('week')
    expect(stepZoom('week', 1)).toBe('month')
    expect(stepZoom('quarter', 1)).toBe('quarter')
  })

  it('keeps the same days in every time zone', () => {
    for (const tz of ['Pacific/Tongatapu', 'America/Bogota']) {
      process.env.TZ = tz
      expect(dateToX('2026-11-01', '2026-10-01', 'week')).toBe(31 * dayWidth('week'))
      expect(xToDate(31 * dayWidth('week'), '2026-10-01', 'week')).toBe('2026-11-01')
    }
  })

  it('covers every date and today, from the first to the last of a month', () => {
    const range = timelineRange(['2026-10-10', '2026-12-03'], '2026-10-08', 'week')
    expect(range).toEqual({ start: '2026-09-01', end: '2026-12-31' })
    expect(timelineRange([], '2026-10-08', 'quarter')).toEqual({
      start: '2026-07-01',
      end: '2027-01-31'
    })
  })

  it('cuts the header into months over days, weeks and months', () => {
    const range = { start: '2026-10-01', end: '2026-12-31' }
    const week = timelineTicks(range, 'week', 1)
    expect(week.major.map((tick) => [tick.date, tick.days])).toEqual([
      ['2026-10-01', 31],
      ['2026-11-01', 30],
      ['2026-12-01', 31]
    ])
    expect(week.minor).toHaveLength(92)
    const month = timelineTicks(range, 'month', 1)
    // October 1 2026 is a Thursday: the first week is cut to the range.
    expect(month.minor[0]).toMatchObject({ date: '2026-10-01', days: 4 })
    expect(month.minor[1]).toMatchObject({ date: '2026-10-05', days: 7 })
    const quarter = timelineTicks({ start: '2026-11-01', end: '2027-01-31' }, 'quarter')
    expect(quarter.major.map((tick) => [tick.label, tick.days])).toEqual([
      ['Q4 2026', 61],
      ['Q1 2027', 31]
    ])
    expect(quarter.minor.map((tick) => tick.date)).toEqual([
      '2026-11-01',
      '2026-12-01',
      '2027-01-01'
    ])
  })

  it('lists weekends', () => {
    expect(weekendDays({ start: '2026-10-01', end: '2026-10-07' })).toEqual([
      '2026-10-03',
      '2026-10-04'
    ])
  })
})

describe('bar layout', () => {
  it('draws each combination of dates', () => {
    expect(taskTimelineBar({ startDate: '2026-10-05', targetDate: '2026-10-09' })).toEqual({
      kind: 'range',
      start: '2026-10-05',
      end: '2026-10-09',
      hasStart: true
    })
    // Due only: a one-day bar ending on the due date.
    expect(taskTimelineBar({ startDate: null, targetDate: '2026-10-09' })).toEqual({
      kind: 'range',
      start: '2026-10-09',
      end: '2026-10-09',
      hasStart: false
    })
    // Start only: a marker.
    expect(taskTimelineBar({ startDate: '2026-10-05', targetDate: null })).toEqual({
      kind: 'start',
      start: '2026-10-05'
    })
    // Neither: unscheduled.
    expect(taskTimelineBar({ startDate: null, targetDate: null })).toBeNull()
    // A start after the due date is ignored, as the Calendar does.
    expect(taskTimelineBar({ startDate: '2026-10-12', targetDate: '2026-10-09' })).toMatchObject({
      start: '2026-10-09',
      hasStart: false
    })
  })

  it('places unscheduled tasks in their own group at the bottom', () => {
    const milestone = {
      id: 'm1',
      name: 'Launch',
      targetDate: '2026-10-20',
      status: 'planned'
    } as PlanningMilestone
    const items = [
      makeWorkItem('none', { title: 'No dates', milestoneId: 'm1' }),
      makeWorkItem('b', { title: 'Second', milestoneId: 'm1', targetDate: '2026-10-12' }),
      makeWorkItem('a', {
        title: 'First',
        milestoneId: 'm1',
        startDate: '2026-10-01',
        targetDate: '2026-10-03'
      }),
      makeWorkItem('loose', { title: 'Loose', targetDate: '2026-10-02' })
    ]
    const rows = buildTimelineRows(items, {
      groupBy: 'milestone',
      collapsed: new Set(),
      milestones: [milestone],
      people: new Map()
    })
    expect(rows.map((row) => row.id)).toEqual([
      'group:milestone:m1',
      'a',
      'b',
      'group:milestone:none',
      'loose',
      'group:unscheduled',
      'none'
    ])
    const collapsed = buildTimelineRows(items, {
      groupBy: 'none',
      collapsed: new Set(['unscheduled']),
      milestones: [milestone],
      people: new Map()
    })
    expect(collapsed.map((row) => row.id)).toEqual(['a', 'loose', 'b', 'group:unscheduled'])
  })

  it('groups by assignee, with Unassigned last', () => {
    const people = new Map<string, Person>([
      ['p2', { id: 'p2', name: 'Zoe' } as Person],
      ['p1', { id: 'p1', name: 'Ana' } as Person]
    ])
    const rows = buildTimelineRows(
      [
        makeWorkItem('x', { targetDate: '2026-10-02', assigneeId: 'p2' }),
        makeWorkItem('y', { targetDate: '2026-10-03', assigneeId: 'p1' }),
        makeWorkItem('z', { targetDate: '2026-10-04' })
      ],
      { groupBy: 'assignee', collapsed: new Set(), milestones: [], people }
    )
    expect(rows.map((row) => row.id)).toEqual([
      'group:assignee:p1',
      'y',
      'group:assignee:p2',
      'x',
      'group:assignee:none',
      'z'
    ])
  })
})

describe('timeline edits', () => {
  const range = { startDate: '2026-10-05', targetDate: '2026-10-09' }
  const dueOnly = { startDate: null, targetDate: '2026-10-09' }
  const startOnly = { startDate: '2026-10-05', targetDate: null }

  it('moves both dates, or the start or the due date alone', () => {
    expect(editTaskDates(range, 'move', 1)).toEqual({
      targetDate: '2026-10-10',
      startDate: '2026-10-06'
    })
    expect(editTaskDates(range, 'start', -2)).toEqual({ startDate: '2026-10-03' })
    expect(editTaskDates(range, 'due', 1)).toEqual({ targetDate: '2026-10-10' })
    expect(editTaskDates(dueOnly, 'move', -1)).toEqual({ targetDate: '2026-10-08' })
    expect(editTaskDates(startOnly, 'move', 3)).toEqual({ startDate: '2026-10-08' })
    expect(editTaskDates(startOnly, 'start', -1)).toEqual({ startDate: '2026-10-04' })
  })

  it('keeps a due-only bar anchored when its ends move', () => {
    // Lengthening keeps the left end: that day becomes the start.
    expect(editTaskDates(dueOnly, 'due', 2)).toEqual({
      targetDate: '2026-10-11',
      startDate: '2026-10-09'
    })
    expect(editTaskDates(dueOnly, 'start', -3)).toEqual({ startDate: '2026-10-06' })
    // A start-only task gets a due date on or after its start.
    expect(editTaskDates(startOnly, 'due', 2)).toEqual({ targetDate: '2026-10-07' })
  })

  it('refuses an edit that would put the start after the due date', () => {
    expect(editTaskDates(range, 'start', 5)).toBeNull()
    expect(editTaskDates(range, 'due', -5)).toBeNull()
    expect(editTaskDates(dueOnly, 'start', 1)).toBeNull()
    expect(editTaskDates(dueOnly, 'due', -1)).toBeNull()
    expect(editTaskDates(startOnly, 'due', -1)).toBeNull()
    expect(editTaskDates(range, 'move', 0)).toBeNull()
    expect(editTaskDates({ startDate: null, targetDate: null }, 'move', 1)).toBeNull()
  })

  it('gives the same strings in every time zone', () => {
    for (const tz of ['Pacific/Tongatapu', 'America/Bogota']) {
      process.env.TZ = tz
      expect(
        editTaskDates({ startDate: '2026-10-31', targetDate: '2026-11-01' }, 'move', 1)
      ).toEqual({ targetDate: '2026-11-02', startDate: '2026-11-01' })
    }
  })

  it('schedules an unscheduled task on one day, and undo restores what changed', () => {
    expect(scheduleTaskOn('2026-10-14')).toEqual({
      startDate: '2026-10-14',
      targetDate: '2026-10-14'
    })
    expect(previousTaskDateChange(range, { startDate: '2026-10-03' })).toEqual({
      startDate: '2026-10-05'
    })
    expect(previousTaskDateChange(dueOnly, scheduleTaskOn('2026-10-14'))).toEqual({
      startDate: null,
      targetDate: '2026-10-09'
    })
  })
})

describe('dependencyConflicts', () => {
  it('flags each link of a chain that starts too early', () => {
    const conflicts = dependencyConflicts([
      task('a', { startDate: '2026-10-01', targetDate: '2026-10-05' }),
      task('b', { startDate: '2026-10-05', targetDate: '2026-10-08' }, ['a']),
      task('c', { startDate: '2026-10-07', targetDate: '2026-10-09' }, ['b'])
    ])
    // b starts on the day a is due: not before it. c starts before b is due.
    expect(conflicts).toEqual([
      { taskId: 'c', dependencyId: 'b', start: '2026-10-07', dependencyDue: '2026-10-08' }
    ])
  })

  it('judges each edge of a diamond on its own', () => {
    const conflicts = dependencyConflicts([
      task('top', { targetDate: '2026-10-02' }),
      task('left', { startDate: '2026-10-03', targetDate: '2026-10-06' }, ['top']),
      task('right', { startDate: '2026-10-01', targetDate: '2026-10-10' }, ['top']),
      task('bottom', { startDate: '2026-10-08', targetDate: '2026-10-12' }, ['left', 'right'])
    ])
    expect(conflicts.map((c) => `${c.dependencyId}->${c.taskId}`)).toEqual([
      'top->right',
      'right->bottom'
    ])
  })

  it('ignores missing dates and missing tasks, and uses the due date when there is no start', () => {
    expect(
      dependencyConflicts([
        task('a', { startDate: '2026-10-01' }),
        task('b', { startDate: '2026-09-01' }, ['a']),
        task('c', {}, ['a']),
        task('d', { targetDate: '2026-09-01' }, ['gone']),
        task('e', { targetDate: '2026-10-01' }),
        task('f', { targetDate: '2026-09-30' }, ['e', 'f'])
      ])
    ).toEqual([
      { taskId: 'f', dependencyId: 'e', start: '2026-09-30', dependencyDue: '2026-10-01' }
    ])
  })
})
