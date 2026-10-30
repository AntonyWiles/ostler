import type Database from 'better-sqlite3'
import type { InboxItem, OstlerConfig } from '@shared/ostler-api'
import { lastWeeklyReviewDue, nextWeeklyReviewDue } from '@shared/reminder-settings'
import { t } from '@shared/i18n'
import type { InboxSource } from './inbox-service'

const WEEK_MS = 7 * 86_400_000
/** The timer never waits longer than this; while quiet hours hold a reminder, it looks again this often. */
const CHECK_MS = 60 * 60 * 1000
const QUIET_RETRY_MS = 10 * 60 * 1000

type NotificationSettings = OstlerConfig['notifications']

export interface WeeklyReviewReminderDependencies {
  db: Database.Database
  getSettings(): NotificationSettings
  /** Quiet hours hold desktop notifications now (`inQuietHours`). */
  inQuietHours(now: number): boolean
  /** Shows the notification, through `NotificationService.notify` and so `shouldNotify`. */
  notify(title: string, body: string): void
  /** The Inbox changed: Home and the Inbox reload. */
  onDelivered(): void
  now?: () => number
}

/**
 * The weekly review reminder (N1.5, N13): off, or a weekday and a local
 * time. At that time, while Ostler runs, it shows a notification and an Inbox
 * entry; during quiet hours it waits until they end. A time missed while
 * Ostler was closed shows in the Inbox at the next start, without a
 * notification, once. A review finished in the week before the time (or
 * after it) clears it.
 *
 * Each time the reminder reaches is a row in `weekly_review_reminders`, so
 * it is never delivered twice.
 */
export class WeeklyReviewReminder {
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly now: () => number

  constructor(private readonly deps: WeeklyReviewReminderDependencies) {
    this.now = deps.now ?? Date.now
  }

  start(): void {
    this.deliverMissed()
    this.plan()
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  /** Sets the timer for the next time, a quiet-hours retry, or the hourly look. */
  plan(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const now = this.now()
    const settings = this.deps.getSettings()
    const next = nextWeeklyReviewDue(settings, now)
    if (next === null) return
    const waiting = this.pending(now) !== null
    const delay = waiting ? QUIET_RETRY_MS : Math.min(Math.max(0, next - now), CHECK_MS)
    this.timer = setTimeout(() => {
      this.timer = null
      this.fire()
      this.plan()
    }, delay)
    this.timer.unref?.()
  }

  /**
   * The setting changed: the time just past is not news, so it is marked
   * quiet rather than offered as missed.
   */
  settingsChanged(): void {
    const due = lastWeeklyReviewDue(this.deps.getSettings(), this.now())
    if (due !== null) this.record(due, true)
    this.plan()
  }

  /** The latest time not yet recorded, or null. */
  private pending(now: number): number | null {
    const due = lastWeeklyReviewDue(this.deps.getSettings(), now)
    if (due === null) return null
    const known = this.deps.db
      .prepare('SELECT 1 FROM weekly_review_reminders WHERE due_at = ?')
      .get(due)
    return known ? null : due
  }

  /** A review finished in the week before `due`, or after it. */
  private reviewedFor(due: number): boolean {
    return (
      this.deps.db
        .prepare('SELECT 1 FROM weekly_reviews WHERE finished_at >= ? LIMIT 1')
        .get(due - WEEK_MS) !== undefined
    )
  }

  private record(due: number, quiet: boolean): void {
    this.deps.db
      .prepare(
        'INSERT OR IGNORE INTO weekly_review_reminders (due_at, delivered_at, quiet) VALUES (?, ?, ?)'
      )
      .run(due, this.now(), quiet ? 1 : 0)
  }

  /** Delivers the reminder when its time has come; whether it did. */
  fire(): boolean {
    const now = this.now()
    const due = this.pending(now)
    if (due === null) return false
    if (this.reviewedFor(due)) {
      this.record(due, true)
      return false
    }
    // Quiet hours: the Inbox entry and the notification wait until they end.
    if (this.deps.inQuietHours(now)) return false
    this.record(due, false)
    this.deps.notify(
      t('desktop:weeklyReview.reminderTitle'),
      t('desktop:weeklyReview.reminderBody')
    )
    this.deps.onDelivered()
    return true
  }

  /** At start: a time missed while Ostler was closed goes to the Inbox, without a notification. */
  deliverMissed(): boolean {
    const due = this.pending(this.now())
    if (due === null) return false
    const reviewed = this.reviewedFor(due)
    this.record(due, reviewed)
    if (!reviewed) this.deps.onDelivered()
    return !reviewed
  }
}

/**
 * The reminder's Inbox entry: the latest time delivered, until a review
 * finishes for it or the reminder is turned off.
 */
export function weeklyReviewSource(
  db: Database.Database,
  getSettings: () => NotificationSettings
): InboxSource {
  return () => {
    if (getSettings().weeklyReviewDay === null) return []
    const row = db
      .prepare(
        'SELECT due_at FROM weekly_review_reminders WHERE quiet = 0 ORDER BY due_at DESC LIMIT 1'
      )
      .get() as { due_at: number } | undefined
    if (!row) return []
    const reviewed = db
      .prepare('SELECT 1 FROM weekly_reviews WHERE finished_at >= ? LIMIT 1')
      .get(row.due_at - WEEK_MS)
    if (reviewed) return []
    return [
      {
        key: `weeklyreview:${row.due_at}`,
        kind: 'weeklyReview',
        title: t('desktop:weeklyReview.reminderTitle'),
        body: t('desktop:weeklyReview.reminderBody'),
        projectId: null,
        taskId: null,
        createdAt: row.due_at
      } satisfies InboxItem
    ]
  }
}
