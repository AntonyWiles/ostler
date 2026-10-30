import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, type OstlerConfig, type WatchedProject } from '../../src/shared/ostler-api'
import { PlanningService } from '../../electron/services/planning-service'
import { ReminderService, reminderTaskReader } from '../../electron/services/reminder-service'
import { inQuietHours } from '../../src/shared/reminder-settings'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

const human = { kind: 'human' as const }

function project(id: string, enabled = true): WatchedProject {
  return { id, name: id === 'p1' ? 'Website' : 'Garden', enabled } as WatchedProject
}

describe('reminders (P5.6)', () => {
  const tempDir = useTempDir('ostler-reminders-')
  let databasePath: string
  let planning: PlanningService
  let settings: OstlerConfig['notifications']
  let projects: WatchedProject[]
  let notify: ReturnType<typeof vi.fn>
  let delivered: ReturnType<typeof vi.fn>
  let zone: string

  const service = () =>
    new ReminderService({
      reminders: planning.reminders,
      getProjects: () => projects,
      // The reader the app wires in (electron/app/services.ts).
      getTask: reminderTaskReader(planning),
      replanDueReminders: () => planning.replanDueReminders(),
      notify,
      onDelivered: delivered,
      timeZone: () => zone
    })

  beforeEach(async () => {
    vi.useFakeTimers()
    // Wednesday 7 October 2026, 08:00 local time.
    vi.setSystemTime(new Date(2026, 9, 7, 8, 0))
    databasePath = await createMigratedDatabase(tempDir())
    settings = { ...DEFAULT_CONFIG.notifications }
    projects = [project('p1'), project('p2')]
    planning = new PlanningService(
      databasePath,
      () => projects.map((entry) => entry.id),
      () => settings
    )
    notify = vi.fn()
    delivered = vi.fn()
    zone = 'Pacific/Auckland'
  })

  afterEach(() => {
    planning.close()
    vi.useRealTimers()
  })

  it('holds reminders while paused from the tray, and delivers them when the pause ends (P8.2)', () => {
    planning.createWorkItem('p1', { title: 'Pay invoice', targetDate: '2026-10-07' }, human)
    const reminders = service()
    reminders.start()
    // Paused at 08:30 for an hour: the 09:00 reminder waits until 09:30.
    vi.advanceTimersByTime(30 * 60 * 1000)
    reminders.pauseUntil(Date.now() + 60 * 60 * 1000)
    expect(reminders.pausedUntil()).toBe(new Date(2026, 9, 7, 9, 30).getTime())
    vi.advanceTimersByTime(45 * 60 * 1000)
    expect(notify).not.toHaveBeenCalled()
    vi.advanceTimersByTime(15 * 60 * 1000)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(reminders.pausedUntil()).toBeNull()
    reminders.stop()
  })

  it('fires a due reminder at the reminder time, as a notification that opens the task', () => {
    const task = planning.createWorkItem(
      'p1',
      { title: 'Pay invoice', targetDate: '2026-10-07' },
      human
    )
    const reminders = service()
    reminders.start()
    expect(notify).not.toHaveBeenCalled()

    vi.advanceTimersByTime(59 * 60 * 1000)
    expect(notify).not.toHaveBeenCalled()
    vi.advanceTimersByTime(60 * 1000)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith('reminder', 'Due today · Website', 'Pay invoice', 'p1', {
      kind: 'task',
      projectId: 'p1',
      taskId: task.id
    })
    expect(delivered).toHaveBeenCalled()
    expect(planning.listReminders(task.id)).toEqual([])
    reminders.stop()
  })

  it('reminds the day before, or both, by the setting', () => {
    settings.dueReminders = 'both'
    const task = planning.createWorkItem('p1', { title: 'Taxes', targetDate: '2026-10-09' }, human)
    expect(planning.listReminders(task.id).map((r) => new Date(r.remindAt).getDate())).toEqual([
      8, 9
    ])
    settings.dueReminders = 'off'
    planning.replanDueReminders()
    expect(planning.listReminders(task.id)).toEqual([])
  })

  it('re-plans when the due date changes', () => {
    const task = planning.createWorkItem('p1', { title: 'Call', targetDate: '2026-10-07' }, human)
    const reminders = service()
    reminders.start()
    planning.updateWorkItem(task.id, { targetDate: '2026-10-08' }, human)
    reminders.plan()
    vi.advanceTimersByTime(2 * 60 * 60 * 1000)
    expect(notify).not.toHaveBeenCalled()
    vi.setSystemTime(new Date(2026, 9, 8, 9, 0))
    reminders.check()
    expect(notify).toHaveBeenCalledTimes(1)
    reminders.stop()
  })

  it('cancels a task’s reminders when it is done, archived or deleted', () => {
    const task = planning.createWorkItem('p1', { title: 'Call', targetDate: '2026-10-07' }, human)
    planning.addReminder(task.id, new Date(2026, 9, 7, 15, 0).getTime())
    expect(planning.listReminders(task.id)).toHaveLength(2)
    planning.updateWorkItem(task.id, { status: 'done' }, human)
    expect(planning.listReminders(task.id)).toEqual([])
    const reminders = service()
    reminders.start()
    vi.advanceTimersByTime(10 * 60 * 60 * 1000)
    expect(notify).not.toHaveBeenCalled()
    reminders.stop()

    const other = planning.createWorkItem('p1', { title: 'Other', targetDate: '2026-10-09' }, human)
    planning.archiveWorkItem(other.id, human)
    expect(planning.listReminders(other.id)).toEqual([])
    planning.unarchiveWorkItem(other.id, human)
    expect(planning.listReminders(other.id)).toHaveLength(1)
    planning.moveWorkItemToBin(other.id, human)
    expect(planning.listReminders(other.id)).toEqual([])
  })

  it('summarises reminders missed while Ostler was closed in one notification', () => {
    planning.createWorkItem('p1', { title: 'One', targetDate: '2026-10-07' }, human)
    planning.createWorkItem('p1', { title: 'Two', targetDate: '2026-10-07' }, human)
    planning.createWorkItem('p2', { title: 'Three', targetDate: '2026-10-07' }, human)
    // Ostler was closed through the morning.
    vi.setSystemTime(new Date(2026, 9, 7, 13, 0))
    const reminders = service()
    reminders.start()
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith(
      'reminder',
      '3 reminders while Ostler was closed',
      'Open the Inbox to see them.',
      null,
      { kind: 'inbox' }
    )
    expect(planning.reminders.delivered(['p1', 'p2'])).toHaveLength(3)
    reminders.stop()
  })

  it('never fires for a disabled project', () => {
    planning.createWorkItem('p2', { title: 'Weed', targetDate: '2026-10-07' }, human)
    projects = [project('p1'), project('p2', false)]
    const reminders = service()
    reminders.start()
    vi.advanceTimersByTime(3 * 60 * 60 * 1000)
    expect(notify).not.toHaveBeenCalled()
    reminders.stop()
  })

  it('re-plans due reminders when the time zone changes', () => {
    const task = planning.createWorkItem('p1', { title: 'Call', targetDate: '2026-10-08' }, human)
    const reminders = service()
    reminders.start()
    const replan = vi.spyOn(planning, 'replanDueReminders')
    reminders.check()
    expect(replan).not.toHaveBeenCalled()
    zone = 'Europe/London'
    vi.advanceTimersByTime(60 * 60 * 1000)
    expect(replan).toHaveBeenCalledTimes(1)
    expect(planning.listReminders(task.id)).toHaveLength(1)
    reminders.stop()
  })

  it('knows quiet hours, including ones that run over midnight', () => {
    const quiet = { quietHoursEnabled: true, quietHoursStart: '22:00', quietHoursEnd: '07:00' }
    expect(inQuietHours(new Date(2026, 9, 7, 23, 30), quiet)).toBe(true)
    expect(inQuietHours(new Date(2026, 9, 7, 6, 59), quiet)).toBe(true)
    expect(inQuietHours(new Date(2026, 9, 7, 7, 0), quiet)).toBe(false)
    expect(inQuietHours(new Date(2026, 9, 7, 12, 0), quiet)).toBe(false)
    expect(inQuietHours(new Date(2026, 9, 7, 23, 30), { ...quiet, quietHoursEnabled: false })).toBe(
      false
    )
    const day = { quietHoursEnabled: true, quietHoursStart: '12:00', quietHoursEnd: '13:00' }
    expect(inQuietHours(new Date(2026, 9, 7, 12, 30), day)).toBe(true)
    expect(inQuietHours(new Date(2026, 9, 7, 13, 30), day)).toBe(false)
  })

  it('refuses a custom reminder in the past', () => {
    const task = planning.createWorkItem('p1', { title: 'Call' }, human)
    expect(() => planning.addReminder(task.id, Date.now() - 1000)).toThrow('in the future')
  })

  describe('the task a reminder shows', () => {
    it('reads the title and due date of a live task', () => {
      const task = planning.createWorkItem(
        'p1',
        { title: 'Pay invoice', targetDate: '2026-10-07' },
        human
      )
      expect(reminderTaskReader(planning)(task.id)).toEqual({
        title: 'Pay invoice',
        targetDate: '2026-10-07'
      })
    })

    it('stays quiet for an archived task, a recycled one and one that is gone', () => {
      const read = reminderTaskReader(planning)
      const archived = planning.createWorkItem('p1', { title: 'Archived' }, human)
      planning.archiveWorkItem(archived.id, human)
      const recycled = planning.createWorkItem('p1', { title: 'Recycled' }, human)
      planning.moveWorkItemToBin(recycled.id, human)
      expect(read(archived.id)).toBeNull()
      expect(read(recycled.id)).toBeNull()
      expect(read('no-such-task')).toBeNull()
    })

    it('shows no notification for a reminder whose task was archived or recycled since it was planned', () => {
      const archived = planning.createWorkItem(
        'p1',
        { title: 'Archived', targetDate: '2026-10-07' },
        human
      )
      const recycled = planning.createWorkItem(
        'p1',
        { title: 'Recycled', targetDate: '2026-10-07' },
        human
      )
      const kept = planning.createWorkItem('p1', { title: 'Kept', targetDate: '2026-10-07' }, human)
      // The task leaves the plan behind the reminder's back: the reader is the last guard.
      const gone = new Set([archived.id, recycled.id])
      const live = reminderTaskReader(planning)
      const reminders = new ReminderService({
        reminders: planning.reminders,
        getProjects: () => projects,
        getTask: (id) => {
          if (!gone.has(id)) return live(id)
          if (id === archived.id) planning.archiveWorkItem(id, human)
          else planning.moveWorkItemToBin(id, human)
          gone.delete(id)
          return live(id)
        },
        replanDueReminders: () => {},
        notify,
        onDelivered: delivered,
        timeZone: () => zone
      })
      reminders.start()
      vi.advanceTimersByTime(60 * 60 * 1000)
      expect(notify).toHaveBeenCalledTimes(1)
      expect(notify.mock.calls[0][2]).toBe('Kept')
      expect(notify.mock.calls[0][4]).toEqual({ kind: 'task', projectId: 'p1', taskId: kept.id })
      reminders.stop()
    })
  })
})
