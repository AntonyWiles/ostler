/**
 * Undo history (`change-history/history-service.ts`): every change the
 * person made in Ostler, step by step, across projects. Any step can be
 * undone on its own, leaving later changes as they are, and an undo can be
 * undone again (redo). Kept for `history.keepChangesDays`.
 */

/** What a step changed. A task's comments, checklist and the like count as the task. */
export const CHANGE_SUBJECT_KINDS = [
  'task',
  'milestone',
  'goal',
  'decision',
  'iteration',
  'label',
  'field',
  'taskType',
  'subproject',
  'template',
  'rule',
  'savedView',
  'column',
  'person',
  'contact',
  'cost',
  'billing',
  'budget',
  'dayOff',
  'pin',
  'reminder',
  'shoppingItem',
  'statusUpdate',
  'personalGoal',
  'weeklyReview',
  'baseline',
  'whiteboard',
  'team',
  'signOff'
] as const

export type ChangeSubjectKind = (typeof CHANGE_SUBJECT_KINDS)[number]

export type ChangeSubjectAction =
  'added' | 'changed' | 'removed' | 'restored' | 'archived' | 'unarchived'

/**
 * The parts of a task (or goal, baseline) that live in tables of their own:
 * a step that adds a comment changes the task's `comments`.
 */
export const CHANGE_ASPECTS = [
  'comments',
  'checklist',
  'dependencies',
  'customFields',
  'repeat',
  'blockers',
  'links',
  'contacts',
  'attachments',
  'sources',
  'myDay',
  'reminders',
  'time',
  'timeBlocks',
  'checkIns',
  'goalLinks',
  'baselineDates',
  'objects',
  'members',
  'following'
] as const

export type ChangeAspect = (typeof CHANGE_ASPECTS)[number]

export interface ChangeSubject {
  kind: ChangeSubjectKind
  id: string
  projectId: string | null
  /** Its title or name when the step was saved; null when it has none. */
  name: string | null
  action: ChangeSubjectAction
  /** For `changed`: the columns (`title`, `status`, …) and aspects (`comments`, …) it touched. */
  fields: string[]
}

/** What an entry is to the person: a change, an undo of one, or a redo (undoing an undo). */
export type ChangeEntryKind = 'change' | 'undo' | 'redo'

export interface ChangeHistoryEntry {
  id: string
  /** When the step began, and when its last edit landed (edits in a row join one step). */
  at: number
  lastAt: number
  kind: ChangeEntryKind
  /** The project all its changes belong to, or null for global changes or several projects. */
  projectId: string | null
  /**
   * What the step changed. For an undo or a redo, the change it took back or
   * put back, so it reads "Undid: Renamed …".
   */
  subjects: ChangeSubject[]
  /** How many things it changed; `subjects` holds the first few. */
  subjectCount: number
  /** For an undo or a redo: the entry it undid. */
  undoesId: string | null
  /** An undo still in force has taken this step out; undoing that undo is redo. */
  undoneById: string | null
}

export interface ChangeHistoryQuery {
  projectId?: string
  /** Matches the names in each step. */
  search?: string
  /** Only steps from this time on, in milliseconds. */
  since?: number
  /** The page cursor from `nextBefore`. */
  before?: string
  limit?: number
}

export interface ChangeHistoryPage {
  entries: ChangeHistoryEntry[]
  /** Pass as `before` for the next, older page; null at the end. */
  nextBefore: string | null
}

/** One value a step changed, for the entry's details. */
export interface ChangeDetail {
  kind: ChangeSubjectKind
  subjectId: string
  /** A column (`title`) or, for a part of a task, its aspect (`comments`). */
  field: string
  /** Whether the row was added, deleted or changed by the step. */
  action: 'added' | 'removed' | 'changed'
  /** The values as text, shortened; null for none. An id names what it points to. */
  before: string | null
  after: string | null
}

export interface ChangeUndoResult {
  /** The new undo (or redo) entry; null when there was nothing left to change. */
  entry: ChangeHistoryEntry | null
  /** Values put back. */
  reverted: number
  /** Values left as they are, because something changed them later. */
  kept: number
}

export interface ChangeHistoryStats {
  entries: number
  oldestAt: number | null
  /** Roughly how much room the history takes in the database. */
  bytes: number
}

/** What Clear removes: everything, or what is older than a time. */
export interface ChangeHistoryClear {
  olderThan?: number
  projectId?: string
}

/** The step the toolbar's Undo and Redo would act on, for their tooltips. */
export interface ChangeHistoryHead {
  undo: ChangeHistoryEntry | null
  redo: ChangeHistoryEntry | null
}
