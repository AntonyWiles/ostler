import { v4 as uuidv4 } from 'uuid'
import type {
  AIPlanTaskNode,
  PlanningActor,
  PlanningWorkItem,
  PlanningWorkItemStatus
} from '@shared/ostler-api'
import type { PlanningService } from './planning-service'
import { agentPlanTaskDescription } from '@shared/agent-plan-briefing'
import { unmetDependencyIds } from '@shared/planning/dependencies'
import { t } from '@shared/i18n'

/** Multi-record planning workflows layered over the planning persistence service. */
export class PlanningWorkflowService {
  constructor(private readonly planning: PlanningService) {}

  /**
   * Resolves whether a linked harness task has already finished its work. The
   * board treats such an item as done the moment its task completes, but the
   * planning row only reaches 'done' when someone moves it there -- so without
   * this the two disagreed and the Queue button offered work the main process
   * then refused. Wired in main.ts; absent in tests and headless callers.
   */
  private harnessWorkComplete:
    ((projectId: string, harnessTaskId: string, sessionId?: string) => boolean) | null = null

  setHarnessCompletionResolver(
    resolver: ((projectId: string, harnessTaskId: string, sessionId?: string) => boolean) | null
  ): void {
    this.harnessWorkComplete = resolver
  }

  /**
   * The single answer to "is this dependency still in the way?", shared by the
   * dispatch check and the handoff so they can never disagree again.
   *
   * A dependency counts as satisfied when its planning row is done, when its
   * agent has finished the work, or when the dependency no longer exists --
   * a deleted or cross-project id used to block its dependents forever with an
   * error naming dependencies the board could not even show.
   */
  private unsatisfiedDependencyIds(
    projectId: string,
    item: PlanningWorkItem,
    sessionId?: string
  ): string[] {
    if (item.dependencyIds.length === 0) return []
    const items = new Map(
      this.planning.listWorkItems(projectId).map((candidate) => [candidate.id, candidate])
    )
    return unmetDependencyIds(
      item,
      (id) => items.get(id),
      (dependency) =>
        dependency.status === 'done' ||
        (!!dependency.linkedHarnessTaskId &&
          !!this.harnessWorkComplete?.(projectId, dependency.linkedHarnessTaskId, sessionId))
    )
  }

  /**
   * The queueable subset of a selection, sorted so a dependency always sits
   * ahead of the work relying on it. Dependencies need not be met yet -- the
   * queue holds that work until every claim path agrees it can run -- so this
   * only excludes what can never be queued: work that is not Ready, work
   * already linked to a task, and container nodes with subtasks of their own.
   */
  orderWorkItemsForQueue(projectId: string, workItemIds: string[]): PlanningWorkItem[] {
    const requested = new Set(workItemIds)
    const all = this.planning.listWorkItems(projectId)
    const hasChildren = new Set(
      all.map((item) => item.parentWorkItemId).filter((id): id is string => Boolean(id))
    )
    const items = all.filter((item) => requested.has(item.id))
    const byId = new Map(items.map((item) => [item.id, item]))
    const queueable = new Set(
      items
        .filter(
          (item) =>
            item.status === 'ready' && !item.linkedHarnessTaskId && !hasChildren.has(item.id)
        )
        .map((item) => item.id)
    )
    // Depth-first over the selection's own edges. A dependency outside the
    // selection is simply not an ordering constraint we can honour here.
    const ordered: PlanningWorkItem[] = []
    const seen = new Set<string>()
    const visit = (item: PlanningWorkItem, path: Set<string>): void => {
      if (seen.has(item.id) || path.has(item.id)) return
      path.add(item.id)
      for (const dependencyId of item.dependencyIds) {
        const dependency = byId.get(dependencyId)
        if (dependency) visit(dependency, path)
      }
      path.delete(item.id)
      if (seen.has(item.id)) return
      seen.add(item.id)
      if (queueable.has(item.id)) ordered.push(item)
    }
    for (const item of items) visit(item, new Set())
    return ordered
  }

  isWorkItemEligibleForDispatch(projectId: string, workItemId: string): boolean {
    try {
      const item = this.planning.getWorkItem(workItemId)
      if (item.projectId !== projectId) return false
      if (item.status !== 'ready' && item.status !== 'active') return false
      const items = new Map(
        this.planning.listWorkItems(projectId).map((candidate) => [candidate.id, candidate])
      )
      if (this.unsatisfiedDependencyIds(projectId, item).length > 0) return false
      if (
        this.planning
          .listBlockersForWorkItem(workItemId)
          .some((blocker) => blocker.status === 'open')
      ) {
        return false
      }
      return ![...items.values()].some((candidate) => candidate.parentWorkItemId === workItemId)
    } catch {
      return false
    }
  }

  /**
   * Reserves the one harness task for this work item.
   *
   * `allowUnmetDependencies` is what lets a whole Ready column be queued in one
   * go: the task joins the queue immediately and every claim path re-checks its
   * dependencies before an agent is given it, so waiting happens in the queue
   * rather than in front of the board.
   */
  prepareHarnessHandoff(
    projectId: string,
    workItemId: string,
    options: { allowUnmetDependencies?: boolean } = {}
  ): PlanningWorkItem {
    const item = this.planning.getWorkItem(workItemId)
    if (item.projectId !== projectId)
      throw new Error('Planning work item belongs to another project')
    if (item.linkedHarnessTaskId) return item
    if (item.status !== 'ready')
      throw new Error(t('errors:planningWorkflowService.onlyReadyWorkCan'))
    if (
      !options.allowUnmetDependencies &&
      this.unsatisfiedDependencyIds(projectId, item).length > 0
    ) {
      throw new Error(t('errors:planningWorkflowService.completeAllDependenciesBefore'))
    }
    return this.planning.compareAndSetHarnessTaskId(item.id, null, uuidv4())
  }

  /**
   * How many of this item's dependencies are still in the way.
   *
   * A dependency is cleared once its work is merged, because a fresh session's
   * worktree is cut from nexus/control and cannot see a sibling's unmerged
   * branch. `sessionId` is the exception that makes chaining fast: work this
   * same session finished is already in its workspace, merged or not, so
   * auto-continuation never waits on itself.
   */
  unmetDependencyCount(projectId: string, workItemId: string, sessionId?: string): number {
    try {
      const item = this.planning.getWorkItem(workItemId)
      if (item.projectId !== projectId) return 0
      return this.unsatisfiedDependencyIds(projectId, item, sessionId).length
    } catch {
      return 0
    }
  }

  clearHarnessHandoff(
    projectId: string,
    workItemId: string,
    harnessTaskId: string
  ): PlanningWorkItem {
    const item = this.planning.getWorkItem(workItemId)
    if (item.projectId !== projectId)
      throw new Error('Planning work item belongs to another project')
    if (item.linkedHarnessTaskId !== harnessTaskId) {
      throw new Error('Planning work item is not linked to this harness task')
    }
    return this.planning.compareAndSetHarnessTaskId(item.id, harnessTaskId, null)
  }

  createAgentPlanTasks(
    projectId: string,
    milestoneId: string | null,
    phases: { code: string; name: string; tasks: AIPlanTaskNode[] }[],
    actor: PlanningActor,
    planRules: string[] = []
  ): PlanningWorkItem[] {
    if (!Array.isArray(phases) || phases.length === 0 || phases.length > 8) {
      throw new Error('An agent plan must contain between one and eight phases')
    }
    const existing = actor.draftId
      ? this.planning.listWorkItemsFromDraft(projectId, actor.draftId)
      : []
    if (existing.length > 0) return existing

    type FlatNode = { node: AIPlanTaskNode; phaseCode: string; phaseName: string }
    const flat: FlatNode[] = []
    const flatten = (node: AIPlanTaskNode, phaseCode: string, phaseName: string): void => {
      flat.push({ node, phaseCode, phaseName })
      for (const child of node.subtasks.slice(0, 5)) flatten(child, phaseCode, phaseName)
    }
    for (const phase of phases) {
      if (phase.tasks.length > 12) {
        throw new Error(`Phase ${phase.code} has more than twelve top-level tasks`)
      }
      for (const task of phase.tasks) flatten(task, phase.code, phase.name)
    }
    if (flat.length === 0) throw new Error(t('errors:planningWorkflowService.noTasksWereSelected'))
    if (flat.length > 60) throw new Error('An agent plan may not exceed sixty total nodes')

    const codeToNode = new Map(flat.map((entry) => [entry.node.code, entry.node]))
    const parentCodeOf = (code: string): string | null => {
      const lastDot = code.lastIndexOf('.')
      return lastDot === -1 ? null : code.slice(0, lastDot)
    }

    return this.planning.runInTransaction(() => {
      const codeToId = new Map<string, string>()
      const created: PlanningWorkItem[] = []
      for (const { node, phaseCode, phaseName } of flat) {
        const item = this.planning.createWorkItem(
          projectId,
          {
            title: node.title,
            description: agentPlanTaskDescription(node, planRules),
            milestoneId,
            status: 'backlog',
            priority: node.priority,
            acceptanceCriteria: node.acceptanceCriteria,
            taskCode: node.code,
            phaseCode,
            phaseName
          },
          actor,
          'ai-approved'
        )
        codeToId.set(node.code, item.id)
        created.push(item)
      }

      for (const { node } of flat) {
        const id = codeToId.get(node.code)
        if (!id) continue
        const parentCode = parentCodeOf(node.code)
        // A generated plan happily writes "1.2 relies on 1". Honouring that
        // would strand the subtask: its parent is never dispatched, so it
        // never reaches done. The containment edge already says it.
        const dependencyIds = node.reliesOn
          .filter((code) => code !== parentCode && codeToNode.has(code))
          .map((code) => codeToId.get(code))
          .filter((value): value is string => Boolean(value))
        const parentWorkItemId = parentCode ? (codeToId.get(parentCode) ?? null) : null
        const status: PlanningWorkItemStatus = dependencyIds.length === 0 ? 'ready' : 'backlog'
        this.planning.updateWorkItem(id, { dependencyIds, status }, actor)
        if (parentWorkItemId) this.planning.setAgentPlanParent(id, parentWorkItemId)
      }
      return created.map((item) => this.planning.getWorkItem(item.id))
    })
  }

  private requiredText(value: unknown, label: string, maximum: number): string {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`)
    if (value.trim().length > maximum) throw new Error(`${label} is too long`)
    return value.trim()
  }
}
