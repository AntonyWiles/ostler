/** `matchesFilter`, the one implementation of a filter. */

import { isoWeekday, shiftIsoDate, toIsoDate } from '../dates'
import { columnIdOfKey } from '../board-columns'
import { ITERATION_CURRENT } from '../planning/iterations'
import { isHiddenNow } from '../planning/show-from'
import {
  ASSIGNEE_ME,
  ASSIGNEE_NOBODY,
  type FilterableTask,
  NO_RECORD,
  type RelativeDate,
  type TaskFilter,
  type TaskFilterCondition,
  type TaskFilterContext,
  type TaskFilterOp,
  type TaskFilterValue
} from './types'

/** Whether `task` meets `filter`. The one implementation (see the file comment). */
export function matchesFilter(
  task: FilterableTask,
  filter: TaskFilter,
  ctx: TaskFilterContext
): boolean {
  if (filter.conditions.length === 0) return true
  const test = (condition: TaskFilterCondition) => matchesCondition(task, condition, ctx)
  return filter.match === 'any' ? filter.conditions.some(test) : filter.conditions.every(test)
}

/** Weeks run Monday to Sunday (ISO 8601), as the List's due groups do. */
function weekStartOf(date: string): string {
  return shiftIsoDate(date, -((isoWeekday(date) + 6) % 7))
}

function matchesDate(
  date: string | null,
  op: TaskFilterOp,
  value: TaskFilterValue,
  ctx: TaskFilterContext,
  done: boolean
): boolean {
  if (op === 'before') return date !== null && date < String(value)
  if (op === 'after') return date !== null && date > String(value)
  const today = ctx.today
  switch (value as RelativeDate) {
    case 'none':
      return date === null
    case 'any':
      return date !== null
    case 'today':
      return date === today
    case 'overdue':
      return date !== null && date < today && !done
    case 'thisWeek': {
      if (date === null) return false
      const start = weekStartOf(today)
      return date >= start && date <= shiftIsoDate(start, 6)
    }
    case 'next7Days':
      return date !== null && date > today && date <= shiftIsoDate(today, 7)
    case 'last7Days':
      return date !== null && date <= today && date > shiftIsoDate(today, -7)
    default:
      return false
  }
}

function inList(
  actual: string | null,
  values: string[],
  noneValue: string,
  op: TaskFilterOp
): boolean {
  const found = values.some((value) => (value === noneValue ? actual === null : value === actual))
  return op === 'isNot' ? !found : found
}

function matchesCondition(
  task: FilterableTask,
  condition: TaskFilterCondition,
  ctx: TaskFilterContext
): boolean {
  const { op, value } = condition
  const status = ctx.projectedStatus ? ctx.projectedStatus(task) : task.status
  const list = Array.isArray(value) ? (value as unknown[]).map(String) : []
  switch (condition.field) {
    case 'text': {
      const needle = String(value).trim().toLowerCase()
      if (!needle) return true
      const found = [task.title, task.description, ...task.labels, ...task.acceptanceCriteria].some(
        (text) => text.toLowerCase().includes(needle)
      )
      return op === 'notContains' ? !found : found
    }
    case 'status': {
      // A status takes every task counting as it, its own columns' too; a
      // column of the project's own (`custom:<id>`, MOP-26) only its tasks.
      const column = status === task.status ? (task.columnId ?? null) : null
      const found = list.some((entry) => {
        const columnId = columnIdOfKey(entry)
        return columnId === null ? entry === status : columnId === column
      })
      return op === 'isNot' ? !found : found
    }
    case 'priority':
      return inList(task.priority, list, '', op)
    case 'assignee': {
      const ids = list.map((entry) => (entry === ASSIGNEE_ME ? (ctx.meId ?? '\u0000no-me') : entry))
      return inList(task.assigneeId, ids, ASSIGNEE_NOBODY, op)
    }
    case 'labels': {
      if (op === 'hasAll') return list.every((label) => task.labels.includes(label))
      const any = list.some((label) => task.labels.includes(label))
      return op === 'hasNone' ? !any : any
    }
    case 'milestone':
      return inList(task.milestoneId, list, NO_RECORD, op)
    case 'subproject':
      return inList(task.subprojectId ?? null, list, NO_RECORD, op)
    case 'goal':
      return inList(ctx.goalIdForTask ? ctx.goalIdForTask(task) : null, list, NO_RECORD, op)
    case 'iteration': {
      // With no current iteration, "current" matches no task.
      const ids = list.map((entry) =>
        entry === ITERATION_CURRENT ? (ctx.currentIterationId ?? '\u0000no-iteration') : entry
      )
      return inList(task.iterationId ?? null, ids, NO_RECORD, op)
    }
    case 'type':
      return inList(task.typeId ?? null, list, NO_RECORD, op)
    case 'due':
      return matchesDate(task.targetDate, op, value, ctx, status === 'done')
    case 'start':
      return matchesDate(task.startDate, op, value, ctx, status === 'done')
    case 'created':
      return matchesDate(toIsoDate(new Date(task.createdAt)), op, value, ctx, false)
    case 'updated':
      return matchesDate(toIsoDate(new Date(task.updatedAt)), op, value, ctx, false)
    case 'estimate':
      return matchesNumber(task.estimate, op, value)
    case 'impact':
      return matchesNumber(task.impact ?? null, op, value)
    case 'effort':
      return matchesNumber(task.effort ?? null, op, value)
    case 'checklist': {
      const total = task.acceptanceCriteria.length
      if (total === 0) return false
      const complete = task.checkedCriteria.length >= total
      return value === 'complete' ? complete : !complete
    }
    case 'hasComments': {
      const has = (ctx.commentCount ? ctx.commentCount(task) : 0) > 0
      return has === value
    }
    case 'recurring':
      return Boolean(task.recurring) === value
    case 'showFrom':
      if (value === 'hidden' || value === 'shown')
        return isHiddenNow(task, ctx.today) === (value === 'hidden')
      return matchesDate(task.showFrom ?? null, op, value, ctx, false)
    case 'someday':
      return Boolean(task.someday) === value
    case 'inTriage':
      return Boolean(task.inTriage) === value
    case 'resolution': {
      const is = (task.resolution ?? null) === value
      return op === 'isNot' ? !is : is
    }
    case 'contact': {
      const named = ctx.contactsOf ? ctx.contactsOf(task) : []
      const found = list.some((entry) => {
        const [contactId, role] = entry.split(':')
        return named.some(
          (link) => link.contactId === contactId && (role === undefined || link.role === role)
        )
      })
      return op === 'hasNone' ? !found : found
    }
    case 'custom':
      return matchesCustom(task, condition)
    default: {
      // A field added to `TaskFilterField` without a case here fails the typecheck.
      const unhandled: never = condition.field
      void unhandled
      return false
    }
  }
}

/**
 * A custom field condition (R2.2). The operator and the value's shape say
 * what to compare, so no field definition is needed here: a field's type
 * never changes, and a deleted field's values are gone (only "is empty"
 * still matches).
 */
function matchesCustom(task: FilterableTask, condition: TaskFilterCondition): boolean {
  const { op, value } = condition
  const actual = condition.fieldId ? task.fieldValues?.[condition.fieldId] : undefined
  const list = Array.isArray(value) ? (value as unknown[]).map(String) : []
  switch (op) {
    case 'isEmpty':
      return value === 'set' ? actual !== undefined : actual === undefined
    case 'contains':
    case 'notContains': {
      const needle = String(value).trim().toLowerCase()
      if (!needle) return true
      const found = typeof actual === 'string' && actual.toLowerCase().includes(needle)
      return op === 'notContains' ? !found : found
    }
    case 'equals':
    case 'lessThan':
    case 'greaterThan':
    case 'between': {
      if (typeof actual !== 'number') return false
      if (op === 'equals') return actual === Number(value)
      if (op === 'lessThan') return actual < Number(value)
      if (op === 'greaterThan') return actual > Number(value)
      const [low, high] = (value as number[]).map(Number)
      return actual >= Math.min(low, high) && actual <= Math.max(low, high)
    }
    case 'before':
      return typeof actual === 'string' && actual < String(value)
    case 'after':
      return typeof actual === 'string' && actual > String(value)
    case 'is':
    case 'isNot': {
      if (typeof value === 'boolean') return (actual === true) === value
      const found = typeof actual === 'string' && list.includes(actual)
      return op === 'isNot' ? !found : found
    }
    case 'hasAny':
    case 'hasAll':
    case 'hasNone': {
      const chosen = Array.isArray(actual) ? actual : []
      if (op === 'hasAll') return list.every((id) => chosen.includes(id))
      const any = list.some((id) => chosen.includes(id))
      return op === 'hasNone' ? !any : any
    }
    default:
      return false
  }
}

/** "is set/empty", equals, less than, greater than, for a number that may be null. */
function matchesNumber(n: number | null, op: string, value: unknown): boolean {
  if (op === 'is') return value === 'set' ? n !== null : n === null
  if (n === null) return false
  const target = Number(value)
  if (op === 'equals') return n === target
  if (op === 'lessThan') return n < target
  return n > target
}
