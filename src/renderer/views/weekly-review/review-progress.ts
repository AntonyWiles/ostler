import type { WeeklyReview, WeeklyReviewRecord, WeeklyReviewStepId } from '@shared/ostler-api'
import { WEEKLY_REVIEW_STEPS } from '@shared/ostler-api'

/**
 * Where a person is in the weekly review (N1.5), kept in the renderer's
 * local storage (not config), so leaving half-way and coming back opens the
 * same step. Finishing the review forgets it.
 */
export interface ReviewProgress {
  /** Index into `WEEKLY_REVIEW_STEPS`. */
  step: number
  skipped: WeeklyReviewStepId[]
  /** What each step showed when it was first opened: task or milestone ids, or the Inbox count. */
  shown: Partial<Record<WeeklyReviewStepId, string[]>>
  inboxShown: number | null
  /**
   * Left off this review with Still on or Keep, by the step it was left off
   * in: not a change there. Kept by step, so a task changed in one step and
   * kept in a later one (moved to Someday, then kept there) still counts as
   * changed where it was changed.
   */
  dismissed: Partial<Record<WeeklyReviewStepId, string[]>>
}

export const REVIEW_PROGRESS_KEY = 'ostler.weeklyReview.progress'

export const EMPTY_PROGRESS: ReviewProgress = {
  step: 0,
  skipped: [],
  shown: {},
  inboxShown: null,
  dismissed: {}
}

/** Every task left off this review, in any step: none of the steps lists it again. */
export function allDismissed(progress: ReviewProgress): Set<string> {
  return new Set(Object.values(progress.dismissed).flat())
}

/** The left-off tasks as stored, by step; a list kept before they were (any step's) applies to each. */
function readDismissed(value: unknown): ReviewProgress['dismissed'] {
  const ids = (list: unknown) =>
    Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : []
  if (Array.isArray(value)) {
    const all = ids(value)
    return all.length === 0
      ? {}
      : Object.fromEntries(WEEKLY_REVIEW_STEPS.map((step) => [step, all]))
  }
  if (!value || typeof value !== 'object') return {}
  const byStep: ReviewProgress['dismissed'] = {}
  for (const step of WEEKLY_REVIEW_STEPS) {
    const list = ids((value as Record<string, unknown>)[step])
    if (list.length > 0) byStep[step] = list
  }
  return byStep
}

export function readProgress(storage: Storage = window.localStorage): ReviewProgress {
  try {
    const raw = storage.getItem(REVIEW_PROGRESS_KEY)
    if (!raw) return EMPTY_PROGRESS
    const value = JSON.parse(raw) as Partial<ReviewProgress>
    const step =
      typeof value.step === 'number' && value.step >= 0 && value.step < WEEKLY_REVIEW_STEPS.length
        ? Math.floor(value.step)
        : 0
    return {
      step,
      skipped: Array.isArray(value.skipped)
        ? value.skipped.filter((id) => WEEKLY_REVIEW_STEPS.includes(id))
        : [],
      shown: value.shown && typeof value.shown === 'object' ? value.shown : {},
      inboxShown: typeof value.inboxShown === 'number' ? value.inboxShown : null,
      dismissed: readDismissed(value.dismissed)
    }
  } catch {
    return EMPTY_PROGRESS
  }
}

export function writeProgress(progress: ReviewProgress, storage: Storage = window.localStorage) {
  try {
    storage.setItem(REVIEW_PROGRESS_KEY, JSON.stringify(progress))
  } catch {
    // Storage full or blocked: the review still works, it just will not resume.
  }
}

export function clearProgress(storage: Storage = window.localStorage) {
  try {
    storage.removeItem(REVIEW_PROGRESS_KEY)
  } catch {
    // Nothing to forget.
  }
}

/** The ids a step lists now, before Still on and Keep leave some out. */
export function stepIds(review: WeeklyReview, step: WeeklyReviewStepId): string[] {
  switch (step) {
    case 'inbox':
      return []
    case 'overdue':
    case 'blocked':
    case 'stale':
    case 'someday':
      return review[step].map((task) => task.id)
    case 'upcoming':
      return review.upcoming.flatMap((day) => [
        ...day.tasks.map((task) => task.id),
        ...day.milestones.map((milestone) => milestone.milestoneId)
      ])
    case 'milestones':
      return review.milestones.map((milestone) => milestone.milestoneId)
  }
}

/**
 * Each step's counts for Finish review: what it showed when first opened,
 * and how many of those are no longer in it (moved, closed, rescheduled).
 * Still on and Keep are not changes; a skipped or unopened step is left out.
 */
export function reviewCounts(
  progress: ReviewProgress,
  review: WeeklyReview
): WeeklyReviewRecord['steps'] {
  const steps: WeeklyReviewRecord['steps'] = {}
  for (const step of WEEKLY_REVIEW_STEPS) {
    if (progress.skipped.includes(step)) continue
    if (step === 'inbox') {
      if (progress.inboxShown === null) continue
      steps.inbox = {
        shown: progress.inboxShown,
        changed: Math.max(0, progress.inboxShown - review.inboxCount)
      }
      continue
    }
    const shown = progress.shown[step]
    if (!shown) continue
    const now = new Set(stepIds(review, step))
    const dismissed = new Set(progress.dismissed[step] ?? [])
    const changed = shown.filter((id) => !now.has(id) && !dismissed.has(id)).length
    steps[step] = { shown: shown.length, changed }
  }
  return steps
}
