import type {
  HarnessProjectState,
  HarnessSession,
  HarnessTask,
  PlanningWorkItem,
  WatchedProject
} from '@shared/ostler-api'
import { projectFolder } from '@shared/project-folder'
import { isHiddenNow } from '@shared/planning/show-from'
import { todayIsoDate } from '@shared/dates'
import type { ConfigStore } from '../config-store'
import type { HarnessService } from './harness-service'
import type { OpenCodeRunnerService } from './opencode-runner-service'
import { embeddedFailureNote } from './opencode-runner-service'
import type { PlanningService } from './planning-service'
import { isAiHalted } from './ai-halt'

/**
 * Phase 4 (H4) Automatic Dispatcher:
 * Automatically starts embedded agent sessions for eligible queued tasks when a project
 * has auto-dispatch enabled and available concurrency capacity.
 *
 * Invariants:
 * 1. Default disabled (enabled: false, maxConcurrentEmbeddedSessions: 0).
 * 2. Concurrency limit is strictly enforced (never exceeds configured capacity).
 * 3. Planning dependency completion and Ready status are strictly gated via PlanningService.
 * 4. Held tasks (task.hold === true) are never automatically dispatched.
 * 5. Evaluations per project are serialized to prevent concurrent dispatch race conditions.
 * 6. A task that repeatedly fails to launch backs off instead of retrying forever.
 * 7. While agents are on, Ready work always goes to the queue, and the next
 *    few queued tasks get their copies prepared (simplify pass §2.2): as many
 *    as auto-dispatch runs at once, plus one. Only a task whose copy is ready
 *    is dispatched, so an agent never starts in a half-made copy.
 */

export class DispatcherService {
  /**
   * Retrying a task that cannot start on every state change -- and every
   * state change includes the ones this retry causes -- would spin forever.
   */
  private static readonly DISPATCH_BACKOFF_MS = 5 * 60_000
  private static readonly MAX_DISPATCH_BACKOFF_STEPS = 6

  private readonly projectQueues = new Map<string, Promise<unknown>>()
  private readonly dispatchFailures = new Map<string, { count: number; retryAfter: number }>()

  constructor(
    private readonly harnessService: HarnessService,
    private readonly openCodeRunnerService: OpenCodeRunnerService,
    private readonly planningService: PlanningService,
    private readonly configStore: ConfigStore,
    private readonly notifyHarnessState?: (project: WatchedProject) => void,
    /**
     * Queues one planning work item exactly the way the board's Queue button
     * does. Supplied by main.ts, which owns that flow; without it auto-queue
     * is simply inert.
     */
    private readonly queueWorkItem?: (project: WatchedProject, workItemId: string) => void
  ) {}

  /**
   * Evaluates the task queue for a project and dispatches eligible tasks into new
   * embedded agent sessions up to the project's configured concurrency capacity.
   * Serialized per project to prevent race conditions.
   */
  async evaluate(projectId: string): Promise<HarnessSession[]> {
    const previous = this.projectQueues.get(projectId) ?? Promise.resolve()
    const next = previous.catch(() => {}).then(() => this.runEvaluation(projectId))

    this.projectQueues.set(projectId, next)
    return next
  }

  private async runEvaluation(projectId: string): Promise<HarnessSession[]> {
    let project: WatchedProject | undefined
    try {
      project = this.configStore.getProjects().find((p) => p.id === projectId)
      if (!project) return []
    } catch {
      return []
    }

    // Agents work in a copy of the project's folder: with none linked there is
    // nothing to queue or dispatch, and that is not an error.
    if (projectFolder(project) === null) return []

    // The person pressed the emergency stop: nothing starts on its own until
    // they resume, and no copies are prepared.
    if (isAiHalted()) return []
    if (!this.configStore.get().harness.enabled) return []

    const config = this.configStore.getProjectAutoDispatchConfig(projectId)
    const autoRun = config.enabled && config.maxConcurrentEmbeddedSessions > 0
    this.queueReadyWork(project)
    // Copies for the next few tasks (§2.2). Not awaited: setup can take
    // minutes, and a finished copy notifies, which evaluates again.
    void this.harnessService.prepareCopies(
      project,
      (autoRun ? config.maxConcurrentEmbeddedSessions : 1) + 1
    )
    if (!autoRun) return []

    const state = this.harnessService.getState(project)
    const activeEmbeddedCount = state.activeSessions.filter(
      (session) => session.provenance === 'embedded'
    ).length

    const spareCapacity = config.maxConcurrentEmbeddedSessions - activeEmbeddedCount
    if (spareCapacity <= 0) {
      return []
    }

    // A token limit reached (D43): no more built-in runs start on their own
    // until it resets. A wait, not a launch failure, so nothing backs off; the
    // Inbox says which limit and when it resets.
    if (this.harnessService.reachedAgentLimit(project)) {
      return []
    }

    const eligibleTasks = this.getEligibleTasks(project, state, spareCapacity)
    if (eligibleTasks.length === 0) {
      return []
    }

    const launchedSessions: HarnessSession[] = []

    for (const task of eligibleTasks) {
      try {
        const session = await this.harnessService.startEmbeddedSessionForTask(project, task.id)
        this.harnessService.touchSessionConnection(project, session.id)
        this.notifyState(project)

        const refreshedTask =
          this.harnessService
            .getState(project)
            .taskQueue.find((item) => item.claimedBy === session.id) ?? task

        launchedSessions.push(session)

        void this.openCodeRunnerService
          .start(project, session, refreshedTask)
          // Reserving the session is not the part that fails; clear the
          // backoff only once the runner itself is actually up.
          .then(() => this.dispatchFailures.delete(task.id))
          .catch((error) => {
            console.error(`Auto-dispatched embedded session ${session.id} failed:`, error)
            this.recordDispatchFailure(task.id)
            try {
              this.harnessService.failSession(project, session.id, embeddedFailureNote(error))
            } catch {
              // Best-effort session update; project or session may have already closed
            } finally {
              this.notifyState(project)
            }
          })
      } catch (error) {
        console.error(`Failed to dispatch task ${task.id} for project ${projectId}:`, error)
        this.recordDispatchFailure(task.id)
      }
    }

    if (launchedSessions.length > 0) {
      this.notifyState(project)
    }

    return launchedSessions
  }

  /**
   * Queues Ready work nobody has queued yet. Dependencies need not be met:
   * the queue is the waiting room and every claim path re-checks them, so
   * queuing early is what stops an unattended run from waiting on a person.
   * Blocked work and container items are excluded, matching the board.
   */
  private queueReadyWork(project: WatchedProject): void {
    if (!this.queueWorkItem) return
    let items: PlanningWorkItem[]
    try {
      items = this.planningService.listWorkItems(project.id)
    } catch {
      return
    }
    const today = todayIsoDate()
    const hasChildren = new Set(
      items.map((item) => item.parentWorkItemId).filter((id): id is string => Boolean(id))
    )
    for (const item of items) {
      if (item.status !== 'ready' || item.linkedHarnessTaskId) continue
      if (hasChildren.has(item.id)) continue
      // Someday and hidden-until-later tasks wait for the person (N1.1a).
      if (isHiddenNow(item, today)) continue
      // An Owner only task is the person's to do, never an agent's.
      if (item.ownerOnly) continue
      try {
        if (
          this.planningService
            .listBlockersForWorkItem(item.id)
            .some((blocker) => blocker.status === 'open')
        ) {
          continue
        }
        this.queueWorkItem(project, item.id)
      } catch (error) {
        console.error(`Auto-queue of work item ${item.id} failed:`, error)
      }
    }
  }

  private getEligibleTasks(
    project: WatchedProject,
    state: HarnessProjectState,
    limit: number
  ): HarnessTask[] {
    const eligible: HarnessTask[] = []

    for (const task of state.taskQueue) {
      if (eligible.length >= limit) break

      if (task.status !== 'pending') continue
      if (task.claimedBy !== null) continue
      if (task.hold === true) continue
      // Only a ready copy: "Getting ready" tasks wait (§2.1).
      if (task.copy?.state !== 'ready') continue
      if (this.isBackingOff(task.id)) continue

      if (task.planningWorkItemId) {
        const isEligible = this.planningService.isWorkItemEligibleForDispatch(
          project.id,
          task.planningWorkItemId
        )
        if (!isEligible) continue
      }

      eligible.push(task)
    }

    return eligible
  }

  /**
   * Counts a failed launch and holds the task back, backing off further each
   * time up to a ceiling. It still retries eventually: whatever stopped the
   * launch (a missing binary, a provider outage) is usually fixed without
   * anyone thinking to nudge this particular task.
   */
  private recordDispatchFailure(taskId: string): void {
    const count = (this.dispatchFailures.get(taskId)?.count ?? 0) + 1
    const steps = Math.min(count, DispatcherService.MAX_DISPATCH_BACKOFF_STEPS)
    this.dispatchFailures.set(taskId, {
      count,
      retryAfter: Date.now() + steps * DispatcherService.DISPATCH_BACKOFF_MS
    })
  }

  /** True while a previously failed task is still inside its backoff window. */
  private isBackingOff(taskId: string): boolean {
    const failure = this.dispatchFailures.get(taskId)
    // The count is deliberately kept past the window so repeated failures keep
    // lengthening the wait rather than restarting at the shortest one.
    return failure !== undefined && Date.now() < failure.retryAfter
  }

  private notifyState(project: WatchedProject): void {
    if (this.notifyHarnessState) {
      this.notifyHarnessState(project)
    }
  }
}
