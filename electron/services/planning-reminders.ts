import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import type {
  OstlerConfig,
  PlanningReminder,
  PlanningReminderOptions,
  PlanningWorkItem,
  ReminderKind
} from '@shared/ostler-api'
import {
  dueReminderInstants,
  isKeepRemindingMinutes,
  nextLocalMidnight,
  quietHoursEndAfter
} from '@shared/reminder-settings'
import { t } from '@shared/i18n'
import { closeTaskReminders } from '@shared/planning/task-writes'

interface ReminderRow {
  id: string
  project_id: string
  work_item_id: string
  remind_at: number
  kind: ReminderKind
  delivered_at: number | null
  dismissed_at: number | null
  keep_reminding: number
  interval_minutes: number | null
  last_nudged_at: number | null
  stopped_at: number | null
}

export type ReminderSettings = Pick<
  OstlerConfig['notifications'],
  'dueReminders' | 'reminderTime'
> &
  Partial<Pick<OstlerConfig['notifications'], 'keepRemindingMinutes'>>

/** The longest a custom reminder may be set ahead: ten years. */
const MAX_AHEAD_MS = 10 * 366 * 24 * 60 * 60 * 1000

/**
 * The `reminders` table (P5.6). Plain reads and writes, plus the one rule
 * that keeps a task's due reminders in step with it: `syncTask` runs inside
 * `PlanningService`'s write transaction for every create, edit, archive,
 * delete and restore, so no surface can leave a reminder behind.
 *
 * A due reminder is planned from the due date and the reminder time in local
 * time; a custom one is the instant the person chose. Neither survives the
 * task being done, archived or in the recycle bin. Delivered rows stay: they
 * are the Inbox's reminder items.
 */
export class PlanningReminders {
  constructor(
    private readonly db: Database.Database,
    private readonly getSettings: () => ReminderSettings
  ) {}

  /** Brings a task's pending reminders in line with the task. */
  syncTask(item: PlanningWorkItem, now: number): void {
    const open = item.status !== 'done' && !item.archivedAt && !item.deletedAt
    if (!open) {
      closeTaskReminders(this.db, item.id, now)
      return
    }
    const settings = this.getSettings()
    // A capture in To triage gets no due reminder until it is accepted (N4.3a);
    // reminders the person set still fire.
    const wanted =
      item.targetDate && settings.dueReminders !== 'off' && !item.inTriage
        ? dueReminderInstants(item.targetDate, settings.dueReminders, settings.reminderTime).filter(
            (at) => at > now
          )
        : []
    const rows = this.db
      .prepare("SELECT * FROM reminders WHERE work_item_id = ? AND kind = 'due'")
      .all(item.id) as ReminderRow[]
    const remove = this.db.prepare('DELETE FROM reminders WHERE id = ?')
    for (const row of rows) {
      if (row.delivered_at === null && !wanted.includes(row.remind_at)) remove.run(row.id)
    }
    const known = new Set(rows.map((row) => row.remind_at))
    for (const at of wanted) {
      if (!known.has(at)) this.insert(item, at, 'due')
    }
  }

  addCustom(
    item: PlanningWorkItem,
    remindAt: number,
    now: number,
    options: PlanningReminderOptions = {}
  ): PlanningReminder {
    const keep = options.keepReminding === true
    const fallback = this.getSettings().keepRemindingMinutes
    const interval = keep
      ? (options.intervalMinutes ?? (isKeepRemindingMinutes(fallback) ? fallback : 15))
      : null
    if (keep && !isKeepRemindingMinutes(interval))
      throw new Error(t('errors:planningReminders.chooseInterval'))
    if (!Number.isFinite(remindAt) || !Number.isInteger(remindAt)) {
      throw new Error(t('errors:planningReminders.reminderNeedsTime'))
    }
    if (remindAt <= now) throw new Error(t('errors:planningReminders.chooseTimeFuture'))
    if (remindAt > now + MAX_AHEAD_MS)
      throw new Error(t('errors:planningReminders.chooseTimeWithinTen'))
    if (item.status === 'done' || item.archivedAt || item.deletedAt) {
      throw new Error(t('errors:planningReminders.finishedArchivedDeletedTask'))
    }
    return this.insert(item, remindAt, 'custom', interval)
  }

  private insert(
    item: PlanningWorkItem,
    remindAt: number,
    kind: ReminderKind,
    intervalMinutes: number | null = null
  ): PlanningReminder {
    const reminder: PlanningReminder = {
      id: uuidv4(),
      projectId: item.projectId,
      workItemId: item.id,
      remindAt,
      kind,
      deliveredAt: null,
      dismissedAt: null,
      keepReminding: intervalMinutes !== null,
      intervalMinutes,
      lastNudgedAt: null,
      stoppedAt: null
    }
    this.db
      .prepare(
        `INSERT INTO reminders (id, project_id, work_item_id, remind_at, kind, delivered_at,
           dismissed_at, keep_reminding, interval_minutes)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)`
      )
      .run(
        reminder.id,
        reminder.projectId,
        reminder.workItemId,
        remindAt,
        kind,
        reminder.keepReminding ? 1 : 0,
        intervalMinutes
      )
    return reminder
  }

  get(id: string): PlanningReminder | null {
    const row = this.db.prepare('SELECT * FROM reminders WHERE id = ?').get(id) as
      ReminderRow | undefined
    return row ? toReminder(row) : null
  }

  /**
   * A task's reminders still to come, soonest first, then any delivered one
   * that keeps reminding and has not stopped (N1.7): the drawer's bar.
   */
  pendingForTask(workItemId: string): PlanningReminder[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM reminders WHERE work_item_id = ?
             AND (delivered_at IS NULL OR (keep_reminding = 1 AND stopped_at IS NULL
               AND dismissed_at IS NULL))
           ORDER BY delivered_at IS NOT NULL, remind_at`
        )
        .all(workItemId) as ReminderRow[]
    ).map(toReminder)
  }

  /**
   * Delivered reminders that keep reminding and have not stopped, in these
   * projects (N1.7). Their tasks are open: finishing one stops them.
   */
  nudging(projectIds: string[]): PlanningReminder[] {
    if (projectIds.length === 0) return []
    return (
      this.db
        .prepare(
          `SELECT * FROM reminders WHERE keep_reminding = 1 AND delivered_at IS NOT NULL
             AND stopped_at IS NULL AND dismissed_at IS NULL
             AND project_id IN (${projectIds.map(() => '?').join(', ')})
           ORDER BY delivered_at`
        )
        .all(...projectIds) as ReminderRow[]
    ).map(toReminder)
  }

  /** A nudge was shown. */
  markNudged(id: string, at: number): void {
    this.db.prepare('UPDATE reminders SET last_nudged_at = ? WHERE id = ?').run(at, id)
  }

  /**
   * Stops a reminder that keeps reminding (Stop reminding, or midnight).
   * A pending one is delivered once and does not come back.
   */
  stop(id: string, at: number): PlanningReminder {
    const reminder = this.get(id)
    if (!reminder || !reminder.keepReminding)
      throw new Error(t('errors:planningReminders.doesNotKeepReminding'))
    if (reminder.stoppedAt === null)
      this.db.prepare('UPDATE reminders SET stopped_at = ? WHERE id = ?').run(at, id)
    return this.get(id)!
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM reminders WHERE id = ?').run(id)
  }

  /** Every pending reminder in these projects due by `now`, oldest first. */
  dueBy(now: number, projectIds: string[]): PlanningReminder[] {
    if (projectIds.length === 0) return []
    return (
      this.db
        .prepare(
          `SELECT * FROM reminders WHERE delivered_at IS NULL AND remind_at <= ?
             AND project_id IN (${projectIds.map(() => '?').join(', ')})
           ORDER BY remind_at`
        )
        .all(now, ...projectIds) as ReminderRow[]
    ).map(toReminder)
  }

  /** The soonest pending reminder in these projects, or null. */
  nextAt(projectIds: string[]): number | null {
    if (projectIds.length === 0) return null
    const row = this.db
      .prepare(
        `SELECT MIN(remind_at) AS at FROM reminders WHERE delivered_at IS NULL
           AND project_id IN (${projectIds.map(() => '?').join(', ')})`
      )
      .get(...projectIds) as { at: number | null }
    return row.at
  }

  /** Delivered at `at`; for one that keeps reminding, that is its first nudge too. */
  markDelivered(ids: string[], at: number): void {
    const update = this.db.prepare(
      `UPDATE reminders SET delivered_at = ?,
         last_nudged_at = CASE WHEN keep_reminding = 1 THEN ? ELSE last_nudged_at END
       WHERE id = ?`
    )
    this.db.transaction(() => ids.forEach((id) => update.run(at, at, id)))()
  }

  /** Delivered, not dismissed, in these projects: the Inbox's reminder items. */
  delivered(projectIds: string[]): PlanningReminder[] {
    if (projectIds.length === 0) return []
    return (
      this.db
        .prepare(
          `SELECT * FROM reminders WHERE delivered_at IS NOT NULL AND dismissed_at IS NULL
             AND project_id IN (${projectIds.map(() => '?').join(', ')})
           ORDER BY delivered_at DESC`
        )
        .all(...projectIds) as ReminderRow[]
    ).map(toReminder)
  }

  /**
   * Back to pending, at a new time: a snooze. It becomes a custom reminder,
   * so editing the task's due date does not plan it away. One that keeps
   * reminding starts again from the new time (N1.7).
   */
  reschedule(id: string, remindAt: number): void {
    this.db
      .prepare(
        `UPDATE reminders SET remind_at = ?, delivered_at = NULL, kind = 'custom',
           last_nudged_at = NULL, stopped_at = NULL WHERE id = ?`
      )
      .run(remindAt, id)
  }
}

function toReminder(row: ReminderRow): PlanningReminder {
  return {
    id: row.id,
    projectId: row.project_id,
    workItemId: row.work_item_id,
    remindAt: row.remind_at,
    kind: row.kind,
    deliveredAt: row.delivered_at,
    dismissedAt: row.dismissed_at,
    keepReminding: row.keep_reminding === 1,
    intervalMinutes: row.keep_reminding === 1 ? row.interval_minutes : null,
    lastNudgedAt: row.last_nudged_at,
    stoppedAt: row.stopped_at
  }
}

/**
 * When a nudging reminder next wants attention (N1.7): its next nudge,
 * moved to the end of quiet hours when it falls in them, or local midnight
 * on the day it was delivered, whichever comes first. `ends` says which.
 */
export function nextNudge(
  reminder: PlanningReminder,
  quiet: Parameters<typeof quietHoursEndAfter>[1]
): { at: number; ends: boolean; midnight: number } {
  const midnight = nextLocalMidnight(reminder.deliveredAt ?? reminder.remindAt)
  const last = reminder.lastNudgedAt ?? reminder.deliveredAt ?? reminder.remindAt
  const due = quietHoursEndAfter(last + (reminder.intervalMinutes ?? 15) * 60_000, quiet)
  return due >= midnight
    ? { at: midnight, ends: true, midnight }
    : { at: due, ends: false, midnight }
}

/**
 * Reminder options from outside (IPC, the automation API), checked: keep
 * reminding only when it is exactly true, and an interval only when it is a
 * number (`addCustom` refuses one that is not a choice).
 */
export function reminderOptions(raw: unknown): PlanningReminderOptions {
  if (!raw || typeof raw !== 'object') return {}
  const input = raw as Record<string, unknown>
  return {
    keepReminding: input.keepReminding === true,
    ...(input.intervalMinutes !== undefined && input.intervalMinutes !== null
      ? { intervalMinutes: input.intervalMinutes as number }
      : {})
  }
}

/** A reminder that kept reminding until midnight, unanswered (N1.7): the Inbox says "Missed". */
export function reminderMissed(
  reminder: Pick<PlanningReminder, 'keepReminding' | 'deliveredAt' | 'stoppedAt'>
): boolean {
  return (
    reminder.keepReminding &&
    reminder.deliveredAt !== null &&
    reminder.stoppedAt !== null &&
    reminder.stoppedAt >= nextLocalMidnight(reminder.deliveredAt)
  )
}
