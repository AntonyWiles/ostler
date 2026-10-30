import type {
  PlanningMilestone,
  PlanningStatusTransition,
  PlanningWorkItem,
  RoundComparison,
  RoundComparisonCell,
  RoundComparisonRound,
  RoundComparisonRow
} from '@shared/ostler-api'
import { currentRoundStart, groupRounds } from '@shared/milestone-rounds'
import { isoDaysBetween } from '@shared/dates'
import { entrySeconds } from '@shared/time/timesheet'
import { t } from '@shared/i18n'
import { localIsoDate, reportItemMetrics } from './report-builder'
import { workStartedEvent } from './planning-metrics'

/*
 * Compare rounds (N5.7b, N42): a series of rounds (N5.7a) side by side. Pure,
 * like the report builder, and counting as it does: a task is finished and
 * has a cycle time exactly when the Overview's report for that round says so
 * (`reportItemMetrics`), so the two never disagree. The Compare rounds view
 * and `GET /milestones/:milestoneId/rounds` get the same answer.
 */

export interface RoundComparisonInput {
  projectId: string
  /** Any round of the series. */
  milestoneId: string
  milestones: readonly PlanningMilestone[]
  /** Kept tasks (live and archived, not won't do), each with the status the app shows. */
  items: readonly PlanningWorkItem[]
  /** Tasks closed as won't do, counted apart: the reports leave them out. */
  wontDo?: readonly PlanningWorkItem[]
  history: readonly PlanningStatusTransition[]
  /** The project's time entries (R2.3); absent when time is not tracked. */
  timeEntries?: ReadonlyArray<{
    workItemId: string
    startedAt: number
    durationSeconds: number | null
  }>
  now: number
}

/** The latest round's own series, oldest round first. */
function seriesOf(milestones: readonly PlanningMilestone[], milestoneId: string) {
  const series = groupRounds(milestones).find((candidate) =>
    [candidate.latest, ...candidate.earlier].some((milestone) => milestone.id === milestoneId)
  )
  if (!series) throw new Error(t('views:compareRounds.milestoneNotInProject'))
  return { name: series.name, rounds: [...series.earlier].reverse().concat(series.latest) }
}

const days = (count: number) => t('common:count.day', { count })

function roundSentence(round: Omit<RoundComparisonRound, 'summary'>): string {
  const head =
    round.tookDays === null
      ? t('views:compareRounds.notStarted', { name: round.name })
      : round.finished
        ? t('views:compareRounds.took', { name: round.name, days: days(round.tookDays) })
        : t('views:compareRounds.soFar', { name: round.name, days: days(round.tookDays) })
  const planned =
    round.plannedDays === null
      ? t('views:compareRounds.noPlan')
      : t('views:compareRounds.planned', { days: days(round.plannedDays) })
  const counts = t('views:compareRounds.counts', {
    done: round.done,
    wontDo: round.wontDo,
    open: round.open
  })
  return t('views:compareRounds.sentence', { head, planned, counts })
}

/** Builds the comparison for the series `input.milestoneId` belongs to. */
export function buildRoundComparison(input: RoundComparisonInput): RoundComparison {
  const { now } = input
  const today = localIsoDate(now)
  const series = seriesOf(input.milestones, input.milestoneId)
  const roundIndex = new Map(series.rounds.map((milestone, index) => [milestone.id, index]))
  const wontDo = input.wontDo ?? []
  const inSeries = (item: PlanningWorkItem) =>
    item.milestoneId !== null && roundIndex.has(item.milestoneId)
  const kept = input.items.filter(inSeries)
  const closed = wontDo.filter(inSeries)
  const { historyByItem, metrics } = reportItemMetrics(kept, input.history, now)

  const tracked = new Map<string, number>()
  for (const entry of input.timeEntries ?? [])
    tracked.set(entry.workItemId, (tracked.get(entry.workItemId) ?? 0) + entrySeconds(entry, now))
  const seriesIds = new Set([...kept, ...closed].map((item) => item.id))
  const hasTimeTracked = [...tracked.keys()].some((id) => seriesIds.has(id))

  const rounds: RoundComparisonRound[] = series.rounds.map((milestone) => {
    const tasks = kept.filter((item) => item.milestoneId === milestone.id)
    const closedHere = closed.filter((item) => item.milestoneId === milestone.id)
    const done = tasks.filter((item) => metrics.get(item.id)?.completedAt != null)
    const starts = tasks
      .map(
        (item) =>
          workStartedEvent(historyByItem.get(item.id) ?? [])?.at ??
          metrics.get(item.id)?.completedAt ??
          null
      )
      .filter((value): value is number => value !== null)
    const finishes = done.map((item) => metrics.get(item.id)!.completedAt!)
    const open = tasks.length - done.length
    const finished = open === 0 && done.length > 0
    const firstStartedAt = starts.length ? Math.min(...starts) : null
    const lastFinishedAt = finished ? Math.max(...finishes) : null
    const tookDays =
      firstStartedAt === null
        ? null
        : isoDaysBetween(localIsoDate(firstStartedAt), localIsoDate(lastFinishedAt ?? now)) + 1
    const start = currentRoundStart(
      milestone,
      [...tasks, ...closedHere].flatMap((item) => [item.startDate, item.targetDate]),
      today
    )
    const plannedDays =
      milestone.targetDate && milestone.targetDate >= start
        ? isoDaysBetween(start, milestone.targetDate) + 1
        : (milestone.repeat?.lengthDays ?? null)
    const round = {
      milestoneId: milestone.id,
      name: milestone.name,
      start,
      targetDate: milestone.targetDate,
      plannedDays,
      firstStartedAt,
      lastFinishedAt,
      tookDays,
      finished,
      done: done.length,
      wontDo: closedHere.length,
      open,
      timeTrackedSeconds: [...tasks, ...closedHere].reduce(
        (sum, item) => sum + (tracked.get(item.id) ?? 0),
        0
      )
    }
    return { ...round, summary: roundSentence(round) }
  })

  // Rows: a copy joins its source task's row, unless the source is missing
  // or that row already has a task in this round; then it starts a new row.
  const rows: Array<{ cells: Array<RoundComparisonCell | null> }> = []
  const rowOf = new Map<string, number>()
  const all = [...kept, ...closed].sort((a, b) => a.createdAt - b.createdAt)
  series.rounds.forEach((milestone, index) => {
    for (const item of all) {
      if (item.milestoneId !== milestone.id) continue
      const metric = metrics.get(item.id)
      const isClosed = item.resolution === 'wont-do' || !metrics.has(item.id)
      const cell: RoundComparisonCell = {
        workItemId: item.id,
        title: item.title,
        outcome: isClosed ? 'wont-do' : metric?.completedAt != null ? 'done' : 'open',
        cycleTimeMs: isClosed ? null : (metric?.cycleTimeMs ?? null),
        timeTrackedSeconds: tracked.get(item.id) ?? 0
      }
      const sourceRow = item.roundSourceId ? rowOf.get(item.roundSourceId) : undefined
      let row = sourceRow
      if (row === undefined || rows[row].cells[index] !== null) {
        row = rows.length
        rows.push({ cells: series.rounds.map(() => null) })
      }
      rows[row].cells[index] = cell
      rowOf.set(item.id, row)
    }
  })

  const slowest = (
    cells: Array<RoundComparisonCell | null>,
    value: (cell: RoundComparisonCell) => number | null
  ) => {
    let best: number | null = null
    let count = 0
    cells.forEach((cell, index) => {
      const amount = cell ? value(cell) : null
      if (amount === null) return
      count += 1
      if (best === null || amount >= value(cells[best]!)!) best = index
    })
    return count >= 2 ? best : null
  }
  const tasks: RoundComparisonRow[] = rows.map(({ cells }) => ({
    title: [...cells].reverse().find((cell) => cell !== null)!.title,
    cells,
    slowestCycleRound: slowest(cells, (cell) => cell.cycleTimeMs),
    slowestTimeRound: slowest(cells, (cell) =>
      cell.timeTrackedSeconds > 0 ? cell.timeTrackedSeconds : null
    )
  }))

  return {
    projectId: input.projectId,
    seriesName: series.name,
    rounds,
    tasks,
    hasTimeTracked,
    generatedAt: now,
    summary: t('views:compareRounds.summary', { count: rounds.length, name: series.name })
  }
}
