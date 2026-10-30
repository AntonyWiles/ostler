import type { CalendarOccurrence } from '../ostler-api/calendar-types'
import type { TimeBlock } from '../ostler-api/time-block-types'
import { compareIsoDates, shiftIsoDate } from '../dates'
import { BLOCK_STEP_MINUTES, MINUTES_PER_DAY, defaultBlockLength } from './time-blocks'
import { dayOffOn, isWorkingDay, type DayOffSpan } from './working-days'

/*
 * Free time (N3.4b, decision N28): the one rule for where a block can go.
 * A day's free time is its working hours minus timed outside-calendar events
 * (all-day events take no time; cancelled ones are never expanded) and minus
 * other blocks; a day off or a non-working day has none. Pure: "now" is
 * always passed in, so a preview and its apply agree and tests can fix it.
 */

/** How far ahead the next free time is looked for, in days. */
export const FREE_SLOT_SEARCH_DAYS = 14
/** A task is never split into a piece shorter than this. */
export const MIN_PIECE_MINUTES = 30

/** A moment as the person's wall clock reads it. */
export interface WallMoment {
  date: string
  /** Minutes after local midnight. */
  minute: number
}

/** A stretch of a day, in minutes after midnight, `end` exclusive. */
export interface Stretch {
  start: number
  end: number
}

export type BusyEvent = Pick<
  CalendarOccurrence,
  'allDay' | 'startDate' | 'endDate' | 'startTime' | 'endTime'
>
export type BusyBlock = Pick<TimeBlock, 'id' | 'date' | 'startMinute' | 'lengthMinutes'>

export interface FreeTimeContext {
  /** Working hours in minutes (`workingMinutes`). */
  workingHours: Stretch
  /** The person's working days, ISO weekdays; Monday to Friday when left out. */
  workingDays?: readonly number[]
  daysOff?: readonly DayOffSpan[]
  /** Whose leave counts (Me); everyone's days off always do. */
  personId?: string | null
  events?: readonly BusyEvent[]
  blocks?: readonly BusyBlock[]
  /** Blocks left out of taken time (the one being moved). */
  ignoreBlockIds?: ReadonlySet<string>
}

/** The minute rounded up to the next quarter hour. */
export function quarterUp(minute: number): number {
  return Math.ceil(minute / BLOCK_STEP_MINUTES) * BLOCK_STEP_MINUTES
}

function quarterDown(minute: number): number {
  return Math.floor(minute / BLOCK_STEP_MINUTES) * BLOCK_STEP_MINUTES
}

function minuteOf(time: string | null): number | null {
  if (!time) return null
  const match = /^(\d{2}):(\d{2})/.exec(time)
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

/** The part of `date` a timed event takes; null when it takes none of it. */
export function eventStretchOn(event: BusyEvent, date: string): Stretch | null {
  if (event.allDay) return null
  if (compareIsoDates(date, event.startDate) < 0 || compareIsoDates(date, event.endDate) > 0)
    return null
  const start = date === event.startDate ? (minuteOf(event.startTime) ?? 0) : 0
  const end =
    date === event.endDate ? (minuteOf(event.endTime) ?? MINUTES_PER_DAY) : MINUTES_PER_DAY
  return end > start ? { start, end } : null
}

/** Why a day has no free time: a day off (with its name), or not a working day; null when it has. */
export function dayClosed(
  date: string,
  context: FreeTimeContext
): { kind: 'dayOff'; name: string } | { kind: 'notWorking' } | null {
  const off = dayOffOn(date, context.personId, context.daysOff)
  if (off) return { kind: 'dayOff', name: off.name }
  if (!isWorkingDay(date, context.personId, { workingDays: context.workingDays })) {
    return { kind: 'notWorking' }
  }
  return null
}

/** What is taken on `date`, sorted and merged. */
function takenOn(date: string, context: FreeTimeContext): Stretch[] {
  const taken: Stretch[] = []
  for (const event of context.events ?? []) {
    const stretch = eventStretchOn(event, date)
    if (stretch) taken.push(stretch)
  }
  for (const block of context.blocks ?? []) {
    if (block.date !== date || context.ignoreBlockIds?.has(block.id)) continue
    taken.push({ start: block.startMinute, end: block.startMinute + block.lengthMinutes })
  }
  taken.sort((a, b) => a.start - b.start)
  return taken
}

/**
 * A day's free time: its working hours minus what is taken, on quarter
 * hours, from `after` on (a minute of that day) when given. None on a day off
 * or a non-working day.
 */
export function freeTimeOn(date: string, context: FreeTimeContext, after = 0): Stretch[] {
  if (dayClosed(date, context)) return []
  const free: Stretch[] = []
  let cursor = quarterUp(Math.max(context.workingHours.start, after))
  const close = quarterDown(context.workingHours.end)
  for (const taken of takenOn(date, context)) {
    if (taken.end <= cursor) continue
    if (taken.start >= close) break
    const end = quarterDown(taken.start)
    if (end > cursor) free.push({ start: cursor, end })
    cursor = Math.max(cursor, quarterUp(taken.end))
  }
  if (close > cursor) free.push({ start: cursor, end: close })
  return free
}

/** Free time on `date` from `now` on: nothing on a past day, from now (quarter up) today. */
export function freeTimeFrom(date: string, now: WallMoment, context: FreeTimeContext): Stretch[] {
  const order = compareIsoDates(date, now.date)
  if (order < 0) return []
  return freeTimeOn(date, context, order === 0 ? now.minute : 0)
}

/**
 * The first free stretch at least `length` minutes long from `from` on, over
 * the coming working days (at most 14 days ahead): its date and start. Null
 * when none is free.
 */
export function nextFreeSlot(
  length: number,
  from: WallMoment,
  context: FreeTimeContext,
  days = FREE_SLOT_SEARCH_DAYS
): { date: string; startMinute: number } | null {
  for (let offset = 0; offset <= days; offset++) {
    const date = shiftIsoDate(from.date, offset)
    const stretch = freeTimeFrom(date, from, context).find(
      (candidate) => candidate.end - candidate.start >= length
    )
    if (stretch) return { date, startMinute: stretch.start }
  }
  return null
}

/** A task to place: its estimate in minutes (null without an hour estimate) and what is already blocked. */
export interface FillTask {
  id: string
  estimateMinutes: number | null
  /** Minutes already blocked for it on the day. */
  blockedMinutes: number
}

export interface FillPiece {
  workItemId: string
  startMinute: number
  lengthMinutes: number
  /** 1-based, and how many pieces the task was split into (1 when whole). */
  part: number
  parts: number
}

export interface FillDayResult {
  date: string
  /** Why nothing could be placed: a day off or not a working day. */
  closed: ReturnType<typeof dayClosed>
  pieces: FillPiece[]
  /** Tasks that did not fit, with the minutes they needed. */
  notPlaced: { workItemId: string; minutes: number }[]
  /** Tasks already blocked for their whole estimate that day. */
  alreadyBlocked: string[]
}

/** The minutes a task's estimate asks for: hours rounded up to quarter hours, else an hour. */
export function estimateMinutes(
  estimate: number | null | undefined,
  unit: 'hours' | 'points'
): number {
  return defaultBlockLength(estimate, unit, 0)
}

/**
 * Places `tasks` in order into `day`'s free time from `now` (rounded up to
 * the next quarter hour) or the start of working hours: each for what its
 * estimate needs less what is already blocked for it that day, whole in the
 * first stretch that holds it, else split into pieces of at least 30 minutes
 * across the stretches; a task that cannot fit is listed as not placed.
 */
export function fillDay(
  tasks: readonly FillTask[],
  day: string,
  now: WallMoment,
  context: FreeTimeContext
): FillDayResult {
  const result: FillDayResult = {
    date: day,
    closed: dayClosed(day, context),
    pieces: [],
    notPlaced: [],
    alreadyBlocked: []
  }
  let free = result.closed ? [] : freeTimeFrom(day, now, context)
  for (const task of tasks) {
    const wanted = task.estimateMinutes ?? 60
    const need = quarterUp(wanted - task.blockedMinutes)
    if (need <= 0) {
      result.alreadyBlocked.push(task.id)
      continue
    }
    const placed = placeTask(need, free)
    if (!placed) {
      result.notPlaced.push({ workItemId: task.id, minutes: need })
      continue
    }
    free = placed.free
    placed.pieces.forEach((piece, index) =>
      result.pieces.push({
        workItemId: task.id,
        startMinute: piece.start,
        lengthMinutes: piece.end - piece.start,
        part: index + 1,
        parts: placed.pieces.length
      })
    )
  }
  return result
}

/** Takes `pieces` out of `free`. */
function without(free: readonly Stretch[], pieces: readonly Stretch[]): Stretch[] {
  let rest = [...free]
  for (const piece of pieces) {
    rest = rest.flatMap((stretch) => {
      if (piece.end <= stretch.start || piece.start >= stretch.end) return [stretch]
      const parts: Stretch[] = []
      if (piece.start > stretch.start) parts.push({ start: stretch.start, end: piece.start })
      if (piece.end < stretch.end) parts.push({ start: piece.end, end: stretch.end })
      return parts
    })
  }
  return rest
}

function placeTask(
  need: number,
  free: readonly Stretch[]
): { pieces: Stretch[]; free: Stretch[] } | null {
  const whole = free.find((stretch) => stretch.end - stretch.start >= need)
  if (whole) {
    const pieces = [{ start: whole.start, end: whole.start + need }]
    return { pieces, free: without(free, pieces) }
  }
  // Split: earliest stretches first, no piece (nor what is left) under 30 minutes.
  const pieces: Stretch[] = []
  let left = need
  for (const stretch of free) {
    if (left === 0) break
    const room = stretch.end - stretch.start
    if (room < MIN_PIECE_MINUTES) continue
    let take = Math.min(room, left)
    const after = left - take
    if (after > 0 && after < MIN_PIECE_MINUTES) take = left - MIN_PIECE_MINUTES
    if (take < MIN_PIECE_MINUTES) continue
    pieces.push({ start: stretch.start, end: stretch.start + take })
    left -= take
  }
  if (left > 0) return null
  return { pieces, free: without(free, pieces) }
}

/** Whether a block's time has passed while its task is still open. */
export function isBlockPassed(
  block: Pick<TimeBlock, 'date' | 'startMinute' | 'lengthMinutes' | 'status'>,
  now: WallMoment
): boolean {
  if (block.status === 'done') return false
  const order = compareIsoDates(block.date, now.date)
  if (order !== 0) return order < 0
  return block.startMinute + block.lengthMinutes <= now.minute
}

/** A Date as the computer's wall clock reads it. */
export function wallMoment(date: Date): WallMoment {
  const pad = (value: number) => String(value).padStart(2, '0')
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    minute: date.getHours() * 60 + date.getMinutes()
  }
}
