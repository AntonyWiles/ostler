import { shiftIsoDate } from '../dates'
import type { TaskFilter } from '../task-filter'

/**
 * The weekly review's lists (N1.5, N13) as task filters, through the one
 * `matchesFilter` every view and the automation API use. The review's
 * service reads each list across the enabled projects with them, and
 * `docs/automation-api/` names the same filters for `GET /work-items`.
 * Every list leaves out done, archived and deleted tasks.
 */

/** Blocked for longer than this joins the review (as the reports' at-risk section counts it). */
export const REVIEW_BLOCKED_DAYS = 3
/** Not updated for this many days joins "Nothing changed". */
export const REVIEW_STALE_DAYS = 14
/** "The next two weeks": today and the 13 days after it. */
export const REVIEW_UPCOMING_DAYS = 14

export type WeeklyReviewFilterStep = 'overdue' | 'blocked' | 'stale' | 'someday' | 'upcoming'

/** Each task step's filter for `today` (`YYYY-MM-DD`). */
export function weeklyReviewFilters(today: string): Record<WeeklyReviewFilterStep, TaskFilter> {
  return {
    // Overdue, as Home's Today counts it: assigned to Me or nobody, not in Someday.
    overdue: {
      match: 'all',
      conditions: [
        { field: 'due', op: 'is', value: 'overdue' },
        { field: 'assignee', op: 'is', value: ['me', 'nobody'] },
        { field: 'someday', op: 'is', value: false }
      ]
    },
    // How long each has waited comes from its status history, not a filter.
    blocked: { match: 'all', conditions: [{ field: 'status', op: 'is', value: ['blocked'] }] },
    stale: {
      match: 'all',
      conditions: [
        { field: 'status', op: 'isNot', value: ['done'] },
        { field: 'updated', op: 'before', value: shiftIsoDate(today, 1 - REVIEW_STALE_DAYS) },
        { field: 'someday', op: 'is', value: false },
        { field: 'showFrom', op: 'is', value: 'shown' }
      ]
    },
    someday: { match: 'all', conditions: [{ field: 'someday', op: 'is', value: true }] },
    upcoming: {
      match: 'all',
      conditions: [
        { field: 'status', op: 'isNot', value: ['done'] },
        { field: 'due', op: 'after', value: shiftIsoDate(today, -1) },
        { field: 'due', op: 'before', value: shiftIsoDate(today, REVIEW_UPCOMING_DAYS) },
        { field: 'someday', op: 'is', value: false }
      ]
    }
  }
}

/** Whole days from `since` to `now`, at least 0: "waited 5 days". */
export function daysWaited(since: number, now: number): number {
  return Math.max(0, Math.floor((now - since) / 86_400_000))
}
