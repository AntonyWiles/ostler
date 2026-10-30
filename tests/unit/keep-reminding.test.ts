import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, type OstlerConfig, type WatchedProject } from '../../src/shared/ostler-api'
import { PlanningService } from '../../electron/services/planning-service'
import { reminderMissed } from '../../electron/services/planning-reminders'
import { ReminderService } from '../../electron/services/reminder-service'
import { reminderSource } from '../../electron/services/inbox-sources'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

const human = { kind: 'human' as const }
const MINUTE = 60 * 1000

function project(id: string): WatchedProject {
  return { id, name: 'Website', enabled: true } as WatchedProject
}

/** Today (Wednesday 7 October 2026) at `hour:minute`, local time. */
function at(hour: number, minute = 0, day = 7): number {
  return new Date(2026, 9, day, hour, minute).getTime()
}

describe('reminders that keep reminding (N1.7)', () => {
  const tempDir = useTempDir('ostler-keep-reminding-')
  let planning: PlanningService
  let settings: OstlerConfig['notifications']
  let projects: WatchedProject[]
  let notify: ReturnType<typeof vi.fn>
  let delivered: ReturnType<typeof vi.fn>

  const service = () =>
    new ReminderService({
      reminders: planning.reminders,
      getProjects: () => projects,
      getTask: (id) => {
        const item = planning.getWorkItem(id)
        return { title: item.title, targetDate: item.targetDate }
      },
      replanDueReminders: () => planning.replanDueReminders(),
      notify,
      onDelivered: delivered,
      getQuietHours: () => settings,
      timeZone: () => 'Pacific/Auckland'
    })

  const task = (title = 'Call the council') => planning.createWorkItem('p1', { title }, human)

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(at(8)))
    const databasePath = await createMigratedDatabase(tempDir())
    settings = { ...DEFAULT_CONFIG.notifications }
    projects = [project('p1')]
    planning = new PlanningService(
      databasePath,
      () => projects.map((entry) => entry.id),
      () => settings
    )
    notify = vi.fn()
    delivered = vi.fn()
  })

  afterEach(() => {
    planning.close()
    vi.useRealTimers()
  })

  it('stores keep reminding with the chosen interval, or the setting’s default', () => {
    const item = task()
    const chosen = planning.addReminder(item.id, at(9), { keepReminding: true, intervalMinutes: 5 })
    expect(chosen).toMatchObject({ keepReminding: true, intervalMinutes: 5, stoppedAt: null })
    settings.keepRemindingMinutes = 30
    const fallback = planning.addReminder(item.id, at(10), { keepReminding: true })
    expect(fallback.intervalMinutes).toBe(30)
    const plain = planning.addReminder(item.id, at(11))
    expect(plain).toMatchObject({ keepReminding: false, intervalMinutes: null })
    expect(() =>
      planning.addReminder(item.id, at(12), { keepReminding: true, intervalMinutes: 7 })
    ).toThrow(/5, 15, 30 or 60/)
  })

  it('nudges every interval after it is delivered, with no new Inbox item', () => {
    const item = task()
    planning.addReminder(item.id, at(9), { keepReminding: true, intervalMinutes: 15 })
    const reminders = service()
    reminders.start()
    vi.advanceTimersByTime(60 * MINUTE)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0][4]).toEqual({ kind: 'task', projectId: 'p1', taskId: item.id })
    vi.advanceTimersByTime(15 * MINUTE)
    expect(notify).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(14 * MINUTE)
    expect(notify).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(MINUTE)
    expect(notify).toHaveBeenCalledTimes(3)
    expect(notify.mock.calls[2][3]).toBe('p1')
    expect(planning.reminders.delivered(['p1'])).toHaveLength(1)
    const [entry] = reminderSource(planning.database, () => projects)()
    expect(entry).toMatchObject({ nudging: true, body: 'Keeps reminding · Website' })
    reminders.stop()
  })

  it('holds nudges in quiet hours and nudges at their end', () => {
    settings = {
      ...settings,
      quietHoursEnabled: true,
      quietHoursStart: '10:00',
      quietHoursEnd: '11:00'
    }
    const item = task()
    planning.addReminder(item.id, at(9, 50), { keepReminding: true, intervalMinutes: 15 })
    const reminders = service()
    reminders.start()
    vi.advanceTimersByTime(110 * MINUTE)
    expect(notify).toHaveBeenCalledTimes(1)
    // 10:05 falls in quiet hours: the next nudge waits until 11:00.
    expect(reminders.nextAt()).toBe(at(11))
    vi.advanceTimersByTime(69 * MINUTE)
    expect(notify).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(MINUTE)
    expect(notify).toHaveBeenCalledTimes(2)
    expect(Date.now()).toBe(at(11))
    vi.advanceTimersByTime(15 * MINUTE)
    expect(notify).toHaveBeenCalledTimes(3)
    reminders.stop()
  })

  it('stops when the task is done', () => {
    const item = task()
    planning.addReminder(item.id, at(9), { keepReminding: true, intervalMinutes: 5 })
    const reminders = service()
    reminders.start()
    vi.advanceTimersByTime(60 * MINUTE)
    planning.updateWorkItem(item.id, { status: 'done' }, human)
    reminders.plan()
    vi.advanceTimersByTime(60 * MINUTE)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(planning.reminders.nudging(['p1'])).toEqual([])
    reminders.stop()
  })

  it('stops when the task is archived or deleted', () => {
    const archived = task('Archive me')
    const deleted = task('Delete me')
    planning.addReminder(archived.id, at(9), { keepReminding: true, intervalMinutes: 5 })
    planning.addReminder(deleted.id, at(9), { keepReminding: true, intervalMinutes: 5 })
    const reminders = service()
    reminders.start()
    vi.advanceTimersByTime(60 * MINUTE)
    expect(notify).toHaveBeenCalledTimes(2)
    planning.archiveWorkItem(archived.id, human)
    planning.deleteWorkItem(deleted.id, human)
    reminders.plan()
    vi.advanceTimersByTime(60 * MINUTE)
    expect(notify).toHaveBeenCalledTimes(2)
    reminders.stop()
  })

  it('stops when the person presses Stop reminding, and the Inbox item stays', () => {
    const item = task()
    const reminder = planning.addReminder(item.id, at(9), {
      keepReminding: true,
      intervalMinutes: 5
    })
    const reminders = service()
    reminders.start()
    vi.advanceTimersByTime(65 * MINUTE)
    expect(notify).toHaveBeenCalledTimes(2)
    const stopped = planning.stopReminder(item.id, reminder.id)
    expect(stopped.stoppedAt).toBe(Date.now())
    reminders.plan()
    vi.advanceTimersByTime(60 * MINUTE)
    expect(notify).toHaveBeenCalledTimes(2)
    const [entry] = reminderSource(planning.database, () => projects)()
    expect(entry.nudging).toBeUndefined()
    expect(entry.body).toBe('Reminder · Website')
    reminders.stop()
  })

  it('refuses to stop a reminder that does not keep reminding', () => {
    const item = task()
    const plain = planning.addReminder(item.id, at(9))
    expect(() => planning.stopReminder(item.id, plain.id)).toThrow(/does not keep reminding/)
  })

  it('starts nudging again from the snooze time after a snooze', () => {
    const item = task()
    const reminder = planning.addReminder(item.id, at(9), {
      keepReminding: true,
      intervalMinutes: 15
    })
    const reminders = service()
    reminders.start()
    vi.advanceTimersByTime(60 * MINUTE)
    expect(notify).toHaveBeenCalledTimes(1)
    planning.reminders.reschedule(reminder.id, at(13))
    reminders.plan()
    vi.advanceTimersByTime(3 * 60 * MINUTE + 59 * MINUTE)
    expect(notify).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(MINUTE)
    expect(notify).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(15 * MINUTE)
    expect(notify).toHaveBeenCalledTimes(3)
    reminders.stop()
  })

  it('stops at local midnight on the day it was delivered, and the Inbox says Missed', () => {
    const item = task()
    const reminder = planning.addReminder(item.id, at(23, 20), {
      keepReminding: true,
      intervalMinutes: 15
    })
    const reminders = service()
    reminders.start()
    vi.advanceTimersByTime(at(23, 59) - Date.now())
    // 23:20, 23:35 and 23:50.
    expect(notify).toHaveBeenCalledTimes(3)
    vi.advanceTimersByTime(MINUTE)
    const stopped = planning.reminders.get(reminder.id)!
    expect(stopped.stoppedAt).toBe(at(0, 0, 8))
    expect(reminderMissed(stopped)).toBe(true)
    expect(delivered).toHaveBeenCalled()
    vi.advanceTimersByTime(60 * MINUTE)
    expect(notify).toHaveBeenCalledTimes(3)
    const [entry] = reminderSource(planning.database, () => projects)()
    expect(entry.body).toBe('Missed · Website')
    expect(entry.nudging).toBeUndefined()
    reminders.stop()
  })

  it('delivers one missed while Ostler was closed once at start, then nudges', () => {
    const item = task()
    planning.addReminder(item.id, at(9), { keepReminding: true, intervalMinutes: 15 })
    vi.setSystemTime(new Date(at(10)))
    const reminders = service()
    reminders.start()
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0][1]).toMatch(/while Ostler was closed/)
    vi.advanceTimersByTime(14 * MINUTE)
    expect(notify).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(MINUTE)
    expect(notify).toHaveBeenCalledTimes(2)
    reminders.stop()
  })

  it('ends one left nudging past midnight while Ostler was closed, as missed', () => {
    const item = task()
    const reminder = planning.addReminder(item.id, at(9), {
      keepReminding: true,
      intervalMinutes: 15
    })
    const first = service()
    first.start()
    vi.advanceTimersByTime(60 * MINUTE)
    first.stop()
    vi.setSystemTime(new Date(at(8, 0, 8)))
    const second = service()
    second.start()
    vi.advanceTimersByTime(0)
    expect(planning.reminders.get(reminder.id)!.stoppedAt).toBe(at(0, 0, 8))
    expect(notify).toHaveBeenCalledTimes(1)
    second.stop()
  })

  it('keeps one timer, planned for the earliest of the next reminder and the next nudge', () => {
    const item = task()
    planning.addReminder(item.id, at(9), { keepReminding: true, intervalMinutes: 30 })
    planning.addReminder(item.id, at(12))
    const reminders = service()
    reminders.start()
    // The 09:00 reminder: one timer, and the hourly check.
    expect(vi.getTimerCount()).toBe(2)
    expect(reminders.nextAt()).toBe(at(9))
    vi.advanceTimersByTime(60 * MINUTE)
    expect(reminders.nextAt()).toBe(at(9, 30))
    expect(vi.getTimerCount()).toBe(2)
    planning.addReminder(item.id, at(9, 10))
    reminders.plan()
    expect(reminders.nextAt()).toBe(at(9, 10))
    expect(vi.getTimerCount()).toBe(2)
    reminders.stop()
    expect(vi.getTimerCount()).toBe(0)
  })
})
