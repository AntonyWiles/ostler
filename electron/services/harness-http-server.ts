import { REPORT_EXTRAS_GUIDANCE } from '@shared/agent-report-extras'
import { COMMENT_ANSWERS_GUIDANCE } from '@shared/comment-answers'
import { latestReviewComments, REVIEW_COMMENTS_GUIDANCE } from '@shared/review-comments'
import {
  MAX_REVIEW_FINDINGS,
  REVIEWER_GUIDANCE,
  REVIEWER_RUNS_AVAILABLE
} from '@shared/reviewer-runs'
import { createServer, IncomingMessage, ServerResponse, Server } from 'http'
import { appendFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import {
  PLAN_CONTENT_GUIDANCE,
  PLAN_FIRST_AVAILABLE,
  PLAN_FIRST_EXTERNAL_NOTE,
  PLAN_FIRST_GUIDANCE
} from '@shared/plan-first'
import type {
  HarnessPlan,
  HarnessTask,
  HarnessTaskReport,
  LibraryAttachedBy,
  LibraryItemKind,
  PlanningPriority,
  WatchedProject,
  WorkspaceSetupRecord
} from '@shared/ostler-api'
import type { HarnessTaskAction, HarnessService } from './harness-service'
import type { PlanningService } from './planning-service'
import { logRouteFailure, readJsonRecord, respondJson, routeFailureBody } from './loopback-http'
import { checkWorkEvidence, parseTaskReport } from './harness/report-rules'
import { isFolderRequiredError, requireProjectFolder } from '@shared/project-folder'
import { Refusal } from '@shared/refusal'
import {
  resolveTaskAttachments,
  type ResolvedTaskAttachment,
  type TaskAttachmentReader
} from './task-attachments'
import { resolveProjectConventions } from './project-conventions'
import { describeWorkspaceSetup } from '@shared/workspace-setup'
import {
  EventWaitLimitError,
  parseEventQuery,
  type AgentEventFilter,
  type AgentEventStream
} from './agent-events'

interface RouteContext {
  project: WatchedProject
  segments: string[]
  query: URLSearchParams
  body: Record<string, unknown>
  token: string
  /**
   * The session this bearer token belongs to. Every agent has its own
   * session password (simplify pass §2.3), and it may act only on its own
   * session; there is no project-wide password.
   */
  authSessionId: string | null
  /** Aborts when the server stops or the client goes away: ends a waiting GET /events. */
  signal: AbortSignal
}

/**
 * A refusal with its own HTTP status, where a plain error would read as a 400.
 * `body`, when given, is the whole response body instead of `{ ok, error }`.
 */
class HarnessHttpError extends Refusal {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: Record<string, unknown>
  ) {
    super(message)
  }
}

/** How long an agent should wait before retrying a work route while its workspace is being prepared. */
const WORKSPACE_PREPARING_RETRY_SECONDS = 10

/** A route's answer sent as raw bytes instead of the `{ ok, value }` envelope. */
class RawResponse {
  constructor(
    readonly contentType: string,
    readonly bytes: Buffer
  ) {}
}

/**
 * One entry of a task's attachment index over HTTP: the fields of
 * OSTLER_TASK_ATTACHMENTS.md, with URLs where the embedded index has paths.
 */
interface HarnessAttachmentIndexEntry {
  libraryItemId: string
  kind: LibraryItemKind
  title: string
  revision: number
  attachedBy: LibraryAttachedBy
  summary: string
  mimeType: string
  sizeBytes: number
  url: string
  /** Documents only, when they have extracted text. */
  textUrl?: string
}

/**
 * Agent-facing control plane for the harness. Loopback-only HTTP so fresh AI
 * agent sessions — any provider, any tooling, running entirely outside Ostler —
 * can drive HarnessService directly instead of a human relaying their actions
 * through the Ostler UI. Every request is scoped to one project and authenticated
 * with the password of one agent session, which Ostler makes when it starts the
 * session for a task.
 */
export class HarnessHttpServer {
  private server: Server | null = null
  /** Aborted by stop(), which ends every GET /events still waiting. */
  private running = new AbortController()

  constructor(
    private readonly getProjects: () => WatchedProject[],
    private readonly harnessService: HarnessService,
    private readonly onMutation: (project: WatchedProject) => void,
    private readonly dataDir: string,
    private readonly planningService?: PlanningService,
    /** The Library, read through the same resolver the embedded runner uses. */
    private readonly taskAttachments?: TaskAttachmentReader,
    /** GET /events (D41). */
    private readonly events?: AgentEventStream
  ) {}

  start(port: number): void {
    this.stop()
    this.server = createServer((req, res) => {
      this.handle(req, res).catch((error) => {
        this.audit(req, endpointSignature(req.url), 'internal_error', 500)
        logRouteFailure(
          'Harness API',
          `${req.method ?? 'GET'} ${endpointSignature(req.url)}`,
          error
        )
        respondJson(res, 500, {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        })
      })
    })
    // Without this, a port already in use (a second Ostler instance, or a
    // leftover process) emits an unhandled 'error' on the server and takes
    // the whole main process down at startup.
    this.server.on('error', (error) => {
      console.error(
        `[HarnessHttpServer] Could not listen on 127.0.0.1:${port}: ${error.message}. ` +
          'The agent harness API is unavailable until this is resolved.'
      )
      this.server = null
    })
    this.server.listen(port, '127.0.0.1')
  }

  stop(): void {
    this.running.abort()
    this.running = new AbortController()
    this.server?.close()
    this.server = null
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const parts = url.pathname.split('/').filter(Boolean)
    const endpoint = endpointSignature(url.pathname)
    if (parts[0] !== 'harness' || !parts[1]) {
      this.audit(req, endpoint, 'not_applicable', 404)
      respondJson(res, 404, { ok: false, error: 'Unknown route' })
      return
    }

    const project = this.getProjects().find((p) => p.id === parts[1])
    if (!project) {
      this.audit(req, endpoint, 'not_applicable', 404)
      respondJson(res, 404, { ok: false, error: 'Unknown project' })
      return
    }
    if (!project.enabled) {
      this.audit(req, endpoint, 'not_applicable', 403, project.id)
      respondJson(res, 403, { ok: false, error: 'Project is disabled' })
      return
    }

    const authHeader = req.headers.authorization ?? ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : ''
    const auth = this.harnessService.resolveToken(project, token)
    if (!auth.valid) {
      if (auth.expiredSessionId) {
        this.audit(req, endpoint, 'expired_session', 410, project.id)
        respondJson(res, 410, {
          ok: false,
          error:
            'This harness session is already complete and its token has been revoked. Stop retrying this request; start a new session only for new work.'
        })
        return
      }
      this.audit(req, endpoint, 'invalid', 401, project.id)
      respondJson(res, 401, { ok: false, error: 'Invalid or missing harness token' })
      return
    }
    // The session password says exactly which session just made a live call,
    // so Ostler can show when it last connected without the agent reporting it.
    if (auth.sessionId) {
      this.harnessService.touchSessionConnection(project, auth.sessionId)
      this.onMutation(project)
    }

    let body: Record<string, unknown>
    try {
      body = req.method === 'POST' ? await readJsonRecord(req) : {}
    } catch (error) {
      this.audit(req, endpoint, 'valid', 400, project.id)
      respondJson(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      })
      return
    }
    const clientGone = new AbortController()
    res.once('close', () => clientGone.abort())
    const context: RouteContext = {
      project,
      segments: parts.slice(2),
      query: url.searchParams,
      body,
      token,
      authSessionId: auth.sessionId,
      signal: AbortSignal.any([this.running.signal, clientGone.signal])
    }

    try {
      const value = await this.route(req.method ?? 'GET', context)
      if (value === undefined) {
        this.audit(req, endpoint, 'valid', 404, project.id)
        respondJson(res, 404, { ok: false, error: 'Unknown route' })
        return
      }
      this.audit(req, endpoint, 'valid', 200, project.id)
      if (value instanceof RawResponse) {
        res.writeHead(200, {
          'Content-Type': value.contentType,
          'Content-Length': value.bytes.byteLength
        })
        res.end(value.bytes)
        return
      }
      respondJson(res, 200, { ok: true, value })
    } catch (error) {
      const status =
        error instanceof HarnessHttpError ? error.status : isFolderRequiredError(error) ? 409 : 400
      this.audit(req, endpoint, 'valid', status, project.id)
      logRouteFailure('Harness API', `${req.method ?? 'GET'} ${endpoint}`, error)
      respondJson(
        res,
        status,
        error instanceof HarnessHttpError && error.body ? error.body : routeFailureBody(error)
      )
    }
  }

  /**
   * Records every harness API attempt without retaining secrets or request data.
   * Agent request bodies can include source paths, task text, and questions;
   * bearer tokens can authenticate a project, so neither is ever written here.
   */
  private audit(
    req: IncomingMessage,
    endpoint: string,
    authentication: 'valid' | 'invalid' | 'expired_session' | 'not_applicable' | 'internal_error',
    status: number,
    projectId?: string
  ): void {
    try {
      const logDirectory = join(this.dataDir, 'logs')
      mkdirSync(logDirectory, { recursive: true })
      appendFileSync(
        join(logDirectory, 'harness-audit.log'),
        `${JSON.stringify({
          timestamp: new Date().toISOString(),
          method: req.method ?? 'GET',
          endpoint,
          authentication,
          status,
          ...(projectId ? { projectId } : {})
        })}\n`,
        'utf8'
      )
    } catch {
      // Audit logging must never prevent the agent harness from responding.
    }
  }

  /**
   * The branch is the evidence, not the agent's word.
   *
   * Both completion routes took an agent's claim at face value, so a session
   * could mark its task complete as its first action, having touched nothing.
   * The session's own workspace settles it: with no commits and nothing even
   * edited, a claim of changed files is provably false and is refused, with
   * instructions for what to do instead. A task that genuinely needs no code
   * change is still completable -- report it explicitly with an empty
   * `filesChanged`, which is a claim a human can then see and check.
   */
  private async requireWorkEvidence(
    project: WatchedProject,
    sessionId: string,
    report: HarnessTaskReport | null
  ): Promise<void> {
    const session = this.harnessService
      .getState(project)
      .activeSessions.find((candidate) => candidate.id === sessionId)
    // No workspace means no branch to read (the project is not a Git repo);
    // there is nothing to contradict, so nothing to refuse. A review run
    // (N9.5a) changes nothing by design.
    if (!session?.workspace || session.reviewOf) return
    let diff
    try {
      diff = await this.harnessService.getSessionDiff(project, sessionId)
    } catch {
      // Unreadable diff is not proof of idleness, and refusing on it would
      // strand honest work. Let it through.
      return
    }
    const refusal = checkWorkEvidence(diff, report)
    if (refusal) throw new Refusal(refusal)
  }

  /**
   * The task a session token may read attachments for: one its session has
   * claimed. Another session's task reads as not found.
   */
  private heldTask(
    project: WatchedProject,
    taskId: string,
    authSessionId: string | null
  ): HarnessTask {
    if (!authSessionId) {
      throw new HarnessHttpError(
        403,
        "Task attachments are only for the session that holds the task: use that session's token"
      )
    }
    const task = this.harnessService
      .getState(project)
      .taskQueue.find((candidate) => candidate.id === taskId)
    const held = task && task.status === 'claimed' && task.claimedBy === authSessionId
    if (!task || !held) {
      throw new HarnessHttpError(404, `Task ${taskId} not found or not held by this session`)
    }
    return task
  }

  /**
   * A held task's attachments, through the one resolver every coding agent
   * reads from, recorded as given to the session just as the embedded runner
   * records them at start (re-reading the same list records nothing new).
   */
  private resolveHeldAttachments(
    project: WatchedProject,
    task: HarnessTask,
    sessionId: string
  ): ResolvedTaskAttachment[] {
    if (!this.taskAttachments) return []
    const resolved = resolveTaskAttachments(this.taskAttachments, project.id, task, (message) =>
      console.warn(`[HarnessHttpServer] ${sessionId}: ${message}`)
    )
    if (resolved.length > 0) {
      this.harnessService.recordAttachmentsGiven(
        project,
        sessionId,
        resolved.map((entry) => entry.given)
      )
    }
    return resolved
  }

  /**
   * The attachment index of a task the calling session holds: what its claim
   * and its own route return. Undefined (so left out of the response) without
   * a session.
   */
  private attachmentIndex(
    project: WatchedProject,
    task: HarnessTask,
    authSessionId: string | null
  ): HarnessAttachmentIndexEntry[] | undefined {
    if (!authSessionId) return undefined
    return this.resolveHeldAttachments(project, task, authSessionId).map((attachment) => {
      const url = `/harness/${project.id}/tasks/${task.id}/attachments/${attachment.given.libraryItemId}`
      const primary = attachment.files[0]
      return {
        libraryItemId: attachment.given.libraryItemId,
        kind: attachment.given.kind,
        title: attachment.given.title,
        revision: attachment.given.revision,
        attachedBy: attachment.given.attachedBy,
        summary: attachment.summary.replace(/\s+/g, ' ').trim(),
        mimeType: primary.mimeType,
        sizeBytes: primary.sizeBytes,
        url,
        ...(attachment.files.some((file) => file.form === 'text')
          ? { textUrl: `${url}?as=text` }
          : {})
      }
    })
  }

  /**
   * The project's conventions for a session token, from the one resolver the
   * embedded runner writes OSTLER_PROJECT_CONVENTIONS.md from. Spread into a
   * response: absent without a session and for a project with none.
   */
  /**
   * The line comments the person left when this task was last sent back
   * (N9.2a), as reviewComments. Empty when there are none.
   */
  private reviewCommentsField(task: HarnessTask | null | undefined): {
    reviewComments?: ReturnType<typeof latestReviewComments>
  } {
    const comments = latestReviewComments(task?.rejections)
    return comments.length > 0 ? { reviewComments: comments } : {}
  }

  /**
   * A review run's task (N9.5a): what it reviews and how to review it. Spread
   * into the claim and GET /session/:sessionId. Empty for any other task.
   */
  private reviewField(task: HarnessTask | null | undefined): {
    reviewOf?: HarnessTask['reviewOf']
    reviewInstructions?: string
  } {
    if (!REVIEWER_RUNS_AVAILABLE || !task?.reviewOf) return {}
    return { reviewOf: task.reviewOf, reviewInstructions: REVIEWER_GUIDANCE }
  }

  /**
   * Plan first (N9.3a): for a session whose task asks for a plan, says so and
   * carries its plan as it stands. Spread into the claim and GET
   * /session/:sessionId. Empty while plans are unavailable, and for any other task.
   */
  private planField(
    project: WatchedProject,
    sessionId: string | null
  ): { planFirst?: true; planFirstNote?: string; plan?: HarnessPlan | null } {
    if (!PLAN_FIRST_AVAILABLE || !sessionId) return {}
    if (!this.harnessService.sessionPlanFirst(project, sessionId)) return {}
    return {
      planFirst: true,
      planFirstNote: PLAN_FIRST_EXTERNAL_NOTE,
      plan: this.harnessService.getSessionPlan(project, sessionId)
    }
  }

  private conventionsField(
    project: WatchedProject,
    authSessionId: string | null
  ): { projectConventions?: string } {
    const conventions = authSessionId ? resolveProjectConventions(project) : null
    return conventions ? { projectConventions: conventions } : {}
  }

  /**
   * The workspace setup record and its text for a session token: what Ostler
   * did to the workspace before the agent started. Spread into the same
   * responses as projectConventions. Empty without a session.
   */
  private setupField(
    project: WatchedProject,
    authSessionId: string | null
  ): { workspace?: { setup: WorkspaceSetupRecord }; workspaceSetupNote?: string } {
    if (!authSessionId) return {}
    const setup = this.harnessService.getWorkspaceSetup(project, authSessionId)
    const note = describeWorkspaceSetup(setup)
    return { workspace: { setup }, ...(note ? { workspaceSetupNote: note } : {}) }
  }

  /**
   * Work routes wait for the workspace: a session whose setup is still running
   * may not claim, check out files or update. The agent retries after the
   * number of seconds the body names, and GET /session/:id shows the record.
   */
  private requireWorkspaceReady(project: WatchedProject, sessionId: string): void {
    if (!sessionId) return
    if (this.harnessService.getWorkspaceSetup(project, sessionId).status !== 'running') return
    throw new HarnessHttpError(409, 'workspace_preparing', {
      error: 'workspace_preparing',
      retryAfterSeconds: WORKSPACE_PREPARING_RETRY_SECONDS
    })
  }

  private async route(method: string, ctx: RouteContext): Promise<unknown> {
    const { project, segments, query, body, token, authSessionId, signal } = ctx
    const service = this.harnessService

    /**
     * Every session-addressing route runs its target through this. Without it
     * any live session's token could end, question, or re-assign the work of
     * any other session in the same project, because authentication is only
     * checked per project.
     */
    const ownSession = (sessionId: string): string => {
      if (authSessionId && sessionId && sessionId !== authSessionId) {
        throw new Refusal(
          `This token belongs to session ${authSessionId} and cannot act on session ${sessionId}`
        )
      }
      return sessionId
    }

    /**
     * Matches one route against the path below `/harness/:projectId`, with
     * `'*'` standing in for an id segment. Spelled out as method/length/index
     * boolean chains, the route table read as forty lines of comparisons with
     * the actual endpoint hidden in a comment above each one.
     */
    const at = (wanted: string, ...pattern: string[]): boolean =>
      method === wanted &&
      segments.length === pattern.length &&
      pattern.every((part, index) => part === '*' || part === segments[index])

    // Routes that work in the project's folder answer 409 for a project
    // without one (FolderRequiredError); status, tasks and questions still work.
    const folderPurpose = folderRoutePurpose(segments)
    if (folderPurpose) requireProjectFolder(project, folderPurpose)

    // GET /harness/:projectId/help
    if (at('GET', 'help')) {
      return buildHelp(project.id)
    }

    // GET /harness/:projectId/status
    if (at('GET', 'status')) {
      return { state: service.getState(project), report: service.getReport(project) }
    }

    // GET /harness/:projectId/events
    if (at('GET', 'events')) {
      if (!this.events) throw new Error('Agent events unavailable')
      const { since, wait } = parseEventQuery(query)
      // A session token sees its own session's events and the queue.
      const visible: AgentEventFilter = authSessionId
        ? (event) => event.sessionId === authSessionId || event.type.startsWith('task.')
        : () => true
      try {
        return await this.events.wait(project.id, since, wait, visible, token, signal)
      } catch (error) {
        if (error instanceof EventWaitLimitError) throw new HarnessHttpError(429, error.message)
        throw error
      }
    }

    // GET /harness/:projectId/conventions
    if (at('GET', 'conventions')) {
      if (!authSessionId) {
        throw new HarnessHttpError(
          403,
          "Project conventions are for a running session: use that session's token"
        )
      }
      return { projectConventions: resolveProjectConventions(project) }
    }

    // GET /harness/:projectId/tasks
    if (at('GET', 'tasks')) {
      return service.getState(project).taskQueue
    }

    // POST /harness/:projectId/tasks
    if (at('POST', 'tasks')) {
      const result = service.addTask(
        project,
        str(body.title),
        str(body.details),
        undefined,
        optionalTaskPriority(body.priority)
      )
      this.onMutation(project)
      return result
    }

    // GET /harness/:projectId/tasks/:taskId/attachments
    if (at('GET', 'tasks', '*', 'attachments')) {
      const task = this.heldTask(project, segments[1], authSessionId)
      return this.attachmentIndex(project, task, authSessionId) ?? []
    }

    // GET /harness/:projectId/tasks/:taskId/attachments/:itemId
    if (at('GET', 'tasks', '*', 'attachments', '*')) {
      const task = this.heldTask(project, segments[1], authSessionId)
      // Only the task's own attachments: anything else in the Library reads as absent.
      const attachment = this.resolveHeldAttachments(project, task, authSessionId!).find(
        (entry) => entry.given.libraryItemId === segments[3]
      )
      if (!attachment) {
        throw new HarnessHttpError(404, `No attachment ${segments[3]} on task ${task.id}`)
      }
      const as = query.get('as')
      if (as !== null && as !== 'text') throw new Refusal(`Unknown attachment form: ${as}`)
      const file =
        as === 'text'
          ? attachment.files.find((candidate) => candidate.form === 'text')
          : attachment.files[0]
      if (!file) throw new Refusal('?as=text is only for documents with extracted text')
      const bytes = file.read()
      service.recordAttachmentFetch(project, authSessionId!, {
        libraryItemId: attachment.given.libraryItemId,
        revision: attachment.given.revision,
        form: file.form
      })
      this.onMutation(project)
      return new RawResponse(file.mimeType, bytes)
    }

    // POST /harness/:projectId/tasks/:taskId/:action
    if (at('POST', 'tasks', '*', '*') && segments[2] !== 'blocker') {
      const [, taskId, action] = segments
      const sessionId = ownSession(str(body.sessionId))
      if (!service.getState(project).activeSessions.some((session) => session.id === sessionId)) {
        throw new Refusal('Task updates require an active harness session')
      }
      this.requireWorkspaceReady(project, sessionId)
      // A task cannot become complete independently of its session: the
      // session owns the isolated Git workspace that a human must merge or
      // discard. Finish both atomically so completed work always enters the
      // review flow (unless the same session explicitly auto-continues).
      if (action === 'complete') {
        const report = parseTaskReport(body.report)
        await this.requireWorkEvidence(project, sessionId, report)
        const completed = await service.completeSessionWithAutoContinuation(
          project,
          sessionId,
          str(body.note) || 'Task marked complete by agent',
          taskId,
          report
        )
        const task = service.getState(project).taskQueue.find((item) => item.id === taskId)
        if (!task) throw new Refusal('Completed harness task was not found')
        this.onMutation(project)
        return {
          ...task,
          session: completed.session,
          nextAssignment: completed.nextTask
            ? {
                task: completed.nextTask,
                attachments: this.attachmentIndex(project, completed.nextTask, authSessionId),
                ...this.reviewCommentsField(completed.nextTask),
                ...this.conventionsField(project, authSessionId),
                ...this.setupField(project, authSessionId),
                tokenUnchanged: true,
                prompt: buildContinuationPrompt(
                  project.id,
                  completed.session,
                  completed.nextTask,
                  token
                )
              }
            : null
        }
      }
      const result = service.updateTask(project, taskId, requireTaskAction(action), sessionId)
      this.onMutation(project)
      // A claim hands over the task's attachment index, as an embedded agent gets its own at start.
      if (action === 'claim') {
        return {
          ...result,
          attachments: this.attachmentIndex(project, result, authSessionId),
          ...this.reviewCommentsField(result),
          ...this.reviewField(result),
          ...this.planField(project, sessionId),
          ...this.conventionsField(project, authSessionId),
          ...this.setupField(project, authSessionId)
        }
      }
      return result
    }

    // POST /harness/:projectId/tasks/:taskId/blocker
    if (at('POST', 'tasks', '*', 'blocker')) {
      if (!this.planningService) throw new Error('Planning API unavailable')
      const [, taskId] = segments
      const sessionId = ownSession(str(body.sessionId))
      if (!service.getState(project).activeSessions.some((session) => session.id === sessionId)) {
        throw new Refusal('Reporting a blocker requires an active harness session')
      }
      const task = service.getState(project).taskQueue.find((item) => item.id === taskId)
      if (!task) throw new Refusal('Task was not found')
      if (!task.planningWorkItemId) {
        throw new Refusal('This task has no linked planning work item to attach a blocker to')
      }
      const resolutionOptions = Array.isArray(body.resolutionOptions)
        ? body.resolutionOptions.filter((option): option is string => typeof option === 'string')
        : []
      const result = this.planningService.reportBlocker(
        task.planningWorkItemId,
        str(body.description),
        'agent',
        resolutionOptions
      )
      this.onMutation(project)
      return result
    }

    // GET /harness/:projectId/session/:sessionId
    if (at('GET', 'session', '*')) {
      const sessionId = ownSession(segments[1])
      service.touchSessionConnection(project, sessionId)
      const state = service.getState(project)
      const session = state.activeSessions.find((s) => s.id === sessionId)
      const questions = state.questions.filter((q) => q.sessionId === sessionId)
      if (!session) throw new Refusal(`Session ${sessionId} not found or already ended`)
      // A session Ostler started for a task claims it on its first call (usually
      // this one), so the task's attachment index comes with the session.
      const task = state.taskQueue.find(
        (candidate) => candidate.status === 'claimed' && candidate.claimedBy === sessionId
      )
      // Messages from the person waiting for this agent, each returned once
      // and marked delivered. An embedded run gets its own in its session.
      const guidance =
        session.provenance === 'embedded'
          ? []
          : service.takeUndeliveredGuidance(project, sessionId).map((entry) => ({
              id: entry.id,
              from: entry.from,
              text: entry.text,
              sentAt: entry.sentAt
            }))
      if (guidance.length > 0) this.onMutation(project)
      return {
        session,
        questions,
        guidance,
        ...(task ? { attachments: this.attachmentIndex(project, task, authSessionId) } : {}),
        ...this.reviewCommentsField(task),
        ...this.reviewField(task),
        ...this.planField(project, sessionId),
        ...this.conventionsField(project, authSessionId),
        ...this.setupField(project, authSessionId)
      }
    }

    // POST /harness/:projectId/session/:sessionId/update
    if (at('POST', 'session', '*', 'update')) {
      service.touchSessionConnection(project, ownSession(segments[1]))
      this.requireWorkspaceReady(project, segments[1])
      if (body.done === true) {
        await this.requireWorkEvidence(project, segments[1], parseTaskReport(body.report))
        const completed = await service.completeSessionWithAutoContinuation(
          project,
          segments[1],
          str(body.note),
          typeof body.completedTaskId === 'string' ? body.completedTaskId : null,
          parseTaskReport(body.report)
        )
        this.onMutation(project)
        return {
          session: completed.session,
          nextAssignment: completed.nextTask
            ? {
                task: completed.nextTask,
                attachments: this.attachmentIndex(project, completed.nextTask, authSessionId),
                ...this.reviewCommentsField(completed.nextTask),
                ...this.conventionsField(project, authSessionId),
                ...this.setupField(project, authSessionId),
                tokenUnchanged: true,
                prompt: buildContinuationPrompt(
                  project.id,
                  completed.session,
                  completed.nextTask,
                  token
                )
              }
            : null
        }
      }
      const result = service.updateSession(project, segments[1], str(body.note), false)
      this.onMutation(project)
      return result
    }

    // POST /harness/:projectId/session/:sessionId/ask
    if (at('POST', 'session', '*', 'ask')) {
      service.touchSessionConnection(project, ownSession(segments[1]))
      const result = service.askQuestion(project, segments[1], str(body.question))
      this.onMutation(project)
      return result
    }

    // POST /harness/:projectId/session/:sessionId/plan
    if (PLAN_FIRST_AVAILABLE && at('POST', 'session', '*', 'plan')) {
      service.touchSessionConnection(project, ownSession(segments[1]))
      const plan = service.submitPlan(project, segments[1], {
        steps: body.steps,
        files: body.files,
        risks: body.risks
      })
      this.onMutation(project)
      return { plan }
    }

    // POST /harness/:projectId/session/:sessionId/transcript
    if (at('POST', 'session', '*', 'transcript')) {
      service.touchSessionConnection(project, ownSession(segments[1]))
      const entries = Array.isArray(body.entries) ? body.entries : []
      const result = service.recordSessionTranscript(
        project,
        segments[1],
        entries as import('@shared/ostler-api').SessionTranscriptEntry[]
      )
      this.onMutation(project)
      return result
    }

    return undefined
  }
}

interface HelpRoute {
  method: string
  path: string
  body?: Record<string, string>
  description: string
}

/** A review run's report (N9.5a), in the completion routes' help only while reviews are available. */
const REVIEW_REPORT_HELP = REVIEWER_RUNS_AVAILABLE
  ? ` In a review run (reviewOf in your claim), the report also carries findings: up to ${MAX_REVIEW_FINDINGS} of { file: string, side: "new" | "old", firstLine: number, lastLine: number, comment: string, severity: "must-fix" | "should-fix" | "nit" }, with an empty filesChanged; see Review runs below.`
  : ''

/** Plan first (N9.3a): listed only while plans are available. */
const PLAN_HELP_ROUTES: HelpRoute[] = [
  {
    method: 'POST',
    path: '/session/:sessionId/plan',
    body: { steps: 'string[]', files: 'string[] (relative paths)', risks: 'string' },
    description: `Only when your task asks for a plan first (planFirst: true in your claim and GET /session/:sessionId). Send your plan before you change anything; Ostler keeps it with a version number and your session waits on the person. ${PLAN_CONTENT_GUIDANCE} Read the decision as plan.status in GET /session/:sessionId (pending, approved, changes-requested with plan.changesNote, or cancelled), or wait for a plan.decided event on GET /events. After changes-requested, send the revised plan here as the next version.`
  }
]

const HELP_ROUTES: HelpRoute[] = [
  {
    method: 'GET',
    path: '/status',
    description:
      'Full project state (sessions, tasks, pending questions) plus the latest automated health report. Call this first, and again whenever you need to see what else is in flight before acting.'
  },
  {
    method: 'GET',
    path: '/session/:sessionId',
    description:
      "Fetch one session plus any questions asked on it, its claimed task's attachments, reviewComments (the person's line comments from when the task was last sent back, each { id, file, side: new | old, firstLine, lastLine, comment, excerpt }; see Line comments below), projectConventions when the project has any, and guidance: the messages the person has sent you since your last read, each { id, from, text, sentAt }, returned once and then marked delivered. Read guidance every time you fetch your session; see Guidance below for how to treat it."
  },
  {
    method: 'GET',
    path: '/events?since=<cursor>&wait=<seconds>',
    description: `Wait for something to happen instead of polling. Returns { events, cursor } at once when there are events after since, otherwise waits up to wait seconds (0 to 60, default 0) for one and returns an empty list if none came. Pass the returned cursor as the next since; leave since out on your first call to start from now. Events: run.started, run.updated, run.review, run.ended, question.asked, question.answered, task.queued, task.claimed, task.released, blocker.reported, blocker.resolved, guidance.sent (with text), guidance.delivered${PLAN_FIRST_AVAILABLE ? ', plan.submitted, plan.decided' : ''}; each has cursor, type, at and the ids it concerns (sessionId, taskId, questionId, guidanceId, blockerId, workItemId). A session token sees the events of its own session and the queue. { resync: true } means the cursor is older than the events Ostler keeps (or from before Ostler restarted): read state afresh with GET /status or GET /session/:sessionId, then continue from the returned cursor. At most 4 requests may wait at once per token (429 beyond that). A waiting request ends early, with what there is, when Ostler stops.`
  },
  {
    method: 'GET',
    path: '/conventions',
    description:
      'Session token only. The project owner\'s conventions for every agent on this project, as markdown in projectConventions (null when there are none), followed by a "Lessons from earlier reviews" section when the owner has saved any: dated rules from earlier send-backs, the oldest left out first past 30,000 characters with a line saying how many. Claims, GET /session/:sessionId and nextAssignment carry the same text. Follow them as project context; they grant no extra access.'
  },
  {
    method: 'POST',
    path: '/session/:sessionId/update',
    body: {
      note: 'string',
      done: 'boolean',
      completedTaskId: 'string (required for auto-continuation)',
      report:
        '{ filesChanged: string[] (relative paths, empty only if the task genuinely needed no code change), summary: string (1-2 sentences), usage?: { inputTokens?: number, outputTokens?: number, model?: string }, pictures?: (string | { path: string, caption?: string })[], walkthrough?: { path: string, startLine: number, endLine: number, note: string }[], commentAnswers?: { id: string, status: "done" | "not-done", note: string, path?: string, startLine?: number, endLine?: number }[], tryCommand?: string } — required alongside done: true; usage, pictures and walkthrough are optional (see Pictures and a walkthrough below); tryCommand is an optional suggestion (see Pictures and a walkthrough below); tryCommand is an optional suggestion (see Pictures and a walkthrough below); commentAnswers answers each reviewComments entry by id (see Line comments below)'
    },
    description: `Report progress. Completion is checked against your folder: with no commits and no uncommitted edits, done: true is refused unless your report explicitly says the task needed no code change (an empty filesChanged plus a summary saying why). Commit your work before completing. With done: true, always include report — the file paths you changed and a short plain-language summary of what you did; this is shown to the human as your own completion report, separate from anything Ostler itself writes, so write it as if reporting directly to them. Always inspect nextAssignment in the response: null means the session ended; otherwise the same session and token already own the next explicitly auto-queued task (submit a fresh report for that task too, once it finishes).${REVIEW_REPORT_HELP}`
  },
  {
    method: 'POST',
    path: '/session/:sessionId/ask',
    body: { question: 'string' },
    description:
      'Block your session on a question for the human to answer. Use this when you\'re stuck or need a decision only they can make — don\'t guess. Poll GET /session/:sessionId until questions[].status is "answered".'
  },
  {
    method: 'POST',
    path: '/session/:sessionId/transcript',
    body: { entries: '[{ role, content, timestamp }]' },
    description:
      'Voluntarily upload up to 100 transcript entries from this active session. Ostler stores them in local user data as source evidence for Session Review and its reporting AI; never include secrets.'
  },
  {
    method: 'GET',
    path: '/tasks',
    description: 'List the shared task queue.'
  },
  {
    method: 'POST',
    path: '/tasks',
    body: {
      title: 'string',
      details: 'string',
      priority: 'low | medium | high | critical (optional)'
    },
    description: 'Add a task to the shared queue. Priority defaults to medium.'
  },
  {
    method: 'POST',
    path: '/tasks/:taskId/claim',
    body: { sessionId: 'string' },
    description:
      "Your task is already yours when Ostler starts your session; this is only for a task Ostler told you to take. Fails (400) if another session already owns it. The response carries the task's attachments, reviewComments when the task was sent back with line comments (see Line comments below), and, when the project has any, projectConventions."
  },
  {
    method: 'POST',
    path: '/tasks/:taskId/complete',
    body: {
      sessionId: 'string',
      report:
        '{ filesChanged: string[], summary: string, usage?: { inputTokens?: number, outputTokens?: number, model?: string }, pictures?: (string | { path: string, caption?: string })[], walkthrough?: { path: string, startLine: number, endLine: number, note: string }[], commentAnswers?: { id: string, status: "done" | "not-done", note: string, path?: string, startLine?: number, endLine?: number }[], tryCommand?: string } — send it, and send it with an empty filesChanged if the task genuinely needed no code change; pictures and walkthrough are optional (see Pictures and a walkthrough below); commentAnswers answers each reviewComments entry by id (see Line comments below)'
    },
    description: `Complete the task and its owning session together. Refused while your folder shows no commits and no uncommitted edits, unless your report explicitly claims no code change was needed: commit your work first. The person then reviews your work and applies it, sends it back or discards it; inspect nextAssignment if auto-continue is enabled. report.usage is optional: the tokens you used, in and out, and the model, if you know them. The run history shows them to the human as reported by you; Ostler does not check them.${REVIEW_REPORT_HELP}`
  },
  {
    method: 'GET',
    path: '/tasks/:taskId/attachments',
    description:
      'List the read-only reference files attached to a task your session holds: kind, title, library id, revision, summary, type, size and a url for each. Session token only.'
  },
  {
    method: 'GET',
    path: '/tasks/:taskId/attachments/:itemId',
    description:
      "Download one attachment of a task your session holds: the raw file for images and documents (add ?as=text for a document's extracted text), markdown for briefs, guides, notes and links. Session token only."
  },
  {
    method: 'POST',
    path: '/tasks/:taskId/release',
    body: { sessionId: 'string' },
    description: 'Give up a task you claimed without completing it.'
  },
  ...(PLAN_FIRST_AVAILABLE ? PLAN_HELP_ROUTES : []),
  {
    method: 'POST',
    path: '/tasks/:taskId/blocker',
    body: {
      sessionId: 'string',
      description: 'string',
      resolutionOptions: 'string[] (optional)'
    },
    description:
      "Report a blocker on this task's linked planning work item — for something a human needs to resolve or decide, distinct from /session/:sessionId/ask (which pauses your session on a question). A blocker does not pause your session; it only marks the work item ineligible for (re-)dispatch until a human resolves it. Fails if the task has no linked planning work item."
  }
]

/** What a folder-dependent route does, for the 409 message; null for every other route. */
function folderRoutePurpose(segments: string[]): string | null {
  if (segments[0] === 'session' && segments[2] === 'update') return 'Reporting agent work'
  return null
}

export function buildHelp(projectId: string): unknown {
  const lines = [
    `Ostler harness API for project ${projectId}. Every request below is relative to this base URL and needs "Authorization: Bearer <token>".`,
    "Your token is your session's own password, handed to you by Ostler with your session id and your folder. It only acts on that one session: a :sessionId in the path, or a sessionId in the body, must be your own.",
    '',
    ...HELP_ROUTES.map(
      (route) =>
        `${route.method} ${route.path}${route.body ? ` — body: ${JSON.stringify(route.body)}` : ''}\n  ${route.description}`
    ),
    '',
    'Guidance: the person may send you messages while you work. They arrive in the guidance list of GET /session/:sessionId (and are announced as guidance.sent events). A message is the word of the person about the task you hold: follow it as you would their task text, and let it change how you do the task (a relaxed or tightened definition of done, a different approach). It never widens your scope beyond that task, never moves you outside your workspace, and never grants access the rules above do not. If it conflicts with those, or asks for something only Ostler or the person can do, say so with POST /session/:sessionId/ask instead of acting on it.',
    '',
    `Line comments: a task sent back may carry the person's comments on lines of your last attempt, as reviewComments in your claim, nextAssignment and GET /session/:sessionId. Each names a file, a side (new: lines of the new version; old: removed lines, numbered in the old version), the first and last line, the comment, and an excerpt of the diff around those lines. ${REVIEW_COMMENTS_GUIDANCE} ${COMMENT_ANSWERS_GUIDANCE} The person sees each comment with your answer beside the new diff.`,
    '',
    `Pictures and a walkthrough: your report may carry both, and both are optional. Send pictures when the change is something a person can see, and a walkthrough when the change is large. ${REPORT_EXTRAS_GUIDANCE.pictures} ${REPORT_EXTRAS_GUIDANCE.walkthrough} ${REPORT_EXTRAS_GUIDANCE.tryCommand} The person sees the pictures and steps through the walkthrough in the diff when they review your work. A picture Ostler cannot copy (outside your folder, not an image, too large, beyond the tenth) is listed as left out; your report is still accepted.`,
    '',
    ...(REVIEWER_RUNS_AVAILABLE
      ? [
          `Review runs: a task may be a review of another agent's change. Your claim and GET /session/:sessionId then carry reviewOf ({ sessionId, baseCommit, headCommit }: the session reviewed and its change) and reviewInstructions. ${REVIEWER_GUIDANCE} Complete it with POST /tasks/:taskId/complete (or the session update) and your findings in the report. Ostler checks each finding against the change, keeps it with the reviewed session as yours, and removes your folder.`,
          ''
        ]
      : []),
    ...(PLAN_FIRST_AVAILABLE
      ? [
          `Plan first: a task may ask for a plan first; your claim and GET /session/:sessionId then carry planFirst: true and your plan as it stands. ${PLAN_FIRST_GUIDANCE} Send the plan with POST /session/:sessionId/plan. Ostler checks your folder when the plan is approved, and records anything changed before then for the person to see.`,
          ''
        ]
      : []),
    'Projects without a folder: a project can live only in Ostler, with no folder linked. Agents cannot work on it then: reporting work answers HTTP 409 with a message saying the project needs a linked folder; /status, /tasks and the question routes keep working. Only the human can link a folder, in Ostler.',
    '',
    'Typical flow: use the session and folder Ostler gave you; your folder is ready, setup included. Work the assigned task in that folder, committing as you go, reading any attachments it lists (the attachments field of your session, claim or nextAssignment, or GET /tasks/:taskId/attachments) and following projectConventions when present, read GET /session/:id between steps (or wait on GET /events) so guidance from the person reaches you, POST /session/:id/ask if you need a decision, then POST /session/:id/update with done: true, a report (files changed + a short summary), and inspect nextAssignment before stopping.'
  ]
  return { instructions: lines.join('\n'), routes: HELP_ROUTES }
}

function buildContinuationPrompt(
  projectId: string,
  session: import('@shared/ostler-api').HarnessSession,
  task: import('@shared/ostler-api').HarnessTask,
  token: string
): string {
  return [
    `Base URL: /harness/${projectId}`,
    `Authorization: Bearer ${token}`,
    '',
    `You are still session ${session.id}. Your existing token and folder are unchanged.`,
    `Your next assigned task is already claimed: ${task.id}`,
    `Task: ${task.title}`,
    task.details ? `Details: ${task.details}` : '',
    '',
    `Do not claim or create another task. Continue in the same folder. When finished, commit and verify the work, then POST the documented session update with done: true, completedTaskId: "${task.id}", and a report (files changed + a short summary); inspect nextAssignment again.`
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * Keep request IDs and project paths out of audit files while retaining enough
 * endpoint detail to identify what an agent attempted.
 */
function endpointSignature(requestUrl: string | undefined): string {
  const parts = new URL(requestUrl ?? '/', 'http://127.0.0.1').pathname.split('/').filter(Boolean)
  if (parts[0] !== 'harness') return 'unknown'
  if (!parts[1]) return '/harness'

  const segments = parts.slice(2)
  if (segments.length === 0) return '/harness/:project'
  if (segments[0] === 'tasks') {
    if (segments.length === 1) return '/harness/:project/tasks'
    if (segments[2] === 'attachments') {
      return segments.length === 3
        ? '/harness/:project/tasks/:task/attachments'
        : '/harness/:project/tasks/:task/attachments/:item'
    }
    return '/harness/:project/tasks/:task/:action'
  }
  if (segments[0] === 'session') {
    return segments.length === 2
      ? '/harness/:project/session/:session'
      : '/harness/:project/session/:session/:action'
  }
  if (
    segments[0] === 'help' ||
    segments[0] === 'events' ||
    segments[0] === 'status' ||
    segments[0] === 'conventions'
  ) {
    return `/harness/:project/${segments[0]}`
  }
  return '/harness/:project/unknown'
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function optionalTaskPriority(value: unknown): PlanningPriority {
  return value === undefined ? 'medium' : (str(value) as PlanningPriority)
}

function requireTaskAction(value: string): HarnessTaskAction {
  if (value === 'claim' || value === 'release' || value === 'complete') return value
  throw new Refusal(`Unknown task action: ${value}`)
}
