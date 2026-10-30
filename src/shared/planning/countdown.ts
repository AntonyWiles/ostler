import { t } from '../i18n'
import { compareIsoDates, isIsoDate, isoDaysBetween, shiftIsoDate, todayIsoDate } from '../dates'
import { countWorkingDays, type PersonWorkingDays } from './working-days'

/**
 * Countdowns (N5.2b, N37): the one place a countdown is worded, so Home, the
 * tray menu, the jump list and the automation API all say the same thing.
 * Dates only, on local `YYYY-MM-DD` strings: "today" is the person's local
 * date. Working days are the person's own (`myWorkingDays`: Me's working
 * days, less Me's days off and everyone's), as the rule in `working-days.ts`
 * decides them.
 */

/** At most this many countdowns show at once. */
export const COUNTDOWN_MAX = 3

/** A gap longer than this many days also says how many working days it holds. */
const WORKING_DAYS_AFTER = 7

export interface CountdownSubject {
  title: string
  /** The milestone's target date or the task's due date. */
  date: string
  /** The milestone is complete or the task is done. */
  done: boolean
}

/** Days from `today` to `date`: positive ahead, 0 today, negative past. */
export function countdownDays(date: string, today: string): number {
  return isoDaysBetween(today, date)
}

/**
 * The working days between today and the date, today itself left out: the
 * days still to work before it, or those worked since it.
 */
export function countdownWorkingDays(
  date: string,
  today: string,
  mine: PersonWorkingDays = {}
): number {
  return compareIsoDates(date, today) >= 0
    ? countWorkingDays(shiftIsoDate(today, 1), date, mine.personId ?? null, mine)
    : countWorkingDays(shiftIsoDate(date, 1), today, mine.personId ?? null, mine)
}

/**
 * "12 days to Launch", "Launch is tomorrow", "Launch is today", "Launch was
 * 2 days ago", "Launch: done", with "(9 working days)" after a gap of more
 * than a week whose working days differ from its days.
 */
export function countdownWords(
  subject: CountdownSubject,
  today: string,
  mine: PersonWorkingDays = {}
): string {
  const title = subject.title
  if (subject.done) return t('common:countdowns.done', { title })
  if (!isIsoDate(subject.date) || !isIsoDate(today)) return title
  const days = countdownDays(subject.date, today)
  if (days === 0) return t('common:countdowns.today', { title })
  if (days === 1) return t('common:countdowns.tomorrow', { title })
  if (days === -1) return t('common:countdowns.yesterday', { title })
  const words =
    days > 0
      ? t('common:countdowns.daysTo', { count: days, title })
      : t('common:countdowns.daysAgo', { count: -days, title })
  if (Math.abs(days) <= WORKING_DAYS_AFTER) return words
  const working = countdownWorkingDays(subject.date, today, mine)
  if (working === Math.abs(days)) return words
  return t('common:countdowns.withWorkingDays', {
    words,
    workingDays: t('common:countdowns.workingDays', { count: working })
  })
}

/**
 * How much of the wait has passed since the item was pinned, 0 to 1: the
 * days from the pin's date to today over those from it to the date.
 */
export function countdownProgress(pinnedAt: number, date: string, today: string): number {
  const start = todayIsoDate(new Date(pinnedAt))
  if (!isIsoDate(date) || compareIsoDates(date, start) <= 0) return 1
  const total = isoDaysBetween(start, date)
  const passed = isoDaysBetween(start, today)
  return Math.min(1, Math.max(0, passed / total))
}

/** A title short enough for the tray's narrow menu and a jump-list entry. */
export function shortCountdownTitle(title: string): string {
  const clean = title.replace(/\s+/g, ' ').trim()
  return clean.length > 32 ? `${clean.slice(0, 31)}…` : clean
}
