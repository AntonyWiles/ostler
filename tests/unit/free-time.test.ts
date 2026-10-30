import { describe, expect, it } from 'vitest'
import {
  fillDay,
  freeTimeOn,
  isBlockPassed,
  nextFreeSlot,
  type BusyEvent,
  type FreeTimeContext
} from '../../src/shared/planning/free-time'

// 19 October 2026 is a Monday.
const MONDAY = '2026-10-19'
const FRIDAY = '2026-10-23'
const hours = { start: 9 * 60, end: 17 * 60 }

function timed(date: string, start: string, end: string, endDate = date): BusyEvent {
  return { allDay: false, startDate: date, endDate, startTime: start, endTime: end }
}

function block(id: string, date: string, startMinute: number, lengthMinutes: number) {
  return { id, date, startMinute, lengthMinutes }
}

const ctx = (extra: Partial<FreeTimeContext> = {}): FreeTimeContext => ({
  workingHours: hours,
  ...extra
})

describe('free time (N3.4b)', () => {
  it('is the working hours of a working day', () => {
    expect(freeTimeOn(MONDAY, ctx())).toEqual([{ start: 540, end: 1020 }])
  })

  it('takes out timed events and other blocks, on quarter hours', () => {
    const free = freeTimeOn(
      MONDAY,
      ctx({
        events: [timed(MONDAY, '10:10', '11:00')],
        blocks: [block('b', MONDAY, 13 * 60, 90)]
      })
    )
    expect(free).toEqual([
      { start: 540, end: 600 },
      { start: 660, end: 780 },
      { start: 870, end: 1020 }
    ])
  })

  it('ignores all-day events, and counts an event past midnight on both days', () => {
    const allDay: BusyEvent = {
      allDay: true,
      startDate: MONDAY,
      endDate: MONDAY,
      startTime: null,
      endTime: null
    }
    expect(freeTimeOn(MONDAY, ctx({ events: [allDay] }))).toEqual([{ start: 540, end: 1020 }])
    const late = timed('2026-10-19', '16:00', '10:00', '2026-10-20')
    expect(freeTimeOn('2026-10-19', ctx({ events: [late] }))).toEqual([{ start: 540, end: 960 }])
    expect(freeTimeOn('2026-10-20', ctx({ events: [late] }))).toEqual([{ start: 600, end: 1020 }])
  })

  it('has none on a day off or a non-working day', () => {
    const daysOff = [{ personId: null, firstDate: MONDAY, lastDate: MONDAY, name: 'Holiday' }]
    expect(freeTimeOn(MONDAY, ctx({ daysOff }))).toEqual([])
    expect(freeTimeOn('2026-10-24', ctx())).toEqual([])
    // Someone who works Saturdays.
    expect(freeTimeOn('2026-10-24', ctx({ workingDays: [6] }))).toHaveLength(1)
  })

  it('finds the next free slot across a weekend and a day off', () => {
    const daysOff = [
      { personId: null, firstDate: '2026-10-26', lastDate: '2026-10-26', name: 'Holiday' }
    ]
    const context = ctx({ daysOff, events: [timed('2026-10-27', '09:00', '10:00')] })
    expect(nextFreeSlot(60, { date: FRIDAY, minute: 16 * 60 + 30 }, context)).toEqual({
      date: '2026-10-27',
      startMinute: 600
    })
    expect(nextFreeSlot(30, { date: FRIDAY, minute: 16 * 60 + 20 }, context)).toEqual({
      date: FRIDAY,
      startMinute: 990
    })
  })

  it('looks at most 14 days ahead', () => {
    const daysOff = [{ personId: null, firstDate: MONDAY, lastDate: '2026-11-20', name: 'Away' }]
    expect(nextFreeSlot(60, { date: MONDAY, minute: 0 }, ctx({ daysOff }))).toBeNull()
  })

  it('leaves out the block being moved', () => {
    const context = ctx({
      workingHours: { start: 540, end: 600 },
      blocks: [block('self', MONDAY, 540, 60)],
      ignoreBlockIds: new Set(['self'])
    })
    expect(nextFreeSlot(60, { date: MONDAY, minute: 0 }, context)).toEqual({
      date: MONDAY,
      startMinute: 540
    })
  })
})

describe('fillDay (N3.4b)', () => {
  const now = { date: MONDAY, minute: 9 * 60 + 5 }

  it('places tasks in order from now, rounded up to the quarter hour', () => {
    const result = fillDay(
      [
        { id: 'a', estimateMinutes: 90, blockedMinutes: 0 },
        { id: 'b', estimateMinutes: null, blockedMinutes: 0 }
      ],
      MONDAY,
      now,
      ctx()
    )
    expect(result.pieces).toEqual([
      { workItemId: 'a', startMinute: 555, lengthMinutes: 90, part: 1, parts: 1 },
      { workItemId: 'b', startMinute: 645, lengthMinutes: 60, part: 1, parts: 1 }
    ])
    expect(result.notPlaced).toEqual([])
  })

  it('starts at working hours on a later day, and places nothing on a past day', () => {
    const tasks = [{ id: 'a', estimateMinutes: 60, blockedMinutes: 0 }]
    expect(fillDay(tasks, '2026-10-20', now, ctx()).pieces[0].startMinute).toBe(540)
    expect(fillDay(tasks, '2026-10-16', now, ctx()).notPlaced).toHaveLength(1)
  })

  it('splits a task around a meeting, never into a piece under 30 minutes', () => {
    const context = ctx({
      events: [timed(MONDAY, '10:00', '11:00'), timed(MONDAY, '12:00', '17:00')]
    })
    const split = fillDay(
      [{ id: 'a', estimateMinutes: 120, blockedMinutes: 0 }],
      MONDAY,
      { date: MONDAY, minute: 540 },
      context
    )
    expect(split.pieces).toEqual([
      { workItemId: 'a', startMinute: 540, lengthMinutes: 60, part: 1, parts: 2 },
      { workItemId: 'a', startMinute: 660, lengthMinutes: 60, part: 2, parts: 2 }
    ])
    // A 15-minute gap is skipped: 09:00 to 09:15 is too short for a piece.
    const floor = fillDay(
      [{ id: 'a', estimateMinutes: 480, blockedMinutes: 0 }],
      MONDAY,
      { date: MONDAY, minute: 540 },
      ctx({ events: [timed(MONDAY, '09:15', '10:00')] })
    )
    expect(floor.notPlaced).toEqual([{ workItemId: 'a', minutes: 480 }])
    // Leaving 15 minutes for a last piece is not allowed: the first piece gives way.
    const remainder = fillDay(
      [{ id: 'a', estimateMinutes: 75, blockedMinutes: 0 }],
      MONDAY,
      { date: MONDAY, minute: 540 },
      ctx({ events: [timed(MONDAY, '10:00', '16:30')] })
    )
    expect(remainder.pieces.map((piece) => piece.lengthMinutes)).toEqual([45, 30])
  })

  it('counts what is already blocked for a task that day', () => {
    const result = fillDay(
      [
        { id: 'a', estimateMinutes: 120, blockedMinutes: 90 },
        { id: 'b', estimateMinutes: 60, blockedMinutes: 60 }
      ],
      MONDAY,
      { date: MONDAY, minute: 540 },
      ctx()
    )
    expect(result.pieces).toEqual([
      { workItemId: 'a', startMinute: 540, lengthMinutes: 30, part: 1, parts: 1 }
    ])
    expect(result.alreadyBlocked).toEqual(['b'])
  })

  it('lists what does not fit and keeps placing the rest', () => {
    const result = fillDay(
      [
        { id: 'big', estimateMinutes: 600, blockedMinutes: 0 },
        { id: 'small', estimateMinutes: 60, blockedMinutes: 0 }
      ],
      MONDAY,
      { date: MONDAY, minute: 540 },
      ctx()
    )
    expect(result.notPlaced).toEqual([{ workItemId: 'big', minutes: 600 }])
    expect(result.pieces.map((piece) => piece.workItemId)).toEqual(['small'])
  })

  it('places nothing on a day off and says so', () => {
    const daysOff = [{ personId: null, firstDate: MONDAY, lastDate: MONDAY, name: 'Holiday' }]
    const result = fillDay([{ id: 'a', estimateMinutes: 60, blockedMinutes: 0 }], MONDAY, now, {
      ...ctx(),
      daysOff
    })
    expect(result.closed).toEqual({ kind: 'dayOff', name: 'Holiday' })
    expect(result.pieces).toEqual([])
  })
})

describe('passed blocks (N3.4b)', () => {
  it('is passed when its end has gone by and its task is open', () => {
    const b = { date: MONDAY, startMinute: 540, lengthMinutes: 60, status: 'ready' as const }
    expect(isBlockPassed(b, { date: MONDAY, minute: 599 })).toBe(false)
    expect(isBlockPassed(b, { date: MONDAY, minute: 600 })).toBe(true)
    expect(isBlockPassed(b, { date: '2026-10-20', minute: 0 })).toBe(true)
    expect(isBlockPassed({ ...b, status: 'done' }, { date: '2026-10-20', minute: 0 })).toBe(false)
  })
})
