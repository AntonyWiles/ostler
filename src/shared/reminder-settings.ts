import { DEFAULT_CONFIG, DUE_REMINDER_MODES, type OstlerConfig } from './ostler-api'
import { normalizeFocusSettings } from './focus'
import type { DueReminderMode } from './ostler-api'
import { isoWeekday, parseIsoDate, shiftIsoDate, toIsoDate } from './dates'
import { t } from './i18n'

/**
 * Reminder and quiet-hours rules (P5.6), shared by the reminder service, the
 * settings screen and the tests. A reminder time is local wall-clock time:
 * the instant is built from the date and the time in the local time zone
 * when the reminder is planned, and planned again when the zone changes.
 */

type NotificationSettings = OstlerConfig['notifications']

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/

export function isClockTime(value: unknown): value is string {
  return typeof value === 'string' && CLOCK.test(value)
}

/** Minutes after midnight for `HH:MM`. */
export function clockMinutes(value: string): number {
  const match = CLOCK.exec(value)
  if (!match) throw new Error(t('tasks:reminderSettings.notTime', { value }))
  return Number(match[1]) * 60 + Number(match[2])
}

/** The instant of `HH:MM` on a calendar day, in local time. */
export function localInstant(date: string, time: string): number {
  const day = parseIsoDate(date)
  if (!day) throw new Error(t('tasks:reminderSettings.notCalendarDate', { date }))
  const minutes = clockMinutes(time)
  return new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    Math.floor(minutes / 60),
    minutes % 60
  ).getTime()
}

/** When a task due on `dueDate` should remind, by the setting. */
export function dueReminderInstants(
  dueDate: string,
  mode: DueReminderMode,
  time: string
): number[] {
  const instants: number[] = []
  if (mode === 'dayBefore' || mode === 'both')
    instants.push(localInstant(shiftIsoDate(dueDate, -1), time))
  if (mode === 'dueDate' || mode === 'both') instants.push(localInstant(dueDate, time))
  return instants
}

/** Whether `now` falls in quiet hours. A start after the end runs over midnight. */
export function inQuietHours(
  now: Date,
  settings: Pick<NotificationSettings, 'quietHoursEnabled' | 'quietHoursStart' | 'quietHoursEnd'>
): boolean {
  if (!settings.quietHoursEnabled) return false
  const minute = now.getHours() * 60 + now.getMinutes()
  const start = clockMinutes(settings.quietHoursStart)
  const end = clockMinutes(settings.quietHoursEnd)
  if (start === end) return false
  return start < end ? minute >= start && minute < end : minute >= start || minute < end
}

/**
 * The first instant at or after `at` outside quiet hours: `at` itself, or
 * the moment quiet hours end (N1.7: a held nudge comes then).
 */
export function quietHoursEndAfter(
  at: number,
  settings: Pick<NotificationSettings, 'quietHoursEnabled' | 'quietHoursStart' | 'quietHoursEnd'>
): number {
  const moment = new Date(at)
  if (!inQuietHours(moment, settings)) return at
  const day = toIsoDate(moment)
  const end = localInstant(day, settings.quietHoursEnd)
  return end > at ? end : localInstant(shiftIsoDate(day, 1), settings.quietHoursEnd)
}

/** Local midnight at the end of the day `at` falls on. */
export function nextLocalMidnight(at: number): number {
  const moment = new Date(at)
  return new Date(moment.getFullYear(), moment.getMonth(), moment.getDate() + 1).getTime()
}

/** How often a reminder that keeps reminding may come back, in minutes (N1.7). */
export const KEEP_REMINDING_MINUTES = [5, 15, 30, 60] as const

export function isKeepRemindingMinutes(value: unknown): value is number {
  return KEEP_REMINDING_MINUTES.includes(value as (typeof KEEP_REMINDING_MINUTES)[number])
}

/** A weekday as the weekly review reminder stores it: 0 for Sunday to 6 for Saturday. */
export function isWeekday(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6
}

type WeeklyReviewSettings = Pick<NotificationSettings, 'weeklyReviewDay' | 'weeklyReviewTime'>

/**
 * The weekly review reminder's latest time at or before `now` (N1.5): the
 * last chosen weekday at the chosen local time. Null while the reminder is
 * off. Built from local wall-clock time, so it stays on the chosen hour
 * across a clock change.
 */
export function lastWeeklyReviewDue(settings: WeeklyReviewSettings, now: number): number | null {
  if (!isWeekday(settings.weeklyReviewDay) || !isClockTime(settings.weeklyReviewTime)) return null
  const today = toIsoDate(new Date(now))
  const day = shiftIsoDate(today, -((isoWeekday(today) - settings.weeklyReviewDay + 7) % 7))
  const at = localInstant(day, settings.weeklyReviewTime)
  return at <= now ? at : localInstant(shiftIsoDate(day, -7), settings.weeklyReviewTime)
}

/** The weekly review reminder's next time after `now`, or null while it is off. */
export function nextWeeklyReviewDue(settings: WeeklyReviewSettings, now: number): number | null {
  const last = lastWeeklyReviewDue(settings, now)
  if (last === null) return null
  return localInstant(shiftIsoDate(toIsoDate(new Date(last)), 7), settings.weeklyReviewTime)
}

/** Settings as saved: anything out of range goes back to its default. */
export function normalizeNotificationSettings(value: NotificationSettings): NotificationSettings {
  const defaults = DEFAULT_CONFIG.notifications
  return {
    ...value,
    dueReminders: DUE_REMINDER_MODES.includes(value.dueReminders)
      ? value.dueReminders
      : defaults.dueReminders,
    reminderTime: isClockTime(value.reminderTime) ? value.reminderTime : defaults.reminderTime,
    quietHoursStart: isClockTime(value.quietHoursStart)
      ? value.quietHoursStart
      : defaults.quietHoursStart,
    quietHoursEnd: isClockTime(value.quietHoursEnd) ? value.quietHoursEnd : defaults.quietHoursEnd,
    weeklyReviewDay: isWeekday(value.weeklyReviewDay) ? value.weeklyReviewDay : null,
    weeklyReviewTime: isClockTime(value.weeklyReviewTime)
      ? value.weeklyReviewTime
      : defaults.weeklyReviewTime,
    keepRemindingMinutes: isKeepRemindingMinutes(value.keepRemindingMinutes)
      ? value.keepRemindingMinutes
      : defaults.keepRemindingMinutes,
    focus: normalizeFocusSettings(value.focus)
  }
}
