/** Checking a filter that arrives from outside (the API, stored state). */

import { isIsoDate } from '../dates'
import { TASK_PRIORITIES, TASK_STATUSES } from '../task-labels'
import { columnIdOfKey } from '../board-columns'
import { ITERATION_CURRENT } from '../planning/iterations'
import { PLANNING_RESOLUTIONS } from '../ostler-api/planning-types'
import { isTaskContactRole } from '../contacts'
import {
  ASSIGNEE_ME,
  ASSIGNEE_NOBODY,
  EMPTY_TASK_FILTER,
  type FilterOpSpec,
  NO_RECORD,
  type RelativeDate,
  type TaskFilter,
  type TaskFilterCondition,
  type TaskFilterField,
  type TaskFilterOp,
  type TaskFilterValue
} from './types'
import { CUSTOM_OPS, FIELD_SPECS, fieldSpec } from './specs'

const MAX_CONDITIONS = 30
const MAX_LIST = 100

function isStringList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_LIST &&
    value.every((entry) => typeof entry === 'string' && entry.length > 0 && entry.length <= 200)
  )
}

export function checkValue(spec: FilterOpSpec, value: unknown): string | null {
  switch (spec.kind) {
    case 'text':
      return typeof value === 'string' && value.length <= 200
        ? null
        : 'a piece of text (up to 200 characters)'
    case 'statuses':
      return isStringList(value) &&
        value.length > 0 &&
        value.every(
          (entry) =>
            (TASK_STATUSES as readonly string[]).includes(entry) || columnIdOfKey(entry) !== null
        )
        ? null
        : `a list of statuses from: ${TASK_STATUSES.join(', ')}, or custom:<column id> for a column of the project's own (GET /columns)`
    case 'priorities':
      return isStringList(value) &&
        value.length > 0 &&
        value.every((entry) => (TASK_PRIORITIES as readonly string[]).includes(entry))
        ? null
        : `a list of priorities from: ${TASK_PRIORITIES.join(', ')}`
    case 'people':
      return isStringList(value) && value.length > 0
        ? null
        : `a list of person ids, "${ASSIGNEE_ME}" or "${ASSIGNEE_NOBODY}"`
    case 'labels':
      return isStringList(value) && value.length > 0 ? null : 'a list of labels'
    case 'milestones':
      return isStringList(value) && value.length > 0
        ? null
        : `a list of milestone ids or "${NO_RECORD}"`
    case 'goals':
      return isStringList(value) && value.length > 0 ? null : `a list of goal ids or "${NO_RECORD}"`
    case 'iterations':
      return isStringList(value) && value.length > 0
        ? null
        : `a list of iteration ids, "${ITERATION_CURRENT}" or "${NO_RECORD}"`
    case 'types':
      return isStringList(value) && value.length > 0
        ? null
        : `a list of task type ids or "${NO_RECORD}"`
    case 'subprojects':
      return isStringList(value) && value.length > 0
        ? null
        : `a list of sub-project ids or "${NO_RECORD}"`
    case 'contacts':
      return isStringList(value) &&
        value.length > 0 &&
        value.every((entry) => {
          const [id, role, extra] = entry.split(':')
          return id !== '' && extra === undefined && (role === undefined || isTaskContactRole(role))
        })
        ? null
        : 'a list of contact ids, each alone or as "<contact id>:<role>" (asked-for-it, supplier or other)'
    case 'relativeDate':
      return typeof value === 'string' && (spec.relative ?? []).includes(value as RelativeDate)
        ? null
        : `one of: ${(spec.relative ?? []).join(', ')}`
    case 'date':
      return isIsoDate(value) ? null : 'a date written YYYY-MM-DD'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? null : 'a number'
    case 'estimatePresence':
      return value === 'set' || value === 'empty' ? null : '"set" or "empty"'
    case 'checklist':
      return value === 'complete' || value === 'incomplete' ? null : '"complete" or "incomplete"'
    case 'resolution':
      return (PLANNING_RESOLUTIONS as readonly string[]).includes(String(value))
        ? null
        : `one of: ${PLANNING_RESOLUTIONS.join(', ')}`
    case 'boolean':
      return typeof value === 'boolean' ? null : 'true or false'
    case 'numberRange':
      return Array.isArray(value) &&
        value.length === 2 &&
        value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
        ? null
        : 'two numbers, [low, high]'
    case 'presence':
      return value === 'empty' || value === 'set' ? null : '"empty" or "set"'
    case 'options':
      return isStringList(value) && value.length > 0 ? null : 'a list of option ids'
  }
}

/**
 * A filter from untrusted input (a saved view, `?filter=`), checked field by
 * field. Throws an Error whose message says, in plain words, what is wrong.
 */
export function parseTaskFilter(raw: unknown): TaskFilter {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('A filter must be an object: { match: "all" | "any", conditions: [...] }')
  const input = raw as { match?: unknown; conditions?: unknown }
  const match = input.match ?? 'all'
  if (match !== 'all' && match !== 'any')
    throw new Error('A filter\'s match must be "all" or "any"')
  const list = input.conditions ?? []
  if (!Array.isArray(list)) throw new Error("A filter's conditions must be a list")
  if (list.length > MAX_CONDITIONS)
    throw new Error(`A filter can have at most ${MAX_CONDITIONS} conditions`)
  const conditions = list.map((entry, index): TaskFilterCondition => {
    const where = `Filter condition ${index + 1}`
    if (!entry || typeof entry !== 'object')
      throw new Error(`${where} must be an object: { field, op, value }`)
    const { field, op, value, fieldId } = entry as Record<string, unknown>
    if (field === 'custom') return parseCustomCondition(where, op, value, fieldId)
    const spec = fieldSpec(field as TaskFilterField)
    if (!spec)
      throw new Error(
        `${where}: unknown field "${String(field)}". Use one of: ${FIELD_SPECS.map((s) => s.field).join(', ')}, custom`
      )
    const operator = spec.ops.find((candidate) => candidate.op === op)
    if (!operator)
      throw new Error(
        `${where}: "${spec.field}" can't use "${String(op)}". Use one of: ${spec.ops.map((s) => s.op).join(', ')}`
      )
    const problem = checkValue(operator, value)
    if (problem)
      throw new Error(`${where}: the value for "${spec.field} ${operator.op}" must be ${problem}`)
    return {
      field: spec.field,
      op: operator.op,
      value: Array.isArray(value) ? [...new Set(value as string[])] : (value as TaskFilterValue)
    }
  })
  return { match, conditions }
}

/**
 * A custom field condition from untrusted input: `{ field: "custom", fieldId,
 * op, value }`. The value must fit one of the operator's kinds; whether the
 * field still exists is the view's business (a deleted field matches only
 * "is empty").
 */
function parseCustomCondition(
  where: string,
  op: unknown,
  value: unknown,
  fieldId: unknown
): TaskFilterCondition {
  if (typeof fieldId !== 'string' || fieldId.length === 0 || fieldId.length > 200)
    throw new Error(`${where}: a "custom" condition needs the field's id as "fieldId"`)
  const specs = CUSTOM_OPS.filter((spec) => spec.op === op)
  if (specs.length === 0)
    throw new Error(
      `${where}: "custom" can't use "${String(op)}". Use one of: ${[
        ...new Set(CUSTOM_OPS.map((spec) => spec.op))
      ].join(', ')}`
    )
  const problems = specs.map((spec) => checkValue(spec, value))
  if (problems.every((problem) => problem !== null))
    throw new Error(
      `${where}: the value for "custom ${String(op)}" must be ${[...new Set(problems)].join(' or ')}`
    )
  return {
    field: 'custom',
    fieldId,
    op: op as TaskFilterOp,
    value:
      Array.isArray(value) && value.every((entry) => typeof entry === 'string')
        ? [...new Set(value as string[])]
        : (value as TaskFilterValue)
  }
}

/** `parseTaskFilter` that falls back to no filter, for stored state the renderer reads. */
export function normalizeTaskFilter(raw: unknown): TaskFilter {
  try {
    return parseTaskFilter(raw)
  } catch {
    return EMPTY_TASK_FILTER
  }
}
