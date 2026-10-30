/** A filter's words: the chips and the API's summaries. */

import type { PlanningPriority, PlanningWorkItemStatus } from '../ostler-api'
import { taskPriorityLabel, taskStatusLabel } from '../task-labels'
import { t } from '../i18n'
import { columnIdOfKey, customColumns } from '../board-columns'
import { ITERATION_CURRENT } from '../planning/iterations'
import { contactRoleLabel, isTaskContactRole } from '../contacts'
import {
  ASSIGNEE_ME,
  ASSIGNEE_NOBODY,
  type FilterNames,
  NO_RECORD,
  type RelativeDate,
  type TaskFilterCondition
} from './types'
import { RELATIVE_DATE_LABELS, customOpSpec, fieldSpec, opSpec } from './specs'

/** One value as words: a status, a priority, a person, "no milestone". */
export function describeValue(
  condition: Pick<TaskFilterCondition, 'field'>,
  value: string,
  names: FilterNames = {}
): string {
  switch (condition.field) {
    case 'status': {
      const columnId = columnIdOfKey(value)
      if (columnId === null) return taskStatusLabel(value as PlanningWorkItemStatus, names.columns)
      return (
        customColumns(names.columns).find((column) => column.id === columnId)?.name ??
        t('tasks:taskFilter.deletedColumn')
      )
    }
    case 'priority':
      return taskPriorityLabel(value as PlanningPriority)
    case 'assignee':
      if (value === ASSIGNEE_ME) return 'me'
      if (value === ASSIGNEE_NOBODY) return 'nobody'
      return names.person?.(value) ?? t('tasks:taskFilter.someoneRemoved')
    case 'milestone':
      return value === NO_RECORD
        ? t('tasks:taskFilter.noMilestone')
        : (names.milestone?.(value) ?? t('tasks:taskFilter.deletedMilestone'))
    case 'goal':
      return value === NO_RECORD
        ? t('tasks:taskFilter.noGoal')
        : (names.goal?.(value) ?? t('tasks:taskFilter.deletedGoal'))
    case 'iteration':
      if (value === ITERATION_CURRENT) return t('tasks:taskFilter.currentIteration')
      return value === NO_RECORD
        ? t('tasks:taskFilter.noIteration')
        : (names.iteration?.(value) ?? t('tasks:taskFilter.deletedIteration'))
    case 'type':
      return value === NO_RECORD
        ? t('tasks:taskFilter.noType')
        : (names.taskType?.(value) ?? t('tasks:taskFilter.deletedType'))
    case 'subproject':
      return value === NO_RECORD
        ? t('tasks:taskFilter.noSubproject')
        : (names.subproject?.(value) ?? t('tasks:taskFilter.deletedSubproject'))
    case 'contact': {
      const [contactId, role] = value.split(':')
      const name = names.contact?.(contactId) ?? t('tasks:taskFilter.deletedContact')
      return isTaskContactRole(role)
        ? t('tasks:taskFilter.contactInRole', { name, role: contactRoleLabel(role) })
        : name
    }
    default:
      return value
  }
}

function joinWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? ''
  if (words.length === 2) return t('tasks:taskFilter.or', { words: words[0], words2: words[1] })
  return t('tasks:taskFilter.or2', {
    join: words.slice(0, -1).join(', '),
    words: words[words.length - 1]
  })
}

/** A condition as a chip's words: "Due is this week", "Priority is High or Critical". */
export function describeCondition(condition: TaskFilterCondition, names: FilterNames = {}): string {
  if (condition.field === 'custom') return describeCustomCondition(condition, names)
  const spec = fieldSpec(condition.field)
  const operator = opSpec(condition.field, condition.op)
  if (!spec || !operator) return t('tasks:taskFilter.unknownFilter')
  const { value } = condition
  let words: string
  if (Array.isArray(value)) {
    const parts = (value as unknown[])
      .map(String)
      .map((entry) => describeValue(condition, entry, names))
    words = condition.op === 'hasAll' ? parts.join(' and ') : joinWords(parts)
  } else if (operator.kind === 'relativeDate') words = RELATIVE_DATE_LABELS[value as RelativeDate]
  else if (operator.kind === 'boolean') words = value ? 'yes' : 'no'
  else if (operator.kind === 'resolution') words = t('tasks:taskFilter.wontDo')
  else if (operator.kind === 'text') words = `"${String(value)}"`
  else words = String(value)
  return `${spec.label} ${operator.label} ${words}`
}

/** A custom field condition's words: "Room is one of Kitchen or Hall", "Version between 1 and 3". */
function describeCustomCondition(condition: TaskFilterCondition, names: FilterNames): string {
  const field = condition.fieldId ? names.customField?.(condition.fieldId) : undefined
  if (!field) return t('tasks:taskFilter.deletedField')
  const operator = customOpSpec(field, condition.op)
  if (!operator) return t('tasks:taskFilter.unknownFilter')
  const { value } = condition
  let words: string
  switch (operator.kind) {
    case 'options': {
      const parts = (Array.isArray(value) ? value : []).map(
        (id) =>
          field.options.find((option) => option.id === id)?.name ??
          t('tasks:taskFilter.deletedOption')
      )
      words = condition.op === 'hasAll' ? parts.join(' and ') : joinWords(parts)
      break
    }
    case 'numberRange': {
      const [low, high] = Array.isArray(value) ? value : []
      words = t('tasks:taskFilter.andRange', { low, high })
      break
    }
    case 'presence':
      return value === 'set'
        ? t('tasks:taskFilter.isSetWords', { field: field.name })
        : t('tasks:taskFilter.isEmptyWords', { field: field.name })
    case 'boolean':
      words = value ? 'yes' : 'no'
      break
    case 'text':
      words = `"${String(value)}"`
      break
    default:
      words = String(value)
  }
  return `${field.name} ${operator.label} ${words}`
}
