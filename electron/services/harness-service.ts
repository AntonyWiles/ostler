import { withMatchedAnswers } from '@shared/comment-answers'
import type {
  AgentLimitUsage,
  AgentModelPrice,
  AgentRunHistory,
  AgentRunRecordOutcome,
  AgentUsageStatus,
  WorkspaceSetupRecord,
  HarnessApplyResult,
  HarnessAttachmentFetch,
  HarnessAttachmentGiven,
  HarnessEmbeddedRuntime,
  HarnessGuidance,
  HarnessPlan,
  HarnessProjectState,
  HarnessQuestion,
  HarnessReport,
  RecentAgentRun,
  HarnessSession,
  HarnessSessionDiff,
  HarnessTask,
  HarnessTaskPlaybook,
  HarnessTaskRejection,
  HarnessTaskReport,
  PlanningPriority,
  ProjectHistory,
  ProjectHistoryEntry,
  ProjectHistoryFilter,
  ProjectUndoResult,
  SessionTranscriptEntry,
  WatchedProject
} from '@shared/ostler-api'
import type { AgentRunChoice } from '@shared/agent-model'
import type { EventDatabase } from './event-database'
import {
  abortAllWorkspaceSetups,
  abortWorkspaceSetup,
  HarnessContextImpl,
  stopWorkspaceSetup
} from './harness/context'
import * as sessions from './harness/sessions'
import * as taskQueue from './harness/task-queue'
import * as taskCopies from './harness/task-copies'
import * as taskReview from './harness/task-review'
import * as reviews from './harness/reviews'
import { REVIEW_STOPPED_NOTE } from './harness/reviews'
import { REVIEWER_RUNS_AVAILABLE } from '@shared/reviewer-runs'
import * as projectHistory from './project-history'
import * as questions from './harness/questions'
import * as plans from './harness/plans'
import * as guidance from './harness/guidance'
import type { AgentEventStream } from './agent-events'
import * as reporting from './harness/reporting'
import { recentAgentRuns } from './harness/recent-runs'
import { changedRunRecords, runRecordFor } from './harness/run-records'
import { readReportPicture, withCopiedPictures } from './harness/report-pictures'
import {
  agentLimitMessage,
  agentLimitUsage,
  buildRunHistory,
  limitPeriods,
  normalizeAgentLimits,
  parseRunFilter,
  reachedLimit,
  runHistoryCsv
} from '@shared/agent-run-history'
import { Refusal } from '@shared/refusal'
import { t } from '@shared/i18n'
import { planWorkspaceSetup, runWorkspaceSetup } from './harness/workspace-setup'
import { projectFolder, requireProjectFolder } from '@shared/project-folder'
import type { HarnessAutomationOptions, HarnessTaskAction } from './harness/types'
import {
  emptyState,
  reviewSessionsAwaitingDecision,
  storedTaskWorkComplete,
  toSession
} from './harness/types'
import type { HistoryOptions } from './project-history'
import type { TaskPlanSource } from './task-plans-service'

export type { HarnessTaskAction, HarnessAutomationOptions, GitWorktreeEntry } from './harness/types'

export {
  parseWorktreeListing,
  normalizeRelativePath,
  formatHarnessReportMarkdown
} from './harness/types'

/**
 * Agent work for each project (simplify pass): the queue, sessions and their
 * passwords, each task's copy of the project, and Apply, Discard, Send back,
 * Stop and Undo. Ostler's own state lives under the data folder; agent copies
 * are worktrees of the person's repository under `<dataDir>/worktrees`, and
 * work reaches the project folder only when the person applies it.
 */
export class HarnessService {
  private readonly ctx: HarnessContextImpl

  constructor(dataDir: string, database: EventDatabase) {
    this.ctx = new HarnessContextImpl(
      dataDir,
      database,
      (project) => this.getState(project),
      (project) => this.getReport(project)
    )
    this.ctx.setRunSink((projectId, before, after) => this.recordRuns(projectId, before, after))
  }

  private modelPrices: () => AgentModelPrice[] = () => []
  private planListener: ((source: TaskPlanSource, plan: HarnessPlan) => void) | null = null
  private historyOptions: () => HistoryOptions & { retentionDays: number } = () => ({
    saveMyEdits: true,
    retentionDays: projectHistory.DEFAULT_RETENTION_DAYS
  })

  /** Teaches the service the person's history settings (Settings › Advanced and › Data). Wired in main. */
  setHistoryOptions(options: () => HistoryOptions & { retentionDays: number }): void {
    this.historyOptions = options
  }

  /** Stops a running agent by session id (the built-in agent's process); wired in main. */
  private runStopper: (sessionId: string) => Promise<void> = async () => undefined

  /**
   * Called before a verdict closes or changes a session's copy (Apply, Send
   * back, Discard, Stop), with whether it is Apply. Try it (N9.4) stops its
   * run here, whichever surface gave the verdict, and refuses Apply while its
   * run's leftover files wait on the person. Wired in main.
   */
  private beforeVerdict: (
    project: WatchedProject,
    sessionId: string,
    verdict: 'apply' | 'other'
  ) => Promise<void> = async () => undefined

  setBeforeVerdict(
    hook: (project: WatchedProject, sessionId: string, verdict: 'apply' | 'other') => Promise<void>
  ): void {
    this.beforeVerdict = hook
  }

  /** A session as stored, or null: what Try it (N9.4) runs against. */
  findSession(project: WatchedProject, sessionId: string): HarnessSession | null {
    const stored = this.ctx.loadState(project.id)?.sessions.find((item) => item.id === sessionId)
    return stored ? toSession(stored) : null
  }

  /**
   * Runs workspace setup in a session's copy unless it already finished
   * successfully (a setup with nothing to run stays skipped), and records the outcome on the
   * session's workspace. Try it (N9.4) calls this before its command.
   */
  async ensureSessionSetup(
    project: WatchedProject,
    sessionId: string,
    signal: AbortSignal
  ): Promise<WorkspaceSetupRecord> {
    const session = this.findSession(project, sessionId)
    const workspace = session?.workspace
    if (!workspace || workspace.closed) throw new Refusal(t('errors:tryIt.noCopy'))
    if (workspace.setup?.status === 'succeeded') return workspace.setup
    const planned = planWorkspaceSetup(project, workspace.worktreePath)
    if (!planned.run) return planned.setup
    const save = (record: WorkspaceSetupRecord) =>
      this.ctx.mutate(project, (state) => {
        const stored = state.sessions.find((item) => item.id === sessionId)
        if (stored?.workspace) stored.workspace.setup = record
      })
    save(planned.setup)
    return runWorkspaceSetup(
      this.ctx,
      project,
      { id: `try-${sessionId}`, worktreePath: workspace.worktreePath, save },
      planned.run,
      signal
    )
  }

  /** Teaches the harness how to stop a running built-in agent, for reviews whose task ended (N9.5a). */
  setRunStopper(stopper: (sessionId: string) => Promise<void>): void {
    this.runStopper = stopper
  }

  /** Review runs being ended, by reviewer session: one ending at a time each (N9.5a). */
  private readonly reviewEnds = new Map<string, Promise<HarnessSession>>()
  /** Review runs Ostler is stopping because the reviewed task ended. */
  private readonly stoppingReviews = new Set<string>()

  /** Copy preparation runs one at a time per project, in queue order. */
  private readonly copyQueues = new Map<string, Promise<void>>()

  /** Teaches the run history the person's prices (Settings › Agents › Usage). Wired in main. */
  setModelPrices(prices: () => AgentModelPrice[]): void {
    this.modelPrices = prices
  }

  /**
   * Writes the run history from a state write (R5.3): every run that ended
   * in it, and every ended run whose record changed. Commits and files come
   * from Git later, while the run's branch still exists (see
   * `fillRunWork`), never from a process left running here.
   */
  private recordRuns(
    projectId: string,
    before: Parameters<typeof changedRunRecords>[1],
    after: Parameters<typeof changedRunRecords>[2]
  ): void {
    const repository = this.ctx.database.agentRuns
    if (!repository) return
    const { records } = changedRunRecords(projectId, before, after)
    for (const record of records) repository.upsert(record)
  }

  /**
   * Reads commits and files from Git for ended runs whose branch is still
   * there (in review) and whose record lacks them. A review's accept or
   * discard reads them before it removes the branch.
   */
  private async fillRunWork(project: WatchedProject): Promise<void> {
    const repository = this.ctx.database.agentRuns
    const stored = this.ctx.loadState(project.id)
    if (!repository || !stored) return
    const missing = new Set(
      repository
        .list(project.id)
        .filter((run) => run.commits === null)
        .map((run) => run.sessionId)
    )
    for (const session of reviewSessionsAwaitingDecision(stored)) {
      if (!missing.has(session.id) || !session.workspace) continue
      await taskCopies.recordSessionWork(this.ctx, project, session.id, session.workspace)
    }
  }

  /** Records every finished run the history does not have yet: runs from before it existed. */
  backfillRunHistory(project: WatchedProject): number {
    const repository = this.ctx.database.agentRuns
    const stored = this.ctx.loadState(project.id)
    if (!repository || !stored) return 0
    let added = 0
    for (const session of stored.sessions) {
      const record = runRecordFor(project.id, stored, session)
      if (record && repository.insertMissing(record)) added += 1
    }
    return added
  }

  /** The Agents view's History and `GET /agent-runs`: runs, totals and a breakdown by model. */
  async getRunHistory(project: WatchedProject, filter: unknown = {}): Promise<AgentRunHistory> {
    await this.fillRunWork(project)
    const runs = this.ctx.database.agentRuns?.list(project.id) ?? []
    return buildRunHistory(runs, parseRunFilter(filter), this.modelPrices())
  }

  /** The filtered history as CSV, for Export CSV and `GET /agent-runs?format=csv`. */
  async getRunHistoryCsv(project: WatchedProject, filter: unknown = {}): Promise<string> {
    return runHistoryCsv((await this.getRunHistory(project, filter)).runs, this.modelPrices())
  }

  /**
   * How much of each token limit the built-in agent has used (D43): the
   * built-in runs that started this day and this month, finished and running.
   */
  getAgentUsage(project: WatchedProject, now = Date.now()): AgentUsageStatus {
    const since = limitPeriods(now).monthStart
    const runs = new Map<
      string,
      { startedAt: number; inputTokens: number | null; outputTokens: number | null }
    >()
    for (const record of this.ctx.database.agentRuns?.listEmbeddedSince(project.id, since) ?? []) {
      runs.set(record.sessionId, record)
    }
    for (const session of this.ctx.loadState(project.id)?.sessions ?? []) {
      if (session.status === 'done' || session.provenance !== 'embedded') continue
      runs.set(session.id, {
        startedAt: Date.parse(session.startedAt),
        inputTokens: session.embeddedRuntime?.usage?.inputTokens ?? null,
        outputTokens: session.embeddedRuntime?.usage?.outputTokens ?? null
      })
    }
    return {
      projectId: project.id,
      ...agentLimitUsage([...runs.values()], normalizeAgentLimits(project.agentLimits), now)
    }
  }

  /** The limit the built-in agent has reached in this project, if any. */
  reachedAgentLimit(project: WatchedProject, now = Date.now()): AgentLimitUsage | null {
    return reachedLimit(this.getAgentUsage(project, now))
  }

  /** Refuses to start a built-in run once a limit is reached (D43), in plain words. */
  assertWithinAgentLimits(project: WatchedProject, now = Date.now()): void {
    const reached = this.reachedAgentLimit(project, now)
    if (!reached) return
    throw new Refusal(agentLimitMessage(reached))
  }

  /**
   * Teaches the harness which queued work its planning dependencies still
   * block. Wired in main.ts; without it every task is dispatchable, which is
   * the right answer for a harness running without planning.
   */
  /**
   * Whether a linked task's work is finished and no longer awaiting a merge
   * decision. Reads stored state directly rather than the projected queue:
   * planning asks this while the harness is projecting its queue, and going
   * through getState() would send the two services round in circles.
   */
  isTaskWorkComplete(project: WatchedProject, taskId: string, sessionId?: string): boolean {
    const stored = this.ctx.loadState(project.id)
    return stored ? storedTaskWorkComplete(stored, taskId, sessionId) : false
  }

  /**
   * The board column a reviewed session's work item belongs in, read from what
   * actually happened to its task rather than from which button was pressed.
   * Accepting a session whose task was already handed back to the queue (an
   * agent that gave up, a run Ostler interrupted) used to mark the item done
   * anyway -- releasing every item that depended on work nobody did.
   */
  workItemStatusForTask(project: WatchedProject, taskId: string): 'done' | 'ready' | null {
    const task = this.ctx.loadState(project.id)?.tasks.find((candidate) => candidate.id === taskId)
    if (task?.status === 'complete') return 'done'
    if (task?.status === 'pending') return 'ready'
    return null
  }

  /**
   * Which planning work item each harness task ran, and which tasks each
   * session held, so a task's activity can show its agent runs (P5.2). Read
   * from stored state, like isTaskWorkComplete.
   */
  activityLinks(project: WatchedProject): {
    taskWorkItems: Map<string, string>
    sessions: Map<string, { builtIn: boolean; taskIds: string[] }>
  } {
    const stored = this.ctx.loadState(project.id)
    const taskWorkItems = new Map<string, string>()
    const sessions = new Map<string, { builtIn: boolean; taskIds: string[] }>()
    for (const task of stored?.tasks ?? []) {
      if (task.planningWorkItemId) taskWorkItems.set(task.id, task.planningWorkItemId)
    }
    for (const session of stored?.sessions ?? []) {
      const taskIds = new Set<string>()
      if (session.taskId) taskIds.add(session.taskId)
      if (session.assignedTaskId) taskIds.add(session.assignedTaskId)
      for (const task of stored?.tasks ?? [])
        if (task.claimedBy === session.id) taskIds.add(task.id)
      sessions.set(session.id, {
        builtIn: session.provenance === 'embedded',
        taskIds: [...taskIds]
      })
    }
    return { taskWorkItems, sessions }
  }

  setPlanningDispatchResolver(
    resolver: ((projectId: string, planningWorkItemId: string, sessionId?: string) => number) | null
  ): void {
    this.ctx.setDispatchableResolver(resolver)
  }

  /**
   * Teaches every claim path about open blockers. Auto-dispatch already
   * refused blocked work; without this, the same work was still claimable
   * over the agent HTTP API, which is the opposite of what reporting a
   * blocker is documented to do.
   */
  setPlanningBlockerResolver(
    resolver: ((projectId: string, planningWorkItemId: string) => boolean) | null
  ): void {
    this.ctx.setBlockedResolver(resolver)
  }

  startMonitoring(
    project: WatchedProject,
    pollIntervalMs: number,
    onStateChange: (projectId: string, state: HarnessProjectState) => void,
    automation: Partial<HarnessAutomationOptions> = {}
  ): void {
    try {
      this.backfillRunHistory(project)
    } catch (error) {
      console.error(`[HarnessService] Run history backfill failed for ${project.id}:`, error)
    }
    reporting.startMonitoring(this.ctx, project, pollIntervalMs, onStateChange, automation)
  }

  stopMonitoring(projectId: string): void {
    reporting.stopMonitoring(this.ctx, projectId)
  }

  /**
   * App shutdown: stops monitoring and aborts every workspace setup in flight,
   * so no installer outlives Ostler.
   */
  stopAll(): void {
    reporting.stopAll(this.ctx)
    abortAllWorkspaceSetups(this.ctx)
  }

  /**
   * Called on every workspace setup change, so the UI shows setup as it runs.
   * Wired in main, next to the other harness state notifications.
   */
  setWorkspaceSetupListener(listener: ((project: WatchedProject) => void) | null): void {
    this.ctx.setWorkspaceSetupNotifier(listener)
  }

  /** A session's setup record. Setup finishes while the copy is prepared, before any agent starts. */
  async waitForWorkspaceSetup(
    project: WatchedProject,
    sessionId: string
  ): Promise<WorkspaceSetupRecord> {
    return sessions.workspaceSetupRecord(this.ctx, project, sessionId)
  }

  getWorkspaceSetup(project: WatchedProject, sessionId: string): WorkspaceSetupRecord {
    return sessions.workspaceSetupRecord(this.ctx, project, sessionId)
  }

  /** Aborts the setup of one task's copy. */
  cancelWorkspaceSetup(taskId: string): void {
    abortWorkspaceSetup(this.ctx, taskCopies.copySetupKey(taskId))
  }

  /** Aborts every workspace setup in flight, for the emergency stop. */
  cancelAllWorkspaceSetups(): void {
    abortAllWorkspaceSetups(this.ctx)
  }

  getState(project: WatchedProject): HarnessProjectState {
    const state = reporting.getState(this.ctx, project)
    const problem = this.legacyProblem(project.id)
    const folder = projectFolder(project)
    return {
      ...state,
      folderVersion: folder ? taskCopies.folderVersionNow(folder) : null,
      ...(problem ? { legacyMigrationProblem: problem } : {})
    }
  }

  private legacyProblem: (projectId: string) => string | null = () => null

  /** Wired in main: why a project's move from the old agent setup failed, if it did (§6). */
  setLegacyMigrationProblem(problem: (projectId: string) => string | null): void {
    this.legacyProblem = problem
  }

  /** Returns the latest automated report, generating one if this project has no report yet. */
  /** Finished agent runs for the Agents view's Recent runs, newest first. */
  getRecentRuns(project: WatchedProject, limit = 10): RecentAgentRun[] {
    const stored = this.ctx.loadState(project.id)
    if (!stored) return []
    const inReview = new Set(reviewSessionsAwaitingDecision(stored).map((session) => session.id))
    return recentAgentRuns(stored.sessions, inReview, limit)
  }

  getReport(project: WatchedProject): HarnessReport {
    return reporting.getReport(this.ctx, project)
  }

  /** Rebuilds the report after an explicit management action. */
  refreshReport(project: WatchedProject): HarnessReport {
    return reporting.refreshReport(this.ctx, project)
  }

  /**
   * Starts an agent on a queued task (§2.3): claims it and starts the session
   * together, in the task's ready copy. The external path: the session's own
   * password is what the agent signs in with.
   */
  async startSessionForTask(project: WatchedProject, taskId: string): Promise<HarnessSession> {
    return this.startForTask(project, taskId, 'external')
  }

  /**
   * The built-in agent's start: the same claim and copy as an external agent,
   * marked `embedded` so `OpenCodeRunnerService` drives it. Does not itself
   * start any process.
   */
  async startEmbeddedSessionForTask(
    project: WatchedProject,
    taskId: string
  ): Promise<HarnessSession> {
    // Every built-in start comes through here: the app, auto-dispatch and the API.
    this.assertWithinAgentLimits(project)
    return this.startForTask(project, taskId, 'embedded')
  }

  private async startForTask(
    project: WatchedProject,
    taskId: string,
    provenance: 'external' | 'embedded'
  ): Promise<HarnessSession> {
    const session = await sessions.startSessionForTask(
      this.ctx,
      project,
      taskId,
      this.historyOptions(),
      provenance
    )
    this.ctx.notifyWorkspaceSetup(project)
    return session
  }

  /**
   * Prepares copies for the next `limit` queued tasks (§2.2) and removes the
   * ones nothing will use. Serialized per project; safe to call often.
   */
  prepareCopies(project: WatchedProject, limit: number): Promise<void> {
    const previous = this.copyQueues.get(project.id) ?? Promise.resolve()
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        await taskCopies.tidyCopies(this.ctx, project)
        await taskCopies.ensureCopies(this.ctx, project, limit, this.historyOptions())
      })
      .catch((error: unknown) => {
        console.error(`[HarnessService] Preparing copies failed for ${project.id}:`, error)
      })
    this.copyQueues.set(project.id, next)
    return next
  }

  /** Records the opencode process backing an embedded session once it is actually running. */
  setEmbeddedRuntime(
    project: WatchedProject,
    sessionId: string,
    embeddedRuntime: HarnessEmbeddedRuntime
  ): HarnessSession {
    return sessions.setEmbeddedRuntime(this.ctx, project, sessionId, embeddedRuntime)
  }

  /** Records the library attachments a coding session was given. See `sessions.recordAttachmentsGiven`. */
  recordAttachmentsGiven(
    project: WatchedProject,
    sessionId: string,
    attachments: HarnessAttachmentGiven[]
  ): HarnessSession {
    return sessions.recordAttachmentsGiven(this.ctx, project, sessionId, attachments)
  }

  /** Records one attachment download by an external session. See `sessions.recordAttachmentFetch`. */
  recordAttachmentFetch(
    project: WatchedProject,
    sessionId: string,
    fetch: Omit<HarnessAttachmentFetch, 'fetchedAt'>
  ): void {
    sessions.recordAttachmentFetch(this.ctx, project, sessionId, fetch)
  }

  /** Authenticates a session's own password (§2.3). There is no project-wide password. */
  resolveToken(
    project: WatchedProject,
    token: string
  ): { valid: boolean; sessionId: string | null; expiredSessionId: string | null } {
    return sessions.resolveToken(this.ctx, project, token)
  }

  /** Records that an agent signed in with its session password. */
  touchSessionConnection(project: WatchedProject, sessionId: string): void {
    sessions.touchSessionConnection(this.ctx, project, sessionId)
  }

  /** Read-only: the changes in a session's copy, and whether the folder switched versions (§4). */
  async getSessionDiff(project: WatchedProject, sessionId: string): Promise<HarnessSessionDiff> {
    return taskCopies.getSessionDiff(this.ctx, project, sessionId)
  }

  /**
   * Saves an agent's unsaved leftovers on its copy's own version, so work the
   * agent did not save is reviewable. Never touches the project folder.
   */
  async commitSessionLeftovers(
    project: WatchedProject,
    sessionId: string,
    message: string
  ): Promise<taskCopies.SessionLeftoverCommit> {
    const session = this.ctx.loadState(project.id)?.sessions.find((item) => item.id === sessionId)
    if (!session?.workspace || session.workspace.closed) return { committed: false, files: [] }
    return taskCopies.commitCopyLeftovers(session.workspace.worktreePath, message)
  }

  /** Apply (§3.2): the task's work into the project folder, one entry per task. */
  async applyTaskWork(
    project: WatchedProject,
    sessionId: string,
    onCurrentVersion = false
  ): Promise<HarnessApplyResult> {
    await this.beforeVerdict(project, sessionId, 'apply')
    const result = await taskReview.applyTaskWork(
      this.ctx,
      project,
      sessionId,
      this.historyOptions(),
      onCurrentVersion
    )
    await this.stopReviewsOf(project, sessionId)
    this.ctx.notifyWorkspaceSetup(project)
    return result
  }

  /** Discard (§3.3): the copy goes, its work is kept for Bring back. */
  async discardTaskWork(project: WatchedProject, sessionId: string): Promise<HarnessSession> {
    await this.beforeVerdict(project, sessionId, 'other')
    const session = await taskReview.discardTaskWork(this.ctx, project, sessionId)
    await this.stopReviewsOf(project, sessionId)
    return session
  }

  /** Send back (§3.3): the task returns to its agent with a note, in the same copy. */
  async sendBackTaskWork(
    project: WatchedProject,
    sessionId: string,
    reason: string,
    disposition: HarnessTaskRejection['disposition'],
    runAgainWith?: AgentRunChoice,
    /** Line comments (N9.2a), unchecked; absent sends the session's drafts. */
    comments?: unknown
  ): Promise<HarnessSession> {
    await this.beforeVerdict(project, sessionId, 'other')
    const session = await taskReview.sendBack(
      this.ctx,
      project,
      sessionId,
      reason,
      disposition,
      runAgainWith,
      comments
    )
    await this.stopReviewsOf(project, sessionId)
    return session
  }

  /** Keeps the person's draft line comments with the session (N9.2a). */
  saveReviewDrafts(project: WatchedProject, sessionId: string, drafts: unknown): HarnessSession {
    return taskReview.saveReviewDrafts(this.ctx, project, sessionId, drafts)
  }

  /**
   * Stop: ends a running agent, keeps its work as discarded work, and puts its
   * task back in the queue. The caller stops the agent's process first.
   */
  async stopSession(project: WatchedProject, sessionId: string): Promise<HarnessSession> {
    if (this.isReviewRun(project, sessionId)) {
      return this.endReview(project, sessionId, { outcome: 'stopped', note: 'Stopped' })
    }
    await this.beforeVerdict(project, sessionId, 'other')
    const session = await taskReview.stopSession(this.ctx, project, sessionId)
    await this.stopReviewsOf(project, sessionId)
    return session
  }

  /**
   * Starts a review of a session in review (N9.5a): a review task queued
   * ahead of ordinary work, for an embedded or external agent. At most one per
   * session at a time. Refused while reviewer runs are unavailable.
   */
  async startReview(project: WatchedProject, sessionId: string): Promise<HarnessTask> {
    const task = await reviews.startReview(this.ctx, project, sessionId)
    this.ctx.notifyWorkspaceSetup(project)
    return task
  }

  /** What a review run reviews, or null for any other session (N9.5a). */
  sessionReviewOf(project: WatchedProject, sessionId: string): HarnessSession['reviewOf'] | null {
    return (
      this.ctx.loadState(project.id)?.sessions.find((session) => session.id === sessionId)
        ?.reviewOf ?? null
    )
  }

  private isReviewRun(project: WatchedProject, sessionId: string): boolean {
    return this.sessionReviewOf(project, sessionId) !== null
  }

  /** Ends a review run, after any ending already under way for it (N9.5a). */
  private endReview(
    project: WatchedProject,
    sessionId: string,
    ending: reviews.ReviewEnding
  ): Promise<HarnessSession> {
    // A run Ostler is stopping because the reviewed task ended ends as stopped,
    // whatever its agent's own ending says.
    const final: reviews.ReviewEnding = this.stoppingReviews.has(sessionId)
      ? { outcome: 'stopped', note: REVIEW_STOPPED_NOTE }
      : ending
    const previous = this.reviewEnds.get(sessionId) ?? Promise.resolve(null)
    const next = previous
      .catch(() => null)
      .then(() => reviews.endReviewRun(this.ctx, project, sessionId, final))
    this.reviewEnds.set(sessionId, next)
    next
      .finally(() => {
        if (this.reviewEnds.get(sessionId) === next) this.reviewEnds.delete(sessionId)
        this.ctx.notifyWorkspaceSetup(project)
      })
      .catch((error: unknown) => {
        console.error(`[HarnessService] Ending review run ${sessionId} failed:`, error)
      })
    return next
  }

  /** How a review run's report ends it: a report of its own, or none. */
  private reviewEnding(report: HarnessTaskReport | null, note: string): reviews.ReviewEnding {
    const own =
      report &&
      !report.missing &&
      report.outcome !== 'unreported' &&
      report.outcome !== 'abandoned' &&
      report.outcome !== 'no-response'
    return own ? { outcome: 'reported', report, note } : { outcome: 'not-reported', note }
  }

  /** Waits for every review ending under way (N9.5a). */
  async settleReviewEnds(): Promise<void> {
    await Promise.allSettled([...this.reviewEnds.values()])
  }

  /** Stops the review of a session whose task just ended (N9.5a). Never fails the person's action. */
  private async stopReviewsOf(project: WatchedProject, sessionId: string): Promise<void> {
    try {
      await reviews.stopReviewsOf(this.ctx, project, sessionId, async (reviewerId) => {
        this.stoppingReviews.add(reviewerId)
        try {
          await this.runStopper(reviewerId)
          await this.reviewEnds.get(reviewerId)?.catch(() => undefined)
        } finally {
          this.stoppingReviews.delete(reviewerId)
        }
      })
    } catch (error) {
      console.error(`[HarnessService] Stopping the review of ${sessionId} failed:`, error)
    }
  }

  /** Bring back (§3.3): recreates a discarded task's copy and puts it up for review again. */
  async bringBackTaskWork(project: WatchedProject, sessionId: string): Promise<HarnessSession> {
    // In line with copy preparation, so the task's queue copy is never half made.
    const previous = this.copyQueues.get(project.id) ?? Promise.resolve()
    const run = previous
      .catch(() => undefined)
      .then(() => taskReview.bringBackTaskWork(this.ctx, project, sessionId))
    this.copyQueues.set(
      project.id,
      run.then(
        () => undefined,
        () => undefined
      )
    )
    return run
  }

  /** The History view (§3.5): entries, the folder's version, and work that can be brought back. */
  async getProjectHistory(
    project: WatchedProject,
    filter: ProjectHistoryFilter = {}
  ): Promise<ProjectHistory> {
    const folder = requireProjectFolder(project, 'Reading the project history')
    if (!projectHistory.hasOwnRepository(folder)) {
      return { available: false, version: null, entries: [], discarded: [] }
    }
    const [entries, version, discarded] = await Promise.all([
      projectHistory.listHistory(folder, filter),
      projectHistory.currentVersion(folder),
      taskReview.listDiscardedWork(this.ctx, project)
    ])
    return { available: true, version: version.version, entries, discarded }
  }

  /** Undo one or more entries (§3.5), recorded as a new entry that can itself be undone. */
  async undoHistoryEntries(
    project: WatchedProject,
    entryIds: string[]
  ): Promise<ProjectUndoResult> {
    const folder = requireProjectFolder(project, 'Undoing a change')
    return projectHistory.undoEntries(folder, entryIds, this.historyOptions())
  }

  /** Sets the folder back to how it was at an entry, as a new entry (§3.5). */
  async restoreToHistoryEntry(
    project: WatchedProject,
    entryId: string
  ): Promise<ProjectHistoryEntry> {
    const folder = requireProjectFolder(project, 'Restoring the project folder')
    return projectHistory.restoreToEntry(folder, entryId, this.historyOptions())
  }

  /** Deletes restore points and discarded work past the retention period (§3.5). */
  async pruneHistory(project: WatchedProject): Promise<number> {
    const folder = requireProjectFolder(project, 'Tidying the project history')
    return projectHistory.pruneExpired(folder, this.historyOptions().retentionDays)
  }

  /** Where this project's agent copies live (`<dataDir>/worktrees/<project-id>`). */
  copiesRoot(projectId: string): string {
    return taskCopies.copiesRoot(this.ctx, projectId)
  }

  /**
   * Removes every copy of a project that is leaving Ostler. Work in them stays
   * on their `ostler/*` versions in the person's repository; returns those names.
   */
  async releaseProjectCopies(project: WatchedProject): Promise<string[]> {
    const stored = this.ctx.loadState(project.id)
    if (!stored) return []
    let git
    try {
      git = taskCopies.repositoryGit(project)
    } catch {
      return []
    }
    const kept: string[] = []
    // A copy still being prepared has an installer holding files open in it.
    for (const task of stored.tasks) {
      if (task.copy) await stopWorkspaceSetup(this.ctx, taskCopies.copySetupKey(task.id))
    }
    const copies = [
      ...stored.tasks.flatMap((task) => (task.copy ? [task.copy] : [])),
      ...stored.sessions.flatMap((session) =>
        session.workspace && !session.workspace.closed ? [session.workspace] : []
      )
    ]
    for (const copy of copies) {
      try {
        await taskCopies.removeCopy(git, copy, { keepBranch: true })
        // A reviewer's detached copy has no version to keep (N9.5a).
        if (copy.branchName) kept.push(copy.branchName)
      } catch (error) {
        console.warn(`[HarnessService] Could not remove copy ${copy.worktreePath}:`, error)
      }
    }
    return kept
  }

  updateSession(
    project: WatchedProject,
    sessionId: string,
    note: string,
    done: boolean,
    report: HarnessTaskReport | null = null,
    endedAs?: AgentRunRecordOutcome
  ): HarnessSession {
    // A review run's end (N9.5a): findings checked and its copy removed, in the background.
    if (done && this.isReviewRun(project, sessionId)) {
      this.endReview(project, sessionId, this.reviewEnding(report, note)).catch(() => undefined)
      return this.currentSession(project, sessionId)
    }
    return sessions.updateSession(
      this.ctx,
      project,
      sessionId,
      note,
      done,
      this.reportWithPictures(project, sessionId, report),
      endedAs
    )
  }

  /**
   * Copies a report's pictures out of the session's copy before anything can
   * remove it (N9.1), and matches its answers to line comments (N9.2b): the
   * one place both agent paths' reports pass through.
   */
  private reportWithPictures(
    project: WatchedProject,
    sessionId: string,
    given: HarnessTaskReport | null
  ): HarnessTaskReport | null {
    const state = this.ctx.loadState(project.id)
    const session = state?.sessions.find((item) => item.id === sessionId)
    // Answers to line comments (N9.2b) are kept only for the comments the
    // session's task was last sent back with; other ids are listed as ignored.
    const task = state?.tasks.find(
      (item) =>
        (item.status === 'claimed' && item.claimedBy === sessionId) ||
        (Boolean(session?.taskId) && item.id === session?.taskId)
    )
    const report = withMatchedAnswers(given, task?.rejections)
    if (!report?.pictureRequests) return report
    const workspace = session?.workspace
    return withCopiedPictures(
      report,
      workspace && !workspace.closed ? workspace.worktreePath : null,
      this.ctx.projectDir(project.id),
      sessionId
    )
  }

  /** One picture from a session's report, by its stored name; null for anything else. */
  readReportPicture(
    project: WatchedProject,
    sessionId: string,
    name: string
  ): { bytes: Buffer; mimeType: string } | null {
    const known = this.ctx.loadState(project.id)?.sessions.some((item) => item.id === sessionId)
    return known ? readReportPicture(this.ctx.projectDir(project.id), sessionId, name) : null
  }

  failSession(
    project: WatchedProject,
    sessionId: string,
    note: string,
    endedAs?: AgentRunRecordOutcome
  ): HarnessSession {
    if (this.isReviewRun(project, sessionId)) {
      this.endReview(project, sessionId, { outcome: 'not-reported', note }).catch(() => undefined)
      return this.currentSession(project, sessionId)
    }
    return sessions.failSession(this.ctx, project, sessionId, note, endedAs)
  }

  private currentSession(project: WatchedProject, sessionId: string): HarnessSession {
    const session = this.ctx.loadState(project.id)?.sessions.find((item) => item.id === sessionId)
    if (!session) throw new Error(`Session ${sessionId} not found`)
    return toSession(session)
  }

  async completeSessionWithAutoContinuation(
    project: WatchedProject,
    sessionId: string,
    note: string,
    completedTaskId: string | null,
    report: HarnessTaskReport | null = null
  ): Promise<{ session: HarnessSession; nextTask: HarnessTask | null }> {
    // A review run never continues to other work (N9.5a).
    if (this.isReviewRun(project, sessionId)) {
      const session = await this.endReview(project, sessionId, this.reviewEnding(report, note))
      return { session, nextTask: null }
    }
    let finishedAt: string | null = null
    const stored = this.ctx.loadState(project.id)
    const session = stored?.sessions.find((item) => item.id === sessionId)
    // Marks where the finished task's work ends in the copy before the session
    // may continue to a next task, so Apply adds one entry per task (§3.2).
    if (completedTaskId && session?.workspace && !session.workspace.closed) {
      try {
        const task = stored?.tasks.find((candidate) => candidate.id === completedTaskId)
        await taskCopies.commitCopyLeftovers(
          session.workspace.worktreePath,
          task?.title ?? completedTaskId
        )
        finishedAt = (
          await taskCopies.repositoryGit(project).raw(['rev-parse', session.workspace.branchName])
        ).trim()
      } catch {
        // Without a mark, Apply records the session's tasks as one entry.
      }
    }
    return sessions.completeSessionWithAutoContinuation(
      this.ctx,
      project,
      sessionId,
      note,
      completedTaskId,
      this.reportWithPictures(project, sessionId, report),
      finishedAt
    )
  }

  addTask(
    project: WatchedProject,
    title: string,
    details: string,
    taskId: string = undefined as unknown as string,
    priority: PlanningPriority = 'medium',
    planningWorkItemId: string | null = null,
    autoContinue = false
  ): HarnessTask {
    return taskQueue.addTask(
      this.ctx,
      project,
      title,
      details,
      taskId,
      priority,
      planningWorkItemId,
      autoContinue
    )
  }

  /** Human queue action: the model and effort for a queued task's run (D42), already validated. */
  setTaskRunModel(project: WatchedProject, taskId: string, choice: AgentRunChoice): HarnessTask {
    return taskQueue.setTaskRunModel(this.ctx, project, taskId, choice)
  }

  /** Run playbook (N9.6b): the playbook a queued task came from. */
  setTaskPlaybook(
    project: WatchedProject,
    taskId: string,
    playbook: HarnessTaskPlaybook
  ): HarnessTask {
    return taskQueue.setTaskPlaybook(this.ctx, project, taskId, playbook)
  }

  /** Scheduled agent tasks (N9.7): a queued task its repeat's schedule queued. */
  setTaskScheduled(project: WatchedProject, taskId: string): HarnessTask {
    return taskQueue.setTaskScheduled(this.ctx, project, taskId)
  }

  setTaskHold(project: WatchedProject, taskId: string, hold: boolean): HarnessTask {
    return taskQueue.setTaskHold(this.ctx, project, taskId, hold)
  }

  setTaskAutoContinue(project: WatchedProject, taskId: string, enabled: boolean): HarnessTask {
    return taskQueue.setTaskAutoContinue(this.ctx, project, taskId, enabled)
  }

  updateTask(
    project: WatchedProject,
    taskId: string,
    action: HarnessTaskAction,
    sessionId: string
  ): HarnessTask {
    return taskQueue.updateTask(this.ctx, project, taskId, action, sessionId)
  }

  /** Human queue action: cancel work that no session has reserved or claimed. */
  cancelTask(
    project: WatchedProject,
    taskId: string,
    planningWorkItemId: string | null = null
  ): HarnessTask {
    return taskQueue.cancelTask(this.ctx, project, taskId, planningWorkItemId)
  }

  /** Human queue action: persist the exact order of all unreserved queued work. */
  reorderPendingTasks(project: WatchedProject, orderedTaskIds: string[]): HarnessTask[] {
    return taskQueue.reorderPendingTasks(this.ctx, project, orderedTaskIds)
  }

  /** Human queue action: adjust scheduling priority without changing execution ownership. */
  setTaskPriority(
    project: WatchedProject,
    taskId: string,
    priority: PlanningPriority,
    planningWorkItemId: string | null = null
  ): HarnessTask {
    return taskQueue.setTaskPriority(this.ctx, project, taskId, priority, planningWorkItemId)
  }

  /** Re-copies a queued, unheld task's text from its work item. See `taskQueue.syncPendingTaskText`. */
  syncPendingTaskText(
    project: WatchedProject,
    taskId: string,
    title: string,
    details: string
  ): HarnessTask | null {
    return taskQueue.syncPendingTaskText(this.ctx, project, taskId, title, details)
  }

  /** An agent session blocks itself pending human input. Surfaced as a report alert until answered. */
  askQuestion(project: WatchedProject, sessionId: string, question: string): HarnessQuestion {
    return questions.askQuestion(this.ctx, project, sessionId, question)
  }

  /** Plan first (N9.3a): asks a queued task for a plan first. Refused while plans are unavailable. */
  setTaskPlanFirst(project: WatchedProject, taskId: string, planFirst: boolean): HarnessTask {
    return plans.setTaskPlanFirst(this.ctx, project, taskId, planFirst)
  }

  /** An agent sends its plan; the session waits on the person. See `plans.submitPlan`. */
  submitPlan(
    project: WatchedProject,
    sessionId: string,
    plan: { steps?: unknown; files?: unknown; risks?: unknown }
  ): HarnessPlan {
    return this.planChanged(
      project,
      sessionId,
      plans.submitPlan(this.ctx, project, sessionId, plan)
    )
  }

  /** The person approves a session's pending plan, recording what changed before approval. */
  async approvePlan(project: WatchedProject, sessionId: string): Promise<HarnessPlan> {
    return this.planChanged(
      project,
      sessionId,
      await plans.approvePlan(this.ctx, project, sessionId)
    )
  }

  /** The person asks for changes to a session's pending plan; the agent sends a new version. */
  requestPlanChanges(project: WatchedProject, sessionId: string, note: string): HarnessPlan {
    return this.planChanged(
      project,
      sessionId,
      plans.requestPlanChanges(this.ctx, project, sessionId, note)
    )
  }

  /**
   * The person cancels at the plan: the run ends as Stop ends one. The caller
   * stops an embedded agent's process first, as for `stopSession`.
   */
  async cancelPlan(project: WatchedProject, sessionId: string): Promise<HarnessSession> {
    const session = await plans.cancelPlan(this.ctx, project, sessionId)
    if (session.plan) this.planChanged(project, sessionId, session.plan)
    return session
  }

  /**
   * Stop from any surface (N9.3b): a run waiting on its plan is cancelled at
   * the plan, so the plan reads "cancelled"; any other run stops as before.
   * The caller stops an embedded agent's process first.
   */
  async stopRun(project: WatchedProject, sessionId: string): Promise<HarnessSession> {
    if (this.getSessionPlan(project, sessionId)?.status === 'pending') {
      const open = this.ctx
        .loadState(project.id)
        ?.sessions.find((session) => session.id === sessionId && session.status !== 'done')
      if (open) return this.cancelPlan(project, sessionId)
    }
    return this.stopSession(project, sessionId)
  }

  /**
   * Hears every plan sent or decided (N9.3b), with the run and task it is
   * for, so plans can be kept with their tasks. One listener.
   */
  setPlanListener(listener: ((source: TaskPlanSource, plan: HarnessPlan) => void) | null): void {
    this.planListener = listener
  }

  private planChanged(project: WatchedProject, sessionId: string, plan: HarnessPlan): HarnessPlan {
    if (!this.planListener) return plan
    try {
      const state = this.ctx.loadState(project.id) ?? emptyState()
      const session = state.sessions.find((item) => item.id === sessionId)
      const taskId = session?.taskId ?? session?.assignedTaskId ?? null
      const task =
        state.tasks.find((item) => item.id === taskId) ??
        state.tasks.find((item) => item.claimedBy === sessionId)
      this.planListener(
        {
          projectId: project.id,
          sessionId,
          taskId: task?.id ?? taskId,
          workItemId: task?.planningWorkItemId ?? null
        },
        plan
      )
    } catch (error) {
      console.error(`Keeping plan version ${plan.version} of ${sessionId} failed:`, error)
    }
    return plan
  }

  /** Whether a session must still send a plan, or wait for one, before it changes files. */
  sessionMayChangeFiles(project: WatchedProject, sessionId: string): boolean {
    return plans.sessionMayChangeFiles(this.ctx.loadState(project.id) ?? emptyState(), sessionId)
  }

  /** Whether a session's task asks for a plan first. */
  sessionPlanFirst(project: WatchedProject, sessionId: string): boolean {
    return plans.sessionPlanFirst(this.ctx.loadState(project.id) ?? emptyState(), sessionId)
  }

  /** A session's plan as it stands, or null when it has sent none. */
  getSessionPlan(project: WatchedProject, sessionId: string): HarnessPlan | null {
    return (
      this.ctx.loadState(project.id)?.sessions.find((session) => session.id === sessionId)?.plan ??
      null
    )
  }

  /**
   * Sends every state change on to the agent event stream (D41) as events:
   * runs, questions, the queue and guidance, from whichever path wrote them.
   */
  setAgentEventStream(stream: AgentEventStream | null): void {
    this.eventStream = stream
    this.wireEventSink()
  }

  private eventStream: AgentEventStream | null = null
  private reviewBeforeMe: ((projectId: string) => WatchedProject | null) | null = null

  /**
   * Review agent work before me (N9.5b): `lookup` gives the project when its
   * switch is on, else null. A session of such a project entering review
   * starts a review, whichever path ended it.
   */
  setReviewBeforeMe(lookup: ((projectId: string) => WatchedProject | null) | null): void {
    this.reviewBeforeMe = lookup
    this.wireEventSink()
  }

  private wireEventSink(): void {
    const stream = this.eventStream
    const lookup = this.reviewBeforeMe
    this.ctx.setEventSink(
      stream || lookup
        ? (projectId, events) => {
            for (const event of events) {
              stream?.publish(projectId, event)
              if (lookup && event.type === 'run.review' && event.sessionId) {
                const sessionId = event.sessionId
                // After the write that raised it has finished.
                setImmediate(() => void this.reviewOnEntry(lookup, projectId, sessionId))
              }
            }
          }
        : null
    )
  }

  /** Starts the review of a session that just entered review with changes, when its project asks for one. */
  private async reviewOnEntry(
    lookup: (projectId: string) => WatchedProject | null,
    projectId: string,
    sessionId: string
  ): Promise<void> {
    if (!REVIEWER_RUNS_AVAILABLE) return
    const project = lookup(projectId)
    if (!project) return
    try {
      const task = await reviews.startReview(this.ctx, project, sessionId, {
        onlyWithChanges: true
      })
      if (task) this.ctx.notifyWorkspaceSetup(project)
    } catch (error) {
      console.warn(
        `[HarnessService] Could not start the review of ${sessionId}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  /** Dismisses, or brings back, one of the reviewer's findings on a session (N9.5b). */
  dismissReviewFinding(
    project: WatchedProject,
    sessionId: string,
    findingId: string,
    dismissed = true
  ): HarnessSession {
    return reviews.dismissFinding(this.ctx, project, sessionId, findingId, dismissed)
  }

  /**
   * Stores a message from the person for a running run (D41). Refused for a
   * run that has ended, an empty or over-long message, or one over the rate
   * cap. Delivery is separate: see `RunGuidanceService`.
   */
  addGuidance(
    project: WatchedProject,
    sessionId: string,
    text: string,
    from: string,
    via: HarnessGuidance['via']
  ): HarnessGuidance {
    return guidance.addGuidance(this.ctx, project, sessionId, text, from, via)
  }

  /** Marks a message delivered once the embedded runner has posted it into the session. */
  markGuidanceDelivered(project: WatchedProject, guidanceId: string): HarnessGuidance | null {
    return guidance.markGuidanceDelivered(this.ctx, project, guidanceId)
  }

  /** An external agent's waiting messages, marked delivered: each is returned once. */
  takeUndeliveredGuidance(project: WatchedProject, sessionId: string): HarnessGuidance[] {
    return guidance.takeUndeliveredGuidance(this.ctx, project, sessionId)
  }

  /** A human answers a pending agent question, unblocking the session. */
  answerQuestion(project: WatchedProject, questionId: string, answer: string): HarnessQuestion {
    return questions.answerQuestion(this.ctx, project, questionId, answer)
  }

  /**
   * The folder holding this project's agent copies. Callers that need to
   * validate a copy's path (the Files tab's IPC handlers) use this.
   */
  getProjectWorkspaceRoot(projectId: string): string {
    return taskCopies.copiesRoot(this.ctx, projectId)
  }

  /** The folder holding this project's agent state and reports, deleted when the project is. */
  getProjectDataDir(projectId: string): string {
    return this.ctx.projectDir(projectId)
  }

  recordSessionTranscript(
    project: WatchedProject,
    sessionId: string,
    entries: SessionTranscriptEntry[],
    limit?: number,
    replace?: boolean
  ): { accepted: number } {
    return sessions.recordSessionTranscript(this.ctx, project, sessionId, entries, limit, replace)
  }

  getSessionTranscript(project: WatchedProject, sessionId: string): SessionTranscriptEntry[] {
    const transcript = this.ctx.database.getSessionTranscript(project.id, sessionId)
    return transcript?.entries ?? []
  }
}
