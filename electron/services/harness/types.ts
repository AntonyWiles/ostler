import * as path from 'path'
import { requireProjectFolder } from '@shared/project-folder'
import { randomBytes } from 'crypto'
import type {
  AgentRunRecordOutcome,
  AIEffortSetting,
  HarnessGuidance,
  HarnessQuestion,
  HarnessReport,
  HarnessReviewOf,
  HarnessTaskPlaybook,
  HarnessSession,
  HarnessTaskCopy,
  HarnessTaskRejection,
  HarnessTaskReport,
  PlanningPriority,
  WatchedProject
} from '@shared/ostler-api'

export interface StoredSession extends Omit<HarnessSession, 'blocked'> {
  status: 'active' | 'done' | 'blocked'
  overview: string
  assignedTaskId: string | null
  /** How the run ended, set by the path that ended it (R5.3); the run history reads it. */
  endedAs?: AgentRunRecordOutcome
  /** Where its work is kept after Discard or Stop, for Bring back (§3.3). */
  discardedRef?: string
  discardedAt?: string
}

export function generateSessionToken(): string {
  return randomBytes(24).toString('hex')
}

export type StoredQuestion = HarnessQuestion

export interface StoredTask {
  id: string
  title: string
  details: string
  status: 'pending' | 'claimed' | 'complete' | 'cancelled'
  claimedBy: string | null
  priority: PlanningPriority
  planningWorkItemId: string | null
  autoContinue: boolean
  hold: boolean
  report?: HarnessTaskReport | null
  rejections?: HarnessTaskRejection[]
  model?: string
  effort?: AIEffortSetting
  /** The task's copy while it waits in the queue (§2.1). */
  copy?: HarnessTaskCopy
  /** Plan first (N9.3a): set only through `setTaskPlanFirst` (`plans.ts`). */
  planFirst?: boolean
  /** A review run's task (N9.5a), set only by `startReview` (`reviews.ts`). */
  reviewOf?: HarnessReviewOf
  /** Run playbook (N9.6b), set only through `setTaskPlaybook` (`task-queue.ts`). */
  playbook?: HarnessTaskPlaybook
  /** Queued by its repeat's schedule (N9.7), set only through `setTaskScheduled` (`task-queue.ts`). */
  scheduled?: true
}

export interface StoredHarnessState {
  version: 1
  updatedAt: string
  sessions: StoredSession[]
  tasks: StoredTask[]
  questions: StoredQuestion[]
  guidance: HarnessGuidance[]
  watcherRunning: boolean
}

export interface MonitorState {
  interval: NodeJS.Timeout | null
  lastState: import('@shared/ostler-api').HarnessProjectState | null
  options: HarnessAutomationOptions
  lastReport: HarnessReport
  /**
   * When a report was last written to the retained history, as opposed to
   * merely recomputed. Reads refresh `lastReport` constantly, so the archive
   * cadence has to be tracked separately or it would never come due.
   */
  lastArchivedAt: number
}

export type HarnessTaskAction = 'claim' | 'release' | 'complete'

export interface HarnessAutomationOptions {
  pollIntervalMs: number
  reportIntervalMs: number
  staleSessionThresholdMs: number
  reportRetentionDays: number
  maxToolCallsPerMinute: number
}

export const DEFAULT_AUTOMATION_OPTIONS: HarnessAutomationOptions = {
  pollIntervalMs: 10000,
  reportIntervalMs: 60000,
  staleSessionThresholdMs: 30 * 60 * 1000,
  reportRetentionDays: 30,
  maxToolCallsPerMinute: 50
}

export const TASK_PRIORITIES: PlanningPriority[] = ['low', 'medium', 'high', 'critical']

export function emptyState(): StoredHarnessState {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    sessions: [],
    tasks: [],
    questions: [],
    guidance: [],
    watcherRunning: false
  }
}

export function requireSession(state: StoredHarnessState, sessionId: string): StoredSession {
  const session = state.sessions.find((item) => item.id === sessionId)
  if (!session) throw new Error(`Session ${sessionId} not found`)
  return session
}

export function requireTaskPriority(priority: PlanningPriority): PlanningPriority {
  if (!TASK_PRIORITIES.includes(priority)) throw new Error('Invalid task priority')
  return priority
}

export function toSession(session: StoredSession): HarnessSession {
  return {
    id: session.id,
    title: session.title,
    startedAt: session.startedAt,
    lastUpdate: session.lastUpdate,
    statusNote: session.statusNote,
    status: session.status,
    blocked: session.status === 'blocked',
    workspace: session.workspace,
    token: session.token,
    lastSeenAt: session.lastSeenAt,
    taskId: session.taskId ?? session.assignedTaskId ?? null,
    provenance: session.provenance ?? 'external',
    embeddedRuntime: session.embeddedRuntime,
    ...(session.attachmentsGiven ? { attachmentsGiven: session.attachmentsGiven } : {}),
    ...(session.attachmentFetches ? { attachmentFetches: session.attachmentFetches } : {}),
    ...(session.reviewDrafts?.length ? { reviewDrafts: session.reviewDrafts } : {}),
    ...(session.plan ? { plan: session.plan } : {}),
    ...(session.reviewOf ? { reviewOf: session.reviewOf } : {}),
    ...(session.reviewerReports?.length ? { reviewerReports: session.reviewerReports } : {}),
    ...(session.reviewRequestedAt ? { reviewRequestedAt: session.reviewRequestedAt } : {}),
    ...(session.dismissedFindingIds?.length
      ? { dismissedFindingIds: session.dismissedFindingIds }
      : {})
  }
}

export function reviewSessionsAwaitingDecision(state: StoredHarnessState): StoredSession[] {
  return state.sessions.filter(
    (session) =>
      session.status === 'done' &&
      session.workspace !== null &&
      session.workspace.closed !== true &&
      // A review run is never in review itself (N9.5a).
      !session.reviewOf
  )
}

/**
 * Whether a task's work is finished and no longer awaiting a merge decision,
 * read from stored state. Main's half of a rule the Board holds too: the
 * renderer calls the same work done when `projectWorkItemStatus` projects it
 * into the Done column. Both are tested against one table of cases
 * (tests/unit/planning-rules.test.ts); main alone also knows `sessionId`, so a
 * session chaining its own work never waits on itself.
 */
export function storedTaskWorkComplete(
  stored: StoredHarnessState,
  taskId: string,
  sessionId?: string
): boolean {
  const task = stored.tasks.find((candidate) => candidate.id === taskId)
  if (task?.status !== 'complete') return false
  // Work this same session did is already in its workspace, merged or not.
  if (sessionId && task.claimedBy === sessionId) return true
  return !reviewSessionsAwaitingDecision(stored).some((session) => session.id === task.claimedBy)
}

export function normalizeRelativePath(relativePath: string): string {
  const normalized = path.normalize(relativePath.trim()).replaceAll('\\', '/')
  if (
    !normalized ||
    normalized === '.' ||
    path.isAbsolute(relativePath) ||
    normalized.startsWith('../')
  ) {
    throw new Error('A relative project file path is required')
  }
  return normalized
}

export interface GitWorktreeEntry {
  worktreePath: string
  branchName: string | null
}

/**
 * Parses `git worktree list --porcelain`: blank-line-separated records that
 * open with `worktree <path>` and carry either `branch refs/heads/<name>` or
 * a bare `detached`. Written against the porcelain form specifically because
 * the human-readable one cannot be parsed safely - it separates columns with
 * spaces that also occur in paths and branch names.
 */
export function parseWorktreeListing(listing: string): GitWorktreeEntry[] {
  const entries: GitWorktreeEntry[] = []
  let current: GitWorktreeEntry | null = null

  for (const rawLine of listing.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) {
      if (current) entries.push(current)
      current = null
      continue
    }
    if (line.startsWith('worktree ')) {
      if (current) entries.push(current)
      current = { worktreePath: line.slice('worktree '.length).trim(), branchName: null }
      continue
    }
    if (current && line.startsWith('branch ')) {
      current.branchName = line
        .slice('branch '.length)
        .trim()
        .replace(/^refs\/heads\//, '')
    }
  }
  if (current) entries.push(current)
  return entries.filter((entry) => entry.worktreePath.length > 0)
}

export function formatHarnessReportMarkdown(report: HarnessReport, projectName: string): string {
  const metricRows = [
    ['Health', report.healthStatus],
    ['Active sessions', report.metrics.activeSessions],
    ['Stale sessions', report.metrics.staleSessions],
    ['Pending tasks', report.metrics.pendingTasks],
    ['Claimed tasks', report.metrics.claimedTasks],
    ['Completed tasks', report.metrics.completedTasks],
    ['Events (24h)', report.metrics.recentEvents],
    ['Pending agent questions', report.metrics.pendingQuestions]
  ]
    .map(([label, value]) => `| ${label} | ${value} |`)
    .join('\n')
  const alerts = report.alerts.length
    ? report.alerts
        .map((alert) => `- **${alert.severity.toUpperCase()} — ${alert.title}:** ${alert.detail}`)
        .join('\n')
    : '- None'
  const events = report.recentEvents.length
    ? report.recentEvents
        .slice(0, 20)
        .map(
          (event) =>
            `- ${new Date(event.timestamp).toISOString()} — ${event.eventType}: ${event.details}`
        )
        .join('\n')
    : '- None'

  return `# Ostler Harness Report — ${projectName}\n\nGenerated: ${report.generatedAt}\nWindow: ${report.windowStart} to ${report.windowEnd}\n\n${report.summary}\n\n## Metrics\n\n| Metric | Value |\n| --- | ---: |\n${metricRows}\n\n## Alerts\n\n${alerts}\n\n## Recent events\n\n${events}\n`
}
