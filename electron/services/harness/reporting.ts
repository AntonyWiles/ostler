import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'crypto'
import type {
  HarnessAutomationStatus,
  HarnessProjectState,
  HarnessReport,
  HarnessReportAlert,
  HarnessTask,
  WatchedProject
} from '@shared/ostler-api'
import type { HarnessContext } from './context'
import { openReviewTask } from './reviews'
import { reviewWait } from '@shared/reviewer-runs'
import {
  DEFAULT_AUTOMATION_OPTIONS,
  emptyState,
  reviewSessionsAwaitingDecision,
  toSession,
  type HarnessAutomationOptions,
  type MonitorState,
  type StoredTask
} from './types'

export function startMonitoring(
  ctx: HarnessContext,
  project: WatchedProject,
  pollIntervalMs: number,
  onStateChange: (projectId: string, state: HarnessProjectState) => void,
  automation: Partial<HarnessAutomationOptions> = {}
): void {
  stopMonitoring(ctx, project.id)
  const stored = ctx.loadState(project.id) ?? emptyState()
  stored.watcherRunning = true
  ctx.saveState(project.id, stored)
  const options: HarnessAutomationOptions = {
    ...DEFAULT_AUTOMATION_OPTIONS,
    ...automation,
    pollIntervalMs,
    reportIntervalMs: Math.max(
      1000,
      automation.reportIntervalMs ?? DEFAULT_AUTOMATION_OPTIONS.reportIntervalMs
    ),
    staleSessionThresholdMs: Math.max(
      60_000,
      automation.staleSessionThresholdMs ?? DEFAULT_AUTOMATION_OPTIONS.staleSessionThresholdMs
    ),
    reportRetentionDays: Math.max(
      1,
      automation.reportRetentionDays ?? DEFAULT_AUTOMATION_OPTIONS.reportRetentionDays
    ),
    maxToolCallsPerMinute: Math.max(
      1,
      automation.maxToolCallsPerMinute ?? DEFAULT_AUTOMATION_OPTIONS.maxToolCallsPerMinute
    )
  }
  const report = publishReport(ctx, project, options)
  const monitor: MonitorState = {
    interval: null,
    lastState: null,
    options,
    lastReport: report,
    lastArchivedAt: Date.now()
  }
  ctx.projects.set(project.id, monitor)
  const state = getState(ctx, project)
  monitor.lastState = state
  monitor.interval = setInterval(
    () => {
      // A throw out of a timer callback takes down the main process, and this
      // one reads state from disk on every tick. A single unreadable read is
      // worth skipping a tick over, never the whole app.
      try {
        const current = getState(ctx, project)
        const reportDue = Date.now() - monitor.lastArchivedAt >= options.reportIntervalMs
        let nextReport = monitor.lastReport
        if (reportDue) {
          nextReport = publishReport(ctx, project, options)
          monitor.lastArchivedAt = Date.now()
        }
        const stateChanged =
          monitor.lastState === null ||
          JSON.stringify(current) !== JSON.stringify(monitor.lastState)
        const reportChanged = nextReport.healthStatus !== monitor.lastReport.healthStatus
        if (stateChanged || reportChanged || reportDue) {
          monitor.lastState = current
          monitor.lastReport = nextReport
          onStateChange(project.id, current)
        }
      } catch (error) {
        console.error(
          `[HarnessService] Monitor tick failed for project ${project.id}:`,
          error instanceof Error ? error.message : String(error)
        )
      }
    },
    Math.max(250, pollIntervalMs)
  )
  onStateChange(project.id, state)
}

export function stopMonitoring(ctx: HarnessContext, projectId: string): void {
  const monitor = ctx.projects.get(projectId)
  if (monitor?.interval) clearInterval(monitor.interval)
  ctx.projects.delete(projectId)
  const stored = ctx.loadState(projectId)
  if (stored) {
    stored.watcherRunning = false
    ctx.saveState(projectId, stored)
  }
}

export function stopAll(ctx: HarnessContext): void {
  for (const projectId of [...ctx.projects.keys()]) stopMonitoring(ctx, projectId)
}

export function getState(ctx: HarnessContext, project: WatchedProject): HarnessProjectState {
  const stored = ctx.loadState(project.id) ?? emptyState()
  const monitor = ctx.projects.get(project.id)
  const latestReport = monitor?.lastReport ?? readLatestReport(ctx, project.id)
  const reviewSessions = reviewSessionsAwaitingDecision(stored)
  return {
    projectId: project.id,
    hasHarness: true,
    activeSessions: stored.sessions
      .filter((session) => session.status !== 'done')
      .map((session) => toSession(session)),
    reviewSessions: reviewSessions.map((session) => {
      // Where its review stands (N9.5b), read against the queue now.
      const review = reviewWait(session, Boolean(openReviewTask(stored, session.id)), Date.now())
      return { ...toSession(session), ...(review ? { review } : {}) }
    }),
    taskQueue: orderTaskQueue(ctx, project.id, stored.tasks),
    questions: stored.questions,
    guidance: stored.guidance,
    watcherRunning: stored.watcherRunning,
    automation: getAutomationStatus(project.id, monitor, latestReport)
  }
}

/**
 * The queue as it will actually run. Pending work whose planning dependencies
 * are still open sinks below work that can start now, so the order on screen is
 * the release order and nobody has to reorder it by hand as tasks finish.
 * Relative order is otherwise preserved, and claimed/finished tasks stay put.
 */
function orderTaskQueue(
  ctx: HarnessContext,
  projectId: string,
  tasks: StoredTask[]
): HarnessTask[] {
  const decorated = tasks.map((task) => ({
    ...task,
    waitingOnDependencies:
      task.status === 'pending' ? ctx.unmetDependencyCount(projectId, task.planningWorkItemId) : 0
  }))
  const pending = decorated.filter((task) => task.status === 'pending')
  // Runnable work first, then work still waiting, fewest open dependencies
  // first -- which is the order a chain unblocks in. Both halves keep their
  // existing relative order, so a human's own ordering still counts.
  const reordered = [
    ...pending.filter((task) => task.waitingOnDependencies === 0),
    ...pending
      .filter((task) => task.waitingOnDependencies > 0)
      .sort((left, right) => left.waitingOnDependencies - right.waitingOnDependencies)
  ]
  // Non-pending tasks keep their exact slot; only the pending ones move.
  let next = 0
  return decorated.map((task) => (task.status === 'pending' ? reordered[next++] : task))
}

/**
 * Returns the latest automated report, generating one if this project has no
 * report yet.
 *
 * Deliberately does not archive: this runs on every authenticated harness API
 * call and every management action, so keeping a history entry here meant a
 * polling agent wrote a report file per request and re-scanned the whole
 * directory each time. Archiving belongs to the monitor's report interval.
 */
export function getReport(ctx: HarnessContext, project: WatchedProject): HarnessReport {
  const monitor = ctx.projects.get(project.id)
  if (monitor) {
    monitor.lastReport = publishReport(ctx, project, monitor.options, { archive: false })
    monitor.lastState = getState(ctx, project)
    return monitor.lastReport
  }
  return publishReport(ctx, project, DEFAULT_AUTOMATION_OPTIONS, { archive: false })
}

/** Rebuilds the report after an explicit management action. */
export function refreshReport(ctx: HarnessContext, project: WatchedProject): HarnessReport {
  return getReport(ctx, project)
}

export function publishReport(
  ctx: HarnessContext,
  project: WatchedProject,
  options: HarnessAutomationOptions,
  { archive = true }: { archive?: boolean } = {}
): HarnessReport {
  const report = createReport(ctx, project, options)
  const reportDir = ctx.reportDir(project.id)
  fs.mkdirSync(reportDir, { recursive: true })
  const latestPath = path.join(reportDir, 'latest.json')
  const tempPath = `${latestPath}.${randomUUID()}.tmp`
  try {
    fs.writeFileSync(tempPath, JSON.stringify(report, null, 2), 'utf8')
    fs.renameSync(tempPath, latestPath)
  } catch (error) {
    fs.rmSync(tempPath, { force: true })
    throw error
  }

  if (archive) {
    const historyPath = path.join(reportDir, `report-${Date.now()}-${randomUUID()}.json`)
    fs.writeFileSync(historyPath, JSON.stringify(report, null, 2), 'utf8')
    pruneReports(reportDir, options.reportRetentionDays)
  }
  return report
}

export function createReport(
  ctx: HarnessContext,
  project: WatchedProject,
  options: HarnessAutomationOptions
): HarnessReport {
  const stored = ctx.loadState(project.id) ?? emptyState()
  const now = Date.now()
  const windowStart = now - 24 * 60 * 60 * 1000
  const activeSessions = stored.sessions.filter((session) => session.status !== 'done')
  const staleSessions = activeSessions.filter((session) => {
    // Waiting on the person to decide on its plan (N9.3a) is waiting, not stale.
    if (session.plan?.status === 'pending') return false
    const lastUpdate = Date.parse(session.lastUpdate)
    return Number.isFinite(lastUpdate) && now - lastUpdate >= options.staleSessionThresholdMs
  })
  const pendingQuestions = stored.questions.filter((question) => question.status === 'pending')
  const pendingTasks = stored.tasks.filter((task) => task.status === 'pending')
  const readyTasks = pendingTasks.filter((task) => task.copy?.state === 'ready')
  const claimedTasks = stored.tasks.filter((task) => task.status === 'claimed')
  const completedTasks = stored.tasks.filter((task) => task.status === 'complete')
  const reviewSessions = reviewSessionsAwaitingDecision(stored)
  const recentEvents = ctx.database
    .getHarnessEvents(project.id, 100)
    .filter((event) => event.timestamp >= windowStart)
    .map((event) => ({
      timestamp: event.timestamp,
      eventType: event.event_type,
      sessionId: event.agent_session_id,
      sessionTitle: event.agent_title,
      details: event.details
    }))

  const alerts: HarnessReportAlert[] = []
  if (staleSessions.length > 0) {
    alerts.push({
      severity: 'warning',
      code: 'stale_sessions',
      title: `${staleSessions.length} stale session${staleSessions.length === 1 ? '' : 's'}`,
      detail: `${staleSessions.map((session) => session.title).join(', ')} has not reported an update within the configured threshold.`
    })
  }
  const activeOrReviewSessions = [...activeSessions, ...reviewSessions]
  const cappedSessions = activeOrReviewSessions.filter(
    (session) =>
      session.embeddedRuntime?.stoppedForReview === true ||
      session.embeddedRuntime?.stopReason === 'tool_call_rate_exceeded' ||
      session.statusNote.toLowerCase().includes('tool-call rate limit')
  )
  if (cappedSessions.length > 0) {
    alerts.push({
      severity: 'warning',
      code: 'embedded_session_capped',
      title: `${cappedSessions.length} embedded session${cappedSessions.length === 1 ? '' : 's'} stopped at the tool-call rate limit`,
      detail: `${cappedSessions.map((session) => session.title).join(', ')} exceeded the tool-call rate limit (${options.maxToolCallsPerMinute ?? 50} calls/minute) and was stopped for review. Spend tracking is currently token/turn-capped (live provider spend API is deferred).`
    })
  }
  if (claimedTasks.length > 0 && activeSessions.length === 0) {
    alerts.push({
      severity: 'error',
      code: 'claimed_tasks_without_session',
      title: 'Claimed tasks have no active session',
      detail: `${claimedTasks.length} claimed task${claimedTasks.length === 1 ? '' : 's'} may be blocked until an agent session resumes.`
    })
  }
  if (pendingTasks.length > 0) {
    alerts.push({
      severity: 'info',
      code: 'pending_tasks',
      title:
        readyTasks.length > 0
          ? `Ready to start: ${readyTasks[0].title}`
          : `${pendingTasks.length} task${pendingTasks.length === 1 ? '' : 's'} waiting`,
      detail:
        readyTasks.length > 0
          ? 'Its copy of the project is ready. Start it from the queue, or let auto-dispatch take it.'
          : 'Queued tasks get their copy of the project shortly before an agent can take them.'
    })
  }
  if (pendingQuestions.length > 0) {
    const stalledQuestions = pendingQuestions.filter((question) => {
      const askedAt = Date.parse(question.askedAt)
      return Number.isFinite(askedAt) && now - askedAt >= options.staleSessionThresholdMs
    })
    alerts.push({
      severity: stalledQuestions.length > 0 ? 'error' : 'warning',
      code: 'agent_question_pending',
      title: `${pendingQuestions.length} agent question${pendingQuestions.length === 1 ? '' : 's'} awaiting an answer`,
      detail: pendingQuestions
        .map((question) => `${question.sessionTitle}: ${question.question}`)
        .join(' | ')
    })
  }

  const healthStatus = alerts.some((alert) => alert.severity === 'error')
    ? 'error'
    : alerts.some((alert) => alert.severity === 'warning')
      ? 'warning'
      : 'healthy'
  const summary = `${activeSessions.length} active session${activeSessions.length === 1 ? '' : 's'}, ${reviewSessions.length} workspace${reviewSessions.length === 1 ? '' : 's'} awaiting review, ${pendingTasks.length} pending task${pendingTasks.length === 1 ? '' : 's'}, and ${recentEvents.length} harness event${recentEvents.length === 1 ? '' : 's'} in the last 24 hours.`

  return {
    projectId: project.id,
    generatedAt: new Date(now).toISOString(),
    windowStart: new Date(windowStart).toISOString(),
    windowEnd: new Date(now).toISOString(),
    healthStatus,
    summary,
    metrics: {
      activeSessions: activeSessions.length,
      reviewSessions: reviewSessions.length,
      staleSessions: staleSessions.length,
      pendingTasks: pendingTasks.length,
      claimedTasks: claimedTasks.length,
      completedTasks: completedTasks.length,
      recentEvents: recentEvents.length,
      pendingQuestions: pendingQuestions.length
    },
    alerts,
    recentEvents
  }
}

export function getAutomationStatus(
  projectId: string,
  monitor: MonitorState | undefined,
  latestReport: HarnessReport | null
): HarnessAutomationStatus {
  const options = monitor?.options ?? DEFAULT_AUTOMATION_OPTIONS
  return {
    enabled: true,
    running: Boolean(monitor),
    pollIntervalMs: options.pollIntervalMs,
    reportIntervalMs: options.reportIntervalMs,
    staleSessionThresholdMs: options.staleSessionThresholdMs,
    lastReportAt: latestReport?.generatedAt ?? null,
    lastReportHealth: latestReport?.healthStatus ?? null
  }
}

export function readLatestReport(ctx: HarnessContext, projectId: string): HarnessReport | null {
  const reportPath = path.join(ctx.reportDir(projectId), 'latest.json')
  if (!fs.existsSync(reportPath)) return null
  try {
    return JSON.parse(fs.readFileSync(reportPath, 'utf8')) as HarnessReport
  } catch {
    return null
  }
}

export function pruneReports(reportDir: string, retentionDays: number): void {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  for (const fileName of fs.readdirSync(reportDir)) {
    if (!fileName.startsWith('report-') || !fileName.endsWith('.json')) continue
    const filePath = path.join(reportDir, fileName)
    try {
      if (fs.statSync(filePath).mtimeMs < cutoff) fs.unlinkSync(filePath)
    } catch {
      // A report being removed while cleanup runs is harmless.
    }
  }
}
