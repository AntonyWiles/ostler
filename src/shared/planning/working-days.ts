import type { DayOff } from '../ostler-api/days-off-types'
import { DEFAULT_WORKING_DAYS } from '../ostler-api/people-types'
import { compareIsoDates, isIsoDate, isoDaysBetween, isoWeekday, shiftIsoDate } from '../dates'

/**
 * What a working day is (N3.2, decision N25): the one rule. A day is a
 * working day for a person when it is one of their working days (Workload,
 * R3.2; Monday to Friday for nobody or when unknown) and it is not a day off,
 * either for everyone (a bank holiday) or for them (leave). Reschedule,
 * Workload, the Calendar, the Timeline and the date fields all ask here;
 * nothing else decides it.
 *
 * Pure, on `YYYY-MM-DD` strings only: days off are local calendar dates, so
 * no time zone can move one. The days off are indexed once per list (kept in
 * a WeakMap), so asking about every day of a long range stays cheap.
 */

/** The parts of a day off the rule reads. */
export type DayOffSpan = Pick<DayOff, 'personId' | 'firstDate' | 'lastDate' | 'name'>

export interface WorkingDayContext {
  /** The person's working days as ISO weekdays, 1 Monday to 7 Sunday; Monday to Friday when left out or empty. */
  workingDays?: readonly number[]
  /** Days off for everyone and for anyone; the rule picks the ones that count for the person. */
  daysOff?: readonly DayOffSpan[]
}

/**
 * One person's working days, ready for the rule: whose they are, their
 * working weekdays and the days off (everyone's and anyone's; the rule keeps
 * the ones that count for them). Countdowns and the streak read the
 * person's own, built by `myWorkingDays`.
 */
export interface PersonWorkingDays extends WorkingDayContext {
  /** The person, or null for nobody in particular: then only everyone's days off count. */
  personId?: string | null
}

/**
 * The person's own working days (decision for countdowns and the streak):
 * Me's working weekdays, Me's days off and everyone's. With nobody as Me,
 * Monday to Friday less everyone's days off; other people's leave never
 * counts. Main and the renderer both build it here, so every surface agrees.
 */
export function myWorkingDays(
  me: { id: string; workingDays?: readonly number[] } | null | undefined,
  daysOff: readonly DayOffSpan[]
): PersonWorkingDays {
  return me
    ? { personId: me.id, workingDays: me.workingDays, daysOff }
    : { personId: null, daysOff }
}

/** The longest stretch of days the rule looks through for the next working day. */
const SEARCH_LIMIT_DAYS = 3660

interface DayOffIndex {
  everyone: Map<string, DayOffSpan>
  byPerson: Map<string, Map<string, DayOffSpan>>
  /** Sorted off dates per person key ('' for nobody), everyone's included. */
  sorted: Map<string, string[]>
}

const indexes = new WeakMap<readonly DayOffSpan[], DayOffIndex>()
const EMPTY: readonly DayOffSpan[] = []

function indexOf(daysOff: readonly DayOffSpan[]): DayOffIndex {
  let index = indexes.get(daysOff)
  if (index) return index
  index = { everyone: new Map(), byPerson: new Map(), sorted: new Map() }
  for (const span of daysOff) {
    if (!isIsoDate(span.firstDate) || !isIsoDate(span.lastDate)) continue
    if (compareIsoDates(span.firstDate, span.lastDate) > 0) continue
    let target = index.everyone
    if (span.personId) {
      target = index.byPerson.get(span.personId) ?? new Map()
      index.byPerson.set(span.personId, target)
    }
    const length = isoDaysBetween(span.firstDate, span.lastDate)
    for (let offset = 0; offset <= length; offset++) {
      const date = shiftIsoDate(span.firstDate, offset)
      // The first one listed names a day that two days off share.
      if (!target.has(date)) target.set(date, span)
    }
  }
  indexes.set(daysOff, index)
  return index
}

function weekdaySet(workingDays: readonly number[] | undefined): ReadonlySet<number> {
  const valid = (workingDays ?? []).filter((day) => Number.isInteger(day) && day >= 1 && day <= 7)
  return new Set(valid.length > 0 ? valid : DEFAULT_WORKING_DAYS)
}

/** 1 for Monday to 7 for Sunday. */
export function isoWeekdayNumber(date: string): number {
  return isoWeekday(date) || 7
}

/**
 * The day off on `date` that counts for the person (or for nobody: then only
 * everyone's), or null. Everyone's comes first when both fall on it.
 */
export function dayOffOn(
  date: string,
  personId: string | null | undefined,
  daysOff: readonly DayOffSpan[] = EMPTY
): DayOffSpan | null {
  if (daysOff.length === 0) return null
  const index = indexOf(daysOff)
  return (
    index.everyone.get(date) ?? (personId ? index.byPerson.get(personId)?.get(date) : null) ?? null
  )
}

/** Whether `date` is a working day for the person these working days belong to. */
export function isOwnWorkingDay(date: string, days: PersonWorkingDays = {}): boolean {
  return isWorkingDay(date, days.personId ?? null, days)
}

/** Everyone's day off on `date`, or null (a bank holiday, not anyone's leave). */
export function everyonesDayOffOn(
  date: string,
  daysOff: readonly DayOffSpan[] = EMPTY
): DayOffSpan | null {
  return dayOffOn(date, null, daysOff)
}

/** The people whose own leave covers `date` (not everyone's days off), by person id. */
export function peopleOffOn(date: string, daysOff: readonly DayOffSpan[] = EMPTY): string[] {
  if (daysOff.length === 0) return []
  const people: string[] = []
  for (const [personId, dates] of indexOf(daysOff).byPerson)
    if (dates.has(date)) people.push(personId)
  return people
}

/** Whether `date` is a working day for the person. */
export function isWorkingDay(
  date: string,
  personId: string | null | undefined,
  context: WorkingDayContext = {}
): boolean {
  if (!weekdaySet(context.workingDays).has(isoWeekdayNumber(date))) return false
  return dayOffOn(date, personId, context.daysOff) === null
}

/**
 * The first working day on or after `date` for the person. When none comes
 * within ten years (a mistake in the days off), `date` itself.
 */
export function nextWorkingDay(
  date: string,
  personId: string | null | undefined,
  context: WorkingDayContext = {}
): string {
  let at = date
  for (let step = 0; step < SEARCH_LIMIT_DAYS; step++) {
    if (isWorkingDay(at, personId, context)) return at
    at = shiftIsoDate(at, 1)
  }
  return date
}

/** The next `count` working days after `today` (today itself not included). */
export function workingDaysAfter(
  today: string,
  count: number,
  personId: string | null | undefined,
  context: WorkingDayContext = {}
): string[] {
  const days: string[] = []
  let at = today
  for (let step = 0; days.length < count && step < SEARCH_LIMIT_DAYS; step++) {
    at = shiftIsoDate(at, 1)
    if (isWorkingDay(at, personId, context)) days.push(at)
  }
  return days
}

/** How many of the given ISO weekdays fall from `from` to `to`, inclusive, ignoring days off. */
export function countWeekdays(from: string, to: string, weekdays: ReadonlySet<number>): number {
  if (compareIsoDates(from, to) > 0) return 0
  const length = isoDaysBetween(from, to) + 1
  const fullWeeks = Math.floor(length / 7)
  let count = fullWeeks * weekdays.size
  let day = shiftIsoDate(from, fullWeeks * 7)
  for (let index = 0; index < length % 7; index++) {
    if (weekdays.has(isoWeekdayNumber(day))) count++
    day = shiftIsoDate(day, 1)
  }
  return count
}

/** The sorted dates off for a person key, everyone's included. */
function sortedOffDates(index: DayOffIndex, personId: string | null | undefined): string[] {
  const key = personId ?? ''
  let sorted = index.sorted.get(key)
  if (!sorted) {
    const dates = new Set(index.everyone.keys())
    if (personId) for (const date of index.byPerson.get(personId)?.keys() ?? []) dates.add(date)
    sorted = [...dates].sort(compareIsoDates)
    index.sorted.set(key, sorted)
  }
  return sorted
}

/** The first position in `sorted` whose date is on or after `date`. */
function lowerBound(sorted: readonly string[], date: string): number {
  let low = 0
  let high = sorted.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (compareIsoDates(sorted[middle], date) < 0) low = middle + 1
    else high = middle
  }
  return low
}

/** The person's working days from `from` to `to`, inclusive. */
export function countWorkingDays(
  from: string,
  to: string,
  personId: string | null | undefined,
  context: WorkingDayContext = {}
): number {
  const weekdays = weekdaySet(context.workingDays)
  let count = countWeekdays(from, to, weekdays)
  if (count === 0 || !context.daysOff || context.daysOff.length === 0) return count
  const sorted = sortedOffDates(indexOf(context.daysOff), personId)
  for (let at = lowerBound(sorted, from); at < sorted.length; at++) {
    const date = sorted[at]
    if (compareIsoDates(date, to) > 0) break
    if (weekdays.has(isoWeekdayNumber(date))) count--
  }
  return count
}

/** The person's days off from `from` to `to` that fall on their working weekdays, in order. */
export function daysOffBetween(
  from: string,
  to: string,
  personId: string | null | undefined,
  context: WorkingDayContext = {}
): { date: string; dayOff: DayOffSpan }[] {
  if (!context.daysOff || context.daysOff.length === 0) return []
  const weekdays = weekdaySet(context.workingDays)
  const index = indexOf(context.daysOff)
  const sorted = sortedOffDates(index, personId)
  const result: { date: string; dayOff: DayOffSpan }[] = []
  for (let at = lowerBound(sorted, from); at < sorted.length; at++) {
    const date = sorted[at]
    if (compareIsoDates(date, to) > 0) break
    if (!weekdays.has(isoWeekdayNumber(date))) continue
    result.push({ date, dayOff: dayOffOn(date, personId, context.daysOff)! })
  }
  return result
}
