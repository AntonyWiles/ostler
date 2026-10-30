import type {
  NavigateRequest,
  OstlerConfig,
  NotificationType,
  PlanningReminder,
  PlanningWorkItem,
  WatchedProject
} from '@shared/ostler-api'
import { nextNudge, type PlanningReminders } from './planning-reminders'
import { reminderText } from './inbox-sources'
import { t } from '@shared/i18n'

type QuietHours = Pick<
  OstlerConfig['notifications'],
  'quietHoursEnabled' | 'quietHoursStart' | 'quietHoursEnd'
>

const NO_QUIET_HOURS: QuietHours = {
  quietHoursEnabled: false,
  quietHoursStart: '22:00',
  quietHoursEnd: '07:00'
}

/**
 * `getTask` for the app's ReminderService, read from the plan. An archived or
 * recycled task has nothing to open, so its reminder stays quiet; so does one
 * that is gone.
 */
export function reminderTaskReader(planning: {
  getWorkItem(workItemId: string): PlanningWorkItem
}): ReminderServiceDependencies['getTask'] {
  return (workItemId) => {
    try {
      const item = planning.getWorkItem(workItemId)
      if (item.archivedAt || item.deletedAt) return null
      return { title: item.title, targetDate: item.targetDate }
    } catch {
      return null
    }
  }
}

/** The timer never waits longer than this, and the hourly check runs this often. */
export const REMINDER_CHECK_MS = 60 * 60 * 1000

export interface ReminderServiceDependencies {
  reminders: PlanningReminders
  getProjects(): WatchedProject[]
  /** The task's title and due date, or null when it is gone. */
  getTask(workItemId: string): { title: string; targetDate: string | null } | null
  /** Plans every open task's due reminders again (`PlanningService.replanDueReminders`). */
  replanDueReminders(): void
  /** Runs the rules whose trigger is a due date being reached (R6.2), on this schedule. */
  runDueRules?(): void
  /** Makes the rounds whose start date has come (N5.7a), on this schedule. */
  startDueRounds?(): void
  /** Queues the repeating tasks that go to agents and whose day has come (N9.7), on this schedule. */
  queueScheduledTasks?(): void
  notify(
    type: NotificationType,
    title: string,
    body: string,
    projectId: string | null,
    target: NavigateRequest
  ): void
  /** Reminders were delivered: Home and the Inbox reload. */
  onDelivered(): void
  /**
   * Quiet hours (N1.7): a nudge that falls in them waits for their end.
   * Without it there are no quiet hours.
   */
  getQuietHours?(): QuietHours
  now?: () => number
  /** The system time zone, to notice a change (a reminder time is wall-clock). */
  timeZone?: () => string
}

/**
 * Fires reminders while Ostler runs (P5.6). One timer is set for the next
 * pending reminder and planned again whenever reminders change; an hourly
 * check backs it up and notices a time zone change. Reminders that came due
 * while Ostler was closed are delivered at start as one summary notification.
 *
 * Delivering a reminder marks it delivered, which makes it an Inbox item;
 * the desktop notification is shown only if the settings allow it (the gate
 * is `NotificationService.shouldNotify`: on, this source on, not quiet hours,
 * the project enabled). Reminders fire only while Ostler is running; with
 * background mode (P8.2) that includes while its window is closed.
 *
 * A reminder that keeps reminding (N1.7) comes back every interval after it
 * is delivered, on the same one timer, until its task is finished, it is
 * snoozed or stopped, or local midnight ends it (then it was missed). Quiet
 * hours hold a nudge until they end.
 */
export class ReminderService {
  private timer: ReturnType<typeof setTimeout> | null = null
  private hourly: ReturnType<typeof setInterval> | null = null
  private zone = ''
  /** Reminders wait until this moment (the tray's "Pause reminders for 1 hour"); in memory only. */
  private paused: number | null = null
  private readonly now: () => number
  private readonly timeZone: () => string

  constructor(private readonly deps: ReminderServiceDependencies) {
    this.now = deps.now ?? Date.now
    this.timeZone =
      deps.timeZone ??
      (() =>
        `${Intl.DateTimeFormat().resolvedOptions().timeZone}|${new Date().getTimezoneOffset()}`)
  }

  start(): void {
    this.zone = this.timeZone()
    this.runDueRules()
    this.startDueRounds()
    this.queueScheduledTasks()
    this.deliverMissed()
    this.plan()
    this.hourly = setInterval(() => this.check(), REMINDER_CHECK_MS)
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    if (this.hourly) clearInterval(this.hourly)
    this.timer = null
    this.hourly = null
  }

  private enabledIds(): string[] {
    return this.deps
      .getProjects()
      .filter((project) => project.enabled)
      .map((project) => project.id)
  }

  /**
   * Holds every reminder until `until` (or releases them, with null). What
   * comes due meanwhile is delivered when the pause ends, as usual.
   */
  pauseUntil(until: number | null): void {
    this.paused = until
    this.plan()
  }

  /** When a pause ends, or null when reminders are not paused. */
  pausedUntil(): number | null {
    if (this.paused !== null && this.paused <= this.now()) this.paused = null
    return this.paused
  }

  /**
   * Sets the one timer for the next moment anything is due: a pending
   * reminder, a nudge, or the midnight that ends one (N1.7). Call after
   * anything changes.
   */
  plan(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const next = this.nextAt()
    if (next === null) return
    const at = Math.max(next, this.pausedUntil() ?? 0)
    const delay = Math.min(Math.max(0, at - this.now()), REMINDER_CHECK_MS)
    this.timer = setTimeout(() => {
      this.timer = null
      this.fire()
      this.plan()
    }, delay)
  }

  /** The earliest of the next pending reminder and the next nudge or midnight, or null. */
  nextAt(): number | null {
    const ids = this.enabledIds()
    let next = this.deps.reminders.nextAt(ids)
    const quiet = this.quietHours()
    for (const reminder of this.deps.reminders.nudging(ids)) {
      const { at } = nextNudge(reminder, quiet)
      if (next === null || at < next) next = at
    }
    return next
  }

  private quietHours(): QuietHours {
    return this.deps.getQuietHours?.() ?? NO_QUIET_HOURS
  }

  /** The hourly check: a time zone change re-plans due reminders, then anything due fires. */
  check(): void {
    const zone = this.timeZone()
    if (zone !== this.zone) {
      this.zone = zone
      this.deps.replanDueReminders()
    }
    this.runDueRules()
    this.startDueRounds()
    this.queueScheduledTasks()
    this.fire()
    this.plan()
  }

  /** Due-date rules (R6.2) run at start and with every hourly check; a failure waits for the next. */
  private runDueRules(): void {
    try {
      this.deps.runDueRules?.()
    } catch (error) {
      console.error('Due-date rules failed:', error)
    }
  }

  /** Rounds due to start (N5.7a) start at start and with every hourly check; a failure waits for the next. */
  private startDueRounds(): void {
    try {
      this.deps.startDueRounds?.()
    } catch (error) {
      console.error('Starting due rounds failed:', error)
    }
  }

  /** Scheduled agent tasks (N9.7) are queued at start and with every hourly check; a failure waits for the next. */
  private queueScheduledTasks(): void {
    try {
      this.deps.queueScheduledTasks?.()
    } catch (error) {
      console.error('Queuing scheduled agent tasks failed:', error)
    }
  }

  /** The system clock or zone may have moved (resume from sleep, a zone change). */
  systemTimeChanged(): void {
    this.check()
  }

  /** The reminder setting or time changed: due reminders are planned again. */
  settingsChanged(): void {
    this.deps.replanDueReminders()
    this.plan()
  }

  /**
   * Delivers everything due now, one notification each, then nudges the
   * reminders that keep reminding (N1.7). Returns how many were delivered.
   */
  fire(): number {
    if (this.pausedUntil() !== null) return 0
    const due = this.deps.reminders.dueBy(this.now(), this.enabledIds())
    if (due.length > 0) {
      this.deps.reminders.markDelivered(
        due.map((reminder) => reminder.id),
        this.now()
      )
      for (const reminder of due) this.show(reminder)
    }
    const ended = this.nudge(new Set(due.map((reminder) => reminder.id)))
    if (due.length > 0 || ended) this.deps.onDelivered()
    return due.length
  }

  /** One reminder's notification; it opens the task. */
  private show(reminder: PlanningReminder): void {
    const task = this.deps.getTask(reminder.workItemId)
    if (!task) return
    const project = this.deps.getProjects().find((entry) => entry.id === reminder.projectId)
    this.deps.notify(
      'reminder',
      reminderText(task.targetDate, this.now(), project?.name ?? ''),
      task.title,
      reminder.projectId,
      { kind: 'task', projectId: reminder.projectId, taskId: reminder.workItemId }
    )
  }

  /**
   * Shows every nudge that is due, outside quiet hours, and stops the
   * reminders whose day ended at midnight. A nudge is not a new Inbox item.
   * Returns whether any stopped (the Inbox then says "Missed").
   */
  private nudge(justDelivered: Set<string>): boolean {
    const now = this.now()
    const quiet = this.quietHours()
    let ended = false
    for (const reminder of this.deps.reminders.nudging(this.enabledIds())) {
      if (justDelivered.has(reminder.id)) continue
      const next = nextNudge(reminder, quiet)
      if (next.at > now) continue
      // Past its midnight (Ostler was closed or asleep): it ends, unnudged.
      if (next.ends || now >= next.midnight) {
        this.deps.reminders.stop(reminder.id, next.midnight)
        ended = true
        continue
      }
      this.deps.reminders.markNudged(reminder.id, now)
      this.show(reminder)
    }
    return ended
  }

  /** At start: reminders missed while Ostler was closed, as one summary notification. */
  deliverMissed(): number {
    const due = this.deps.reminders.dueBy(this.now(), this.enabledIds())
    if (due.length === 0) return 0
    this.deps.reminders.markDelivered(
      due.map((reminder) => reminder.id),
      this.now()
    )
    const [first] = due
    const task = due.length === 1 ? this.deps.getTask(first.workItemId) : null
    this.deps.notify(
      'reminder',
      t('desktop:reminderService.missedWhileClosed', { count: due.length }),
      task ? task.title : t('desktop:reminderService.openInboxSeeThem'),
      task ? first.projectId : null,
      task
        ? { kind: 'task', projectId: first.projectId, taskId: first.workItemId }
        : { kind: 'inbox' }
    )
    this.deps.onDelivered()
    return due.length
  }
}
