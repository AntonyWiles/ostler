import * as fs from 'fs'
import * as path from 'path'
import { createHash, randomUUID } from 'crypto'
import type {
  HarnessEventType,
  HarnessProjectState,
  HarnessReport,
  WatchedProject,
  WorkspaceSetupRecord
} from '@shared/ostler-api'
import type { EventDatabase } from '../event-database'
import type { AgentEventInput } from '../agent-events'
import { harnessStateEvents } from './state-events'
import { sweepReportPictures } from './report-pictures'
import {
  emptyState,
  generateSessionToken,
  type MonitorState,
  type StoredHarnessState,
  type StoredSession,
  type StoredTask
} from './types'

/**
 * Last-resort task link for a session stored before `taskId` existed whose
 * task had already been released.
 *
 * When a run fails, `claimedBy` is cleared, so for those sessions nothing
 * connects session to task any more -- which is exactly how their workspaces
 * became unreachable and their slots leaked. A session is created with its
 * task's exact title, and that is the only durable trace left. Only an
 * unambiguous match is accepted: a title shared by several tasks leaves the
 * session unlinked rather than offering the wrong workspace for merge.
 */
function recoverLegacyTaskId(session: StoredSession, tasks: StoredTask[]): string | null {
  const matches = tasks.filter((task) => task.title === session.title)
  return matches.length === 1 ? matches[0].id : null
}

export interface HarnessContext {
  readonly root: string
  readonly dataDir: string
  readonly database: EventDatabase
  readonly projects: Map<string, MonitorState>

  loadState(projectId: string): StoredHarnessState | null
  saveState(projectId: string, state: StoredHarnessState): void
  mutate(project: WatchedProject, mutation: (state: StoredHarnessState) => void): void
  recordEvent(
    project: WatchedProject,
    eventType: HarnessEventType,
    session: { id: string; title: string },
    details: string
  ): void

  /**
   * Whether a queued task's linked planning work is dispatchable right now.
   * Every path that hands a task to an agent asks this, so a task can be queued
   * long before its dependencies are met and simply waits its turn -- the same
   * answer for the embedded runner, an external agent claiming over HTTP, and
   * auto-continuation. Always true for a task with no planning work behind it.
   */
  isTaskDispatchable(
    projectId: string,
    planningWorkItemId: string | null,
    sessionId?: string
  ): boolean

  /** How many planning dependencies still stand between a queued task and an agent. */
  unmetDependencyCount(
    projectId: string,
    planningWorkItemId: string | null,
    sessionId?: string
  ): number

  /**
   * Whether a human still has to resolve a reported blocker on this task's
   * planning work. Kept separate from the dependency count so the queue can
   * keep saying "waiting on N dependencies" truthfully while still refusing
   * to hand the work out.
   */
  isTaskBlocked(projectId: string, planningWorkItemId: string | null): boolean

  projectDir(projectId: string): string
  reportDir(projectId: string): string
  getState(project: WatchedProject): HarnessProjectState
  getReport(project: WatchedProject): HarnessReport

  /** Setup runs in flight, keyed by `copySetupKey(taskId)` (`task-copies.ts`). */
  readonly workspaceSetups: Map<string, WorkspaceSetupHandle>
  /** Tasks whose copy is being prepared right now, so a copy left "preparing" by a quit is told apart. */
  readonly preparingCopies: Set<string>
  /** Tells the UI a session's workspace setup changed (the same channel as every other harness change). */
  notifyWorkspaceSetup(project: WatchedProject): void
}

/** One setup in flight: the abort that every session end path pulls, and the record it resolves to. */
export interface WorkspaceSetupHandle {
  controller: AbortController
  done: Promise<WorkspaceSetupRecord>
}

/**
 * Aborts a session's setup if one is running. Every session end path calls
 * this first, so a stopped or ended session never keeps an install running.
 */
export function abortWorkspaceSetup(ctx: HarnessContext, sessionId: string): void {
  ctx.workspaceSetups.get(sessionId)?.controller.abort()
}

/**
 * Aborts a session's setup and waits until its process tree has actually
 * exited. Needed before a worktree is removed: a still-running installer
 * holds files open in it.
 */
export async function stopWorkspaceSetup(ctx: HarnessContext, sessionId: string): Promise<void> {
  const handle = ctx.workspaceSetups.get(sessionId)
  if (!handle) return
  handle.controller.abort()
  await handle.done.catch(() => undefined)
}

/** Aborts every setup in flight: the app is quitting or the emergency stop was pressed. */
export function abortAllWorkspaceSetups(ctx: HarnessContext): void {
  for (const handle of ctx.workspaceSetups.values()) handle.controller.abort()
}

export class HarnessContextImpl implements HarnessContext {
  readonly root: string
  readonly projects = new Map<string, MonitorState>()
  readonly workspaceSetups = new Map<string, WorkspaceSetupHandle>()
  readonly preparingCopies = new Set<string>()
  private setupNotifier: ((project: WatchedProject) => void) | null = null

  /** Wired in main by HarnessService: the same notification as every other harness change. */
  setWorkspaceSetupNotifier(notifier: ((project: WatchedProject) => void) | null): void {
    this.setupNotifier = notifier
  }

  notifyWorkspaceSetup(project: WatchedProject): void {
    try {
      this.setupNotifier?.(project)
    } catch {
      // A UI refresh must never fail a setup.
    }
  }

  constructor(
    readonly dataDir: string,
    readonly database: EventDatabase,
    private readonly getStateFn: (project: WatchedProject) => HarnessProjectState,
    private readonly getReportFn: (project: WatchedProject) => HarnessReport
  ) {
    this.root = path.join(dataDir, 'harness')
    fs.mkdirSync(this.root, { recursive: true })
  }

  private unmetFn:
    ((projectId: string, planningWorkItemId: string, sessionId?: string) => number) | null = null
  private blockedFn: ((projectId: string, planningWorkItemId: string) => boolean) | null = null

  setDispatchableResolver(
    resolver: ((projectId: string, planningWorkItemId: string, sessionId?: string) => number) | null
  ): void {
    this.unmetFn = resolver
  }

  setBlockedResolver(
    resolver: ((projectId: string, planningWorkItemId: string) => boolean) | null
  ): void {
    this.blockedFn = resolver
  }

  isTaskBlocked(projectId: string, planningWorkItemId: string | null): boolean {
    if (!planningWorkItemId || !this.blockedFn) return false
    try {
      return this.blockedFn(projectId, planningWorkItemId)
    } catch {
      // A planning lookup that fails must not strand the queue.
      return false
    }
  }

  unmetDependencyCount(
    projectId: string,
    planningWorkItemId: string | null,
    sessionId?: string
  ): number {
    if (!planningWorkItemId || !this.unmetFn) return 0
    try {
      return this.unmetFn(projectId, planningWorkItemId, sessionId)
    } catch {
      // A planning lookup that fails must not strand the queue.
      return 0
    }
  }

  isTaskDispatchable(
    projectId: string,
    planningWorkItemId: string | null,
    sessionId?: string
  ): boolean {
    return (
      this.unmetDependencyCount(projectId, planningWorkItemId, sessionId) === 0 &&
      !this.isTaskBlocked(projectId, planningWorkItemId)
    )
  }

  getState(project: WatchedProject): HarnessProjectState {
    return this.getStateFn(project)
  }

  getReport(project: WatchedProject): HarnessReport {
    return this.getReportFn(project)
  }

  projectDir(projectId: string): string {
    const key = createHash('sha256').update(projectId).digest('hex')
    return path.join(this.root, key)
  }

  reportDir(projectId: string): string {
    return path.join(this.projectDir(projectId), 'reports')
  }

  mutate(project: WatchedProject, mutation: (state: StoredHarnessState) => void): void {
    const state = this.loadState(project.id) ?? emptyState()
    mutation(state)
    state.updatedAt = new Date().toISOString()
    this.saveState(project.id, state)
  }

  /**
   * Parsed state per project, validated against the file's stat before reuse.
   *
   * This file is read far more often than it is written: projecting the queue
   * asks planning about each task's dependencies, and answering each of those
   * came back here for another full read and parse -- so a single status call
   * could re-read the same file dozens of times. `saveState` refreshes this
   * directly, and the stat check still catches a change made outside this
   * process (project removal deletes the directory wholesale).
   */
  private readonly stateCache = new Map<
    string,
    { mtimeMs: number; size: number; state: StoredHarnessState }
  >()

  loadState(projectId: string): StoredHarnessState | null {
    const statePath = path.join(this.projectDir(projectId), 'state.json')
    let stats: fs.Stats
    try {
      stats = fs.statSync(statePath)
    } catch {
      this.stateCache.delete(projectId)
      return null
    }
    const cached = this.stateCache.get(projectId)
    if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
      // Callers mutate what they get back (that is what `mutate` does), so
      // every reader needs its own copy or an abandoned mutation would leak
      // into the next read.
      return structuredClone(cached.state)
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8')) as Partial<StoredHarnessState>
      // State written before the simplify pass also holds file presence,
      // snapshots, recovery records, workspace slots and reservations (§6
      // step 6). They are left out here, so the next write drops them, and a
      // reserved task reads as a plain queued one.
      const state: StoredHarnessState = {
        ...emptyState(),
        updatedAt: parsed.updatedAt ?? new Date().toISOString(),
        watcherRunning: parsed.watcherRunning ?? false,
        sessions: (parsed.sessions ?? []).map((session) => ({
          ...session,
          token: session.token ?? generateSessionToken(),
          lastSeenAt: session.lastSeenAt ?? null,
          assignedTaskId: session.assignedTaskId ?? null,
          // Sessions persisted before `taskId` existed fall back to whatever
          // assignment survived, then to the task still claiming them. Without
          // this, already-orphaned workspaces stay unreachable after upgrade.
          taskId:
            session.taskId ??
            session.assignedTaskId ??
            (parsed.tasks ?? []).find((task) => task.claimedBy === session.id)?.id ??
            recoverLegacyTaskId(session, parsed.tasks ?? []),
          // Sessions persisted before provenance existed are, by definition,
          // external - embedded sessions did not exist yet when they started.
          provenance: session.provenance ?? 'external',
          embeddedRuntime: session.embeddedRuntime
        })),
        tasks: (parsed.tasks ?? []).map((stored) => {
          // Reservations went with the shared workspaces (simplify pass §2.2).
          const task = { ...stored } as StoredTask & { reservedBy?: unknown }
          delete task.reservedBy
          return {
            ...task,
            priority: task.priority ?? 'medium',
            planningWorkItemId: task.planningWorkItemId ?? null,
            autoContinue: task.autoContinue ?? false,
            hold: task.hold ?? false
          }
        }),
        questions: parsed.questions ?? [],
        guidance: parsed.guidance ?? []
      }
      this.stateCache.set(projectId, { mtimeMs: stats.mtimeMs, size: stats.size, state })
      return structuredClone(state)
    } catch {
      this.stateCache.delete(projectId)
      throw new Error(`Harness state is corrupt for project ${projectId}`)
    }
  }

  private eventSink: ((projectId: string, events: AgentEventInput[]) => void) | null = null

  /** Wired by HarnessService: where the agent events each state write makes go (D41). */
  setEventSink(sink: ((projectId: string, events: AgentEventInput[]) => void) | null): void {
    this.eventSink = sink
  }

  private runSink:
    | ((projectId: string, before: StoredHarnessState | null, after: StoredHarnessState) => void)
    | null = null

  /** Wired by HarnessService: the run history reads each state write (R5.3). */
  setRunSink(
    sink:
      | ((projectId: string, before: StoredHarnessState | null, after: StoredHarnessState) => void)
      | null
  ): void {
    this.runSink = sink
  }

  /** The state as it was before a write, for the events the write makes. */
  private stateBeforeWrite(projectId: string): StoredHarnessState | null {
    if (!this.eventSink && !this.runSink) return null
    try {
      return this.loadState(projectId)
    } catch {
      return null
    }
  }

  saveState(projectId: string, state: StoredHarnessState): void {
    const before = this.stateBeforeWrite(projectId)
    this.writeState(projectId, state)
    if (this.runSink) {
      try {
        this.runSink(projectId, before, state)
      } catch (error) {
        // The history is a record of the work, never a reason to fail it.
        console.error(`[HarnessService] Run history failed for project ${projectId}:`, error)
      }
    }
    if (!this.eventSink) return
    try {
      const events = harnessStateEvents(before, state)
      if (events.length > 0) this.eventSink(projectId, events)
    } catch (error) {
      // The event stream is a convenience for waiting clients; a write never fails over it.
      console.error(`[HarnessService] Agent events failed for project ${projectId}:`, error)
    }
  }

  private writeState(projectId: string, state: StoredHarnessState): void {
    const projectDir = this.projectDir(projectId)
    fs.mkdirSync(projectDir, { recursive: true })
    const statePath = path.join(projectDir, 'state.json')
    const tempPath = `${statePath}.${randomUUID()}.tmp`
    try {
      fs.writeFileSync(tempPath, JSON.stringify(state, null, 2), 'utf8')
      fs.renameSync(tempPath, statePath)
    } catch (error) {
      // Otherwise a failing write leaves a temp file behind on every attempt.
      fs.rmSync(tempPath, { force: true })
      this.stateCache.delete(projectId)
      throw error
    }
    // A session's report pictures go with its record (N9.1).
    sweepReportPictures(
      projectDir,
      state.sessions.map((session) => session.id)
    )
    try {
      const stats = fs.statSync(statePath)
      this.stateCache.set(projectId, {
        mtimeMs: stats.mtimeMs,
        size: stats.size,
        state: structuredClone(state)
      })
    } catch {
      // Without a stat to validate against, the next read goes to disk.
      this.stateCache.delete(projectId)
    }
  }

  recordEvent(
    project: WatchedProject,
    eventType: HarnessEventType,
    session: { id: string; title: string },
    details: string
  ): void {
    this.database.insertHarnessEvent({
      id: randomUUID(),
      projectId: project.id,
      timestamp: Date.now(),
      eventType,
      agentSessionId: session.id,
      agentTitle: session.title,
      details
    })
  }
}
