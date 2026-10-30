import type { PlanningWorkItem } from '../ostler-api'

/**
 * Ideas and scores (N1.1b, N10): an idea is a task in Someday, scored for
 * impact and effort from 1 to 5. The one rule for what a score may be, the
 * "best first" order and the grid's corners, so the Someday view, the grid,
 * filters, CSV, the project file and the API agree.
 */

export const MIN_SCORE = 1
export const MAX_SCORE = 5
/** The five steps, low to high. */
export const SCORE_STEPS: readonly number[] = [1, 2, 3, 4, 5]

export type ScoreField = 'impact' | 'effort'
export type ScoredTask = Pick<PlanningWorkItem, 'impact' | 'effort'>

/** Whether `value` is a score: a whole number from 1 to 5. */
export function isScore(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= MIN_SCORE && value <= MAX_SCORE
  )
}

/**
 * Reads an untrusted score: undefined stays undefined (unchanged), null
 * clears, a whole number from 1 to 5 is kept, anything else is null with
 * `ok: false` so the caller can refuse it in its own words.
 */
export function readScore(value: unknown): { ok: true; value: number | null } | { ok: false } {
  if (value === null) return { ok: true, value: null }
  return isScore(value) ? { ok: true, value } : { ok: false }
}

/** Whether an idea is a quick win: impact 4 or 5, effort 1 or 2. */
export function isQuickWin(task: ScoredTask): boolean {
  return (task.impact ?? 0) >= 4 && task.effort != null && task.effort <= 2
}

/** Whether an idea sits in the "Probably not" corner: impact 1 or 2, effort 4 or 5. */
export function isProbablyNot(task: ScoredTask): boolean {
  return task.impact != null && task.impact <= 2 && (task.effort ?? 0) >= 4
}

/** Whether both scores are set, so the idea has a cell in the grid. */
export function isScored(task: ScoredTask): boolean {
  return task.impact != null && task.effort != null
}

/**
 * "Best first": impact high to low, then effort low to high. A missing
 * impact sorts after every impact, a missing effort after every effort.
 * Returns 0 for a tie, so a stable sort keeps the earlier order.
 */
export function compareBestFirst(a: ScoredTask, b: ScoredTask): number {
  const impactA = a.impact ?? 0
  const impactB = b.impact ?? 0
  if (impactA !== impactB) return impactB - impactA
  const effortA = a.effort ?? MAX_SCORE + 1
  const effortB = b.effort ?? MAX_SCORE + 1
  return effortA - effortB
}

/** `tasks` in "best first" order, a new array. */
export function sortBestFirst<T extends ScoredTask>(tasks: readonly T[]): T[] {
  return [...tasks].sort(compareBestFirst)
}
