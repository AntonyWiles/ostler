import type {
  CreatePlanningWorkItemInput,
  PlanningActor,
  PlanningWorkItem,
  PlanningWorkItemBatchRow,
  PlanningWorkItemBatchRowError
} from '@shared/ostler-api'
import {
  isRef,
  packageCreationOrder,
  validateTaskRefs,
  type RefTask
} from '@shared/project-package'
import { PlanningFieldError, type PlanningService } from './planning-service'

/**
 * Creating several tasks at once: a plan typed into the plan grid, a split
 * from the automation API, or any other batch described by refs. One
 * implementation of the refs, and one transaction: a batch whose any row is
 * refused creates nothing at all.
 *
 * Each row goes through `PlanningService.createWorkItem`, so the rules a
 * single task obeys (a start after its due date, a dependency in another
 * project, the three-level subtask limit) are the same here, with the same
 * words. A row names other rows by `ref`: a subtask names its parent with
 * `parentRef`, a task names what it waits on with `dependencyRefs`, and a
 * milestone created earlier in the same transaction is named with
 * `milestoneRef`.
 */

export type PlanBatchRow = PlanningWorkItemBatchRow
export type PlanBatchRowError = PlanningWorkItemBatchRowError

/** The most tasks one batch may create. */
export const MAX_BATCH_ROWS = 500

/**
 * The rows a request carries, checked for shape only: a list of objects with
 * at least one and at most `MAX_BATCH_ROWS`. The rules are the batch's own.
 */
export function batchRowsFrom(value: unknown): PlanBatchRow[] {
  if (!Array.isArray(value)) throw new Error('Plan rows must be a list of tasks')
  if (value.length === 0) throw new Error('A plan needs at least one task')
  if (value.length > MAX_BATCH_ROWS) {
    throw new Error(`A plan can hold at most ${MAX_BATCH_ROWS} tasks`)
  }
  return value.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error(`items[${index}] must be a task`)
    }
    return row as PlanBatchRow
  })
}

/** A batch that was refused. Nothing from it was written. */
export class PlanBatchError extends Error {
  constructor(readonly errors: PlanBatchRowError[]) {
    super(errors[0]?.message ?? 'The batch was refused')
    this.name = 'PlanBatchError'
  }
}

export interface PlanBatchOptions {
  /** Milestones the batch may name, by ref, to their ids. */
  milestoneIds?: ReadonlyMap<string, string>
  /**
   * Changes a row's definition just before it is created. The goal split uses
   * this to link each item to its goal; the definition is the one the service
   * will receive.
   */
  prepare?: (definition: Record<string, unknown>) => void
  /** How a row is named in a ref message, such as `items[2]`. Defaults to its position. */
  pathOf?: (index: number) => string
}

/** A row's position and its refs, in the form the ref checks read. */
type PlannedRow = RefTask & { index: number }

/** Thrown out of a transaction to undo a check after it has collected its answers. */
class CheckOnly {
  constructor(readonly errors: PlanBatchRowError[]) {}
}

/**
 * Creates every row, in dependency order, in one transaction. Throws a
 * `PlanBatchError` for the first refusal, and then nothing has been written.
 */
export function createWorkItemBatch(
  service: PlanningService,
  projectId: string,
  rows: PlanBatchRow[],
  actor: PlanningActor,
  options: PlanBatchOptions = {}
): PlanningWorkItem[] {
  return service.runInTransaction(() => {
    const outcome = planRows(service, projectId, rows, actor, options, true)
    if (outcome.errors.length > 0) throw new PlanBatchError(outcome.errors)
    return outcome.created
  })
}

/**
 * Checks every row without writing anything: the same refusals as
 * `createWorkItemBatch`, but every row's answer, not only the first. An empty
 * list means the batch would be created.
 */
export function checkWorkItemBatch(
  service: PlanningService,
  projectId: string,
  rows: PlanBatchRow[],
  actor: PlanningActor,
  options: PlanBatchOptions = {}
): PlanBatchRowError[] {
  try {
    service.runInTransaction(() => {
      const outcome = planRows(service, projectId, rows, actor, options, false)
      throw new CheckOnly(outcome.errors)
    })
  } catch (error) {
    if (error instanceof CheckOnly) return error.errors
    throw error
  }
  return []
}

function planRows(
  service: PlanningService,
  projectId: string,
  rows: PlanBatchRow[],
  actor: PlanningActor,
  options: PlanBatchOptions,
  stopAtFirst: boolean
): { created: PlanningWorkItem[]; errors: PlanBatchRowError[] } {
  const shape = readRefs(rows, options)
  if (shape.errors.length > 0) return { created: [], errors: shape.errors }

  const errors: PlanBatchRowError[] = []
  const created = new Map<number, PlanningWorkItem>()
  const ids = new Map<string, string>()
  const milestoneOf = new Map<string, string | null>()
  /** Rows that were refused: a row that waits on one is skipped, not refused again. */
  const refused = new Set<string>()

  for (const entry of packageCreationOrder(shape.tasks)) {
    if ([entry.parentRef, ...entry.dependsOnRefs].some((ref) => ref && refused.has(ref))) {
      refused.add(entry.ref)
      continue
    }
    const row = rows[entry.index]
    const definition = withoutRefs(row)
    if (entry.milestoneRef) definition.milestoneId = options.milestoneIds?.get(entry.milestoneRef)
    if (entry.parentRef) {
      definition.parentWorkItemId = ids.get(entry.parentRef)
      // A subtask belongs where its parent does, unless the row says otherwise.
      if (definition.milestoneId === undefined) {
        definition.milestoneId = milestoneOf.get(entry.parentRef) ?? null
      }
    }
    if (entry.dependsOnRefs.length > 0) {
      const refIds = entry.dependsOnRefs.map((ref) => ids.get(ref))
      // A row that gives typed links (N7.2a) gets its refs as finish-to-start links beside them.
      if (Array.isArray(definition.dependencyLinks)) {
        definition.dependencyLinks = [
          ...definition.dependencyLinks,
          ...refIds.map((id) => ({ id }))
        ]
      } else {
        const given = Array.isArray(definition.dependencyIds) ? definition.dependencyIds : []
        definition.dependencyIds = [...given, ...refIds]
      }
    }
    try {
      options.prepare?.(definition)
      const item = service.createWorkItem(
        projectId,
        definition as unknown as CreatePlanningWorkItemInput,
        actor,
        'human'
      )
      ids.set(entry.ref, item.id)
      milestoneOf.set(entry.ref, item.milestoneId)
      created.set(entry.index, item)
    } catch (error) {
      refused.add(entry.ref)
      errors.push({
        index: entry.index,
        field: error instanceof PlanningFieldError ? error.field : null,
        message: error instanceof Error ? error.message : 'Invalid task'
      })
      if (stopAtFirst) break
    }
  }

  const ordered = [...created.entries()].sort(([left], [right]) => left - right)
  // Made parents and dependencies first; shown in the order the rows were listed.
  const keys = service.keepListedOrder(
    projectId,
    ordered.map(([, item]) => item.id)
  )
  return {
    created: ordered.map(([, item], index) => ({ ...item, orderKey: keys[index] })),
    errors
  }
}

/**
 * The batch's refs as the ref checks read them: each row's ref (a stand-in
 * for unnamed rows), its milestone, parent and dependencies. Anything that
 * is not a ref, is named twice, or names a missing row is refused here.
 */
function readRefs(
  rows: PlanBatchRow[],
  options: PlanBatchOptions
): { tasks: PlannedRow[]; errors: PlanBatchRowError[] } {
  const errors: PlanBatchRowError[] = []
  const seen = new Set<string>()
  const tasks: PlannedRow[] = []
  // A malformed batch names no row: the message carries the path, and nothing is written.
  const refuse = (message: string) => errors.push({ index: -1, field: null, message })
  const pathOf = options.pathOf ?? ((index: number) => `items[${index}]`)

  rows.forEach((row, index) => {
    const path = pathOf(index)
    if (row.ref !== undefined) {
      if (!isRef(row.ref)) {
        refuse(`${path}.ref must be a short reference of letters, digits, - or _`)
        return
      }
      if (seen.has(row.ref)) {
        refuse(`${path}.ref '${row.ref}' is used twice`)
        return
      }
      seen.add(row.ref)
    }
    if (row.milestoneRef !== undefined && row.milestoneId !== undefined) {
      refuse(`${path} names its milestone twice: use milestoneRef or milestoneId`)
      return
    }
    if (row.parentRef !== undefined && row.parentWorkItemId !== undefined) {
      refuse(`${path} names its parent twice: use parentRef or parentWorkItemId`)
      return
    }
    const dependencies = row.dependencyRefs ?? []
    if (!Array.isArray(dependencies) || dependencies.some((ref) => typeof ref !== 'string')) {
      refuse(`${path}.dependencyRefs must be a list of refs`)
      return
    }
    tasks.push({
      index,
      ref: row.ref ?? `#${index}`,
      milestoneRef: optionalRef(row.milestoneRef, `${path}.milestoneRef`, refuse),
      parentRef: optionalRef(row.parentRef, `${path}.parentRef`, refuse),
      dependsOnRefs: dependencies
    })
  })
  if (errors.length > 0) return { tasks: [], errors }

  const milestoneRefs = new Set(options.milestoneIds?.keys() ?? [])
  const checked = validateTaskRefs(tasks, milestoneRefs, {
    pathOf: (position) => pathOf(tasks[position].index),
    dependencyField: 'dependencyRefs'
  })
  if (!checked.ok)
    return { tasks: [], errors: [{ index: -1, field: null, message: checked.error }] }
  return { tasks, errors }
}

function optionalRef(
  value: unknown,
  path: string,
  refuse: (message: string) => void
): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') {
    refuse(`${path} must be a ref`)
    return null
  }
  return value
}

/** A row without its refs: the definition the service creates from. */
function withoutRefs(row: PlanBatchRow): Record<string, unknown> {
  const definition: Record<string, unknown> = { ...row }
  for (const field of ['ref', 'milestoneRef', 'parentRef', 'dependencyRefs']) {
    delete definition[field]
  }
  return definition
}
