import { formatIsoDate, isIsoDate, isoDaysBetween, shiftIsoDate } from './dates'
import { t } from './i18n'
import { firstRuleDateFrom, normalizeRule, type RecurrenceRule } from './recurrence'

/**
 * Repeating rounds (N5.7a, N42). A milestone can be a round of work that
 * comes round again: its schedule says when the next round starts (a
 * `RecurrenceRule`, anchored on the rounds' start days, as a task's repeat
 * is anchored on its due dates) and how many days a round lasts. The rules
 * here are shared by the service, the automation API and the dialog's
 * preview, on `YYYY-MM-DD` strings only.
 */

/** A milestone's round schedule, as `PlanningMilestone.repeat` carries it. */
export interface MilestoneRepeat {
  rule: RecurrenceRule
  /** How many days a round lasts, its first and last day included: 1 to 366. */
  lengthDays: number
  /** When the next round starts, `YYYY-MM-DD`. */
  nextStart: string
  /** Off after Stop repeating; the schedule is kept for the history. */
  on: boolean
}

/** What Repeat this round and `PUT /milestones/:id/repeat` send. */
export interface MilestoneRepeatInput {
  rule: RecurrenceRule
  lengthDays: number
  nextStart: string
}

/** What the next round would be, for the dialog's preview. */
export interface MilestoneRoundPreview {
  name: string
  start: string
  end: string
  /** Tasks that would be copied. */
  taskCount: number
  /** Repeating tasks of this round, which repeat by themselves and are not copied. */
  repeatingCount: number
}

export const MAX_ROUND_LENGTH_DAYS = 366

/** The checked form of what a caller sent, or an error saying what is wrong. */
export function normalizeMilestoneRepeat(value: unknown): MilestoneRepeatInput {
  if (!value || typeof value !== 'object') throw new Error(t('tasks:rounds.repeatRequired'))
  const input = value as Record<string, unknown>
  const rule = normalizeRule(input.rule)
  const lengthDays = input.lengthDays
  if (
    typeof lengthDays !== 'number' ||
    !Number.isInteger(lengthDays) ||
    lengthDays < 1 ||
    lengthDays > MAX_ROUND_LENGTH_DAYS
  )
    throw new Error(t('tasks:rounds.lengthInvalid', { max: MAX_ROUND_LENGTH_DAYS }))
  if (!isIsoDate(input.nextStart)) throw new Error(t('tasks:rounds.nextStartInvalid'))
  return { rule, lengthDays, nextStart: input.nextStart }
}

/** The last day of a round that starts on `start`. */
export function roundEnd(start: string, lengthDays: number): string {
  return shiftIsoDate(start, Math.max(1, lengthDays) - 1)
}

/** The start after `start` on the rule's schedule. */
export function followingRoundStart(rule: RecurrenceRule, start: string): string {
  return firstRuleDateFrom(rule, start, shiftIsoDate(start, 1))
}

/**
 * The round to make now, if any: the latest start on the schedule from
 * `nextStart` that is on or before `today`. An Ostler closed through several
 * start dates makes only the latest one; null when none is due.
 */
export function latestDueRoundStart(
  rule: RecurrenceRule,
  nextStart: string,
  today: string
): string | null {
  if (nextStart > today) return null
  let start = nextStart
  for (;;) {
    const following = followingRoundStart(rule, start)
    if (following > today) return start
    start = following
  }
}

/**
 * Where a task's date lands in the next round. Rounds by the month or year
 * move dates by whole months, so a task due on the 31st lands on the last day
 * of a shorter month; rounds by the day or week move them by the days
 * between the two rounds' starts, as `shiftTaskDates` does.
 */
export function shiftRoundDate(
  value: string,
  fromStart: string,
  toStart: string,
  rule: RecurrenceRule
): string {
  if (rule.every === 'day' || rule.every === 'week')
    return shiftIsoDate(value, isoDaysBetween(fromStart, toStart))
  const [fy, fm] = fromStart.split('-').map(Number)
  const [ty, tm] = toStart.split('-').map(Number)
  const months = (ty - fy) * 12 + (tm - fm)
  const [y, m, d] = value.split('-').map(Number)
  const index = y * 12 + (m - 1) + months
  const year = Math.floor(index / 12)
  const month = (index % 12) + 1
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(
    Math.min(d, last)
  ).padStart(2, '0')}`
}

/**
 * The round's own words, worded for the rule: the month ("May 2027"), the
 * quarter ("Q2 2027", a round every 3 months), the year ("2027"), or the
 * date ("3 May 2027") for rounds by the day or week.
 */
export function roundLabel(rule: RecurrenceRule, start: string): string {
  const [year, month] = start.split('-').map(Number)
  if (rule.every === 'year') return String(year)
  if (rule.every === 'month' && rule.interval === 3)
    return t('tasks:rounds.quarter', { quarter: Math.floor((month - 1) / 3) + 1, year })
  if (rule.every === 'month') return formatIsoDate(start, { month: 'long', year: 'numeric' })
  return formatIsoDate(start, { day: 'numeric', month: 'long', year: 'numeric' })
}

const MAX_NAME = 160

/** "Accounts · May 2027": the series' name and the round's, within a milestone name's length. */
export function roundName(series: string, rule: RecurrenceRule, start: string): string {
  const label = roundLabel(rule, start)
  const room = MAX_NAME - label.length - 3
  const head = series.length > room ? series.slice(0, Math.max(1, room)).trimEnd() : series
  return t('tasks:rounds.name', { series: head, round: label })
}

/**
 * The day a round started: its own, else the earliest date among its tasks
 * (on or before its target date), else a week before its target date, else
 * today. The dialog and the service both ask this, so they agree.
 */
export function currentRoundStart(
  milestone: { roundStart?: string | null; targetDate: string | null },
  taskDates: readonly (string | null | undefined)[],
  today: string
): string {
  if (milestone.roundStart) return milestone.roundStart
  const earliest = taskDates.filter((value): value is string => isIsoDate(value)).sort()[0]
  if (earliest && (!milestone.targetDate || earliest <= milestone.targetDate)) return earliest
  if (milestone.targetDate) return shiftIsoDate(milestone.targetDate, -6)
  return today
}

/** The days a round lasts by default: from this round's start to its target date. */
export function defaultRoundLength(start: string | null, targetDate: string | null): number {
  if (!start || !targetDate || targetDate < start) return 7
  return Math.min(MAX_ROUND_LENGTH_DAYS, isoDaysBetween(start, targetDate) + 1)
}

/** The fields of a milestone the rounds read. */
export interface RoundMilestone {
  id: string
  name: string
  previousRoundId?: string | null
  createdAt: number
}

/** A series of rounds: its latest round first, then the earlier ones, latest first. */
export interface RoundSeries<T extends RoundMilestone> {
  /** The first round's name: what every round is named after. */
  name: string
  latest: T
  earlier: T[]
}

/**
 * Groups milestones into series, in the order given by each series' latest
 * round. A milestone that is no round stands alone, as a series of one. A
 * round whose earlier round is not in the list starts its own series.
 */
export function groupRounds<T extends RoundMilestone>(milestones: readonly T[]): RoundSeries<T>[] {
  const byId = new Map(milestones.map((milestone) => [milestone.id, milestone]))
  const next = new Map<string, T>()
  for (const milestone of milestones) {
    const previous = milestone.previousRoundId
    if (previous && byId.has(previous) && previous !== milestone.id) next.set(previous, milestone)
  }
  const firstOf = (milestone: T): T => {
    let current = milestone
    const seen = new Set<string>([current.id])
    for (;;) {
      const previous = current.previousRoundId ? byId.get(current.previousRoundId) : undefined
      if (!previous || seen.has(previous.id)) return current
      seen.add(previous.id)
      current = previous
    }
  }
  const series: RoundSeries<T>[] = []
  const placed = new Set<string>()
  for (const milestone of milestones) {
    if (placed.has(milestone.id)) continue
    const first = firstOf(milestone)
    const chain: T[] = []
    let current: T | undefined = first
    while (current && !placed.has(current.id)) {
      placed.add(current.id)
      chain.push(current)
      current = next.get(current.id)
    }
    const [latest, ...earlier] = chain.reverse()
    series.push({ name: first.name, latest, earlier })
  }
  // Each series where its latest round would stand in the given order.
  const position = new Map(milestones.map((milestone, index) => [milestone.id, index]))
  return series.sort((a, b) => position.get(a.latest.id)! - position.get(b.latest.id)!)
}
