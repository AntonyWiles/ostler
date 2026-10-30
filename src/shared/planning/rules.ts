import { isOneOf } from '../parse-primitives'
import {
  MAX_RULE_ACTIONS,
  MAX_RULE_CHECKLIST_ITEMS,
  MAX_RULE_COMMENT_LENGTH,
  MAX_RULE_CONDITIONS,
  MAX_RULE_MESSAGE_LENGTH,
  MAX_RULE_NAME_LENGTH,
  PLANNING_RULE_ACTION_KINDS,
  PLANNING_RULE_CONDITION_KINDS,
  PLANNING_RULE_TRIGGER_KINDS,
  type CreatePlanningRuleInput,
  type PlanningFieldValue,
  type PlanningPriority,
  type PlanningRule,
  type PlanningRuleAction,
  type PlanningRuleCondition,
  type PlanningRuleEffect,
  type PlanningRuleOperator,
  type PlanningRulePreview,
  type PlanningRuleTrigger,
  type PlanningWorkItem,
  type PlanningWorkItemStatus
} from '../ostler-api'
import { Refusal } from '../refusal'
import { t } from '../i18n'

/**
 * Rules (R6.2, D45): the one engine. Pure: it reads tasks and rules and says
 * which rules a change sets off and what each would do. `PlanningRules`
 * (electron/services/planning-rules.ts) applies the answer inside the
 * transaction of the change that set it off, so every surface shares it and
 * nothing else decides.
 */

export const RULE_STATUSES: readonly PlanningWorkItemStatus[] = [
  'backlog',
  'ready',
  'active',
  'blocked',
  'review',
  'done'
]
export const RULE_PRIORITIES: readonly PlanningPriority[] = ['low', 'medium', 'high', 'critical']
const OPERATORS: readonly PlanningRuleOperator[] = ['is', 'isNot']
const MAX_LABEL_LENGTH = 80
const MAX_CHECKLIST_ITEM_LENGTH = 500

/**
 * What happened to a task, as the triggers read it. The planning service
 * fills in what its write did; anything left out did not happen.
 */
export interface RuleChange {
  /** The task the rules look at and act on, as it is after the change. */
  task: PlanningWorkItem
  created?: boolean
  /**
   * The status or column changed (MOP-26), from this status (null for a new
   * task); the same status as the task's when only the column moved.
   */
  statusFrom?: PlanningWorkItemStatus | null
  /** With `statusFrom`: the custom column it left, or null for the status's own. */
  columnFrom?: string | null
  assigneeChanged?: boolean
  /** The checklist went from not complete to complete. */
  checklistCompleted?: boolean
  /** The task's last open subtask was just done. */
  subtasksDone?: boolean
  /** The task's due date was reached (the scheduled check). */
  dueDateReached?: boolean
}

/** Whether `trigger` fires for `change`. */
export function triggerFires(trigger: PlanningRuleTrigger, change: RuleChange): boolean {
  switch (trigger.kind) {
    case 'taskCreated':
      return change.created === true
    case 'statusChanged': {
      if (change.statusFrom === undefined || change.created) return false
      if (change.task.status !== trigger.to) return false
      if (trigger.toColumnId) {
        // Into that column: from another status, or from another column of it.
        const column = change.task.columnId ?? null
        if (column !== trigger.toColumnId) return false
        if (change.statusFrom === trigger.to && (change.columnFrom ?? null) === column) return false
      } else if (change.statusFrom === trigger.to) return false
      return trigger.from == null || trigger.from === change.statusFrom
    }
    case 'assigneeChanged':
      return change.assigneeChanged === true && !change.created
    case 'subtasksDone':
      return change.subtasksDone === true
    case 'checklistComplete':
      return change.checklistCompleted === true
    case 'dueDateReached':
      return change.dueDateReached === true
  }
}

function sameText(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

function fieldValueIs(actual: PlanningFieldValue | undefined, wanted: PlanningFieldValue): boolean {
  if (typeof wanted === 'boolean') return (actual === true) === wanted
  if (actual === undefined) return false
  if (Array.isArray(actual)) {
    const values = Array.isArray(wanted) ? wanted : [wanted]
    return values.every((value) => actual.includes(String(value)))
  }
  if (typeof actual === 'string' && typeof wanted === 'string') return sameText(actual, wanted)
  return actual === wanted
}

/** Whether the task meets one condition. */
export function conditionHolds(condition: PlanningRuleCondition, task: PlanningWorkItem): boolean {
  const holds = (() => {
    switch (condition.kind) {
      case 'label':
        return task.labels.some((label) => sameText(label, condition.label))
      case 'priority':
        return task.priority === condition.priority
      case 'assignee':
        return (task.assigneeId ?? null) === condition.personId
      case 'milestone':
        return (task.milestoneId ?? null) === condition.milestoneId
      case 'status':
        return (
          task.status === condition.status &&
          (!condition.columnId || (task.columnId ?? null) === condition.columnId)
        )
      case 'field':
        return fieldValueIs(task.fieldValues?.[condition.fieldId], condition.value)
    }
  })()
  return condition.op === 'isNot' ? !holds : holds
}

/** The rules `change` sets off, in the order given: on, triggered, and every condition met. */
export function matchingRules(rules: readonly PlanningRule[], change: RuleChange): PlanningRule[] {
  return rules.filter(
    (rule) =>
      rule.enabled &&
      triggerFires(rule.trigger, change) &&
      rule.conditions.every((condition) => conditionHolds(condition, change.task))
  )
}

/** The task fields a rule can write, and nothing else. */
export interface RuleTaskPatch {
  status?: PlanningWorkItemStatus
  /** With `status`: the project's own column (MOP-26), or null for the status's own. */
  columnId?: string | null
  priority?: PlanningPriority
  assigneeId?: string | null
  milestoneId?: string | null
  labels?: string[]
  acceptanceCriteria?: string[]
}

/** What one rule would do to one task. */
export interface RulePlan {
  /** Field changes, written as one update; empty when nothing changes. */
  patch: RuleTaskPatch
  comments: string[]
  /** One "Notify me" each; the text may be empty. */
  notices: string[]
  archive: boolean
  effects: PlanningRuleEffect[]
}

/**
 * What `actions` would do to `task`, one after another, each seeing what the
 * ones before it did. A task with agent work keeps the status its run gives
 * it (`src/shared/work-item-status.ts`), and archive takes only Done work
 * with no agent work, as a person's Archive does once a run is over.
 */
export function planActions(
  task: PlanningWorkItem,
  actions: readonly PlanningRuleAction[]
): RulePlan {
  const state = {
    status: task.status,
    columnId: task.columnId ?? null,
    priority: task.priority,
    assigneeId: task.assigneeId ?? null,
    milestoneId: task.milestoneId ?? null,
    labels: [...task.labels],
    acceptanceCriteria: [...task.acceptanceCriteria]
  }
  const patch: RuleTaskPatch = {}
  const plan: RulePlan = { patch, comments: [], notices: [], archive: false, effects: [] }
  const effect = (action: PlanningRuleAction, outcome: PlanningRuleEffect['outcome']) =>
    plan.effects.push({ action, outcome })
  for (const action of actions) {
    switch (action.kind) {
      case 'setStatus': {
        const columnId = action.columnId ?? null
        if (task.linkedHarnessTaskId) effect(action, 'agentWork')
        else if (state.status === action.status && state.columnId === columnId)
          effect(action, 'none')
        else {
          // The column only when one is named or left: a status alone is its own column.
          if (columnId !== null || state.columnId !== null) patch.columnId = columnId
          state.status = patch.status = action.status
          state.columnId = columnId
          effect(action, 'change')
        }
        break
      }
      case 'setPriority':
        if (state.priority === action.priority) effect(action, 'none')
        else {
          state.priority = patch.priority = action.priority
          effect(action, 'change')
        }
        break
      case 'setAssignee':
        if (state.assigneeId === action.personId) effect(action, 'none')
        else {
          state.assigneeId = patch.assigneeId = action.personId
          effect(action, 'change')
        }
        break
      case 'setMilestone':
        if (state.milestoneId === action.milestoneId) effect(action, 'none')
        else {
          state.milestoneId = patch.milestoneId = action.milestoneId
          effect(action, 'change')
        }
        break
      case 'addLabel':
        if (state.labels.some((label) => sameText(label, action.label))) effect(action, 'none')
        else {
          state.labels = patch.labels = [...state.labels, action.label]
          effect(action, 'change')
        }
        break
      case 'removeLabel':
        if (!state.labels.some((label) => sameText(label, action.label))) effect(action, 'none')
        else {
          state.labels = patch.labels = state.labels.filter(
            (label) => !sameText(label, action.label)
          )
          effect(action, 'change')
        }
        break
      case 'addChecklistItems': {
        const fresh = action.items.filter((item) => !state.acceptanceCriteria.includes(item))
        if (fresh.length === 0) effect(action, 'none')
        else {
          state.acceptanceCriteria = patch.acceptanceCriteria = [
            ...state.acceptanceCriteria,
            ...fresh
          ]
          effect(action, 'change')
        }
        break
      }
      case 'addComment':
        plan.comments.push(action.text)
        effect(action, 'change')
        break
      case 'notifyMe':
        plan.notices.push(action.message)
        effect(action, 'change')
        break
      case 'archive':
        if (task.archivedAt) effect(action, 'none')
        else if (task.linkedHarnessTaskId) effect(action, 'agentWork')
        else if (state.status !== 'done') effect(action, 'notDone')
        else {
          plan.archive = true
          effect(action, 'change')
        }
        break
    }
  }
  return plan
}

/** "Try it on a task…": whether the rule's conditions hold for the task, and what it would do. */
export function previewRule(
  rule: Pick<PlanningRule, 'conditions' | 'actions'>,
  task: PlanningWorkItem
): PlanningRulePreview {
  const conditions = rule.conditions.map((condition) => conditionHolds(condition, task))
  return {
    conditions,
    matches: conditions.every(Boolean),
    effects: planActions(task, rule.actions).effects
  }
}

/** Whether a plan writes anything at all. */
export function planDoesSomething(plan: RulePlan): boolean {
  return (
    Object.keys(plan.patch).length > 0 ||
    plan.comments.length > 0 ||
    plan.notices.length > 0 ||
    plan.archive
  )
}

// ─── Checking what arrives ─────────────────────────────────────────────────

type Shape = Record<string, unknown>

function refuse(key: string, values?: Record<string, unknown>): never {
  throw new Refusal(t(`errors:planningRules.${key}`, values))
}

function shape(value: unknown, key: string): Shape {
  if (!value || typeof value !== 'object' || Array.isArray(value)) refuse(key)
  return value as Shape
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], key: string): T {
  if (!isOneOf(value, allowed)) refuse(key)
  return value
}

function text(value: unknown, maximum: number, key: string, allowEmpty = false): string {
  if (typeof value !== 'string') refuse(key)
  const trimmed = value.trim()
  if ((!allowEmpty && !trimmed) || trimmed.length > maximum) refuse(key, { max: maximum })
  return trimmed
}

function idOrNull(value: unknown, key: string): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || !value.trim() || value.length > 100) refuse(key)
  return value
}

export function parseRuleName(value: unknown): string {
  return text(value, MAX_RULE_NAME_LENGTH, 'nameRequired')
}

export function parseRuleTrigger(value: unknown): PlanningRuleTrigger {
  const input = shape(value, 'triggerInvalid')
  const kind = oneOf(input.kind, PLANNING_RULE_TRIGGER_KINDS, 'triggerInvalid')
  if (kind !== 'statusChanged') return { kind } as PlanningRuleTrigger
  const to = oneOf(input.to, RULE_STATUSES, 'statusInvalid')
  const column = optionalColumnId(input.toColumnId)
  const toColumn = column ? { toColumnId: column } : {}
  if (input.from === undefined || input.from === null) return { kind, to, ...toColumn }
  const from = oneOf(input.from, RULE_STATUSES, 'statusInvalid')
  if (from === to) refuse('statusFromSame')
  return { kind, to, from, ...toColumn }
}

/** A column of the project's own (MOP-26) a rule names, or undefined for none. */
function optionalColumnId(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  return idOrNull(value, 'statusInvalid') ?? undefined
}

function parseFieldValue(value: unknown): PlanningFieldValue {
  if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)))
    return value
  if (typeof value === 'string' && value.trim() && value.length <= 500) return value.trim()
  refuse('fieldValueInvalid')
}

export function parseRuleCondition(value: unknown): PlanningRuleCondition {
  const input = shape(value, 'conditionInvalid')
  const kind = oneOf(input.kind, PLANNING_RULE_CONDITION_KINDS, 'conditionInvalid')
  const op = oneOf(input.op ?? 'is', OPERATORS, 'conditionInvalid')
  switch (kind) {
    case 'label':
      return { kind, op, label: text(input.label, MAX_LABEL_LENGTH, 'labelRequired') }
    case 'priority':
      return { kind, op, priority: oneOf(input.priority, RULE_PRIORITIES, 'priorityInvalid') }
    case 'assignee':
      return { kind, op, personId: idOrNull(input.personId ?? null, 'personInvalid') }
    case 'milestone':
      return { kind, op, milestoneId: idOrNull(input.milestoneId ?? null, 'milestoneInvalid') }
    case 'status': {
      const columnId = optionalColumnId(input.columnId)
      return {
        kind,
        op,
        status: oneOf(input.status, RULE_STATUSES, 'statusInvalid'),
        ...(columnId ? { columnId } : {})
      }
    }
    case 'field': {
      const fieldId = idOrNull(input.fieldId, 'fieldInvalid')
      if (fieldId === null) refuse('fieldInvalid')
      return { kind, op, fieldId, value: parseFieldValue(input.value) }
    }
  }
}

/**
 * Checks one action. Only the kinds in `PLANNING_RULE_ACTION_KINDS` exist;
 * anything else (an agent, the Library, AI, a delete, a web request) is
 * refused here, whatever surface it came from.
 */
export function parseRuleAction(value: unknown): PlanningRuleAction {
  const input = shape(value, 'actionInvalid')
  const kind = oneOf(input.kind, PLANNING_RULE_ACTION_KINDS, 'actionInvalid')
  switch (kind) {
    case 'setStatus': {
      const columnId = optionalColumnId(input.columnId)
      return {
        kind,
        status: oneOf(input.status, RULE_STATUSES, 'statusInvalid'),
        ...(columnId ? { columnId } : {})
      }
    }
    case 'setPriority':
      return { kind, priority: oneOf(input.priority, RULE_PRIORITIES, 'priorityInvalid') }
    case 'setAssignee':
      return { kind, personId: idOrNull(input.personId ?? null, 'personInvalid') }
    case 'setMilestone':
      return { kind, milestoneId: idOrNull(input.milestoneId ?? null, 'milestoneInvalid') }
    case 'addLabel':
    case 'removeLabel':
      return { kind, label: text(input.label, MAX_LABEL_LENGTH, 'labelRequired') }
    case 'addChecklistItems': {
      if (!Array.isArray(input.items)) refuse('checklistItemsRequired')
      const items = [
        ...new Set(
          input.items.map((item) => text(item, MAX_CHECKLIST_ITEM_LENGTH, 'checklistItemsRequired'))
        )
      ]
      if (items.length === 0 || items.length > MAX_RULE_CHECKLIST_ITEMS)
        refuse('checklistItemsCount', { max: MAX_RULE_CHECKLIST_ITEMS })
      return { kind, items }
    }
    case 'addComment':
      return { kind, text: text(input.text, MAX_RULE_COMMENT_LENGTH, 'commentRequired') }
    case 'notifyMe':
      return {
        kind,
        message: text(input.message ?? '', MAX_RULE_MESSAGE_LENGTH, 'messageTooLong', true)
      }
    case 'archive':
      return { kind }
  }
}

/** A whole rule as it arrives from any surface, checked; ids are checked by the service. */
export function parseRuleDefinition(input: unknown): Required<
  Pick<CreatePlanningRuleInput, 'name' | 'trigger' | 'conditions' | 'actions'>
> & {
  enabled: boolean
} {
  const body = shape(input, 'ruleInvalid')
  return {
    name: parseRuleName(body.name),
    enabled: body.enabled === undefined ? true : parseEnabled(body.enabled),
    trigger: parseRuleTrigger(body.trigger),
    conditions: parseRuleConditions(body.conditions ?? []),
    actions: parseRuleActions(body.actions)
  }
}

export function parseEnabled(value: unknown): boolean {
  if (typeof value !== 'boolean') refuse('enabledInvalid')
  return value
}

export function parseRuleConditions(value: unknown): PlanningRuleCondition[] {
  if (!Array.isArray(value)) refuse('conditionInvalid')
  if (value.length > MAX_RULE_CONDITIONS) refuse('tooManyConditions', { max: MAX_RULE_CONDITIONS })
  return value.map(parseRuleCondition)
}

export function parseRuleActions(value: unknown): PlanningRuleAction[] {
  if (!Array.isArray(value) || value.length === 0) refuse('actionsRequired')
  if (value.length > MAX_RULE_ACTIONS) refuse('tooManyActions', { max: MAX_RULE_ACTIONS })
  return value.map(parseRuleAction)
}
