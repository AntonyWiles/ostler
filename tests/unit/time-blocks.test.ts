import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TimeBlock, WatchedProject } from '../../src/shared/ostler-api'
import {
  blockInstants,
  clockTime,
  cutAtMidnight,
  defaultBlockLength,
  isBlockLength,
  isBlockStart,
  normalizeWorkingHours,
  parseClockTime,
  snapMinute,
  workingMinutes
} from '../../src/shared/planning/time-blocks'
import { buildCalendarFile, calendarUid } from '../../src/shared/export/calendar-ics'
import { useTempDir } from '../helpers/temp-dir'

const { PlanningService } = await import('../../electron/services/planning-service')
const { TimeBlockService } = await import('../../electron/services/time-block-service')
const { buildProjectCalendarFile } = await import('../../electron/services/export-service')
const { deleteProjectRows } = await import('../../electron/services/project-removal-service')
const { createMigratedDatabase } = await import('../helpers/database')

const human = { kind: 'human' as const }

function project(id: string, name: string, estimateUnit: 'hours' | 'points' = 'hours') {
  return { id, name, color: '#3b82f6', enabled: true, estimateUnit } as WatchedProject
}

describe('time block rules (N3.4a)', () => {
  it('snaps to quarter hours inside the day', () => {
    expect(snapMinute(547)).toBe(540)
    expect(snapMinute(553)).toBe(555)
    expect(snapMinute(-20)).toBe(0)
    expect(snapMinute(1439)).toBe(1425)
  })

  it('takes the estimate in hours, else an hour, cut at midnight', () => {
    expect(defaultBlockLength(1.5, 'hours', 540)).toBe(90)
    expect(defaultBlockLength(0.1, 'hours', 540)).toBe(15)
    expect(defaultBlockLength(3, 'points', 540)).toBe(60)
    expect(defaultBlockLength(null, 'hours', 540)).toBe(60)
    expect(defaultBlockLength(4, 'hours', 22 * 60)).toBe(120)
    expect(cutAtMidnight(1425, 60)).toBe(15)
  })

  it('checks starts and lengths', () => {
    expect(isBlockStart(540)).toBe(true)
    expect(isBlockStart(541)).toBe(false)
    expect(isBlockStart(1440)).toBe(false)
    expect(isBlockLength(60, 1380)).toBe(true)
    expect(isBlockLength(75, 1380)).toBe(false)
    expect(isBlockLength(0, 0)).toBe(false)
  })

  it('reads and writes clock times', () => {
    expect(clockTime(545)).toBe('09:05')
    expect(parseClockTime('9:30')).toBe(570)
    expect(parseClockTime('24:00')).toBeNull()
  })

  it('keeps a 09:00 block at 09:00 on both sides of a clock change', () => {
    // Europe/London moves from BST (UTC+1) to GMT on 25 October 2026.
    const before = blockInstants('2026-10-24', 540, 60, 'Europe/London')
    const after = blockInstants('2026-10-26', 540, 60, 'Europe/London')
    expect(new Date(before.start).toISOString()).toBe('2026-10-24T08:00:00.000Z')
    expect(new Date(after.start).toISOString()).toBe('2026-10-26T09:00:00.000Z')
    expect(after.end - after.start).toBe(60 * 60_000)
  })

  it('defaults working hours to 09:00 to 17:00 and refuses an end before the start', () => {
    expect(normalizeWorkingHours(undefined)).toEqual({ start: '09:00', end: '17:00' })
    expect(normalizeWorkingHours({ start: '08:30', end: '16:00' })).toEqual({
      start: '08:30',
      end: '16:00'
    })
    expect(normalizeWorkingHours({ start: '18:00', end: '09:00' })).toEqual({
      start: '09:00',
      end: '17:00'
    })
    expect(workingMinutes({ start: 'x', end: '17:00' })).toEqual({ start: 540, end: 1020 })
  })
})

describe('TimeBlockService (N3.4a)', () => {
  const tempDir = useTempDir('ostler-time-blocks-')
  let planning: InstanceType<typeof PlanningService>
  let projects: WatchedProject[]

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 16, 8, 0))
    const databasePath = await createMigratedDatabase(tempDir())
    projects = [project('p1', 'Website'), project('p2', 'Garden', 'points')]
    planning = new PlanningService(databasePath, () => projects.map((entry) => entry.id))
  })

  afterEach(() => {
    planning.close()
    vi.useRealTimers()
  })

  const service = () =>
    new TimeBlockService({ db: planning.database, planning, getProjects: () => projects })
  const add = (title: string, extra: object = {}, projectId = 'p1') =>
    planning.createWorkItem(projectId, { title, ...extra }, human)

  it('blocks time with the estimate as its length, several per task, and lists a range in order', () => {
    const write = add('Write the proposal', { estimate: 1.5 })
    const water = add('Water', {}, 'p2')
    const blocks = service()
    blocks.create({ workItemId: write.id, date: '2026-10-20', startMinute: 600 })
    blocks.create({ workItemId: write.id, date: '2026-10-19', startMinute: 540 })
    blocks.create({ workItemId: water.id, date: '2026-10-19', startMinute: 480, lengthMinutes: 30 })
    blocks.create({ workItemId: water.id, date: '2026-11-30', startMinute: 480 })

    const week = blocks.list({ from: '2026-10-19', to: '2026-10-25' })
    expect(week.map((block) => [block.date, clockTime(block.startMinute), block.title])).toEqual([
      ['2026-10-19', '08:00', 'Water'],
      ['2026-10-19', '09:00', 'Write the proposal'],
      ['2026-10-20', '10:00', 'Write the proposal']
    ])
    expect(week[1].lengthMinutes).toBe(90)
    // A points project's task gets an hour.
    expect(blocks.list({ from: '2026-11-30', to: '2026-11-30' })[0].lengthMinutes).toBe(60)
    expect(blocks.list({ from: '2026-10-19', to: '2026-10-25', projectId: 'p2' })).toHaveLength(1)
    expect(
      blocks.list({ from: '2026-10-01', to: '2026-10-31', workItemId: write.id })
    ).toHaveLength(2)
    // The task's dates do not change.
    expect(planning.getWorkItem(write.id).targetDate ?? null).toBeNull()
  })

  it('refuses times off the quarter hour, past midnight, and too long a range', () => {
    const task = add('A')
    const blocks = service()
    expect(() =>
      blocks.create({ workItemId: task.id, date: '2026-10-19', startMinute: 545 })
    ).toThrow(/quarter hour/)
    expect(() =>
      blocks.create({
        workItemId: task.id,
        date: '2026-10-19',
        startMinute: 1380,
        lengthMinutes: 120
      })
    ).toThrow(/midnight/)
    expect(() => blocks.list({ from: '2026-01-01', to: '2027-06-01' })).toThrow(/at most/)
    expect(() => blocks.list({ from: '2026-10-02', to: '2026-10-01' })).toThrow()
    // Cut at midnight when no length is given.
    expect(
      blocks.create({ workItemId: task.id, date: '2026-10-19', startMinute: 1410 }).lengthMinutes
    ).toBe(30)
  })

  it('moves, resizes, removes and restores a block', () => {
    const task = add('A')
    const blocks = service()
    const block = blocks.create({ workItemId: task.id, date: '2026-10-19', startMinute: 540 })
    expect(blocks.update(block.id, { startMinute: 1410 }).lengthMinutes).toBe(30)
    const moved = blocks.update(block.id, {
      date: '2026-10-21',
      startMinute: 600,
      lengthMinutes: 45
    })
    expect(moved).toMatchObject({ date: '2026-10-21', startMinute: 600, lengthMinutes: 45 })
    const removed = blocks.remove(block.id)
    expect(blocks.list({ from: '2026-10-01', to: '2026-10-31' })).toEqual([])
    expect(blocks.restore(removed)).toMatchObject({ id: block.id, startMinute: 600 })
    expect(() => blocks.restore(removed)).toThrow(/already/)
  })

  it('keeps each token to its own project', () => {
    const other = add('Other', {}, 'p2')
    const blocks = service()
    const block = blocks.create({ workItemId: other.id, date: '2026-10-19', startMinute: 540 })
    expect(() =>
      blocks.create({ workItemId: other.id, date: '2026-10-19', startMinute: 540 }, 'p1')
    ).toThrow(/this project/)
    expect(() => blocks.get(block.id, 'p1')).toThrow(/not found/)
    expect(() => blocks.remove(block.id, 'p1')).toThrow(/not found/)
  })

  it('hides blocks while the task is in the bin, and removes them when it is deleted for good', () => {
    const task = add('A')
    const blocks = service()
    blocks.create({ workItemId: task.id, date: '2026-10-19', startMinute: 540 })
    planning.moveWorkItemToBin(task.id, human)
    expect(blocks.list({ from: '2026-10-19', to: '2026-10-19' })).toEqual([])
    planning.restoreWorkItem(task.id, human)
    expect(blocks.list({ from: '2026-10-19', to: '2026-10-19' })).toHaveLength(1)
    planning.moveWorkItemToBin(task.id, human)
    planning.deleteWorkItem(task.id, human)
    expect(
      planning.database.prepare('SELECT COUNT(*) AS n FROM planning_time_blocks').get()
    ).toEqual({ n: 0 })
  })

  it('goes when its project is removed', () => {
    const task = add('A')
    service().create({ workItemId: task.id, date: '2026-10-19', startMinute: 540 })
    deleteProjectRows(planning.database, 'p1')
    expect(
      planning.database.prepare('SELECT COUNT(*) AS n FROM planning_time_blocks').get()
    ).toEqual({ n: 0 })
  })

  it('writes blocks into the calendar file only when asked', () => {
    const task = add('Write the proposal', { targetDate: '2026-10-23' })
    const block = service().create({
      workItemId: task.id,
      date: '2026-10-19',
      startMinute: 540,
      lengthMinutes: 90
    })
    const without = buildProjectCalendarFile(planning, projects[0], {})
    expect(without.eventCount).toBe(1)
    expect(without.text).not.toContain(calendarUid('block', block.id))
    const withBlocks = buildProjectCalendarFile(planning, projects[0], { includeBlocks: true })
    expect(withBlocks.eventCount).toBe(2)
    expect(withBlocks.text).toContain(`UID:${calendarUid('block', block.id)}`)
  })
})

describe('the calendar file with time blocks (N3.4a)', () => {
  const block: TimeBlock = {
    id: 'b1',
    projectId: 'p1',
    workItemId: 't1',
    date: '2026-10-26',
    startMinute: 540,
    lengthMinutes: 90,
    createdAt: 1,
    title: 'Write the proposal',
    status: 'ready'
  }
  const build = (includeBlocks: boolean) =>
    buildCalendarFile({
      project: { id: 'p1', name: 'Website' },
      tasks: [],
      milestones: [],
      personName: () => null,
      now: Date.UTC(2026, 9, 17),
      blocks: [block],
      timeZone: 'Europe/London',
      options: { includeBlocks }
    })

  it('writes each block as a timed event in UTC with a stable UID and the task link', () => {
    const { text, eventCount } = build(true)
    expect(eventCount).toBe(1)
    expect(text).toContain('UID:block-b1@')
    expect(text).toContain('DTSTART:20261026T090000Z')
    expect(text).toContain('DTEND:20261026T103000Z')
    expect(text).toContain('SUMMARY:Write the proposal')
    expect(text.replace(/\r\n /g, '')).toContain('task/p1/t1')
  })

  it('leaves blocks out by default', () => {
    const { text, eventCount } = build(false)
    expect(eventCount).toBe(0)
    expect(text).not.toContain('block-b1')
  })
})
