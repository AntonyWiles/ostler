import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CalendarOccurrence, WatchedProject } from '../../src/shared/ostler-api'
import { useTempDir } from '../helpers/temp-dir'

const { PlanningService } = await import('../../electron/services/planning-service')
const { TimeBlockService } = await import('../../electron/services/time-block-service')
const { MyDayService } = await import('../../electron/services/my-day-service')
const { BlockMoveService } = await import('../../electron/services/block-move-service')
const { createMigratedDatabase } = await import('../helpers/database')

const human = { kind: 'human' as const }
// 19 October 2026 is a Monday.
const MONDAY = '2026-10-19'

function project(id: string): WatchedProject {
  return { id, name: id, color: '#3b82f6', enabled: true, estimateUnit: 'hours' } as WatchedProject
}

function meeting(date: string, start: string, end: string): CalendarOccurrence {
  return {
    id: `e-${start}`,
    eventId: 'e',
    calendarId: 'c',
    title: 'Secret meeting',
    location: '',
    description: '',
    allDay: false,
    startDate: date,
    endDate: date,
    startTime: start,
    endTime: end,
    start: 0,
    end: 0
  }
}

describe('BlockMoveService (N3.4b)', () => {
  const tempDir = useTempDir('ostler-block-moves-')
  let planning: InstanceType<typeof PlanningService>
  let clock: Date
  let events: CalendarOccurrence[]
  const projects = [project('p1'), project('p2')]

  beforeEach(async () => {
    const databasePath = await createMigratedDatabase(tempDir())
    planning = new PlanningService(databasePath, () => projects.map((entry) => entry.id))
    clock = new Date(2026, 9, 19, 10, 5)
    events = []
  })

  afterEach(() => {
    planning.close()
  })

  const parts = () => {
    const db = planning.database
    const timeBlocks = new TimeBlockService({ db, planning, getProjects: () => projects })
    const myDay = new MyDayService({ db, planning, getProjects: () => projects })
    const moves = new BlockMoveService({
      db,
      timeBlocks,
      myDay,
      getWorkingHours: () => ({ start: '09:00', end: '17:00' }),
      getMe: () => null,
      getDaysOff: () => [],
      getEvents: () => events,
      now: () => clock
    })
    return { timeBlocks, myDay, moves }
  }
  const add = (title: string, extra: object = {}, projectId = 'p1') =>
    planning.createWorkItem(projectId, { title, ...extra }, human)

  it('moves a passed block to the next free time around meetings and other blocks, with its length', () => {
    const { timeBlocks, moves } = parts()
    const task = add('Write')
    const other = add('Other', {}, 'p2')
    const passed = timeBlocks.create({
      workItemId: task.id,
      date: MONDAY,
      startMinute: 540,
      lengthMinutes: 60
    })
    timeBlocks.create({ workItemId: other.id, date: MONDAY, startMinute: 615, lengthMinutes: 45 })
    events = [meeting(MONDAY, '11:00', '12:30')]

    expect(moves.passed().map((block) => block.id)).toEqual([passed.id])
    const plan = moves.planMoves([passed.id])
    expect(plan.moves[0].to).toEqual({ date: MONDAY, startMinute: 750, lengthMinutes: 60 })
    expect(JSON.stringify(plan)).not.toContain('Secret')
    // A preview changes nothing.
    expect(timeBlocks.get(passed.id).startMinute).toBe(540)

    const applied = moves.applyMoves(plan)
    expect(applied.applied).toBe(true)
    expect(applied.previous).toEqual([
      { blockId: passed.id, date: MONDAY, startMinute: 540, lengthMinutes: 60 }
    ])
    expect(timeBlocks.get(passed.id).startMinute).toBe(750)
  })

  it('works the plan out again when time moved on since the preview', () => {
    const { timeBlocks, moves } = parts()
    const task = add('Write')
    const block = timeBlocks.create({ workItemId: task.id, date: MONDAY, startMinute: 540 })
    const plan = moves.planMoves([block.id])
    expect(plan.moves[0].to?.startMinute).toBe(615)
    clock = new Date(2026, 9, 19, 10, 40)
    const result = moves.applyMoves(plan)
    expect(result.applied).toBe(false)
    expect(result.plan?.moves[0].to?.startMinute).toBe(645)
    expect(timeBlocks.get(block.id).startMinute).toBe(540)
  })

  it("fills My day's unfinished tasks in order, makes them in one go, and undoes them in one", () => {
    const { timeBlocks, myDay, moves } = parts()
    const first = add('First', { estimate: 1 })
    const second = add('Second', { estimate: 2 })
    const done = add('Done already', { estimate: 1 })
    for (const task of [first, second, done])
      myDay.add(task.id, { date: MONDAY, beforeId: null, afterId: null }, human)
    planning.updateWorkItem(done.id, { status: 'done' }, human)
    events = [meeting(MONDAY, '12:00', '13:00')]

    const plan = moves.planFill(MONDAY)
    expect(
      plan.pieces.map((piece) => [piece.title, piece.startMinute, piece.lengthMinutes, piece.parts])
    ).toEqual([
      ['First', 615, 60, 1],
      ['Second', 780, 120, 1]
    ])
    expect(timeBlocks.list({ from: MONDAY, to: MONDAY })).toHaveLength(0)

    const applied = moves.applyFill(plan)
    expect(applied.blocks).toHaveLength(2)
    expect(timeBlocks.list({ from: MONDAY, to: MONDAY })).toHaveLength(2)
    timeBlocks.removeMany(applied.blocks.map((block) => block.id))
    expect(timeBlocks.list({ from: MONDAY, to: MONDAY })).toHaveLength(0)
  })

  it("keeps a token's fill to its own project's tasks", () => {
    const { myDay, moves } = parts()
    const mine = add('Mine')
    const theirs = add('Theirs', {}, 'p2')
    myDay.add(mine.id, { date: MONDAY, beforeId: null, afterId: null }, human)
    myDay.add(theirs.id, { date: MONDAY, beforeId: null, afterId: null }, human)
    expect(moves.planFill(MONDAY, 'p1').pieces.map((piece) => piece.title)).toEqual(['Mine'])
    expect(() => moves.planMoves(['nope'], 'p1')).toThrow()
  })
})
