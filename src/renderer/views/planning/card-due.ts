import { daysFromToday, parseIsoDate } from '@shared/dates'
import { formatDate, formatShortDate } from '@shared/format'
import { t } from '@shared/i18n'

/** "Monday 12 October 2026", in the active locale's order. */
const FULL_DATE: Intl.DateTimeFormatOptions = {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric'
}

/** How a card's due date reads: overdue (danger), soon (warning, within 2 days) or plain. */
export type DueTone = 'overdue' | 'soon' | 'plain'

/**
 * A due date as a card shows it, in one short token: "Today", "Tomorrow", a
 * weekday within the week, the date
 * beyond it. Finished work is never overdue or soon. `title` carries the
 * full date and how far off it is.
 */
export function cardDue(
  value: string,
  done: boolean,
  today: Date = new Date()
): { text: string; tone: DueTone; title: string } | null {
  const date = parseIsoDate(value)
  const days = daysFromToday(value, today)
  if (!date || days === null) return null
  const full = formatDate(date, FULL_DATE)
  const text =
    days === 0
      ? t('common:date.today')
      : days === 1
        ? t('common:date.tomorrow')
        : days === -1
          ? t('common:date.yesterday')
          : days > 1 && days < 7
            ? formatDate(date, { weekday: 'short' })
            : formatShortDate(date, today)
  const tone: DueTone = done ? 'plain' : days < 0 ? 'overdue' : days <= 2 ? 'soon' : 'plain'
  const late = -days
  const title =
    tone === 'overdue'
      ? t('tasks:cardDue.overdueDaysDue', { count: late, full })
      : t('tasks:cardDue.due', { full })
  return { text, tone, title }
}

/**
 * The start–due range for a card's hover text: "Starts Monday 12 October
 * 2026 · Due Tuesday 20 October 2026". Null without a start date, when the
 * due date's own title says everything.
 */
export function cardDateRangeTitle(
  startDate: string | null,
  dueDate: string | null,
  done: boolean,
  today: Date = new Date()
): string | null {
  const start = startDate ? parseIsoDate(startDate) : null
  if (!start) return null
  const starts = t('tasks:cardDue.starts', { date: formatDate(start, FULL_DATE) })
  const due = dueDate ? cardDue(dueDate, done, today) : null
  return due ? `${starts} · ${due.title}` : starts
}
