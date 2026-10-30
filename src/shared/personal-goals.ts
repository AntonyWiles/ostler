import {
  goalProgress,
  summedCheckIns,
  type GoalMeasure,
  type GoalProgress,
  type LinkMismatch,
  type LinkedReadings
} from './goal-measures'

/**
 * Goals across projects (N5.6b, N41): goals of one's own, outside any
 * project ("Save £5,000", "Read 24 books"), in the global Goals view. They
 * have the same optional measure and check-ins as a project goal, and project
 * goals with the same unit and direction can count towards them. Shared by
 * every project, as people are, and never in a project file.
 */

export type PersonalGoalStatus = 'active' | 'achieved' | 'dropped'

export const PERSONAL_GOAL_STATUSES: readonly PersonalGoalStatus[] = [
  'active',
  'achieved',
  'dropped'
]

export const MAX_PERSONAL_GOAL_TITLE_LENGTH = 160
export const MAX_PERSONAL_GOAL_OUTCOME_LENGTH = 4000

export interface PersonalGoal {
  id: string
  title: string
  outcome: string
  status: PersonalGoalStatus
  /** Its number: the same measure a project goal has (N5.6a); null without one. */
  measure: GoalMeasure | null
  createdAt: number
  updatedAt: number
}

/** One reading of a goal of one's own. At most one a day. */
export interface PersonalGoalCheckIn {
  personalGoalId: string
  /** `YYYY-MM-DD` */
  date: string
  value: number
  note: string
  recordedAt: number
}

/** A project goal counting towards a goal of one's own, as the Goals view shows it. */
export interface PersonalGoalLink {
  goalId: string
  projectId: string
  title: string
  measure: GoalMeasure | null
  /** Its latest value (its start value before a check-in); null without a measure. */
  latest: number | null
  /**
   * Why it does not count now: its measure was taken away, or changed to
   * another unit or direction after it was linked. Null while it counts.
   */
  mismatch: LinkMismatch | null
  createdAt: number
}

/** A goal of one's own with everything the Goals view shows, read in one call. */
export interface PersonalGoalView extends PersonalGoal {
  /** Its own check-ins, oldest first. They count only while no project goal does. */
  checkIns: PersonalGoalCheckIn[]
  /** The project goals linked to it, in the order they were linked. */
  links: PersonalGoalLink[]
  /** True when its number comes from linked project goals rather than its own check-ins. */
  fromLinks: boolean
  /** What its chart and progress read: its own check-ins, or the linked goals' summed. */
  readings: { date: string; value: number }[]
  /** Its progress today; null without a measure. */
  progress: GoalProgress | null
}

export interface CreatePersonalGoalInput {
  title: string
  outcome?: string
  measure?: GoalMeasure | null
}

export interface UpdatePersonalGoalInput {
  title?: string
  outcome?: string
  status?: PersonalGoalStatus
  /** null takes the measure away; its check-ins are kept. */
  measure?: GoalMeasure | null
}

/** A deleted goal of one's own, as it was: Undo puts all of it back. */
export interface DeletedPersonalGoal {
  goal: PersonalGoal
  checkIns: PersonalGoalCheckIn[]
  links: { goalId: string; projectId: string; createdAt: number }[]
}

/** What a project goal counts towards (N5.6b), for its card. */
export interface GoalCountsTowards {
  goalId: string
  personalGoalId: string
  title: string
  /** False when its unit or direction no longer match, so it does not count now. */
  counts: boolean
}

/** A project goal that could count towards a goal of one's own: the Add a project goal picker. */
export interface LinkableProjectGoal {
  goalId: string
  projectId: string
  title: string
  measure: GoalMeasure
  /** The goal of one's own it counts towards already, or null. */
  personalGoalId: string | null
}

/** What setting a project goal's link did: the link before, for Undo. */
export interface SetCountsTowardsResult {
  goalId: string
  personalGoalId: string | null
  previous: string | null
}

/**
 * The one progress rule for a goal of one's own (N5.6b): with linked project
 * goals that count, the sum of their latest values; without, its own
 * check-ins. Either way N5.6a's `goalProgress` reads them.
 */
export function personalGoalProgress(
  measure: GoalMeasure | null,
  own: readonly { date: string; value: number }[],
  counting: readonly LinkedReadings[],
  today: string
): Pick<PersonalGoalView, 'fromLinks' | 'readings' | 'progress'> {
  const fromLinks = counting.length > 0
  const readings = fromLinks
    ? summedCheckIns(counting)
    : own.map((checkIn) => ({ date: checkIn.date, value: checkIn.value }))
  return {
    fromLinks,
    readings,
    progress: measure ? goalProgress(measure, readings, today) : null
  }
}

/** Active goals first, then achieved, then dropped; within each, the newest first. */
export function sortPersonalGoals<T extends Pick<PersonalGoal, 'status' | 'createdAt'>>(
  goals: readonly T[]
): T[] {
  const rank = (status: PersonalGoalStatus) => PERSONAL_GOAL_STATUSES.indexOf(status)
  return [...goals].sort(
    (left, right) => rank(left.status) - rank(right.status) || right.createdAt - left.createdAt
  )
}
