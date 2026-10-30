import { isIsoDate, isoDaysBetween, isoWeekday, shiftIsoDate } from './dates'
import { formatList } from './format'
import { formatLocale, t } from './i18n'

/**
 * Recurring tasks (P5.6). A rule says how often a task comes
 * back; the dates it lands on are computed here, in main and the renderer
 * alike, on `YYYY-MM-DD` strings only, so no time zone can move a day.
 *
 * A rule is anchored on the occurrence it belongs to: "weekly on Monday and
 * Thursday, every 2 weeks" counts its weeks from the week of the task's due
 * date, and "monthly on day 31" lands on the 30th in a 30-day month and is
 * back on the 31st the month after.
 */

export type RecurrenceUnit = 'day' | 'week' | 'month' | 'year'
export const RECURRENCE_UNITS: readonly RecurrenceUnit[] = ['day', 'week', 'month', 'year']

/** As stored in `planning_recurrences.rule`. */
export interface RecurrenceRule {
  every: RecurrenceUnit
  /** Every 1, 2, 3… units. */
  interval: number
  /** Weekly rules: 0 (Sunday) to 6 (Saturday). Absent: the anchor's weekday. */
  weekdays?: number[]
  /** Monthly and yearly rules: the day of the month, 1 to 31. Absent: the anchor's day. */
  monthDay?: number
}

/** A rule with its end. */
export interface RecurrenceSettings {
  rule: RecurrenceRule
  /** No occurrence after this day, `YYYY-MM-DD`, or null. */
  endsOn: string | null
  /** How many more occurrences may follow this one, or null for no limit. */
  remaining: number | null
  /**
   * Take turns (N2.3, N18): the people each new occurrence goes to, in order,
   * by id, or null when the repeat keeps the done task's assignee.
   */
  rotation: string[] | null
  /** Whose turn is next: an index into `rotation`, 0 when there is none. */
  nextIndex: number
}

export const MAX_ROTATION_PEOPLE = 50

export const MAX_RECURRENCE_INTERVAL = 99
export const MAX_RECURRENCE_COUNT = 999

/** The checked form of what a caller sent, or an error saying what is wrong. */
export function normalizeRecurrence(value: unknown): RecurrenceSettings {
  if (!value || typeof value !== 'object') throw new Error(t('tasks:recurrence.repeatRuleRequired'))
  const input = value as Record<string, unknown>
  const rule = normalizeRule(input.rule)
  let endsOn: string | null = null
  if (input.endsOn !== undefined && input.endsOn !== null && input.endsOn !== '') {
    if (!isIsoDate(input.endsOn)) throw new Error(t('tasks:recurrence.repeatEndDateMust'))
    endsOn = input.endsOn
  }
  let remaining: number | null = null
  if (input.remaining !== undefined && input.remaining !== null) {
    if (
      typeof input.remaining !== 'number' ||
      !Number.isInteger(input.remaining) ||
      input.remaining < 0 ||
      input.remaining > MAX_RECURRENCE_COUNT
    ) {
      throw new Error(t('tasks:recurrence.numberRepeatsMustWhole', { MAX_RECURRENCE_COUNT }))
    }
    remaining = input.remaining
  }
  if (endsOn !== null && remaining !== null) {
    throw new Error(t('tasks:recurrence.repeatEndsDateAfter'))
  }
  const rotation = normalizeRotation(input.rotation)
  let nextIndex = 0
  if (input.nextIndex !== undefined && input.nextIndex !== null) {
    if (
      typeof input.nextIndex !== 'number' ||
      !Number.isInteger(input.nextIndex) ||
      input.nextIndex < 0 ||
      input.nextIndex >= Math.max(1, rotation?.length ?? 0)
    ) {
      throw new Error(t('tasks:recurrence.nextIndexMustBe'))
    }
    nextIndex = input.nextIndex
  }
  return { rule, endsOn, remaining, rotation, nextIndex }
}

/** A rotation as sent: person ids, each once, in order; empty or absent is none. */
export function normalizeRotation(value: unknown): string[] | null {
  if (value === undefined || value === null) return null
  if (
    !Array.isArray(value) ||
    value.length > MAX_ROTATION_PEOPLE ||
    value.some((id) => typeof id !== 'string' || id.trim() === '')
  ) {
    throw new Error(t('tasks:recurrence.rotationMustBe', { MAX_ROTATION_PEOPLE }))
  }
  const ids = value as string[]
  if (new Set(ids).size !== ids.length) throw new Error(t('tasks:recurrence.rotationListsTwice'))
  return ids.length === 0 ? null : [...ids]
}

/** Whose turn it is: the person, their place in the rotation, and the index after them. */
export interface RotationTurn {
  personId: string
  index: number
  nextIndex: number
  /** People whose turn it was but who are archived, passed over this time. */
  passedOver: string[]
}

/**
 * Who the next occurrence goes to (N2.3): the first person from `nextIndex`
 * on, wrapping round, who is not archived. Null when everyone in it is
 * archived (or unknown): the occurrence then keeps the done task's assignee.
 * The service and the drawer's "Next: Alex" both ask this.
 */
export function nextInRotation(
  rotation: readonly string[] | null,
  nextIndex: number,
  isArchived: (personId: string) => boolean
): RotationTurn | null {
  if (!rotation || rotation.length === 0) return null
  const start = ((nextIndex % rotation.length) + rotation.length) % rotation.length
  const passedOver: string[] = []
  for (let step = 0; step < rotation.length; step += 1) {
    const index = (start + step) % rotation.length
    const personId = rotation[index]
    if (isArchived(personId)) {
      passedOver.push(personId)
      continue
    }
    return { personId, index, nextIndex: (index + 1) % rotation.length, passedOver }
  }
  return null
}

/**
 * Where the turn stands after the rotation is edited: the person who was
 * next stays next while they are still in it; if they were taken out, the
 * person now in their place is, so a removal never skips anyone.
 */
export function rotationIndexAfterEdit(
  before: readonly string[] | null,
  beforeIndex: number,
  after: readonly string[] | null
): number {
  if (!after || after.length === 0) return 0
  if (!before || before.length === 0) return 0
  const next = before[beforeIndex % before.length]
  const kept = after.indexOf(next)
  if (kept >= 0) return kept
  // Count the people before the removed one who are still in the rotation.
  const ahead = before.slice(0, beforeIndex).filter((id) => after.includes(id)).length
  return ahead % after.length
}

export function normalizeRule(value: unknown): RecurrenceRule {
  if (!value || typeof value !== 'object') throw new Error(t('tasks:recurrence.repeatRuleRequired'))
  const input = value as Record<string, unknown>
  if (!RECURRENCE_UNITS.includes(input.every as RecurrenceUnit)) {
    throw new Error(t('tasks:recurrence.repeatRuleNeedsEvery'))
  }
  const every = input.every as RecurrenceUnit
  const interval = input.interval === undefined ? 1 : input.interval
  if (
    typeof interval !== 'number' ||
    !Number.isInteger(interval) ||
    interval < 1 ||
    interval > MAX_RECURRENCE_INTERVAL
  ) {
    throw new Error(t('tasks:recurrence.repeatIntervalMustWhole', { MAX_RECURRENCE_INTERVAL }))
  }
  const rule: RecurrenceRule = { every, interval }
  if (input.weekdays !== undefined && input.weekdays !== null) {
    if (every !== 'week') throw new Error(t('tasks:recurrence.onlyWeeklyRepeatCan'))
    if (
      !Array.isArray(input.weekdays) ||
      input.weekdays.length === 0 ||
      input.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
    ) {
      throw new Error(t('tasks:recurrence.weekdaysMustNumbers0'))
    }
    rule.weekdays = [...new Set(input.weekdays as number[])].sort((a, b) => a - b)
  }
  if (input.monthDay !== undefined && input.monthDay !== null) {
    if (every !== 'month' && every !== 'year') {
      throw new Error(t('tasks:recurrence.onlyMonthlyYearlyRepeat'))
    }
    const day = input.monthDay
    if (typeof day !== 'number' || !Number.isInteger(day) || day < 1 || day > 31) {
      throw new Error(t('tasks:recurrence.dayMonthMust1'))
    }
    rule.monthDay = day
  }
  return rule
}

function parts(value: string): [number, number, number] {
  const [y, m, d] = value.split('-').map(Number)
  return [y, m, d]
}

function iso(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** The given day in month `m` of year `y`, or the month's last day when it is shorter. */
function clampedDay(y: number, m: number, day: number): string {
  return iso(y, m, Math.min(day, daysInMonth(y, m)))
}

/** Monday of the week `value` falls in. */
function mondayOf(value: string): string {
  return shiftIsoDate(value, -((isoWeekday(value) + 6) % 7))
}

/**
 * The first day on the rule's schedule, anchored at `anchor`, that is after
 * `anchor` and on or after `from`.
 */
export function firstRuleDateFrom(rule: RecurrenceRule, anchor: string, from: string): string {
  const start = from > anchor ? from : shiftIsoDate(anchor, 1)
  const n = rule.interval
  switch (rule.every) {
    case 'day': {
      const k = Math.max(1, Math.ceil(isoDaysBetween(anchor, start) / n))
      return shiftIsoDate(anchor, k * n)
    }
    case 'week': {
      const weekdays = rule.weekdays?.length ? rule.weekdays : [isoWeekday(anchor)]
      const anchorWeek = mondayOf(anchor)
      // Jump to the first week on the schedule at or before `start`'s week.
      const weeks = Math.floor(isoDaysBetween(anchorWeek, mondayOf(start)) / 7)
      let week = shiftIsoDate(anchorWeek, Math.max(0, weeks - (weeks % n)) * 7)
      for (;;) {
        for (let offset = 0; offset < 7; offset += 1) {
          const day = shiftIsoDate(week, offset)
          if (day >= start && weekdays.includes(isoWeekday(day))) return day
        }
        week = shiftIsoDate(week, 7 * n)
      }
    }
    case 'month': {
      const [ay, am, ad] = parts(anchor)
      const day = rule.monthDay ?? ad
      const [sy, sm] = parts(start)
      const months = (sy - ay) * 12 + (sm - am)
      let k = Math.max(0, months - (months % n))
      for (;;) {
        const index = am - 1 + k
        const candidate = clampedDay(ay + Math.floor(index / 12), (index % 12) + 1, day)
        if (candidate >= start) return candidate
        k += n
      }
    }
    case 'year': {
      const [ay, am, ad] = parts(anchor)
      const day = rule.monthDay ?? ad
      const [sy] = parts(start)
      const years = sy - ay
      let k = Math.max(0, years - (years % n))
      for (;;) {
        const candidate = clampedDay(ay + k, am, day)
        if (candidate >= start) return candidate
        k += n
      }
    }
  }
}

/**
 * When the next occurrence of a finished recurring task is due (P5.6): the
 * first rule date after the old due date that is today or later, so a task
 * finished late catches up rather than arriving already overdue. A task with
 * no due date counts from today. Null when the repeat has ended.
 */
export function nextOccurrenceDate(
  settings: RecurrenceSettings,
  dueDate: string | null,
  today: string
): string | null {
  if (settings.remaining !== null && settings.remaining <= 0) return null
  const anchor = dueDate ?? today
  const next = firstRuleDateFrom(settings.rule, anchor, today)
  if (settings.endsOn !== null && next > settings.endsOn) return null
  return next
}

/** The settings the next occurrence carries: one fewer remaining when counted. */
export function advanceRecurrence(settings: RecurrenceSettings): RecurrenceSettings {
  return {
    rule: settings.rule,
    endsOn: settings.endsOn,
    remaining: settings.remaining === null ? null : Math.max(0, settings.remaining - 1),
    rotation: settings.rotation,
    nextIndex: settings.nextIndex
  }
}

function weekdayName(day: number, locale: string = formatLocale()): string {
  // 2026-10-04 was a Sunday.
  return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(2026, 9, 4 + day))
}

/** "31st": an ordinal day of the month, through the language's ordinal plural rules. */
function ordinalDay(day: number): string {
  return t('tasks:recurrence.ordinalDay', { count: day, ordinal: true })
}

const SIMPLE: Record<RecurrenceUnit, string> = {
  get day() {
    return t('tasks:recurrence.daily')
  },
  get week() {
    return t('tasks:recurrence.weekly')
  },
  get month() {
    return t('tasks:recurrence.monthly')
  },
  get year() {
    return t('tasks:recurrence.yearly')
  }
}

/** "Weekly on Mon and Thu", "Every 2 weeks on Mon", "Monthly on the 31st", "Every 3 days". */
export function describeRecurrence(rule: RecurrenceRule, locale?: string): string {
  const head =
    rule.interval === 1
      ? SIMPLE[rule.every]
      : t('tasks:recurrence.every', { count: rule.interval, context: rule.every })
  if (rule.every === 'week' && rule.weekdays?.length) {
    if (rule.interval === 1 && rule.weekdays.join(',') === '1,2,3,4,5')
      return t('tasks:recurrence.everyWeekday')
    const names = rule.weekdays.map((day) => weekdayName(day, locale))
    return t('tasks:recurrence.on', { head, list: formatList(names) })
  }
  if (rule.every === 'month' && rule.monthDay)
    return t('tasks:recurrence.onThe', { head, day: ordinalDay(rule.monthDay) })
  return head
}
