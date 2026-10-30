import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, type OstlerConfig } from '../../src/shared/ostler-api'
import { lastWeeklyReviewDue, nextWeeklyReviewDue } from '../../src/shared/reminder-settings'
import {
  WeeklyReviewReminder,
  weeklyReviewSource
} from '../../electron/services/weekly-review-reminder'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

type Settings = OstlerConfig['notifications']

// Friday 16 October 2026.
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).getTime()

describe('weekly review reminder (N1.5)', () => {
  const tempDir = useTempDir('ostler-weekly-reminder-')
  let db: Database.Database
  let settings: Settings
  let quiet: boolean
  let notify: ReturnType<typeof vi.fn>
  let delivered: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    db = new Database(await createMigratedDatabase(tempDir()))
    // Fridays at 16:00.
    settings = { ...DEFAULT_CONFIG.notifications, weeklyReviewDay: 5, weeklyReviewTime: '16:00' }
    quiet = false
    notify = vi.fn()
    delivered = vi.fn()
  })

  afterEach(() => {
    db.close()
    vi.useRealTimers()
  })

  const reminder = () =>
    new WeeklyReviewReminder({
      db,
      getSettings: () => settings,
      inQuietHours: () => quiet,
      notify,
      onDelivered: delivered,
      now: () => Date.now()
    })
  const inbox = () => weeklyReviewSource(db, () => settings)()
  const finishReview = (when: number) =>
    db
      .prepare("INSERT INTO weekly_reviews (id, finished_at, steps) VALUES (?, ?, '{}')")
      .run(`r${when}`, when)

  it('works out the last and next time from the weekday and local time', () => {
    expect(lastWeeklyReviewDue(settings, at(16, 15, 59))).toBe(at(9, 16))
    expect(lastWeeklyReviewDue(settings, at(16, 16))).toBe(at(16, 16))
    expect(nextWeeklyReviewDue(settings, at(16, 15))).toBe(at(16, 16))
    expect(nextWeeklyReviewDue(settings, at(18, 9))).toBe(at(23, 16))
    expect(lastWeeklyReviewDue({ ...settings, weeklyReviewDay: null }, at(16, 17))).toBeNull()
  })

  it('fires once at the weekday and time, as a notification and an Inbox entry', () => {
    vi.setSystemTime(at(16, 9))
    const weekly = reminder()
    weekly.settingsChanged()
    expect(weekly.fire()).toBe(false)
    expect(inbox()).toEqual([])

    vi.setSystemTime(at(16, 16, 1))
    expect(weekly.fire()).toBe(true)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(delivered).toHaveBeenCalledTimes(1)
    expect(inbox()).toMatchObject([{ kind: 'weeklyReview', createdAt: at(16, 16) }])

    expect(weekly.fire()).toBe(false)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(inbox()).toHaveLength(1)
    weekly.stop()
  })

  it('waits out quiet hours, then shows', () => {
    vi.setSystemTime(at(16, 9))
    const weekly = reminder()
    weekly.settingsChanged()
    quiet = true
    vi.setSystemTime(at(16, 16, 5))
    expect(weekly.fire()).toBe(false)
    expect(notify).not.toHaveBeenCalled()
    expect(inbox()).toEqual([])

    quiet = false
    vi.setSystemTime(at(16, 22))
    expect(weekly.fire()).toBe(true)
    expect(notify).toHaveBeenCalledTimes(1)
    weekly.stop()
  })

  it('shows a time missed while closed in the Inbox at the next start, once, without a notification', () => {
    vi.setSystemTime(at(14, 9))
    reminder().settingsChanged()
    // Closed over Friday; started on Sunday.
    vi.setSystemTime(at(18, 10))
    const weekly = reminder()
    expect(weekly.deliverMissed()).toBe(true)
    expect(notify).not.toHaveBeenCalled()
    expect(inbox()).toHaveLength(1)
    expect(weekly.deliverMissed()).toBe(false)
    expect(reminder().deliverMissed()).toBe(false)
    expect(inbox()).toHaveLength(1)
    // A second missed week still leaves one entry.
    vi.setSystemTime(at(25, 10))
    expect(reminder().deliverMissed()).toBe(true)
    expect(inbox()).toMatchObject([{ createdAt: at(23, 16) }])
  })

  it('is cleared by finishing a review that week', () => {
    vi.setSystemTime(at(16, 9))
    const weekly = reminder()
    weekly.settingsChanged()
    vi.setSystemTime(at(16, 16, 1))
    weekly.fire()
    expect(inbox()).toHaveLength(1)
    finishReview(at(16, 17))
    expect(inbox()).toEqual([])

    // A review finished earlier in the week means the next time stays quiet.
    finishReview(at(21, 10))
    vi.setSystemTime(at(23, 16, 1))
    expect(weekly.fire()).toBe(false)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(inbox()).toEqual([])
    weekly.stop()
  })

  it('does not offer the time just past when the setting is first chosen', () => {
    settings = { ...settings, weeklyReviewDay: null }
    vi.setSystemTime(at(16, 18))
    const weekly = reminder()
    expect(weekly.deliverMissed()).toBe(false)
    settings = { ...settings, weeklyReviewDay: 5 }
    weekly.settingsChanged()
    expect(weekly.fire()).toBe(false)
    expect(weekly.deliverMissed()).toBe(false)
    expect(inbox()).toEqual([])
    weekly.stop()
  })

  it('leaves the Inbox when the reminder is turned off', () => {
    vi.setSystemTime(at(14, 9))
    reminder().settingsChanged()
    vi.setSystemTime(at(18, 10))
    reminder().deliverMissed()
    expect(inbox()).toHaveLength(1)
    settings = { ...settings, weeklyReviewDay: null }
    expect(inbox()).toEqual([])
  })
})
