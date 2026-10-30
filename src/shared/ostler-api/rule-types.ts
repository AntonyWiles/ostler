import type { PlanningFieldValue } from './field-types'
import type { PlanningPriority, PlanningWorkItemStatus } from './planning-types'

// ─── Rules (R6.2, D45) ──────────────────────────────────────────────────────

/** A project has at most this many rules (D45). */
export const MAX_RULES_PER_PROJECT = 50
export const MAX_RULE_NAME_LENGTH = 80
export const MAX_RULE_CONDITIONS = 10
export const MAX_RULE_ACTIONS = 10
/** "Add checklist items" adds at most this many, each up to 500 characters. */
export const MAX_RULE_CHECKLIST_ITEMS = 10
/** A comment a rule adds, and a "Notify me" message. */
export const MAX_RULE_COMMENT_LENGTH = 2000
export const MAX_RULE_MESSAGE_LENGTH = 200

/**
 * What sets a rule off (D45). The due-date trigger is checked while Ostler
 * runs, on the reminder service's schedule, once per task per due date.
 */
export type PlanningRuleTrigger =
  | { kind: 'taskCreated' }
  /**
   * To `to`; with `from`, only from that status. With `toColumnId`, into
   * that column of the project's own (MOP-26), which counts as `to`.
   */
  | {
      kind: 'statusChanged'
      to: PlanningWorkItemStatus
      from?: PlanningWorkItemStatus | null
      toColumnId?: string
    }
  | { kind: 'assigneeChanged' }
  /** Every subtask of the task is Done; the rule acts on the parent. */
  | { kind: 'subtasksDone' }
  | { kind: 'checklistComplete' }
  | { kind: 'dueDateReached' }

export type PlanningRuleTriggerKind = PlanningRuleTrigger['kind']

export const PLANNING_RULE_TRIGGER_KINDS: readonly PlanningRuleTriggerKind[] = [
  'taskCreated',
  'statusChanged',
  'assigneeChanged',
  'subtasksDone',
  'checklistComplete',
  'dueDateReached'
]

export type PlanningRuleOperator = 'is' | 'isNot'

/** A condition on the task; every condition of a rule must hold. */
export type PlanningRuleCondition =
  | { kind: 'label'; op: PlanningRuleOperator; label: string }
  | { kind: 'priority'; op: PlanningRuleOperator; priority: PlanningPriority }
  /** `personId` null is "nobody". */
  | { kind: 'assignee'; op: PlanningRuleOperator; personId: string | null }
  /** `milestoneId` null is "no milestone". */
  | { kind: 'milestone'; op: PlanningRuleOperator; milestoneId: string | null }
  /** With `columnId`, in that column of the project's own (MOP-26), which counts as `status`. */
  | {
      kind: 'status'
      op: PlanningRuleOperator
      status: PlanningWorkItemStatus
      columnId?: string
    }
  /** A custom field's value (R2.2): a choice option id, a number, text, a date or a tick. */
  | { kind: 'field'; op: PlanningRuleOperator; fieldId: string; value: PlanningFieldValue }

export type PlanningRuleConditionKind = PlanningRuleCondition['kind']

export const PLANNING_RULE_CONDITION_KINDS: readonly PlanningRuleConditionKind[] = [
  'label',
  'priority',
  'assignee',
  'milestone',
  'status',
  'field'
]

/**
 * What a rule does (D45). This union is the whole of it: there is no member
 * that queues work for agents, starts or stops runs, touches the harness,
 * deletes, reads or writes the Library, calls Ostler AI or sends anything off
 * the PC, so no rule can be made to.
 */
export type PlanningRuleAction =
  /** With `columnId`, into that column of the project's own (MOP-26), which counts as `status`. */
  | { kind: 'setStatus'; status: PlanningWorkItemStatus; columnId?: string }
  | { kind: 'setPriority'; priority: PlanningPriority }
  | { kind: 'setAssignee'; personId: string | null }
  | { kind: 'setMilestone'; milestoneId: string | null }
  | { kind: 'addLabel'; label: string }
  | { kind: 'removeLabel'; label: string }
  | { kind: 'addChecklistItems'; items: string[] }
  | { kind: 'addComment'; text: string }
  /** An Inbox item and a desktop notification, on this PC. */
  | { kind: 'notifyMe'; message: string }
  /** Archives the task if it is Done; does nothing otherwise. */
  | { kind: 'archive' }

export type PlanningRuleActionKind = PlanningRuleAction['kind']

export const PLANNING_RULE_ACTION_KINDS: readonly PlanningRuleActionKind[] = [
  'setStatus',
  'setPriority',
  'setAssignee',
  'setMilestone',
  'addLabel',
  'removeLabel',
  'addChecklistItems',
  'addComment',
  'notifyMe',
  'archive'
]

export interface PlanningRule {
  id: string
  projectId: string
  name: string
  enabled: boolean
  trigger: PlanningRuleTrigger
  conditions: PlanningRuleCondition[]
  actions: PlanningRuleAction[]
  /** When it last did something, or null. */
  lastRunAt: number | null
  /** How many times it has done something. */
  runCount: number
  createdAt: number
  updatedAt: number
}

export interface CreatePlanningRuleInput {
  name: string
  enabled?: boolean
  trigger: PlanningRuleTrigger
  conditions?: PlanningRuleCondition[]
  actions: PlanningRuleAction[]
}

export type UpdatePlanningRuleInput = Partial<CreatePlanningRuleInput>

/** What deleting a rule took, for its undo. */
export interface PlanningRuleDeletion {
  rule: PlanningRule
}

/** What one action would do to a task, for "Try it on a task…". */
export interface PlanningRuleEffect {
  action: PlanningRuleAction
  /**
   * `change`: it would change the task. `none`: the task is already that way.
   * `agentWork`: the task's status follows its agent work, so a rule leaves
   * it. `notDone`: archive only takes a Done task.
   */
  outcome: 'change' | 'none' | 'agentWork' | 'notDone'
}

/** "Try it on a task…": what the rule would do to one task, without doing it. */
export interface PlanningRulePreview {
  /** Each condition, in order: whether the task meets it. */
  conditions: boolean[]
  /** Whether every condition holds, so the actions would run. */
  matches: boolean
  effects: PlanningRuleEffect[]
}

/**
 * On a task a write returns, when rules acted because of that write: the
 * run's id (pass it as `undoRuleRun` with the undoing update to undo what
 * the rules did too) and the rules that ran.
 */
export interface PlanningRuleRunSummary {
  id: string
  ruleNames: string[]
}
