import { randomUUID } from 'node:crypto'
import type { AIPlanTaskNode, AITaskSplitDraft, TaskSplitJob } from '@shared/ostler-api'
import type { AIPlanningService } from './ai-planning-service'
import { t } from '@shared/i18n'

interface PhasePlan {
  code: string
  name: string
  objective: string
}

interface JobContext {
  job: TaskSplitJob
  projectName: string
  summary: string
  rules: string[]
  /** Library items the owner selected for this plan; Phase 4 passes them. */
  selectedItemIds: string[]
  phasePlans: PhasePlan[]
  /** `warning` is a phase's vision fallback note, carried onto the finished draft. */
  results: Map<string, { code: string; name: string; tasks: AIPlanTaskNode[]; warning?: string }>
  cancelled: boolean
  running: boolean
}

export interface TaskSplitJobDependencies {
  aiPlanningService: AIPlanningService
  /** Pushes the job to the renderer on every state change. */
  emitProgress(job: TaskSplitJob): void
  /** Raises a desktop/in-app notification for a phase or job milestone. */
  notify(title: string, body: string, projectId: string): void
}

/**
 * Flattens a phase's task tree into what later phases are shown: each task's
 * code and title, and the deliverable paths their briefings can point to.
 */
function digestOf(
  nodes: AIPlanTaskNode[]
): { code: string; title: string; deliverables: string[] }[] {
  return nodes.flatMap((node) => [
    { code: node.code, title: node.title, deliverables: node.deliverables ?? [] },
    ...digestOf(node.subtasks)
  ])
}

function countNodes(nodes: AIPlanTaskNode[]): number {
  return nodes.reduce((total, node) => total + 1 + countNodes(node.subtasks), 0)
}

/**
 * Runs a task split as a background job: one model call per approved phase, in
 * order, each seeded with the codes and titles already planned.
 *
 * Sequential rather than parallel on purpose. Phases planned concurrently cannot
 * see each other, so they duplicate scope and cannot express a cross-phase
 * dependency; the split exists to brief agents precisely, and that coherence is
 * worth more than wall-clock time we no longer make the user watch.
 */
export class TaskSplitJobService {
  private readonly jobs = new Map<string, JobContext>()
  private readonly jobIdByGoal = new Map<string, string>()

  constructor(private readonly deps: TaskSplitJobDependencies) {}

  private goalKey(projectId: string, goalId: string): string {
    return `${projectId}:${goalId}`
  }

  getJob(projectId: string, goalId: string): TaskSplitJob | null {
    const jobId = this.jobIdByGoal.get(this.goalKey(projectId, goalId))
    if (!jobId) return null
    return this.jobs.get(jobId)?.job ?? null
  }

  /** Starts a split and returns the initial job; the work continues after this resolves. */
  start(input: {
    projectId: string
    projectName: string
    goalId: string
    masterPlanDraftId: string
    summary: string
    rules: string[]
    phases: PhasePlan[]
    selectedItemIds?: string[]
  }): TaskSplitJob {
    if (input.phases.length === 0)
      throw new Error(t('errors:taskSplitJobService.approveLeastOnePhase'))
    this.deps.aiPlanningService.assertAiAvailable(input.projectId)
    const existing = this.getJob(input.projectId, input.goalId)
    if (existing && existing.status === 'running') {
      throw new Error(t('errors:taskSplitJobService.taskSplitAlreadyRunning'))
    }
    const now = new Date().toISOString()
    const job: TaskSplitJob = {
      jobId: randomUUID(),
      projectId: input.projectId,
      goalId: input.goalId,
      masterPlanDraftId: input.masterPlanDraftId,
      draftId: null,
      status: 'running',
      phases: input.phases.map((phase) => ({
        code: phase.code,
        name: phase.name,
        status: 'pending' as const,
        taskCount: 0,
        error: null
      })),
      startedAt: now,
      updatedAt: now,
      error: null
    }
    const context: JobContext = {
      job,
      projectName: input.projectName,
      summary: input.summary,
      rules: input.rules,
      selectedItemIds: input.selectedItemIds ?? [],
      phasePlans: input.phases,
      results: new Map(),
      cancelled: false,
      running: false
    }
    // A previous split for the same goal is finished with; its context holds
    // every planned task tree, and nothing looks it up again once the goal
    // points at a newer job.
    const supersededJobId = this.jobIdByGoal.get(this.goalKey(input.projectId, input.goalId))
    if (supersededJobId) this.jobs.delete(supersededJobId)
    this.jobs.set(job.jobId, context)
    this.jobIdByGoal.set(this.goalKey(input.projectId, input.goalId), job.jobId)
    this.startRun(context)
    return job
  }

  /**
   * `run` records its own failures, but nothing awaits it -- so anything that
   * escapes it (a renderer that went away mid-progress-emit) would surface as
   * an unhandled rejection and take the main process with it.
   */
  private startRun(context: JobContext): void {
    void this.run(context).catch((error) => {
      console.error(`Task split job ${context.job.jobId} failed unexpectedly:`, error)
      context.running = false
    })
  }

  cancel(jobId: string): TaskSplitJob {
    const context = this.requireJob(jobId)
    context.cancelled = true
    // The in-flight phase is not abortable mid-stream; it finishes and is discarded.
    if (context.job.status === 'running') {
      this.update(context, { status: 'cancelled' })
    }
    return context.job
  }

  /** Re-runs one failed phase without redoing the phases that already succeeded. */
  retryPhase(jobId: string, phaseCode: string): TaskSplitJob {
    const context = this.requireJob(jobId)
    if (context.running) throw new Error('The split is still running; wait for it to stop')
    this.deps.aiPlanningService.assertAiAvailable(context.job.projectId)
    const phase = context.job.phases.find((entry) => entry.code === phaseCode)
    if (!phase) throw new Error(t('errors:taskSplitJobService.phaseNotPartSplit'))
    context.cancelled = false
    phase.status = 'pending'
    phase.error = null
    this.update(context, { status: 'running', error: null })
    this.startRun(context)
    return context.job
  }

  private requireJob(jobId: string): JobContext {
    const context = this.jobs.get(jobId)
    if (!context) throw new Error('That task split job was not found; start the split again')
    return context
  }

  private update(context: JobContext, patch: Partial<TaskSplitJob>): void {
    Object.assign(context.job, patch, { updatedAt: new Date().toISOString() })
    this.deps.emitProgress(context.job)
  }

  private async run(context: JobContext): Promise<void> {
    if (context.running) return
    context.running = true
    try {
      for (const plan of context.phasePlans) {
        if (context.cancelled) return
        const progress = context.job.phases.find((entry) => entry.code === plan.code)
        if (!progress || progress.status === 'done') continue
        progress.status = 'running'
        progress.error = null
        this.update(context, {})
        try {
          const alreadyPlanned = context.phasePlans
            .filter((earlier) => earlier.code !== plan.code)
            .flatMap((earlier) => {
              const result = context.results.get(earlier.code)
              return result ? digestOf(result.tasks) : []
            })
          const result = await this.deps.aiPlanningService.draftPhaseSplit(
            context.job.projectId,
            context.projectName,
            context.job.goalId,
            context.job.masterPlanDraftId,
            context.summary,
            context.rules,
            plan,
            alreadyPlanned,
            this.nodeBudget(context),
            context.selectedItemIds
          )
          if (context.cancelled) return
          context.results.set(plan.code, result)
          progress.status = 'done'
          progress.taskCount = countNodes(result.tasks)
          this.update(context, {})
          this.deps.notify(
            t('errors:taskSplitJobService.phasePlanned', { code: plan.code }),
            t('errors:taskSplitJobService.tasksReadyReview', {
              count: progress.taskCount,
              planName: plan.name
            }),
            context.job.projectId
          )
        } catch (error) {
          progress.status = 'failed'
          progress.error =
            error instanceof Error
              ? error.message
              : t('errors:taskSplitJobService.failedSplitPhase')
          this.update(context, { status: 'failed', error: progress.error })
          this.deps.notify(
            t('errors:taskSplitJobService.phaseFailed', { code: plan.code }),
            `${plan.name} — ${progress.error} Other phases are kept; retry just this one.`,
            context.job.projectId
          )
          return
        }
      }
      if (context.cancelled) return
      const results = context.phasePlans
        .map((plan) => context.results.get(plan.code))
        .filter(
          (
            result
          ): result is { code: string; name: string; tasks: AIPlanTaskNode[]; warning?: string } =>
            Boolean(result)
        )
      const phases = results.map(({ code, name, tasks }) => ({ code, name, tasks }))
      const warnings = [
        ...new Set(results.flatMap((result) => (result.warning ? [result.warning] : [])))
      ]
      const draft = this.deps.aiPlanningService.finishTaskSplit(
        context.job.projectId,
        context.job.goalId,
        context.job.masterPlanDraftId,
        phases,
        warnings
      )
      this.update(context, { status: 'done', draftId: draft.draftId, error: null })
      this.deps.notify(
        t('errors:taskSplitJobService.taskSplitReady'),
        t('errors:taskSplitJobService.tasksAcrossPhases', {
          count: countNodes(phases.flatMap((phase) => phase.tasks)),
          phases: t('common:count.phase', { count: phases.length })
        }),
        context.job.projectId
      )
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t('errors:taskSplitJobService.taskSplitFailed')
      this.update(context, { status: 'failed', error: message })
    } finally {
      context.running = false
    }
  }

  /**
   * Per-phase node ceiling. The plan-wide cap is 60; dividing it means a phase
   * cannot spend the whole budget and leave later phases nothing.
   */
  private nodeBudget(context: JobContext): number {
    return Math.max(4, Math.floor(48 / context.phasePlans.length))
  }

  /** The stored draft a finished job produced. */
  getDraft(projectId: string, draftId: string): AITaskSplitDraft {
    return this.deps.aiPlanningService.getTaskSplitDraft(projectId, draftId)
  }
}
