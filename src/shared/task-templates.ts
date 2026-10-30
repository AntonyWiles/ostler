import { MAX_FIELD_TEXT_LENGTH, MAX_PROJECT_FIELDS } from './ostler-api/field-types'
import type { PlanningFieldValue, PlanningFieldValues } from './ostler-api/field-types'
import { MAX_ESTIMATE } from './ostler-api/people-types'
import { isAIEffortLevel } from './ostler-api/ai-types'
import { PLAN_FIRST_CHOICES, type PlanFirstChoice } from './plan-first'
import type {
  CreatePlanningWorkItemInput,
  PlanningPriority,
  PlanningWorkItem
} from './ostler-api/planning-types'
import {
  MAX_PLAYBOOK_INSTRUCTIONS,
  MAX_TASK_TEMPLATE_NAME_LENGTH,
  MAX_TASK_TEMPLATE_SUBTASKS,
  type TaskTemplateAgent,
  type TaskTemplateBody,
  type TaskTemplateChecklistDetail,
  type TaskTemplateOverrides,
  type TaskTemplateSubtask
} from './ostler-api/task-template-types'
import { compareIsoDates } from './dates'
import { isRelativeDate, relativePackageDate, resolvePackageDate } from './relative-dates'
import { Refusal } from './refusal'
import { t } from './i18n'

/**
 * Task templates (N2.1, N16): the one checker of a template's body, for the
 * app, the automation API and the project file alike, and the pure steps
 * around it — a task as a template, and a template as the tasks it makes.
 */

const PRIORITIES: readonly PlanningPriority[] = ['low', 'medium', 'high', 'critical']
const MAX_TITLE = 200
const MAX_DESCRIPTION = 8000
const MAX_CHECKLIST_ITEMS = 30
const MAX_CHECKLIST_TEXT = 500
const MAX_LABELS = 20
const MAX_LABEL = 80

type Shape = Record<string, unknown>

function refuse(key: string, values?: Record<string, unknown>): never {
  throw new Refusal(t(`errors:taskTemplates.${key}`, values))
}

function shape(value: unknown, key: string): Shape {
  if (!value || typeof value !== 'object' || Array.isArray(value)) refuse(key)
  return value as Shape
}

function onlyKeys(input: Shape, known: readonly string[]): void {
  for (const key of Object.keys(input))
    if (!known.includes(key)) refuse('unknownField', { field: key })
}

function requiredText(value: unknown, max: number, key: string, field = 'title'): string {
  if (typeof value !== 'string' || !value.trim()) refuse(key)
  if (value.trim().length > max) refuse('tooLong', { field, max })
  return value.trim()
}

function optionalText(value: unknown, max: number, field: string): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') refuse('mustBeText', { field })
  if (value.trim().length > max) refuse('tooLong', { field, max })
  return value.trim()
}

function textList(value: unknown, maxItems: number, maxLength: number, field: string): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) refuse('mustBeList', { field })
  if (value.length > maxItems) refuse('tooMany', { field, max: maxItems })
  const items = value.map((item) => {
    if (typeof item !== 'string' || !item.trim()) refuse('mustBeList', { field })
    if (item.trim().length > maxLength) refuse('tooLong', { field, max: maxLength })
    return item.trim()
  })
  return [...new Set(items)]
}

/** A day after the one the template is used on: `+3d`, `+2w`, or null. */
function relativeDay(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null
  if (!isRelativeDate(value)) refuse('dateInvalid', { field })
  return value
}

function fieldValue(value: unknown): PlanningFieldValue {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value === true) return true
  if (typeof value === 'string' && value.trim() && value.length <= MAX_FIELD_TEXT_LENGTH)
    return value
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => typeof entry === 'string' && entry.length > 0 && entry.length <= 100)
  )
    return [...value] as string[]
  return refuse('fieldValueInvalid')
}

function fieldValues(value: unknown): PlanningFieldValues {
  if (value === undefined || value === null) return {}
  const input = shape(value, 'fieldValuesInvalid')
  const keys = Object.keys(input)
  if (keys.length > MAX_PROJECT_FIELDS) refuse('fieldValuesInvalid')
  const result: PlanningFieldValues = {}
  for (const key of keys) {
    if (!key || key.length > 100) refuse('fieldValuesInvalid')
    result[key] = fieldValue(input[key])
  }
  return result
}

/** Checklist items' details (N2.2): items on the checklist, once each, with something set. */
function checklistDetails(value: unknown, checklist: string[]): TaskTemplateChecklistDetail[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > MAX_CHECKLIST_ITEMS) refuse('checklistDetailInvalid')
  const seen = new Set<string>()
  return value.flatMap((entry) => {
    const input = shape(entry, 'checklistDetailInvalid')
    onlyKeys(input, ['text', 'dueDate', 'assigneeId'])
    if (typeof input.text !== 'string') refuse('checklistDetailInvalid')
    const text = input.text.trim()
    if (!checklist.includes(text)) refuse('checklistDetailNotListed', { text })
    if (seen.has(text)) refuse('checklistDetailInvalid')
    seen.add(text)
    const assigneeId = input.assigneeId ?? null
    if (
      assigneeId !== null &&
      (typeof assigneeId !== 'string' || !assigneeId || assigneeId.length > 100)
    )
      refuse('assigneeInvalid')
    const dueDate = relativeDay(input.dueDate, 'checklistDetails.dueDate')
    if (dueDate === null && assigneeId === null) return []
    return [{ text, dueDate, assigneeId: assigneeId as string | null }]
  })
}

function parseSubtask(value: unknown): TaskTemplateSubtask {
  // A subtask is only a title, description and checklist: a subtask of a
  // subtask, or anything else, is refused (one level deep).
  const input = shape(value, 'subtaskInvalid')
  onlyKeys(input, ['title', 'description', 'checklist'])
  return {
    title: requiredText(input.title, MAX_TITLE, 'subtaskTitleRequired', 'subtasks.title'),
    description: optionalText(input.description, MAX_DESCRIPTION, 'description'),
    checklist: textList(input.checklist, MAX_CHECKLIST_ITEMS, MAX_CHECKLIST_TEXT, 'checklist')
  }
}

const MAX_MODEL = 200

/**
 * A playbook's agent part (N9.6b): a model and effort ('' is the default),
 * plan first, and extra instructions of up to 4,000 characters. Whether the
 * provider in effect offers the model, and whether it takes the effort, are
 * asked in main as Settings asks them (`validatePlaybookAgent`): this checks
 * only the shape, so a project file from another computer still reads.
 */
export function parseTaskTemplateAgent(value: unknown): TaskTemplateAgent {
  const input = shape(value, 'agentInvalid')
  onlyKeys(input, ['model', 'effort', 'planFirst', 'instructions'])
  const model = optionalText(input.model, MAX_MODEL, 'agent.model')
  const effort = input.effort ?? ''
  if (effort !== '' && !isAIEffortLevel(effort)) refuse('agentEffortInvalid')
  const planFirst = input.planFirst ?? 'default'
  if (!PLAN_FIRST_CHOICES.includes(planFirst as PlanFirstChoice)) refuse('agentPlanFirstInvalid')
  return {
    model,
    effort: effort as TaskTemplateAgent['effort'],
    planFirst: planFirst as PlanFirstChoice,
    instructions: optionalText(input.instructions, MAX_PLAYBOOK_INSTRUCTIONS, 'agent.instructions')
  }
}

const BODY_KEYS = [
  'title',
  'description',
  'checklist',
  'checklistDetails',
  'labels',
  'priority',
  'estimate',
  'assigneeId',
  'fieldValues',
  'startDate',
  'dueDate',
  'subtasks',
  'agent'
] as const

/**
 * Checks a template's body from any surface and returns it with every
 * optional field filled in. Refuses, in plain words, anything a template
 * cannot hold. Whether the assignee and fields still exist is checked when
 * it is used, not here: a template for every project cannot know them.
 */
export function parseTaskTemplateBody(value: unknown): TaskTemplateBody {
  const input = shape(value, 'bodyInvalid')
  onlyKeys(input, BODY_KEYS)
  const priority = input.priority ?? 'medium'
  if (typeof priority !== 'string' || !PRIORITIES.includes(priority as PlanningPriority))
    refuse('priorityInvalid')
  const estimate = input.estimate ?? null
  if (
    estimate !== null &&
    (typeof estimate !== 'number' ||
      !Number.isFinite(estimate) ||
      estimate < 0 ||
      estimate > MAX_ESTIMATE)
  )
    refuse('estimateInvalid', { max: MAX_ESTIMATE })
  const assigneeId = input.assigneeId ?? null
  if (
    assigneeId !== null &&
    (typeof assigneeId !== 'string' || !assigneeId || assigneeId.length > 100)
  )
    refuse('assigneeInvalid')
  const startDate = relativeDay(input.startDate, 'startDate')
  const dueDate = relativeDay(input.dueDate, 'dueDate')
  if (startDate && dueDate) {
    const day = '2000-01-01'
    if (compareIsoDates(resolvePackageDate(startDate, day)!, resolvePackageDate(dueDate, day)!) > 0)
      refuse('startAfterDue')
  }
  const subtasks = input.subtasks ?? []
  if (!Array.isArray(subtasks)) refuse('subtaskInvalid')
  if (subtasks.length > MAX_TASK_TEMPLATE_SUBTASKS)
    refuse('tooManySubtasks', { max: MAX_TASK_TEMPLATE_SUBTASKS })
  const checklist = textList(input.checklist, MAX_CHECKLIST_ITEMS, MAX_CHECKLIST_TEXT, 'checklist')
  const details = checklistDetails(input.checklistDetails, checklist)
  return {
    title: requiredText(input.title, MAX_TITLE, 'titleRequired'),
    description: optionalText(input.description, MAX_DESCRIPTION, 'description'),
    checklist,
    ...(details.length > 0 ? { checklistDetails: details } : {}),
    labels: textList(input.labels, MAX_LABELS, MAX_LABEL, 'labels'),
    priority: priority as PlanningPriority,
    estimate: estimate as number | null,
    assigneeId: assigneeId as string | null,
    fieldValues: fieldValues(input.fieldValues),
    startDate,
    dueDate,
    subtasks: subtasks.map(parseSubtask),
    ...(input.agent === undefined || input.agent === null
      ? {}
      : { agent: parseTaskTemplateAgent(input.agent) })
  }
}

/** A template's name: trimmed, 1 to 80 characters. */
export function parseTaskTemplateName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) refuse('nameRequired')
  if (value.trim().length > MAX_TASK_TEMPLATE_NAME_LENGTH)
    refuse('nameTooLong', { max: MAX_TASK_TEMPLATE_NAME_LENGTH })
  return value.trim()
}

/** Whether two template names clash: the same words, whatever their case. */
export function sameTemplateName(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase()
}

/**
 * A task, and its subtasks, as a template body. Dates become days after
 * `today` only with `keepDates`, and a date before `today` counts as today.
 * Date custom field values are kept the same way, or left out.
 */
export function taskTemplateBodyFrom(
  item: PlanningWorkItem,
  subtasks: PlanningWorkItem[],
  options: { keepDates: boolean; today: string; dateFieldIds?: ReadonlySet<string> }
): TaskTemplateBody {
  const day = (value: string | null): string | null => {
    if (!options.keepDates || !value) return null
    const offset = relativePackageDate(value, options.today)
    return offset && offset.startsWith('-') ? '+0d' : offset
  }
  const values: PlanningFieldValues = {}
  for (const [fieldId, value] of Object.entries(item.fieldValues ?? {})) {
    if (options.dateFieldIds?.has(fieldId)) {
      const shifted = typeof value === 'string' ? day(value) : null
      if (shifted) values[fieldId] = shifted
    } else values[fieldId] = value
  }
  const checklist = item.acceptanceCriteria.slice(0, MAX_CHECKLIST_ITEMS)
  return parseTaskTemplateBody({
    title: item.title,
    description: item.description,
    checklist,
    // An item's person always; its date only with `keepDates`, as the task's (N2.2).
    checklistDetails: (item.checklistDetails ?? [])
      .filter((detail) => checklist.includes(detail.text))
      .map((detail) => ({
        text: detail.text,
        dueDate: day(detail.dueDate),
        assigneeId: detail.assigneeId
      })),
    labels: item.labels,
    priority: item.priority,
    estimate: item.estimate,
    assigneeId: item.assigneeId,
    fieldValues: values,
    startDate: day(item.startDate),
    dueDate: day(item.targetDate),
    subtasks: subtasks.slice(0, MAX_TASK_TEMPLATE_SUBTASKS).map((subtask) => ({
      title: subtask.title,
      description: subtask.description,
      checklist: subtask.acceptanceCriteria.slice(0, MAX_CHECKLIST_ITEMS)
    }))
  })
}

/**
 * The new task a template makes on `today`, before anything the project
 * cannot take is dropped; `overrides` win over the template. Date custom
 * field values (`dateFieldIds`) are counted from `today` too.
 */
export function taskInputFromTemplate(
  body: TaskTemplateBody,
  today: string,
  overrides: TaskTemplateOverrides = {},
  dateFieldIds: ReadonlySet<string> = new Set()
): CreatePlanningWorkItemInput {
  const fieldValues: CreatePlanningWorkItemInput['fieldValues'] = {}
  for (const [fieldId, value] of Object.entries(body.fieldValues))
    fieldValues[fieldId] =
      dateFieldIds.has(fieldId) && typeof value === 'string'
        ? resolvePackageDate(value, today)
        : value
  return {
    title: body.title,
    description: body.description,
    priority: body.priority,
    labels: body.labels,
    acceptanceCriteria: body.checklist,
    estimate: body.estimate,
    assigneeId: body.assigneeId,
    startDate: resolvePackageDate(body.startDate, today),
    targetDate: resolvePackageDate(body.dueDate, today),
    ...overrides,
    fieldValues: { ...fieldValues, ...(overrides.fieldValues ?? {}) }
  }
}

/**
 * What New task's form shows when a template is chosen (N2.1): the template's
 * task on `today`, with what this project cannot take left empty, as using it
 * would. The person can still change any of it before Create.
 */
export function templateFormValues(
  body: TaskTemplateBody,
  today: string,
  project: { personIds: ReadonlySet<string>; fields: { id: string; type: string }[] }
): CreatePlanningWorkItemInput {
  const dateFieldIds = new Set(
    project.fields.filter((field) => field.type === 'date').map((field) => field.id)
  )
  const known = new Set(project.fields.map((field) => field.id))
  const input = taskInputFromTemplate(body, today, {}, dateFieldIds)
  const fieldValues: NonNullable<CreatePlanningWorkItemInput['fieldValues']> = {}
  for (const [fieldId, value] of Object.entries(input.fieldValues ?? {}))
    if (known.has(fieldId) && value !== null) fieldValues[fieldId] = value
  return {
    ...input,
    assigneeId:
      input.assigneeId && project.personIds.has(input.assigneeId) ? input.assigneeId : null,
    fieldValues
  }
}

/** The days a template's dates fall on when used `today`, for a preview. */
export function templateDatesOn(
  body: Pick<TaskTemplateBody, 'startDate' | 'dueDate'>,
  today: string
): { startDate: string | null; dueDate: string | null } {
  return {
    startDate: resolvePackageDate(body.startDate, today),
    dueDate: resolvePackageDate(body.dueDate, today)
  }
}
