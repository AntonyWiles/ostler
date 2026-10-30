import { isScore } from '../planning/idea-scores'
import type {
  CsvColumnMap,
  CsvField,
  CsvFieldTarget,
  CsvImportOptions,
  CsvUpdateFieldChange,
  CsvUpdateNewRow,
  CsvUpdatePreview,
  CsvUpdateProblem,
  CsvUpdateSkipReason,
  CsvUpdateSkippedRow,
  CsvUpdateTask,
  EstimateUnit,
  PlanningColumnSettings,
  PlanningFieldDefinition,
  PlanningFieldValue,
  PlanningWorkItem,
  UpdatePlanningWorkItemInput
} from '../ostler-api'
import {
  allTaskCsvColumns,
  csvCellText,
  taskCellText,
  taskCsvHeader,
  type TaskCsvColumn,
  type TaskCsvContext
} from '../export/task-csv'
import { fieldIdOf } from '../planning/list'
import { parseFieldValueText } from '../planning/custom-fields'
import { customColumnFromWord, statusFromColumnWord } from '../board-columns'
import { customColumnOf, TASK_PRIORITIES, taskPriorityLabel } from '../task-labels'
import { t } from '../i18n'
import {
  analyzeCsv,
  CSV_FIELDS,
  emptyColumnMap,
  guessColumns,
  parseCsv,
  parseImportDate
} from './csv-import'
import { normaliseHeader } from './csv-presets'
import { cleanImportedText, LIMITS, type ImportKnownRecords, type ImportPlan } from './import-plan'

/**
 * Bring changes back (N2.8, N23): a CSV that Edit in Excel wrote, edited in a
 * spreadsheet, read back. Rows are matched to tasks by the ID column; each
 * cell is compared with what the export writes for the task, so only fields
 * that really differ count. A row without an ID is a new task, read by the
 * CSV import itself. Nothing is ever deleted, and a cell that cannot be read
 * leaves its field alone. Pure, so the app, the automation API and the tests
 * share it.
 */

/** What the matcher knows about the project. */
export interface CsvUpdateContext {
  /** The project's live tasks. */
  tasks: readonly PlanningWorkItem[]
  /** Why an id that is not a live task of the project is not: archived, elsewhere, or unknown. */
  lookup(id: string): 'archived' | 'otherProject' | null
  people: readonly { id: string; name: string }[]
  milestones: readonly { id: string; name: string }[]
  iterations: readonly { id: string; name: string }[]
  /** The project's task types (N2.7a); absent reads as none. */
  taskTypes?: readonly { id: string; name: string }[]
  fields: readonly PlanningFieldDefinition[]
  columns: PlanningColumnSettings | null
  estimateUnit: EstimateUnit
}

/** One task's change: what to send to `updateWorkItem`. */
export interface CsvTaskUpdate {
  taskId: string
  title: string
  updates: UpdatePlanningWorkItemInput
  columns: string[]
}

export interface CsvUpdateAnalysis {
  preview: CsvUpdatePreview
  updates: CsvTaskUpdate[]
  /** New rows, as the import's plan (lines without an ID only). */
  plan: ImportPlan
}

/** Columns the sheet shows but a person cannot change from it. */
const READ_ONLY: ReadonlySet<string> = new Set([
  'id',
  'key',
  'comments',
  'updated',
  'created',
  'timeLogged'
])

/** The CSV import's field for each editable export column. */
const IMPORT_FIELD: Partial<Record<TaskCsvColumn, CsvField>> = {
  title: 'title',
  description: 'description',
  status: 'status',
  priority: 'priority',
  assignee: 'assignee',
  start: 'start',
  due: 'due',
  estimate: 'estimate',
  milestone: 'milestone',
  iteration: 'iteration',
  type: 'type',
  labels: 'labels',
  checklist: 'checklist',
  showFrom: 'showFrom',
  someday: 'someday',
  impact: 'impact',
  effort: 'effort'
}

const lower = (value: string) => value.trim().toLowerCase()

/**
 * Each header's column, read back with the function that wrote it
 * (`taskCsvHeader`): exact name first, then the CSV import's own guess for
 * a header a person retyped ("Estimate").
 */
export function csvUpdateColumns(
  headers: readonly string[],
  context: Pick<TaskCsvContext, 'estimateUnit' | 'fields'>
): (TaskCsvColumn | null)[] {
  const known: TaskCsvColumn[] = [
    'id',
    ...allTaskCsvColumns(context.fields ?? [], { iterations: true, types: true }),
    'timeLogged'
  ]
  const byHeader = new Map<string, TaskCsvColumn>()
  for (const column of known) {
    const header = taskCsvHeader(column, context)
    if (header && !byHeader.has(lower(header))) byHeader.set(lower(header), column)
  }
  const result = headers.map((header) => byHeader.get(lower(header)) ?? null)
  if (!result.includes('id')) {
    const index = headers.findIndex((header) => normaliseHeader(header) === 'id')
    if (index >= 0) result[index] = 'id'
  }
  const guessed = guessColumns([...headers])
  for (const [column, field] of Object.entries(IMPORT_FIELD) as [TaskCsvColumn, CsvField][]) {
    const index = guessed[field]
    if (index != null && result[index] === null && !result.includes(column)) result[index] = column
  }
  return result
}

const TRUE_WORDS = ['yes', 'true', 'y', '1', 'x', '✓']
const FALSE_WORDS = ['', 'no', 'false', 'n', '0']

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function splitList(value: string, separators: RegExp): string[] {
  return value
    .split(separators)
    .map((part) => part.trim())
    .filter(Boolean)
}

function sameFieldValue(a: PlanningFieldValue | null | undefined, b: PlanningFieldValue | null) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

class Unreadable extends Error {}

/**
 * Reads one cell for one column of a task: the update it makes, `null` when
 * it changes nothing, or `Unreadable` with the reason.
 */
function readCell(
  column: TaskCsvColumn,
  text: string,
  task: PlanningWorkItem,
  context: CsvUpdateContext,
  dateFormat: CsvImportOptions['dateFormat']
): UpdatePlanningWorkItemInput | null {
  const value = text.trim()
  const byName = <T extends { name: string }>(list: readonly T[]) =>
    list.find((entry) => lower(entry.name) === lower(value))
  const date = (current: string | null | undefined) => {
    if (!value) return current ? null : undefined
    const parsed = parseImportDate(value, dateFormat ?? 'iso')
    if (!parsed) throw new Unreadable(t('data:editInExcel.notDate', { text: value }))
    return parsed === current ? undefined : parsed
  }
  const fieldId = fieldIdOf(column)
  if (fieldId !== null) {
    const field = context.fields.find((candidate) => candidate.id === fieldId)
    if (!field) return null
    let parsed: PlanningFieldValue | null
    try {
      parsed = parseFieldValueText(field, value)
    } catch {
      throw new Unreadable(t('data:editInExcel.notFieldValue', { name: field.name, text: value }))
    }
    if (sameFieldValue(task.fieldValues?.[fieldId], parsed)) return null
    return { fieldValues: { [fieldId]: parsed } }
  }
  switch (column) {
    case 'title': {
      const title = value.replace(/\s+/g, ' ')
      if (!title) throw new Unreadable(t('data:editInExcel.titleEmpty'))
      if (title.length > LIMITS.title) throw new Unreadable(t('data:editInExcel.tooLong'))
      return title === task.title ? null : { title }
    }
    case 'description': {
      const description = cleanImportedText(text).trim()
      if (description.length > LIMITS.description)
        throw new Unreadable(t('data:editInExcel.tooLong'))
      return description === task.description.trim() ? null : { description }
    }
    case 'status': {
      if (!value) throw new Unreadable(t('data:editInExcel.noSuchStatus', { text: value }))
      // A column of the project's own (MOP-26) is its status and that column.
      const custom = customColumnFromWord(value, context.columns)
      const status = custom?.countsAs ?? statusFromColumnWord(value, context.columns)
      if (!status) throw new Unreadable(t('data:editInExcel.noSuchStatus', { text: value }))
      const columnId = custom?.id ?? null
      const current = customColumnOf(task, context.columns)?.id ?? null
      return status === task.status && columnId === current ? null : { status, columnId }
    }
    case 'priority': {
      const priority = TASK_PRIORITIES.find(
        (candidate) =>
          candidate === lower(value) || lower(taskPriorityLabel(candidate)) === lower(value)
      )
      if (!priority) throw new Unreadable(t('data:editInExcel.noSuchPriority', { text: value }))
      return priority === task.priority ? null : { priority }
    }
    case 'assignee': {
      // A changed row never adds a person, so a typo cannot make one.
      const assigneeId = value ? byName(context.people)?.id : null
      if (assigneeId === undefined)
        throw new Unreadable(t('data:editInExcel.noSuchPerson', { text: value }))
      return assigneeId === (task.assigneeId ?? null) ? null : { assigneeId }
    }
    case 'milestone': {
      const milestoneId = value ? byName(context.milestones)?.id : null
      if (milestoneId === undefined)
        throw new Unreadable(t('data:editInExcel.noSuchMilestone', { text: value }))
      return milestoneId === (task.milestoneId ?? null) ? null : { milestoneId }
    }
    case 'iteration': {
      const iterationId = value ? byName(context.iterations)?.id : null
      if (iterationId === undefined)
        throw new Unreadable(t('data:editInExcel.noSuchIteration', { text: value }))
      return iterationId === (task.iterationId ?? null) ? null : { iterationId }
    }
    case 'type': {
      const typeId = value ? byName(context.taskTypes ?? [])?.id : null
      if (typeId === undefined)
        throw new Unreadable(t('data:editInExcel.noSuchType', { text: value }))
      return typeId === (task.typeId ?? null) ? null : { typeId }
    }
    case 'start': {
      const startDate = date(task.startDate)
      return startDate === undefined ? null : { startDate }
    }
    case 'due': {
      const targetDate = date(task.targetDate)
      return targetDate === undefined ? null : { targetDate }
    }
    case 'showFrom': {
      const showFrom = date(task.showFrom)
      return showFrom === undefined ? null : { showFrom }
    }
    case 'someday': {
      const word = lower(value)
      const someday = TRUE_WORDS.includes(word) ? true : FALSE_WORDS.includes(word) ? false : null
      if (someday === null) throw new Unreadable(t('data:editInExcel.notYesNo', { text: value }))
      return someday === Boolean(task.someday) ? null : { someday }
    }
    case 'impact':
    case 'effort': {
      const score = value ? Number(value) : null
      if (score !== null && !isScore(score))
        throw new Unreadable(t('data:editInExcel.notScore', { text: value }))
      return score === (task[column] ?? null) ? null : { [column]: score }
    }
    case 'estimate': {
      const number = value
        ? Number(value.replace(/\s*(pts?|points?|h|hrs?|hours?)$/i, '').replace(',', '.'))
        : null
      if (number !== null && (!Number.isFinite(number) || number < 0 || number > LIMITS.estimate))
        throw new Unreadable(t('data:editInExcel.notEstimate', { text: value }))
      return number === task.estimate ? null : { estimate: number }
    }
    case 'labels': {
      const labels = [...new Set(splitList(value, /[;,]/))]
      if (labels.length > LIMITS.labels || labels.some((label) => label.length > LIMITS.label))
        throw new Unreadable(t('data:editInExcel.tooLong'))
      return sameList([...labels].sort(), [...task.labels].sort()) ? null : { labels }
    }
    case 'checklist': {
      // Ticks stay as they are: only the items' text comes back.
      const items = [
        ...new Set(
          splitList(cleanImportedText(text), /\n|;/)
            .map((entry) => entry.replace(/^\[[ xX✓]?\]\s*/, '').trim())
            .filter(Boolean)
        )
      ]
      if (
        items.length > LIMITS.checklist ||
        items.some((item) => item.length > LIMITS.checklistItem)
      )
        throw new Unreadable(t('data:editInExcel.tooLong'))
      return sameList(items, task.acceptanceCriteria) ? null : { acceptanceCriteria: items }
    }
    default:
      return null
  }
}

/** The export's context for one project, to write a task's cells. */
function cellContext(context: CsvUpdateContext): TaskCsvContext {
  const people = new Map(context.people.map((person) => [person.id, person.name]))
  const milestones = new Map(context.milestones.map((entry) => [entry.id, entry.name]))
  const iterations = new Map(context.iterations.map((entry) => [entry.id, entry.name]))
  return {
    personName: (id) => people.get(id) ?? null,
    milestoneName: (id) => milestones.get(id) ?? null,
    iterationName: (id) => iterations.get(id) ?? null,
    commentCount: () => 0,
    estimateUnit: context.estimateUnit,
    fields: context.fields,
    columns: context.columns
  }
}

/** A task with an update applied, to write its new cells. */
function applied(task: PlanningWorkItem, updates: UpdatePlanningWorkItemInput): PlanningWorkItem {
  const { fieldValues, ...rest } = updates
  const values = { ...(task.fieldValues ?? {}) }
  for (const [id, value] of Object.entries(fieldValues ?? {})) {
    if (value === null) delete values[id]
    else values[id] = value as PlanningFieldValue
  }
  return { ...task, ...rest, fieldValues: values } as PlanningWorkItem
}

/**
 * Reads the file against the project. `known` and `locale` are the CSV
 * import's own, for the new rows.
 */
export function analyzeCsvUpdate(
  file: { text: string; encoding: CsvUpdatePreview['encoding'] },
  fileName: string,
  context: CsvUpdateContext,
  known: ImportKnownRecords,
  locale: string
): CsvUpdateAnalysis {
  const writeContext = cellContext(context)
  // The import reads the file first: the same delimiter, decoding and dates for every row.
  const probe = analyzeCsv(file, { preset: 'none' }, known, locale)
  const { delimiter, dateFormat, headers } = probe.preview
  const columnOf = csvUpdateColumns(headers, writeContext)
  const idIndex = columnOf.indexOf('id')
  const table = parseCsv(cleanImportedText(file.text), delimiter)
  const body = table.slice(1)
  const lineOf = (index: number) => index + 2

  // New rows: the import itself, with every column mapped as the export wrote it.
  const importColumns: CsvColumnMap = emptyColumnMap()
  const fieldColumns: Record<string, CsvFieldTarget | null> = {}
  columnOf.forEach((column, index) => {
    const field = column ? IMPORT_FIELD[column] : undefined
    if (field && CSV_FIELDS.includes(field)) importColumns[field] = index
    const fieldId = column ? fieldIdOf(column) : null
    fieldColumns[String(index)] = fieldId ? { fieldId } : null
  })
  const analysis = analyzeCsv(
    file,
    { preset: 'none', delimiter, dateFormat, columns: importColumns, fieldColumns },
    known,
    locale
  )
  const idOf = (row: string[]) => (idIndex < 0 ? '' : (row[idIndex] ?? '').trim())
  const newLines = new Set(body.flatMap((row, index) => (idOf(row) === '' ? [lineOf(index)] : [])))
  const rowsByLine = new Map(analysis.preview.rows.map((row) => [row.line, row]))
  const newTasks = analysis.plan.tasks.filter((task) => newLines.has(task.line))
  const importable = new Set(newTasks.map((task) => task.line))
  const titleIndex = columnOf.indexOf('title')
  const newRows: CsvUpdateNewRow[] = [...newLines].map((line) => {
    const row = rowsByLine.get(line)
    return {
      line,
      title: (titleIndex < 0 ? '' : (body[line - 2][titleIndex] ?? '')).trim(),
      errors: importable.has(line)
        ? []
        : (row?.errors.map((issue) => issue.message) ?? [t('data:editInExcel.cannotImport')]),
      warnings: row?.warnings.map((issue) => issue.message) ?? []
    }
  })
  const plan: ImportPlan = {
    ...analysis.plan,
    tasks: newTasks.map((task) => ({
      ...task,
      // Structure only links rows of this file; new rows link nothing.
      parentLine: undefined,
      waitsOnLines: undefined
    })),
    skipped: newRows.length - newTasks.length
  }
  const knownPeople = new Set(known.people.map(lower))
  const knownMilestones = new Set(known.milestones.map(lower))
  const unique = (names: (string | null)[], seen: Set<string>) => {
    const found = new Map<string, string>()
    for (const name of names)
      if (name && !seen.has(lower(name)) && !found.has(lower(name))) found.set(lower(name), name)
    return [...found.values()]
  }

  // Rows with an ID: matched to live tasks, field by field.
  const live = new Map(context.tasks.map((task) => [task.id, task]))
  const seen = new Set<string>()
  const changed: CsvUpdateTask[] = []
  const updates: CsvTaskUpdate[] = []
  const skipped: CsvUpdateSkippedRow[] = []
  let unchangedCount = 0
  body.forEach((row, index) => {
    const id = idOf(row)
    if (!id) return
    const line = lineOf(index)
    const title = (titleIndex < 0 ? '' : (row[titleIndex] ?? '')).trim()
    const task = live.get(id)
    const skip = (reason: CsvUpdateSkipReason) => skipped.push({ line, id, title, reason })
    if (!task) return skip(context.lookup(id) ?? 'unknown')
    if (seen.has(id)) return skip('duplicate')
    seen.add(id)

    let patch: UpdatePlanningWorkItemInput = {}
    const changes: CsvUpdateFieldChange[] = []
    const problems: CsvUpdateProblem[] = []
    const changedColumns: string[] = []
    columnOf.forEach((column, columnIndex) => {
      if (!column || READ_ONLY.has(column)) return
      const text = csvCellText(cleanImportedText(row[columnIndex] ?? ''))
      const label = headers[columnIndex]
      // What the export writes for the task: the same text is no change.
      if (text.trim() === taskCellText(task, column, writeContext).trim()) return
      try {
        const update = readCell(column, text, task, context, dateFormat)
        if (!update) return
        patch = {
          ...patch,
          ...update,
          ...(update.fieldValues
            ? { fieldValues: { ...patch.fieldValues, ...update.fieldValues } }
            : {})
        }
        changedColumns.push(column)
      } catch (error) {
        if (!(error instanceof Unreadable)) throw error
        problems.push({ column, label, text: text.trim(), message: error.message })
      }
    })

    // A start after the due date is not read; the start stays as it is.
    const next = applied(task, patch)
    if (next.startDate && next.targetDate && next.startDate > next.targetDate) {
      const startColumn = columnOf.indexOf('start')
      if ('startDate' in patch) {
        delete patch.startDate
        changedColumns.splice(changedColumns.indexOf('start'), 1)
        problems.push({
          column: 'start',
          label: startColumn >= 0 ? headers[startColumn] : 'start',
          text: next.startDate,
          message: t('data:editInExcel.startAfterDue')
        })
      }
      const kept = applied(task, patch)
      if (
        kept.startDate &&
        kept.targetDate &&
        kept.startDate > kept.targetDate &&
        'targetDate' in patch
      ) {
        const dueColumn = columnOf.indexOf('due')
        delete patch.targetDate
        changedColumns.splice(changedColumns.indexOf('due'), 1)
        problems.push({
          column: 'due',
          label: dueColumn >= 0 ? headers[dueColumn] : 'due',
          text: kept.targetDate,
          message: t('data:editInExcel.startAfterDue')
        })
      }
    }

    const after = applied(task, patch)
    for (const column of changedColumns) {
      const at = columnOf.indexOf(column as TaskCsvColumn)
      changes.push({
        column,
        label: headers[at],
        from: taskCellText(task, column as TaskCsvColumn, writeContext),
        to: taskCellText(after, column as TaskCsvColumn, writeContext)
      })
    }
    if (changes.length === 0 && problems.length === 0) {
      unchangedCount += 1
      return
    }
    changed.push({ line, taskId: task.id, title: task.title, changes, problems })
    if (changes.length > 0)
      updates.push({ taskId: task.id, title: task.title, updates: patch, columns: changedColumns })
  })

  return {
    updates,
    plan,
    preview: {
      fileName,
      encoding: file.encoding,
      delimiter,
      dateFormat,
      hasIdColumn: idIndex >= 0,
      changed,
      unchangedCount,
      newRows,
      newPeople: unique(
        newTasks.map((task) => task.assigneeName),
        knownPeople
      ),
      newMilestones: unique(
        newTasks.map((task) => task.milestoneName),
        knownMilestones
      ),
      skipped
    }
  }
}
