import type {
  PlanningFieldValuesInput,
  PlanningPriority,
  PlanningWorkItemBatchRow
} from './ostler-api'
import { parseQuickAdd, type QuickAddContext } from './quick-add'

/**
 * The plan grid's rows (R1.1): a whole plan typed or pasted at once. Pure, so
 * the dialog, its tests and the paste all read one rule.
 *
 * A row is a task at depth 0, or a subtask at depth 1 or 2 (three levels, as
 * the service allows). A row can wait on rows above it or on existing tasks.
 * The grid only holds what it sends: the service checks each row, and what
 * it refuses is shown on that row's cell.
 */

/** The deepest a row may sit below the top: 0 is a task, 2 a grandchild. */
export const PLAN_GRID_MAX_DEPTH = 2

/** Columns a row fills in, in the order the grid shows them. */
export type PlanColumn =
  'title' | 'assignee' | 'startDate' | 'dueDate' | 'estimate' | 'waitsOn' | 'milestone' | 'labels'

export type PlanWaitsOn = { kind: 'row'; rowId: string } | { kind: 'task'; taskId: string }

export interface PlanRow {
  /** Stable for the life of the row, so the grid can key and focus it. */
  id: string
  depth: number
  title: string
  assigneeId: string | null
  /** `YYYY-MM-DD`, or '' when there is none. */
  startDate: string
  dueDate: string
  /** In the project's estimate unit; null when there is none. */
  estimate: number | null
  waitsOn: PlanWaitsOn[]
  /** A milestone id, or '' for none. */
  milestoneId: string
  /** An iteration id (R6.1), or '' or absent for none. */
  iterationId?: string
  /** A task type id (N2.7a), or '' or absent for none. */
  typeId?: string
  /** Comma-separated labels, as the create form takes them. */
  labels: string
  /** From a `!high` in a pasted line; the grid has no priority column. */
  priority: PlanningPriority | null
  /** Custom field values (R2.2), by field id, for the field columns the grid shows. */
  fieldValues?: PlanningFieldValuesInput
  /** An idea's scores (N1.1b), 1 to 5, when the grid shows their columns. */
  impact?: number | null
  effort?: number | null
}

const SPACES_PER_LEVEL = 2

/**
 * One row per non-blank line. A leading tab is one level of subtask, and so
 * is each two leading spaces. Each line's text goes through the quick-add
 * grammar, so `#label`, `@person`, `!high` and dates read the same here as
 * in quick add. A line never sits more than one level below the line above
 * it, and the first line is never a subtask.
 */
export function planRowsFromText(
  text: string,
  context: QuickAddContext,
  newId: () => string
): PlanRow[] {
  const rows: PlanRow[] = []
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue
    const indent = /^[\t ]*/.exec(line)?.[0] ?? ''
    const tabs = indent.split('\t').length - 1
    const spaces = indent.replace(/\t/g, '').length
    const requested = tabs > 0 ? tabs : Math.floor(spaces / SPACES_PER_LEVEL)
    const above = rows.length > 0 ? rows[rows.length - 1].depth : -1
    const depth = Math.min(requested, above + 1, PLAN_GRID_MAX_DEPTH)

    const parsed = parseQuickAdd(line.trim(), { ...context, projects: [] })
    rows.push({
      id: newId(),
      depth: Math.max(0, depth),
      title: parsed.title,
      assigneeId: parsed.assigneeId,
      startDate: '',
      dueDate: parsed.dueDate ?? '',
      estimate: null,
      waitsOn: [],
      milestoneId: '',
      labels: parsed.labels.join(', '),
      priority: parsed.priority
    })
  }
  return rows
}

/** The rows under `index`: the ones after it, until one is not deeper. */
function subtreeEnd(rows: PlanRow[], index: number): number {
  let end = index + 1
  while (end < rows.length && rows[end].depth > rows[index].depth) end += 1
  return end
}

/**
 * Indents (`delta` +1) or outdents (-1) a row, with the rows under it: they
 * keep their place in the tree. Returns the new rows, or null when the move
 * would break the tree: the first row cannot be indented, nothing goes above
 * the top, and no row may pass the depth limit.
 */
export function indentPlanRow(rows: PlanRow[], index: number, delta: 1 | -1): PlanRow[] | null {
  const current = rows[index]
  if (!current) return null
  if (delta === 1) {
    if (index === 0 || current.depth > rows[index - 1].depth) return null
  } else if (current.depth === 0) {
    return null
  }
  const end = subtreeEnd(rows, index)
  const deepest = rows.slice(index, end).reduce((max, entry) => Math.max(max, entry.depth), 0)
  if (delta === 1 && deepest + 1 > PLAN_GRID_MAX_DEPTH) return null
  return rows.map((entry, position) =>
    position >= index && position < end ? { ...entry, depth: entry.depth + delta } : entry
  )
}

/** The row above `index` that is one level higher: its parent in the plan. */
export function planParentIndex(rows: PlanRow[], index: number): number | null {
  const depth = rows[index].depth
  if (depth === 0) return null
  for (let position = index - 1; position >= 0; position -= 1) {
    if (rows[position].depth === depth - 1) return position
    if (rows[position].depth < depth - 1) return null
  }
  return null
}

/**
 * The rows a row may wait on, in the grid: any row above it for a task, and
 * only its earlier siblings for a subtask (the service refuses any other).
 */
export function waitsOnCandidates(rows: PlanRow[], index: number): PlanRow[] {
  const parent = planParentIndex(rows, index)
  const earlier = rows.slice(0, index)
  if (parent === null && rows[index].depth > 0) return []
  if (rows[index].depth === 0) return earlier
  return earlier.filter((_, position) => planParentIndex(rows, position) === parent)
}

/** A label cell's text as the list of labels it names. */
export function planLabels(text: string): string[] {
  return text
    .split(',')
    .map((label) => label.trim())
    .filter(Boolean)
}

/**
 * The plan as the batch takes it: each row named `r<position>`, its parent and
 * what it waits on by those names, and existing tasks by id. A blank milestone
 * is left out, so a subtask takes its parent's milestone, as the service does.
 */
export function planBatchRows(rows: PlanRow[]): PlanningWorkItemBatchRow[] {
  return rows.map((row, index) => {
    const parent = planParentIndex(rows, index)
    const dependencyRefs: string[] = []
    const dependencyIds: string[] = []
    for (const wait of row.waitsOn) {
      if (wait.kind === 'task') dependencyIds.push(wait.taskId)
      else {
        const position = rows.findIndex((candidate) => candidate.id === wait.rowId)
        if (position >= 0) dependencyRefs.push(refOf(position))
      }
    }
    const batchRow: PlanningWorkItemBatchRow = {
      ref: refOf(index),
      title: row.title,
      assigneeId: row.assigneeId,
      startDate: row.startDate || null,
      targetDate: row.dueDate || null,
      estimate: row.estimate,
      labels: planLabels(row.labels)
    }
    if (row.priority) batchRow.priority = row.priority
    if (row.impact != null) batchRow.impact = row.impact
    if (row.effort != null) batchRow.effort = row.effort
    const fieldValues = Object.entries(row.fieldValues ?? {}).filter(([, value]) => value !== null)
    if (fieldValues.length > 0) batchRow.fieldValues = Object.fromEntries(fieldValues)
    if (row.milestoneId) batchRow.milestoneId = row.milestoneId
    if (row.iterationId) batchRow.iterationId = row.iterationId
    if (row.typeId) batchRow.typeId = row.typeId
    if (parent !== null) batchRow.parentRef = refOf(parent)
    if (dependencyRefs.length > 0) batchRow.dependencyRefs = dependencyRefs
    if (dependencyIds.length > 0) batchRow.dependencyIds = dependencyIds
    return batchRow
  })
}

function refOf(position: number): string {
  return `r${position}`
}

/**
 * The rows Create sends: a row with no title is left out, unless it has
 * subtasks with titles. That one stays in, so the check refuses it on its own
 * row, rather than its subtasks moving silently under the task above it.
 */
export function planRowsToCreate(rows: PlanRow[]): PlanRow[] {
  const titled = (row: PlanRow) => row.title.trim() !== ''
  const hasTitledSubtask = (index: number) => {
    for (let next = index + 1; next < rows.length && rows[next].depth > rows[index].depth; next++)
      if (titled(rows[next])) return true
    return false
  }
  return clampPlanDepths(rows.filter((row, index) => titled(row) || hasTitledSubtask(index)))
}

/** "12 tasks, 3 subtasks, 5 dependencies": what the grid says before Create. */
export function planGridSummary(rows: PlanRow[]): {
  tasks: number
  subtasks: number
  dependencies: number
} {
  return {
    tasks: rows.filter((row) => row.depth === 0).length,
    subtasks: rows.filter((row) => row.depth > 0).length,
    // Counted from the batch, so a wait on a row that is left out is not counted.
    dependencies: planBatchRows(rows).reduce(
      (count, row) => count + (row.dependencyRefs?.length ?? 0) + (row.dependencyIds?.length ?? 0),
      0
    )
  }
}

/**
 * Brings every row's depth back within the tree's rules after rows were
 * pasted in or removed: the first row is a task, and no row sits more than one
 * level below the row above it, nor past the depth limit.
 */
export function clampPlanDepths(rows: PlanRow[]): PlanRow[] {
  let above = -1
  const depths = rows.map((row) => {
    const depth = Math.max(0, Math.min(row.depth, above + 1, PLAN_GRID_MAX_DEPTH))
    above = depth
    return depth
  })
  if (depths.every((depth, index) => depth === rows[index].depth)) return rows
  return rows.map((row, index) =>
    depths[index] === row.depth ? row : { ...row, depth: depths[index] }
  )
}
