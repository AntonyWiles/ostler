import type {
  DayOff,
  PlanningActor,
  PlanningWorkItem,
  Person,
  WatchedProject
} from '@shared/ostler-api'
import { isIsoDate } from '@shared/dates'
import { Refusal } from '@shared/refusal'
import {
  RESCHEDULE_MODES,
  planReschedule,
  type RescheduleChange,
  type RescheduleDueWork,
  type RescheduleMode,
  type RescheduleOptions,
  type ReschedulePlan,
  type RescheduleRelatedTask,
  type RescheduleResult,
  type RescheduleTask
} from '@shared/planning/reschedule'
import {
  planDependentMoves,
  type DependentMovePlan,
  type DependentMoveSkip,
  type TaskDateMove
} from '@shared/planning/move-dependents'
import { myWorkingDays } from '@shared/planning/working-days'
import type { PlanningService } from './planning-service'

/** What moving what waits on a change did (N7.1). */
export interface DependentMoveResult extends RescheduleResult {
  /** Done and undated tasks the plan left where they are. */
  left: DependentMoveSkip[]
}

/** The most tasks one plan or one apply may hold. */
export const MAX_RESCHEDULE_TASKS = 1000

export interface RescheduleServiceDependencies {
  planning: PlanningService
  /** Every project; the service keeps the enabled ones. */
  getProjects(): WatchedProject[]
  getPerson(id: string): Person | null
  getMe(): Person | null
  /** Days off (N3.2), which spreading skips; none when left out. */
  getDaysOff?(): readonly DayOff[]
}

/** What to plan. */
export interface RescheduleRequest extends RescheduleOptions {
  /** The person's local date, `YYYY-MM-DD`. */
  today: string
  /**
   * The tasks to move. Left out: the overdue tasks assigned to the person (to
   * Me or nobody when the person is Me), as Home's Today counts them.
   */
  workItemIds?: string[]
  /** Whose capacity and working days to use: Me when left out. */
  personId?: string | null
  /** Only this project's tasks (the automation API's token reaches one project). */
  projectId?: string
}

/**
 * Reschedule overdue work (N1.3): reads what the plan needs, plans it with the
 * one pure rule (`planReschedule`), and applies a plan through the planning
 * service's normal update path in one transaction. The app's IPC and the
 * automation API both come here.
 */
export class RescheduleService {
  constructor(private readonly deps: RescheduleServiceDependencies) {}

  private projects(projectId?: string): WatchedProject[] {
    const enabled = this.deps.getProjects().filter((project) => project.enabled)
    if (projectId === undefined) return enabled
    const project = enabled.find((candidate) => candidate.id === projectId)
    if (!project) throw new Refusal('Project not found or disabled')
    return [project]
  }

  private person(personId: string | null | undefined): Person | null {
    if (personId === undefined || personId === null) return this.deps.getMe()
    const person = this.deps.getPerson(personId)
    if (!person) throw new Refusal('Person not found')
    return person
  }

  preview(request: RescheduleRequest): ReschedulePlan {
    const options = rescheduleOptions(request)
    if (!isIsoDate(request.today)) throw new Refusal('today must use YYYY-MM-DD')
    const projects = this.projects(request.projectId)
    const person = this.person(request.personId)
    const isMe = person?.isMe ?? true
    const mine = (item: PlanningWorkItem) =>
      item.assigneeId === (person?.id ?? null) || (isMe && item.assigneeId === null)
    // One read per project: every live task, with its dependencies and repeat flag.
    const all = new Map<string, { item: PlanningWorkItem; project: WatchedProject }>()
    for (const project of projects)
      for (const item of this.deps.planning.listWorkItems(project.id))
        all.set(item.id, { item, project })

    let chosen: { item: PlanningWorkItem; project: WatchedProject }[]
    if (request.workItemIds !== undefined) {
      const ids = taskIds(request.workItemIds)
      chosen = ids.map((id) => {
        const found = all.get(id)
        if (!found) throw new Refusal(`Task ${id} was not found in an enabled project`)
        if (found.item.status === 'done') throw new Refusal(`"${found.item.title}" is done`)
        if (!found.item.targetDate) throw new Refusal(`"${found.item.title}" has no due date`)
        return found
      })
    } else {
      chosen = [...all.values()].filter(
        ({ item }) =>
          item.status !== 'done' &&
          item.targetDate !== null &&
          item.targetDate < request.today &&
          mine(item)
      )
    }
    const moving = new Set(chosen.map(({ item }) => item.id))
    const tasks: RescheduleTask[] = chosen.map(({ item, project }) => ({
      id: item.id,
      projectId: item.projectId,
      title: item.title,
      priority: item.priority,
      targetDate: item.targetDate,
      startDate: item.startDate,
      estimate: item.estimate,
      dependencyIds: item.dependencyIds,
      dependencyLinks: item.dependencyLinks,
      createdAt: item.createdAt,
      estimateUnit: project.estimateUnit ?? 'points',
      recurring: item.recurring === true
    }))
    const dueWork: RescheduleDueWork[] = []
    const related: RescheduleRelatedTask[] = []
    for (const { item, project } of all.values()) {
      if (moving.has(item.id)) continue
      if (
        item.status !== 'done' &&
        item.targetDate &&
        item.targetDate >= request.today &&
        mine(item)
      )
        dueWork.push({
          targetDate: item.targetDate,
          estimate: item.estimate,
          estimateUnit: project.estimateUnit ?? 'points'
        })
      if (
        item.dependencyIds.some((id) => moving.has(id)) ||
        tasks.some((task) => task.dependencyIds.includes(item.id))
      )
        related.push(item)
    }
    return planReschedule(tasks, options, {
      today: request.today,
      weeklyCapacityHours: person?.weeklyCapacityHours ?? null,
      workingDays: person?.workingDays,
      personId: person?.id ?? null,
      daysOff: options.mode === 'spread' ? (this.deps.getDaysOff?.() ?? []) : [],
      dueWork,
      related
    })
  }

  /**
   * Applies changes in one transaction, each through `updateWorkItem`, so
   * activity, reminders, search, repeats and rules see every one. A task whose
   * dates are no longer what the preview saw is skipped and reported, never
   * overwritten. `projectId` keeps the changes to one project.
   */
  apply(
    changes: readonly RescheduleChange[],
    actor: PlanningActor,
    projectId?: string
  ): RescheduleResult {
    const checked = rescheduleChanges(changes)
    const allowed = new Set(this.projects(projectId).map((project) => project.id))
    const result: RescheduleResult = { changed: [], skipped: [] }
    this.deps.planning.runInTransaction(() => {
      for (const change of checked) {
        let current: PlanningWorkItem
        try {
          current = this.deps.planning.getWorkItem(change.id)
        } catch {
          result.skipped.push({ id: change.id, title: '', reason: 'missing' })
          continue
        }
        if (!allowed.has(current.projectId) || current.archivedAt || current.deletedAt) {
          result.skipped.push({ id: change.id, title: current.title, reason: 'missing' })
          continue
        }
        if (
          (current.targetDate ?? null) !== change.fromDue ||
          (current.startDate ?? null) !== change.fromStart
        ) {
          result.skipped.push({ id: change.id, title: current.title, reason: 'changed' })
          continue
        }
        // Both dates in one update, so the pair is checked together.
        this.deps.planning.updateWorkItem(
          change.id,
          change.toStart === change.fromStart
            ? { targetDate: change.toDue }
            : { targetDate: change.toDue, startDate: change.toStart },
          actor
        )
        result.changed.push(change)
      }
    })
    return result
  }

  /**
   * Move what waits on it (N7.1): the plan for date changes made (or about to
   * be made) to tasks, built from each task's project read once
   * (`planDependentMoves`), on Me's working days and days off. Changes nothing.
   */
  planDependents(moves: readonly TaskDateMove[], projectId?: string): DependentMovePlan {
    const checked = dependentMoves(moves)
    const allowed = new Set(this.projects(projectId).map((project) => project.id))
    const projectIds = new Set<string>()
    for (const move of checked) {
      let item: PlanningWorkItem
      try {
        item = this.deps.planning.getWorkItem(move.id)
      } catch {
        throw new Refusal(`Task ${move.id} was not found`)
      }
      if (!allowed.has(item.projectId))
        throw new Refusal(`Task ${move.id} was not found in an enabled project`)
      projectIds.add(item.projectId)
    }
    const tasks = [...projectIds].flatMap((id) => this.deps.planning.listWorkItems(id))
    return planDependentMoves(
      tasks,
      checked,
      myWorkingDays(this.deps.getMe(), this.deps.getDaysOff?.() ?? [])
    )
  }

  /** Plans and applies what waits on `moves` in one transaction (the API's `moveDependents`). */
  moveDependents(
    moves: readonly TaskDateMove[],
    actor: PlanningActor,
    projectId?: string
  ): DependentMoveResult {
    return this.deps.planning.runInTransaction(() => {
      const plan = this.planDependents(moves, projectId)
      return { ...this.apply(plan.entries, actor, projectId), left: plan.skipped }
    })
  }
}

/** Checks the date changes a plan for what waits on them is asked about. */
export function dependentMoves(raw: unknown): TaskDateMove[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_RESCHEDULE_TASKS)
    throw new Refusal(`Send 1 to ${MAX_RESCHEDULE_TASKS} date changes`)
  const optionalDate = (value: unknown) => value === null || isIsoDate(value)
  return raw.map((entry) => {
    const move = entry as Partial<TaskDateMove> | null
    if (
      !move ||
      typeof move.id !== 'string' ||
      !move.id ||
      move.id.length > 100 ||
      !optionalDate(move.fromDue) ||
      !optionalDate(move.toDue) ||
      !optionalDate(move.fromStart) ||
      !optionalDate(move.toStart)
    )
      throw new Refusal('Each date change needs id, fromDue, toDue, fromStart and toStart')
    return {
      id: move.id,
      fromDue: move.fromDue ?? null,
      toDue: move.toDue ?? null,
      fromStart: move.fromStart ?? null,
      toStart: move.toStart ?? null
    }
  })
}

function taskIds(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length > MAX_RESCHEDULE_TASKS)
    throw new Refusal(`Send workItemIds as a list of at most ${MAX_RESCHEDULE_TASKS} task ids`)
  const ids = raw.map((id) => {
    if (typeof id !== 'string' || !id || id.length > 100)
      throw new Refusal('workItemIds must be task ids')
    return id
  })
  return [...new Set(ids)]
}

/** Checks the mode, date and days a request names. */
export function rescheduleOptions(raw: {
  mode?: unknown
  date?: unknown
  days?: unknown
}): RescheduleOptions {
  if (!RESCHEDULE_MODES.includes(raw.mode as RescheduleMode))
    throw new Refusal(`mode must be one of: ${RESCHEDULE_MODES.join(', ')}`)
  const mode = raw.mode as RescheduleMode
  if (mode === 'date' && !isIsoDate(raw.date)) throw new Refusal('date must use YYYY-MM-DD')
  if (raw.days !== undefined && raw.days !== null && mode === 'spread') {
    if (
      typeof raw.days !== 'number' ||
      !Number.isInteger(raw.days) ||
      raw.days < 1 ||
      raw.days > 30
    )
      throw new Refusal('days must be a whole number from 1 to 30')
  }
  return {
    mode,
    ...(mode === 'date' ? { date: raw.date as string } : {}),
    ...(mode === 'spread' && typeof raw.days === 'number' ? { days: raw.days } : {})
  }
}

/** Checks the changes an apply call sends. */
export function rescheduleChanges(raw: unknown): RescheduleChange[] {
  if (!Array.isArray(raw) || raw.length > MAX_RESCHEDULE_TASKS)
    throw new Refusal(`Send at most ${MAX_RESCHEDULE_TASKS} changes`)
  const optionalDate = (value: unknown) => value === null || isIsoDate(value)
  return raw.map((entry) => {
    const change = entry as Partial<RescheduleChange> | null
    if (
      !change ||
      typeof change.id !== 'string' ||
      !change.id ||
      !optionalDate(change.fromDue) ||
      !optionalDate(change.toDue) ||
      !optionalDate(change.fromStart) ||
      !optionalDate(change.toStart)
    )
      throw new Refusal('Each change needs id, fromDue, toDue, fromStart and toStart')
    return {
      id: change.id,
      fromDue: change.fromDue ?? null,
      toDue: change.toDue ?? null,
      fromStart: change.fromStart ?? null,
      toStart: change.toStart ?? null
    }
  })
}
