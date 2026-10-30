import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PlanningService } from '../../electron/services/planning-service'
import {
  LATEST_SCHEMA_VERSION,
  MIGRATIONS,
  migrateOstlerDatabase
} from '../../electron/services/database/migrations'
import { createMigratedDatabase } from '../helpers/database'
import {
  COUNTDOWN_MAX,
  countdownProgress,
  countdownWords,
  countdownWorkingDays
} from '../../src/shared/planning/countdown'
import { myWorkingDays, type DayOffSpan } from '../../src/shared/planning/working-days'

const P1 = '0f8fad5b-d9cb-469f-a165-70867728950e'
const P2 = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed'
const human = { kind: 'human' as const }

/** A fixed today, a Monday: no test reads the real date. */
const TODAY = '2026-03-02'
const launch = (date: string, done = false) => ({ title: 'Launch', date, done })

describe('countdown words (N5.2b)', () => {
  it('words a date ahead, tomorrow, today and past', () => {
    expect(countdownWords(launch('2026-03-07'), TODAY)).toBe('5 days to Launch')
    expect(countdownWords(launch('2026-03-03'), TODAY)).toBe('Launch is tomorrow')
    expect(countdownWords(launch('2026-03-02'), TODAY)).toBe('Launch is today')
    expect(countdownWords(launch('2026-03-01'), TODAY)).toBe('Launch was yesterday')
    expect(countdownWords(launch('2026-02-28'), TODAY)).toBe('Launch was 2 days ago')
  })

  it('says done for a done item, whatever its date', () => {
    expect(countdownWords(launch('2026-03-14', true), TODAY)).toBe('Launch: done')
    expect(countdownWords(launch('2026-02-01', true), TODAY)).toBe('Launch: done')
  })

  it('adds working days after more than a week, across weekends', () => {
    // Tuesday 3 March to Saturday 14 March: two weekends left out.
    expect(countdownWorkingDays('2026-03-14', TODAY)).toBe(9)
    expect(countdownWords(launch('2026-03-14'), TODAY)).toBe('12 days to Launch (9 working days)')
    // A week or less never says working days.
    expect(countdownWords(launch('2026-03-09'), TODAY)).toBe('7 days to Launch')
  })

  it('leaves out a day off for everyone, but not one only for someone', () => {
    const daysOff: DayOffSpan[] = [
      { personId: null, firstDate: '2026-03-10', lastDate: '2026-03-10', name: 'Holiday' },
      { personId: 'someone', firstDate: '2026-03-11', lastDate: '2026-03-12', name: 'Leave' }
    ]
    expect(countdownWords(launch('2026-03-14'), TODAY, { daysOff })).toBe(
      '12 days to Launch (8 working days)'
    )
  })

  it("counts my own working days: Me's days off and everyone's, not another person's leave", () => {
    const daysOff: DayOffSpan[] = [
      { personId: null, firstDate: '2026-03-10', lastDate: '2026-03-10', name: 'Holiday' },
      { personId: 'me', firstDate: '2026-03-05', lastDate: '2026-03-05', name: 'Dentist' },
      { personId: 'someone', firstDate: '2026-03-11', lastDate: '2026-03-12', name: 'Leave' }
    ]
    const me = { id: 'me', workingDays: [1, 2, 3, 4, 5] }
    // Nine weekdays, less everyone's holiday and my Thursday off.
    expect(countdownWords(launch('2026-03-14'), TODAY, myWorkingDays(me, daysOff))).toBe(
      '12 days to Launch (7 working days)'
    )
    // Another person's leave never changes my countdown.
    const without = daysOff.filter((day) => day.personId !== 'someone')
    expect(countdownWorkingDays('2026-03-14', TODAY, myWorkingDays(me, without))).toBe(7)
    // My working days: a four-day week (no Fridays) leaves out 6 and 13 March too.
    expect(
      countdownWords(
        launch('2026-03-14'),
        TODAY,
        myWorkingDays({ id: 'me', workingDays: [1, 2, 3, 4] }, daysOff)
      )
    ).toBe('12 days to Launch (5 working days)')
    // Nobody as Me: Monday to Friday less everyone's days off, no one's leave.
    expect(myWorkingDays(null, daysOff)).toEqual({ personId: null, daysOff })
    expect(countdownWords(launch('2026-03-14'), TODAY, myWorkingDays(null, daysOff))).toBe(
      '12 days to Launch (8 working days)'
    )
  })

  it('counts working days since a date long past', () => {
    expect(countdownWords(launch('2026-02-16'), TODAY)).toBe(
      'Launch was 14 days ago (10 working days)'
    )
  })

  it('measures the time passed since the item was pinned', () => {
    const pinnedAt = new Date(2026, 1, 20, 9, 0).getTime()
    expect(countdownProgress(pinnedAt, '2026-03-12', TODAY)).toBeCloseTo(10 / 20)
    expect(countdownProgress(pinnedAt, '2026-02-10', TODAY)).toBe(1)
    expect(countdownProgress(pinnedAt, '2026-03-12', '2026-02-01')).toBe(0)
  })
})

describe('the countdown migration (N5.2b)', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-countdown-migration-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('adds countdown to the pins there are, off', async () => {
    const dbPath = path.join(tempDir, 'ostler.db')
    const options = { backupDir: path.join(tempDir, 'backups'), appVersion: 'test' }
    const before = MIGRATIONS.filter((migration) => migration.version < 49)
    await migrateOstlerDatabase(dbPath, options, before)
    const db = new Database(dbPath)
    db.prepare(
      `INSERT INTO pins (id, place, project_id, kind, target_id, order_key, created_at)
       VALUES ('pin', 'sidebar', ?, 'task', 't1', 'V', 1)`
    ).run(P1)
    db.close()

    const result = await migrateOstlerDatabase(dbPath, options)
    expect(result.to).toBe(LATEST_SCHEMA_VERSION)
    const after = new Database(dbPath)
    expect(after.prepare('SELECT countdown FROM pins').all()).toEqual([{ countdown: 0 }])
    after.close()
  })
})

describe('countdowns on pins (N5.2b)', () => {
  let tempDir: string
  let planning: PlanningService
  let daysOff: DayOffSpan[]

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-countdowns-'))
    const dbPath = await createMigratedDatabase(tempDir)
    planning = new PlanningService(dbPath, () => [P1, P2])
    daysOff = []
    planning.pins.setCountdownContext(() => ({ today: TODAY, daysOff }))
  })

  afterEach(() => {
    planning.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  const pins = () => planning.pins
  const pinTask = (title: string, targetDate: string | null, projectId = P1) => {
    const task = planning.createWorkItem(projectId, { title, targetDate }, human)
    return pins().create({ place: 'sidebar', kind: 'task', targetId: task.id })
  }

  it('shows a dated task as a countdown, worded for today', () => {
    const pin = pinTask('Launch', '2026-03-14')
    expect(pin).toMatchObject({ countdown: false, date: '2026-03-14', done: false })
    expect(pin.countdownText).toBeNull()

    const on = pins().setCountdown(pin.id, { countdown: true })
    expect(on).toMatchObject({
      countdown: true,
      countdownText: '12 days to Launch (9 working days)'
    })
    expect(
      pins()
        .countdowns()
        .map((entry) => entry.id)
    ).toEqual([pin.id])

    daysOff = [{ personId: null, firstDate: '2026-03-10', lastDate: '2026-03-10', name: 'Hol' }]
    expect(pins().countdowns()[0].countdownText).toBe('12 days to Launch (8 working days)')
  })

  it("words a pin's countdown with my own working days, as the app gives them", () => {
    const pin = pins().setCountdown(pinTask('Launch', '2026-03-14').id, { countdown: true })
    expect(pin.countdownText).toBe('12 days to Launch (9 working days)')
    const leave: DayOffSpan[] = [
      { personId: 'me', firstDate: '2026-03-05', lastDate: '2026-03-05', name: 'Dentist' },
      { personId: 'someone', firstDate: '2026-03-11', lastDate: '2026-03-12', name: 'Leave' }
    ]
    planning.pins.setCountdownContext(() => ({
      today: TODAY,
      ...myWorkingDays({ id: 'me', workingDays: [1, 2, 3, 4, 5] }, leave)
    }))
    // My Thursday off counts; someone else's leave does not.
    expect(pins().countdowns()[0].countdownText).toBe('12 days to Launch (8 working days)')
  })

  it('counts down a milestone, and says done once it is complete', () => {
    const milestone = planning.createMilestone(P1, { name: 'Move', targetDate: '2026-03-03' })
    const pin = pins().create({ place: 'overview', kind: 'milestone', targetId: milestone.id })
    expect(pins().setCountdown(pin.id, { countdown: true }).countdownText).toBe('Move is tomorrow')
    planning.updateMilestone(milestone.id, { status: 'complete' })
    expect(pins().countdowns()[0]).toMatchObject({ done: true, countdownText: 'Move: done' })
  })

  it('refuses an undated task and other kinds of pin', () => {
    const undated = pinTask('Someday', null)
    expect(() => pins().setCountdown(undated.id, { countdown: true })).toThrow(/due date/)
    const decision = planning.createDecision(P1, { title: 'Supplier', decision: 'Yes' })
    const pin = pins().create({ place: 'sidebar', kind: 'decision', targetId: decision.id })
    expect(() => pins().setCountdown(pin.id, { countdown: true })).toThrow(/milestone or task/)
  })

  it('shows at most three, and turns one off in the same change when asked', () => {
    const made = ['A', 'B', 'C', 'D'].map((title, index) =>
      pinTask(title, `2026-04-0${index + 1}`, index % 2 === 0 ? P1 : P2)
    )
    for (const pin of made.slice(0, COUNTDOWN_MAX)) pins().setCountdown(pin.id, { countdown: true })
    expect(() => pins().setCountdown(made[3].id, { countdown: true })).toThrow(/At most 3/)
    expect(pins().countdowns()).toHaveLength(3)

    pins().setCountdown(made[3].id, { countdown: true, replacePinId: made[1].id })
    expect(
      pins()
        .countdowns()
        .map((pin) => pin.title)
    ).toEqual(['A', 'C', 'D'])
    expect(() =>
      pins().setCountdown(made[1].id, { countdown: true, replacePinId: 'not-a-countdown' })
    ).toThrow(/not one of the countdowns/)
  })

  it('counts an item pinned in both places once, and turns it off in both', () => {
    const task = planning.createWorkItem(P1, { title: 'Launch', targetDate: '2026-03-14' }, human)
    const side = pins().create({ place: 'sidebar', kind: 'task', targetId: task.id })
    const over = pins().create({ place: 'overview', kind: 'task', targetId: task.id })
    pins().setCountdown(side.id, { countdown: true })
    pins().setCountdown(over.id, { countdown: true })
    expect(
      pins()
        .countdowns()
        .map((pin) => pin.id)
    ).toEqual([side.id])
    pins().setCountdown(over.id, { countdown: false })
    expect(pins().countdowns()).toEqual([])
    expect(pins().get(side.id).countdown).toBe(false)
  })

  it('brings a countdown back with an undone unpin, while there is room', () => {
    const pin = pinTask('Launch', '2026-03-14')
    pins().setCountdown(pin.id, { countdown: true })
    const unpinned = pins().delete(pin.id)
    expect(pins().countdowns()).toEqual([])
    expect(pins().restore(unpinned).countdown).toBe(true)
    expect(pins().countdowns()).toHaveLength(1)
  })
})
