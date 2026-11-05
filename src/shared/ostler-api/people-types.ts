// ─── People and labels (P5.1) ───────────────────────────────────────────────

/**
 * Someone work can be assigned to. Ostler is single-user (D5): a person is a
 * record, not an account. People live in one of two places: the address book,
 * offered in every project, or one project's own people, offered only there
 * and removed with it. At most one person is Me, always in the address book.
 */
export interface Person {
  id: string
  name: string
  /** Up to three letters; derived from the name unless set. */
  initials: string
  /** `#rrggbb`, from the project palette by default. */
  color: string
  isMe: boolean
  /** Set while archived: their assignments stay, but pickers hide them. */
  archivedAt: number | null
  /**
   * Hours a week this person plans to work (D36), 0 to 168, or null when not
   * set. A planning number, not a promise about anyone.
   */
  weeklyCapacityHours: number | null
  /** Working days as ISO weekdays, 1 Monday to 7 Sunday, ascending; Monday to Friday by default. */
  workingDays: number[]
  /** The project whose own person this is; null for the address book. */
  projectId: string | null
  createdAt: number
  updatedAt: number
}

export interface CreatePersonInput {
  name: string
  /** Leave out to derive them from the name. */
  initials?: string
  /** Leave out for a stable palette colour. */
  color?: string
  /** Leave out or null for no capacity. */
  weeklyCapacityHours?: number | null
  /** Leave out for Monday to Friday. */
  workingDays?: number[]
  /** A project's own person; leave out or null for the address book. */
  projectId?: string | null
}

export interface UpdatePersonInput {
  name?: string
  /** An empty string goes back to initials derived from the name. */
  initials?: string
  color?: string
  /** null clears it. */
  weeklyCapacityHours?: number | null
  workingDays?: number[]
}

/** Where a person is used, for the warning before deleting them. */
export interface PersonUsage {
  /** Tasks that are theirs (assigned, a checklist item, a turn in a repeat), live or archived, by project. */
  projects: { projectId: string; tasks: number }[]
  /** Rules that name them: handed on with their tasks, or turned off. */
  rules: number
  isMe: boolean
  /** A member of a shared project: removed there first, not deleted here. */
  sharedMember: boolean
}

export interface DeletePersonOptions {
  /** Who takes their tasks; null leaves them unassigned. */
  giveTasksTo: string | null
}

/** The most hours a week can hold. */
export const MAX_WEEKLY_CAPACITY_HOURS = 168
/** Monday to Friday, as ISO weekdays. */
export const DEFAULT_WORKING_DAYS: readonly number[] = [1, 2, 3, 4, 5]

/** How a project counts estimates (D22). */
export type EstimateUnit = 'points' | 'hours'
export const ESTIMATE_UNITS: readonly EstimateUnit[] = ['points', 'hours']

/** The largest estimate a task may have, in either unit. */
export const MAX_ESTIMATE = 1000

/** A label used in a project, with its colour (stored, or a stable default). */
export interface PlanningLabel {
  name: string
  color: string
  /** Live and archived tasks that carry it. */
  taskCount: number
  /** Library items, archived ones too, that carry it as a tag. */
  libraryItemCount: number
  /** False while the colour is the default one rather than chosen. */
  hasColor: boolean
}

/**
 * What deleting a label took away, so the toast's Undo can put it back
 * exactly: the tasks that had it and the colour it had.
 */
export interface PlanningLabelDeletion {
  name: string
  color: string | null
  workItemIds: string[]
  /** Library items it was taken off; absent in a deletion from before Library tags were labels. */
  libraryItemIds?: string[]
}

// ─── Teams (team-leaders plan, D1) ──────────────────────────────────────────

/**
 * A named group of people from the address book, with an optional lead. A team is the
 * person's own organiser: it grants nothing, is not shared with a project's members, and
 * travels only between the person's own devices.
 */
export interface Team {
  id: string
  name: string
  /** #rrggbb, from the project palette by default. */
  color: string
  /** Who leads it, or null. */
  leadPersonId: string | null
  /** The people in it, in the order they were added. */
  memberIds: string[]
  position: number
  /** Set while archived: the team is hidden from filters. */
  archivedAt: number | null
}

export interface CreateTeamInput {
  name: string
  /** Leave out for a stable palette colour. */
  color?: string
  leadPersonId?: string | null
  memberIds?: string[]
}

export interface UpdateTeamInput {
  name?: string
  color?: string
  /** null clears it. */
  leadPersonId?: string | null
}

/** The longest team name. */
export const MAX_TEAM_NAME = 80
