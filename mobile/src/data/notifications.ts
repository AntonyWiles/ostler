/**
 * What the phone's notifications say and when: reminders coming due, the Today summary, new Inbox
 * items, the running timer and sync that needs attention. The app posts and schedules them with
 * expo-notifications (`../notifications.ts`); everything that decides lives here.
 *
 * Plain functions over anything shaped like a database, so this file imports no React Native code.
 */
import type { InboxEntry, MyWork, TimeEntry } from '@shared/ostler-api'
import { t } from '@shared/i18n/index'
import { formatTime } from '@shared/format'
import { toIsoDate } from '@shared/dates'
import { hoursAndMinutes } from './time'
import type { QueryDb } from './queries'

/** Which notifications the person wants on this phone. Kept on the phone, not synced. */
export interface NotificationSettings {
  /** Reminders on tasks (set by hand, or planned from the due date). */
  due: boolean
  /** An ongoing notification while a timer runs. */
  timer: boolean
  /** Things that arrive in the Inbox. */
  inbox: boolean
  /** A summary of the day's tasks each morning. */
  today: boolean
  /** When the Today summary comes: "HH:MM", the phone's local time. */
  todayTime: string
  /** Sync that has been failing for a while. */
  sync: boolean
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  due: true,
  timer: true,
  inbox: true,
  today: true,
  todayTime: '08:00',
  sync: true
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/

/** Settings read back from storage; anything missing or broken falls back to the default. */
export function parseNotificationSettings(raw: string | null): NotificationSettings {
  let stored: Record<string, unknown> = {}
  try {
    const parsed: unknown = raw === null ? {} : JSON.parse(raw)
    if (parsed && typeof parsed === 'object') stored = parsed as Record<string, unknown>
  } catch {
    // Unreadable: the defaults.
  }
  const flag = (key: Exclude<keyof NotificationSettings, 'todayTime'>) =>
    typeof stored[key] === 'boolean' ? (stored[key] as boolean) : DEFAULT_NOTIFICATION_SETTINGS[key]
  return {
    due: flag('due'),
    timer: flag('timer'),
    inbox: flag('inbox'),
    today: flag('today'),
    todayTime:
      typeof stored.todayTime === 'string' && TIME.test(stored.todayTime)
        ? stored.todayTime
        : DEFAULT_NOTIFICATION_SETTINGS.todayTime,
    sync: flag('sync')
  }
}

/** The times offered for the Today summary. */
export const TODAY_TIMES = ['06:00', '07:00', '08:00', '09:00', '10:00']

/** Where a tap on a notification goes. */
export interface NotificationTarget {
  taskId?: string
  projectId?: string
  /** Opens the Inbox tab, or My day. */
  tab?: 'inbox' | 'myDay'
}

/** A notification to show at a moment. */
export interface PlannedNotification {
  /** Stable, so planning again replaces it rather than adding another. */
  id: string
  kind: 'due' | 'today'
  at: number
  title: string
  body: string
  target: NotificationTarget
}

export interface PendingReminder {
  id: string
  projectId: string
  taskId: string
  title: string
  targetDate: string | null
  remindAt: number
}

/**
 * Reminders on live tasks that have not gone off yet (the PC marks one delivered when it shows it,
 * and that syncs), from `from` on, the soonest first.
 */
export function pendingReminders(db: QueryDb, from: number): PendingReminder[] {
  const rows = db
    .prepare(
      `SELECT r.id, r.project_id, r.work_item_id, r.remind_at, w.title, w.target_date
       FROM reminders r JOIN planning_work_items w ON w.id = r.work_item_id
       WHERE r.delivered_at IS NULL AND r.dismissed_at IS NULL AND r.remind_at >= ?
         AND w.deleted_at IS NULL AND w.archived_at IS NULL AND w.resolution IS NULL
         AND w.status != 'done'
       ORDER BY r.remind_at`
    )
    .all(from) as {
    id: string
    project_id: string
    work_item_id: string
    remind_at: number
    title: string
    target_date: string | null
  }[]
  return rows.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    taskId: row.work_item_id,
    title: row.title,
    targetDate: row.target_date,
    remindAt: row.remind_at
  }))
}

/** Android keeps a limited number of alarms per app; the soonest this many are enough. */
export const MAX_DUE_NOTIFICATIONS = 40

/** One notification per pending reminder: the task's title, and when it is due. */
export function planDueNotifications(
  reminders: PendingReminder[],
  projectName: (projectId: string) => string
): PlannedNotification[] {
  return reminders.slice(0, MAX_DUE_NOTIFICATIONS).map((reminder) => {
    const due = reminder.targetDate
      ? reminder.targetDate === toIsoDate(new Date(reminder.remindAt))
        ? t('mobile:notifications.dueToday')
        : t('mobile:notifications.dueOn', { date: reminder.targetDate })
      : t('mobile:notifications.reminder')
    return {
      id: `due:${reminder.id}`,
      kind: 'due',
      at: reminder.remindAt,
      title: reminder.title,
      body: [due, projectName(reminder.projectId)].filter(Boolean).join(' · '),
      target: { taskId: reminder.taskId, projectId: reminder.projectId }
    }
  })
}

/** The next moment at `time` ("HH:MM", local) after `now`: today's, or else tomorrow's. */
export function nextTimeOfDay(now: number, time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  const at = new Date(now)
  at.setHours(hours, minutes, 0, 0)
  if (at.getTime() <= now) at.setDate(at.getDate() + 1)
  return at.getTime()
}

/** How many tasks the summary names before "and N more". */
const SUMMARY_NAMES = 3

/**
 * The Today summary for a day's lists: how many tasks, and the first few by name. Overdue, due,
 * in progress and My day tasks count, each once; done tasks do not. Null when there is nothing.
 */
export function todaySummary(work: MyWork): { title: string; body: string } | null {
  const seen = new Set<string>()
  const titles: string[] = []
  let overdue = 0
  for (const task of [...work.today, ...work.myDay]) {
    if (seen.has(task.id) || task.status === 'done') continue
    seen.add(task.id)
    titles.push(task.title)
    if ('reason' in task && task.reason === 'overdue') overdue += 1
  }
  if (titles.length === 0) return null
  const named = titles.slice(0, SUMMARY_NAMES).join(', ')
  const more = titles.length - SUMMARY_NAMES
  return {
    title:
      overdue > 0
        ? t('mobile:notifications.todayTitleOverdue', { count: titles.length, overdue })
        : t('mobile:notifications.todayTitle', { count: titles.length }),
    body: more > 0 ? t('mobile:notifications.todayMore', { names: named, count: more }) : named
  }
}

/**
 * The Today summary planned for its next time, from that day's lists. `workFor` gives a day's
 * lists (`myWork` over the phone's database). Its words are those of when it is planned; the app
 * plans again each time it opens or syncs, so they are as fresh as the phone's data.
 */
export function planTodayNotification(
  settings: NotificationSettings,
  now: number,
  workFor: (day: string) => MyWork
): PlannedNotification | null {
  if (!settings.today) return null
  const at = nextTimeOfDay(now, settings.todayTime)
  const summary = todaySummary(workFor(toIsoDate(new Date(at))))
  if (summary === null) return null
  return { id: 'today', kind: 'today', at, ...summary, target: { tab: 'myDay' } }
}

/** Every scheduled notification the settings ask for, as things stand. */
export function planNotifications(
  db: QueryDb,
  settings: NotificationSettings,
  now: number,
  options: { projectName: (projectId: string) => string; workFor: (day: string) => MyWork }
): PlannedNotification[] {
  const planned = settings.due
    ? planDueNotifications(pendingReminders(db, now), options.projectName)
    : []
  const today = planTodayNotification(settings, now, options.workFor)
  return today ? [...planned, today] : planned
}

/** How many Inbox keys are remembered as already seen. */
const SEEN_KEYS = 300

/**
 * The Inbox items to notify about: unread items not seen in an earlier look. The first look
 * (`seen` null) only remembers what is there, so turning this on does not post the whole Inbox.
 * Reminder items are left out while reminders notify by themselves, so one is not told twice.
 */
export function newInboxItems(
  items: InboxEntry[],
  seen: string[] | null,
  settings: NotificationSettings
): { notify: InboxEntry[]; seen: string[] } {
  const keys = items.map((item) => item.key)
  if (seen === null) return { notify: [], seen: keys.slice(0, SEEN_KEYS) }
  const before = new Set(seen)
  const notify = settings.inbox
    ? items.filter(
        (item) =>
          !before.has(item.key) &&
          item.readAt === null &&
          !(settings.due && item.kind === 'reminder')
      )
    : []
  // The newest keys first, then older ones still remembered, up to the limit.
  const next = [...keys, ...seen.filter((key) => !keys.includes(key))].slice(0, SEEN_KEYS)
  return { notify, seen: next }
}

/** The running timer's notification: the task, when it started and the time so far. */
export function timerNotification(
  entry: TimeEntry,
  now: number
): { title: string; body: string; target: NotificationTarget } {
  return {
    title: entry.workItemTitle
      ? t('mobile:notifications.timerTitle', { task: entry.workItemTitle })
      : t('mobile:notifications.timerTitleNoTask'),
    body: t('mobile:notifications.timerBody', {
      time: formatTime(entry.startedAt),
      elapsed: hoursAndMinutes(Math.max(0, Math.floor((now - entry.startedAt) / 1000)))
    }),
    target: { taskId: entry.workItemId, projectId: entry.projectId }
  }
}

/** Sync's trouble so far: since when it has failed, and whether the person was told. */
export interface SyncAttention {
  failingSince: number | null
  notified: boolean
}

export const SYNC_CALM: SyncAttention = { failingSince: null, notified: false }

/** How long sync fails before a notification says so: a blip is not worth one. */
export const SYNC_PATIENCE_MS = 30 * 60 * 1000

/**
 * Whether to tell the person sync needs attention: once, after it has failed for
 * `SYNC_PATIENCE_MS`, and again only after it has worked in between. `clear` is true when sync works
 * again, so a notification already shown can go.
 */
export function syncAttention(
  state: SyncAttention,
  failing: boolean,
  now: number
): { state: SyncAttention; notify: boolean; clear: boolean } {
  if (!failing) return { state: SYNC_CALM, notify: false, clear: state.notified }
  const failingSince = state.failingSince ?? now
  const notify = !state.notified && now - failingSince >= SYNC_PATIENCE_MS
  return { state: { failingSince, notified: state.notified || notify }, notify, clear: false }
}
