/** The filter model's types and its special values. */

import type {
  PlanningColumnSettings,
  PlanningFieldDefinition,
  PlanningWorkItem,
  PlanningWorkItemStatus
} from '../ostler-api'

export type TaskFilterField =
  | 'text'
  | 'status'
  | 'priority'
  | 'assignee'
  | 'labels'
  | 'milestone'
  | 'goal'
  /** The iteration a task is in (R6.1): ids, "none", or "current". */
  | 'iteration'
  /** The task's type (N2.7a): type ids or "none". */
  | 'type'
  /** The workstream a task is in: sub-project ids or "none". */
  | 'subproject'
  | 'due'
  | 'start'
  | 'estimate'
  | 'checklist'
  | 'hasComments'
  | 'recurring'
  /** How a closed task ended (N1.2): "wont-do". For the Archive and `?scope=archived`. */
  | 'resolution'
  /**
   * The show-from date (N1.1a): "hidden" or "shown" (through `isHiddenNow`,
   * so a Someday task is hidden too), "today", "none", "any", before or after.
   */
  | 'showFrom'
  /** In Someday (N1.1a): true or false. */
  | 'someday'
  /** Waiting in To triage (N4.3a): true or false. */
  | 'inTriage'
  /** An idea's scores (N1.1b): set or empty, equals, less than, greater than. */
  | 'impact'
  | 'effort'
  | 'created'
  | 'updated'
  /**
   * The contacts a task names (N6.5): each value is a contact id (in any
   * role) or `<contact id>:<role>` (in that role).
   */
  | 'contact'
  /** A project's custom field (R2.2): the condition's `fieldId` says which. */
  | 'custom'

export type TaskFilterOp =
  | 'contains'
  | 'notContains'
  | 'is'
  | 'isNot'
  | 'hasAny'
  | 'hasAll'
  | 'hasNone'
  | 'before'
  | 'after'
  | 'equals'
  | 'lessThan'
  | 'greaterThan'
  | 'between'
  | 'isEmpty'

export type TaskFilterValue = string | number | boolean | string[] | number[]

export interface TaskFilterCondition {
  field: TaskFilterField
  op: TaskFilterOp
  value: TaskFilterValue
  /** For `field: 'custom'`: the custom field's id. */
  fieldId?: string
}

export interface TaskFilter {
  match: 'all' | 'any'
  conditions: TaskFilterCondition[]
}

export const EMPTY_TASK_FILTER: TaskFilter = { match: 'all', conditions: [] }

/** Relative date values. `next7Days` is the seven days after today, as Home's Upcoming. */
export type RelativeDate =
  | 'today'
  | 'overdue'
  | 'thisWeek'
  | 'next7Days'
  | 'last7Days'
  | 'none'
  | 'any'
  /** Show from only (N1.1a): hidden today, by `isHiddenNow`. */
  | 'hidden'
  /** Show from only (N1.1a): not hidden today. */
  | 'shown'

/** Special values in an assignee list. */
export const ASSIGNEE_ME = 'me'
export const ASSIGNEE_NOBODY = 'nobody'
/** Special value in a milestone or goal list. */
export const NO_RECORD = 'none'

/** What kind of value an operator takes: the FilterBuilder shows the matching editor. */
export type FilterValueKind =
  | 'text'
  | 'statuses'
  | 'priorities'
  | 'people'
  | 'labels'
  | 'milestones'
  | 'goals'
  /** Iteration ids, "none" or "current" (R6.1). */
  | 'iterations'
  /** Task type ids or "none" (N2.7a). */
  | 'types'
  /** Sub-project ids or "none". */
  | 'subprojects'
  | 'relativeDate'
  | 'date'
  | 'number'
  | 'estimatePresence'
  | 'checklist'
  | 'boolean'
  /** Two numbers, low and high, both included. */
  | 'numberRange'
  /** "empty" or "set". */
  | 'presence'
  /** A custom Choice or Choices field's option ids. */
  | 'options'
  /** A resolution (N1.2): "wont-do". */
  | 'resolution'
  /** Contact ids, each alone or with `:<role>` (N6.5). */
  | 'contacts'

export interface FilterOpSpec {
  op: TaskFilterOp
  label: string
  kind: FilterValueKind
  /** For `relativeDate`: the values this field offers. */
  relative?: readonly RelativeDate[]
}

export interface FilterFieldSpec {
  field: TaskFilterField
  label: string
  ops: readonly FilterOpSpec[]
}

/** The fields a task needs for filtering; `recurring` comes from the repeat table. */
export type FilterableTask = Pick<
  PlanningWorkItem,
  | 'id'
  | 'title'
  | 'description'
  | 'status'
  | 'columnId'
  | 'priority'
  | 'labels'
  | 'acceptanceCriteria'
  | 'checkedCriteria'
  | 'milestoneId'
  | 'targetDate'
  | 'startDate'
  | 'assigneeId'
  | 'estimate'
  | 'createdAt'
  | 'updatedAt'
  | 'iterationId'
  | 'typeId'
  | 'subprojectId'
  | 'resolution'
  | 'showFrom'
  | 'someday'
  | 'inTriage'
  | 'impact'
  | 'effort'
> & { recurring?: boolean; fieldValues?: PlanningWorkItem['fieldValues'] }

export interface TaskFilterContext {
  /** Local today, `YYYY-MM-DD`. */
  today: string
  /** Me's person id, for "assignee is me"; null when there is no Me. */
  meId: string | null
  /** The status the views show (an agent run can move it ahead of the stored one). */
  projectedStatus?: (task: FilterableTask) => PlanningWorkItemStatus
  /** The goal a task is under (through its milestone). */
  goalIdForTask?: (task: FilterableTask) => string | null
  /** Comments on a task. */
  commentCount?: (task: FilterableTask) => number
  /**
   * The project's current iteration (R6.1, `currentIteration`), for
   * "iteration is current"; null or absent when it has none.
   */
  currentIterationId?: string | null
  /** The contacts a task names, with their roles (N6.5). */
  contactsOf?: (task: FilterableTask) => readonly { contactId: string; role: string }[]
}

/** Names for ids, so a chip says "Assignee is Sam" rather than an id. */
export interface FilterNames {
  person?: (id: string) => string | undefined
  milestone?: (id: string) => string | undefined
  goal?: (id: string) => string | undefined
  /** An iteration's name by id (R6.1). */
  iteration?: (id: string) => string | undefined
  /** A task type's name by id (N2.7a). */
  taskType?: (id: string) => string | undefined
  /** A sub-project's (workstream's) name by id. */
  subproject?: (id: string) => string | undefined
  /** A contact's name by id (N6.5). */
  contact?: (id: string) => string | undefined
  /** A custom field by id (R2.2), for its name and option names. */
  customField?: (id: string) => PlanningFieldDefinition | undefined
  /** The project's column settings (R2.4): status words, and the statuses offered. */
  columns?: PlanningColumnSettings | null
}
