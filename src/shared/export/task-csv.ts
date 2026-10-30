import type {
  EstimateUnit,
  PlanningColumnSettings,
  PlanningFieldDefinition,
  PlanningWorkItem,
  PlanningWorkItemStatus
} from '../ostler-api'
import {
  fieldColumnId,
  fieldIdOf,
  LIST_COLUMN_IDS,
  LIST_COLUMN_LABELS,
  type FieldColumnId,
  type ListColumnId
} from '../planning/list'
import { fieldValueText } from '../planning/custom-fields'
import { taskColumnLabel, taskPriorityLabel, taskStatusLabel } from '../task-labels'
import { csvHours } from '../time/duration'

/**
 * Tasks as CSV (P6.1): the current List view (its rows, in order, and its
 * visible columns) or every task. RFC 4180 (every field that needs it
 * quoted, quotes doubled, CRLF between records) and UTF-8 with a BOM, so
 * Excel opens accents correctly. The one writer: the app, "Export all
 * tasks" and `GET /export?format=csv` all call it. Its Checklist and Labels
 * read back in through the CSV import.
 */

/**
 * Every column the export knows: the List's, plus the description after the
 * title, plus a column per custom field (`field:<id>`, R2.2), headed with the
 * field's name.
 */
export type TaskCsvColumn =
  | ListColumnId
  | 'description'
  | FieldColumnId
  | 'timeLogged'
  /** The task's iteration (R6.1), once the project has any. */
  | 'iteration'
  /** The task's type by name (N2.7a), once the project has any. */
  | 'type'
  /** Hidden until this date (N1.1a), `YYYY-MM-DD`. */
  | 'showFrom'
  /** In Someday (N1.1a): "Yes" or empty. */
  | 'someday'
  /** An idea's scores (N1.1b): 1 to 5, or empty. */
  | 'impact'
  | 'effort'
  /** The task's id (N2.8): Edit in Excel writes it first, so Bring changes back can match rows. */
  | 'id'

export const TASK_CSV_COLUMNS: readonly TaskCsvColumn[] = [
  'title',
  'description',
  // The task's ID (N9.8a) leads "Export all tasks" instead (`allTaskCsvColumns`).
  // The workstream column is the List's own: the file has no column for it.
  ...LIST_COLUMN_IDS.filter((id) => id !== 'title' && id !== 'key' && id !== 'subproject')
]

export const TASK_CSV_LABELS: Record<ListColumnId | 'description', string> = {
  ...LIST_COLUMN_LABELS,
  description: 'Description'
}

export function isTaskCsvColumn(value: unknown): value is TaskCsvColumn {
  return (
    (TASK_CSV_COLUMNS as readonly unknown[]).includes(value) ||
    value === 'key' ||
    value === 'timeLogged' ||
    value === 'iteration' ||
    value === 'type' ||
    value === 'showFrom' ||
    value === 'someday' ||
    value === 'impact' ||
    value === 'effort' ||
    value === 'id' ||
    (typeof value === 'string' && fieldIdOf(value) !== null)
  )
}

/**
 * Every column, a project's custom fields included: what "Export all tasks"
 * writes. Iteration follows Milestone once the project has an iteration (R6.1),
 * and Type follows Priority once it has a task type (N2.7a). Impact and
 * Effort (N1.1b), then Show from and Someday (N1.1a), come before the custom
 * fields.
 */
export function allTaskCsvColumns(
  fields: readonly PlanningFieldDefinition[],
  { iterations = false, types = false }: { iterations?: boolean; types?: boolean } = {}
): TaskCsvColumn[] {
  // The task's ID (N9.8a) first; the database id stays Edit in Excel's own column.
  const columns: TaskCsvColumn[] = ['key', ...TASK_CSV_COLUMNS]
  if (iterations) columns.splice(columns.indexOf('milestone') + 1, 0, 'iteration')
  if (types) columns.splice(columns.indexOf('priority') + 1, 0, 'type')
  return [
    ...columns,
    'impact',
    'effort',
    'showFrom',
    'someday',
    ...fields.map((field) => fieldColumnId(field.id))
  ]
}

/** A column's header: its label, or a custom field's own name. Empty for a field that is gone. */
export function taskCsvHeader(
  column: TaskCsvColumn,
  context: Pick<TaskCsvContext, 'estimateUnit' | 'fields'>
): string {
  const fieldId = fieldIdOf(column)
  if (fieldId !== null) return context.fields?.find((field) => field.id === fieldId)?.name ?? ''
  if (column === 'timeLogged') return 'Time logged (hours)'
  if (column === 'iteration') return 'Iteration'
  if (column === 'type') return 'Type'
  if (column === 'showFrom') return 'Show from'
  if (column === 'someday') return 'Someday'
  // "(1-5)", so a plain "Effort" column from another tool still reads as an estimate on import.
  if (column === 'impact') return 'Impact (1-5)'
  if (column === 'effort') return 'Effort (1-5)'
  if (column === 'id') return 'ID'
  // "Task ID" (N9.8a), so it never reads as Edit in Excel's ID, which Bring changes back matches.
  if (column === 'key') return 'Task ID'
  if (column === 'estimate') return `${TASK_CSV_LABELS.estimate} (${context.estimateUnit})`
  return TASK_CSV_LABELS[column as ListColumnId | 'description']
}

export interface TaskCsvContext {
  personName: (personId: string) => string | null
  milestoneName: (milestoneId: string) => string | null
  /** An iteration's name (R6.1), for the Iteration column. */
  iterationName?: (iterationId: string) => string | null
  /** A task type's name (N2.7a), for the Type column. */
  typeName?: (typeId: string) => string | null
  commentCount: (taskId: string) => number
  projectedStatus?: (task: PlanningWorkItem) => PlanningWorkItemStatus
  estimateUnit: EstimateUnit
  /** The project's custom fields (R2.2), for their columns. */
  fields?: readonly PlanningFieldDefinition[]
  /** Seconds logged on each task (R2.3), for the Time logged column. */
  timeLogged?: (taskId: string) => number
  /** The project's column names (R2.4): the Status column writes them. */
  columns?: PlanningColumnSettings | null
}

const UTF8_BOM = '\ufeff'

/** A moment as local `YYYY-MM-DD HH:mm`, which Excel reads as a date and time. */
function moment(value: number): string {
  const date = new Date(value)
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** One task's value in one column, as the export and the printed List write it. */
export function taskCellText(
  task: PlanningWorkItem,
  column: TaskCsvColumn,
  context: TaskCsvContext
): string {
  const fieldId = fieldIdOf(column)
  if (fieldId !== null) {
    const field = context.fields?.find((candidate) => candidate.id === fieldId)
    return field ? fieldValueText(field, task.fieldValues?.[fieldId]) : ''
  }
  if (column === 'iteration')
    return task.iterationId ? (context.iterationName?.(task.iterationId) ?? '') : ''
  if (column === 'type') return task.typeId ? (context.typeName?.(task.typeId) ?? '') : ''
  if (column === 'showFrom') return task.showFrom ?? ''
  if (column === 'someday') return task.someday ? 'Yes' : ''
  if (column === 'impact') return task.impact == null ? '' : String(task.impact)
  if (column === 'effort') return task.effort == null ? '' : String(task.effort)
  if (column === 'id') return task.id
  if (column === 'key') return task.key ?? ''
  if (column === 'timeLogged') {
    const seconds = context.timeLogged?.(task.id) ?? 0
    return seconds > 0 ? csvHours(seconds) : ''
  }
  switch (column as ListColumnId | 'description') {
    case 'title':
      return task.title
    case 'description':
      return task.description
    case 'status': {
      // The project's own column (MOP-26) by its name; a run's status by the status's word.
      const status = context.projectedStatus?.(task) ?? task.status
      return status === task.status
        ? taskColumnLabel(task, context.columns)
        : taskStatusLabel(status, context.columns)
    }
    case 'priority':
      return taskPriorityLabel(task.priority)
    case 'assignee':
      return task.assigneeId ? (context.personName(task.assigneeId) ?? '') : ''
    case 'start':
      return task.startDate ?? ''
    case 'due':
      return task.targetDate ?? ''
    case 'estimate':
      return task.estimate === null ? '' : String(task.estimate)
    case 'milestone':
      return task.milestoneId ? (context.milestoneName(task.milestoneId) ?? '') : ''
    case 'labels':
      return task.labels.join('; ')
    case 'checklist':
      return task.acceptanceCriteria
        .map((text) => `${task.checkedCriteria.includes(text) ? '[x]' : '[ ]'} ${text}`)
        .join('\n')
    case 'comments':
      return String(context.commentCount(task.id))
    case 'updated':
      return moment(task.updatedAt)
    case 'created':
      return moment(task.createdAt)
    default:
      return ''
  }
}

/** Undoes `csvField`'s leading apostrophe, so a cell reads back as the task's text. */
export function csvCellText(value: string): string {
  return /^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value
}

/**
 * One field, quoted when it holds a comma, semicolon, quote or line break
 * (RFC 4180). Text that a spreadsheet would run as a formula (`=`, `+`, `-`,
 * `@` at the start) gets a leading apostrophe, so opening an export never
 * runs anything.
 */
export function csvField(value: string): string {
  let text = value
  if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+([.,]\d+)?$/.test(text)) text = `'${text}`
  return /[",;\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function csvRecord(values: string[]): string {
  return values.map(csvField).join(',')
}

/** The file's text: BOM, header, then a record per task, each line ending in CRLF. */
export function tasksToCsv(
  tasks: readonly PlanningWorkItem[],
  columns: readonly TaskCsvColumn[],
  context: TaskCsvContext
): string {
  const header = csvRecord(columns.map((column) => taskCsvHeader(column, context)))
  const records = tasks.map((task) =>
    csvRecord(columns.map((column) => taskCellText(task, column, context)))
  )
  return `${UTF8_BOM}${[header, ...records].join('\r\n')}\r\n`
}
