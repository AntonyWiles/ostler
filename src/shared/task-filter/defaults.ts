/** First values for new conditions, and which conditions apply yet. */

import type { PlanningFieldDefinition } from '../ostler-api'
import { ITERATION_CURRENT } from '../planning/iterations'
import {
  ASSIGNEE_ME,
  type FilterOpSpec,
  NO_RECORD,
  type TaskFilter,
  type TaskFilterCondition,
  type TaskFilterField,
  type TaskFilterValue
} from './types'
import { CUSTOM_FIELD_OPS, CUSTOM_OPS, fieldSpec, opSpec } from './specs'
import { checkValue } from './parse'

/** The first condition "Add filter" makes for a custom field. */
export function defaultCustomCondition(field: PlanningFieldDefinition): TaskFilterCondition {
  const operator = CUSTOM_FIELD_OPS[field.type][0]
  return {
    field: 'custom',
    fieldId: field.id,
    op: operator.op,
    value: defaultValueOfKind(operator)
  }
}

/** A first value for an operator's kind, so a chip is valid (or nearly) as soon as it exists. */
export function defaultValueOfKind(operator: FilterOpSpec): TaskFilterValue {
  switch (operator.kind) {
    case 'text':
    case 'date':
      return ''
    case 'number':
      return 1
    case 'numberRange':
      return [0, 10]
    case 'presence':
      return 'empty'
    case 'options':
      return []
    case 'boolean':
      return true
    default:
      return ''
  }
}

/** A sensible first value for a new condition, so a chip is valid as soon as it exists. */
export function defaultCondition(field: TaskFilterField): TaskFilterCondition {
  const spec = fieldSpec(field)!
  const operator = spec.ops[0]
  const value: TaskFilterValue = (() => {
    switch (operator.kind) {
      case 'text':
        return ''
      case 'statuses':
        return ['done']
      case 'priorities':
        return ['high']
      case 'people':
        return [ASSIGNEE_ME]
      case 'labels':
      case 'contacts':
        return []
      case 'milestones':
      case 'goals':
      case 'types':
      case 'subprojects':
        return [NO_RECORD]
      case 'iterations':
        return [ITERATION_CURRENT]
      case 'relativeDate':
        return operator.relative![0]
      case 'date':
        return ''
      case 'number':
        return 1
      case 'estimatePresence':
        return 'set'
      case 'checklist':
        return 'incomplete'
      case 'resolution':
        return 'wont-do'
      case 'boolean':
        return true
      default:
        return defaultValueOfKind(operator)
    }
  })()
  return { field, op: operator.op, value }
}

/** Whether a condition is complete enough to apply (an empty list or text is not yet). */
export function isConditionComplete(condition: TaskFilterCondition): boolean {
  const operator =
    condition.field === 'custom'
      ? CUSTOM_OPS.find(
          (spec) => spec.op === condition.op && checkValue(spec, condition.value) === null
        )
      : opSpec(condition.field, condition.op)
  return (
    !!operator &&
    checkValue(operator, condition.value) === null &&
    !(operator.kind === 'text' && String(condition.value).trim() === '')
  )
}

/** The conditions that apply: incomplete ones (still being edited) are left out. */
export function effectiveFilter(filter: TaskFilter): TaskFilter {
  return { match: filter.match, conditions: filter.conditions.filter(isConditionComplete) }
}
