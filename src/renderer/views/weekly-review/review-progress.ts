import { WEEKLY_REVIEW_STEPS } from '@shared/ostler-api'
import { EMPTY_PROGRESS, type ReviewProgress } from '@shared/planning/weekly-review-progress'

// The progress itself and its counts are shared with the Android app.
export {
  allDismissed,
  EMPTY_PROGRESS,
  reviewCounts,
  stepIds,
  type ReviewProgress
} from '@shared/planning/weekly-review-progress'

/** Where the desktop keeps the person's place in the review: the renderer's local storage. */
export const REVIEW_PROGRESS_KEY = 'ostler.weeklyReview.progress'

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
