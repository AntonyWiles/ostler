import type {
  CreatePlanningMilestoneInput,
  CreatePlanningWorkItemInput,
  PlanningActor
} from '@shared/ostler-api'
import { isRef } from '@shared/project-package'
import { createWorkItemBatch, PlanBatchError, type PlanBatchRow } from './planning-batch'
import type { PlanningService } from './planning-service'

/** One answer per split item, in the order they were sent. */
export type SplitResult =
  { index: number; ok: true; value: unknown } | { index: number; ok: false; error: string }

const REF_FIELDS = ['ref', 'milestoneRef', 'parentRef', 'dependencyRefs'] as const

/** A split item as the planning service takes it: its refs dropped. */
function withoutRefs(item: Record<string, unknown>): Record<string, unknown> {
  const definition = { ...item }
  for (const field of REF_FIELDS) delete definition[field]
  return definition
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

/**
 * A work item reaches its goal only through a milestone, so splitting a goal
 * straight into work items used to produce items with no link back to the
 * goal that created them -- invisible in that goal's rollup. Default to the
 * goal's sole milestone when the caller named none and exactly one exists;
 * otherwise say what is needed rather than silently orphaning the item.
 */
function linkToGoalMilestone(
  service: PlanningService,
  projectId: string,
  goalId: string,
  definition: Record<string, unknown>
): void {
  if (definition.milestoneId !== undefined) return
  const goalMilestones = service
    .listMilestones(projectId)
    .filter((milestone) => milestone.goalId === goalId)
  if (goalMilestones.length === 1) definition.milestoneId = goalMilestones[0].id
  else if (goalMilestones.length > 1) {
    throw new Error(
      `This goal has ${goalMilestones.length} milestones; set milestoneId so the work item is linked to one of them`
    )
  }
}

function createMilestone(
  service: PlanningService,
  projectId: string,
  goalId: string,
  definition: Record<string, unknown>
) {
  return service.createMilestone(projectId, {
    ...definition,
    goalId
  } as unknown as CreatePlanningMilestoneInput)
}

function createWorkItem(
  service: PlanningService,
  projectId: string,
  goalId: string,
  definition: Record<string, unknown>,
  actor: PlanningActor
) {
  linkToGoalMilestone(service, projectId, goalId, definition)
  return service.createWorkItem(
    projectId,
    definition as unknown as CreatePlanningWorkItemInput,
    actor,
    'human'
  )
}

/**
 * `POST /goals/:goalId/split`. A batch whose items carry refs is one
 * transaction (`splitWithRefs`); one without keeps its per-item results, so
 * the valid items are kept when another fails.
 */
export function splitGoal(
  service: PlanningService,
  projectId: string,
  goalId: string,
  body: Record<string, unknown>,
  actor: PlanningActor
): SplitResult[] {
  const goal = service.getGoal(goalId)
  if (goal.projectId !== projectId) throw new Error('Planning goal belongs to another project')
  if (!Array.isArray(body.items)) throw new Error('Split items must be an array')
  const items = body.items.map(asRecord)
  if (items.some((item) => REF_FIELDS.some((field) => item[field] !== undefined))) {
    return splitWithRefs(service, projectId, goalId, items, actor)
  }
  return items.map((definition, index): SplitResult => {
    try {
      if (definition.type === 'milestone') {
        return { index, ok: true, value: createMilestone(service, projectId, goalId, definition) }
      }
      if (definition.type === 'work-item') {
        const value = createWorkItem(service, projectId, goalId, { ...definition }, actor)
        return { index, ok: true, value }
      }
      throw new Error('Split item type must be "milestone" or "work-item"')
    } catch (error) {
      return { index, ok: false, error: error instanceof Error ? error.message : 'Invalid item' }
    }
  })
}

/**
 * A split batch described by refs: a milestone or work item may carry `ref`.
 * The goal's own rules are checked here (what a milestone may carry, and that
 * refs are unique across both kinds). The work items go through the shared
 * batch (`createWorkItemBatch`), which holds the ref rules for every batch,
 * and everything is one transaction: any error creates nothing.
 */
function splitWithRefs(
  service: PlanningService,
  projectId: string,
  goalId: string,
  items: Record<string, unknown>[],
  actor: PlanningActor
): SplitResult[] {
  const seen = new Set<string>()
  items.forEach((item, index) => {
    const path = `items[${index}]`
    if (item.type !== 'milestone' && item.type !== 'work-item') {
      throw new Error(`${path}.type must be "milestone" or "work-item"`)
    }
    if (item.ref !== undefined) {
      if (!isRef(item.ref)) {
        throw new Error(`${path}.ref must be a short reference of letters, digits, - or _`)
      }
      if (seen.has(item.ref)) throw new Error(`${path}.ref '${item.ref}' is used twice`)
      seen.add(item.ref)
    }
    if (item.type === 'milestone') {
      for (const field of ['milestoneRef', 'parentRef', 'dependencyRefs'] as const) {
        if (item[field] !== undefined) throw new Error(`${path}.${field} is only for work items`)
      }
    }
  })
  const workIndexes = items.flatMap((item, index) => (item.type === 'work-item' ? [index] : []))

  return service.runInTransaction(() => {
    const results: SplitResult[] = new Array(items.length)
    const milestoneIds = new Map<string, string>()
    const attempt = <T extends { id: string }>(index: number, create: () => T): T => {
      try {
        return create()
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid item'
        throw new Error(`items[${index}]: ${message}. Nothing was created.`)
      }
    }
    items.forEach((item, index) => {
      if (item.type !== 'milestone') return
      const definition = withoutRefs(item)
      const value = attempt(index, () => createMilestone(service, projectId, goalId, definition))
      if (typeof item.ref === 'string') milestoneIds.set(item.ref, value.id)
      results[index] = { index, ok: true, value }
    })
    try {
      const rows = workIndexes.map((index) => items[index] as unknown as PlanBatchRow)
      const created = createWorkItemBatch(service, projectId, rows, actor, {
        milestoneIds,
        prepare: (definition) => linkToGoalMilestone(service, projectId, goalId, definition),
        pathOf: (position) => `items[${workIndexes[position]}]`
      })
      created.forEach((value, position) => {
        const index = workIndexes[position]
        results[index] = { index, ok: true, value }
      })
    } catch (error) {
      if (!(error instanceof PlanBatchError)) throw error
      const [first] = error.errors
      if (first.index < 0) throw new Error(first.message)
      const message = first.message
      throw new Error(`items[${workIndexes[first.index]}]: ${message}. Nothing was created.`)
    }
    return results
  })
}
