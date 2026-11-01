import type { WeeklyReview, WeeklyReviewRecord, WeeklyReviewStepId } from '../ostler-api'
import { WEEKLY_REVIEW_STEPS } from '../ostler-api'

/**
 * Where a person is in the weekly review (N1.5), kept by each app (the
 * desktop in local storage, not config), so leaving half-way and coming back opens the
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
