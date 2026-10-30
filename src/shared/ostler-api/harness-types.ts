import type { LibraryAttachedBy, LibraryItemKind } from './library-types'
import type { PlanningPriority } from './planning-types'
import type { AIEffortLevel, AIEffortSetting } from './ai-types'

// ─── Harness Types ──────────────────────────────────────────────────────────

/**
 * A task's copy of the project (simplify pass §2): a worktree of the person's
 * own repository under the Ostler data folder, on an `ostler/<task-slug>` version.
 * Null on a session for a project whose folder has no version history.
 */
export interface HarnessWorkspace {
  /** The copy's own version, `ostler/<task-slug>`. */
  branchName: string
  worktreePath: string
  /** The folder's version (branch) the copy was made from. */
  baseBranch: string
  /** The folder's commit the copy was made from. */
  baseCommit: string
  /** The workspace setup that ran before any agent could act here. Missing on sessions from before setup existed; read it as `skipped`. */
  setup?: WorkspaceSetupRecord
  /**
   * Where each task finished, when one agent did several tasks in a row in this
   * copy (`nextAssignment`). Apply adds one entry per task (§3.2).
   */
  taskMarks?: HarnessTaskMark[]
  /** True once the copy's work was applied, discarded or handed back: nothing waits on it. */
  closed?: boolean
  /**
   * A reviewer's copy (N9.5a): detached at the reviewed change's last commit,
   * with no version of its own (`branchName` is empty). Never applied; removed
   * when the review ends.
   */
  detached?: boolean
}

export interface HarnessTaskMark {
  taskId: string
  title: string
  commit: string
}

/** A queued task's prepared copy (§2.1). */
export interface HarnessTaskCopy extends HarnessWorkspace {
  /** "Getting ready" until the copy and its setup are done; only a ready copy can be started. */
  state: 'preparing' | 'ready' | 'failed'
  preparedAt: string
  /** Why the copy could not be made, when `failed`. */
  failure?: string
  /** True when the copy holds work, from an agent sent back or brought back: it is never reset. */
  hasWork: boolean
}

/**
 * What the harness did to a new workspace before the agent could start in it
 * (install dependencies, typically). Stored on the workspace and reported to
 * the agent as a fact, never as a prompt.
 */
export interface WorkspaceSetupRecord {
  status: 'skipped' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  /** Why nothing ran, when status is `skipped`. */
  skipReason?: 'off' | 'no-lockfile'
  command?: string
  source?: 'detected' | 'custom'
  startedAt?: string
  finishedAt?: string
  exitCode?: number | null
  /** One line, human-readable, shown to the human and the agent. */
  failure?: string
  /** Full output, under the project's harness folder. */
  logPath?: string
}

export interface HarnessSessionDiffFile {
  path: string
  insertions: number
  deletions: number
  binary: boolean
}

/** Read-only session-workspace changes, diffed from the merge-base so the live preview excludes unrelated base-branch changes. */
export interface HarnessSessionDiff {
  branchName: string
  baseBranch: string
  filesChanged: number
  insertions: number
  deletions: number
  files: HarnessSessionDiffFile[]
  /** Bounded unified patch for an in-app, read-only code review preview. */
  patch: string
  /** True when the preview was clipped to keep the renderer responsive. */
  patchTruncated: boolean
  /** Changes already committed on the session branch and therefore eligible for Git merge. */
  committedFilesChanged: number
  committedInsertions: number
  committedDeletions: number
  /** True when staged, unstaged, or untracked work would be omitted from a merge. */
  hasUncommittedChanges: boolean
  /** Paths Git reports as changed but not committed. */
  uncommittedFiles: string[]
  /** Authoritative merge state; computed in the main process, never inferred by the renderer. */
  mergeReadiness: 'ready' | 'needs_commit' | 'no_changes'
  mergeReadinessReason: string
  /** The folder's version the task was prepared from (§4). */
  taskVersion: string
  /** The folder's version now. */
  folderVersion: string
  /** The folder switched versions since the task started: Apply asks first. */
  versionChanged: boolean
}

/**
 * Which process actually drives a session's agent work. `external` (the
 * default, and the only kind until embedded sessions shipped) is a fresh
 * CLI/tool run entirely outside Ostler, connecting back over
 * `HarnessHttpServer`. `embedded` is an Ostler-managed opencode process
 * (`OpenCodeRunnerService`) running headless inside the session's own
 * sandboxed slot. Every other field and every other HarnessService method
 * behaves identically regardless of provenance - this is a marker, not a
 * parallel session model.
 */
export type HarnessSessionProvenance = 'external' | 'embedded'

/** Present only when `provenance === 'embedded'`. Debugging/correlation metadata for the opencode process backing this session. */
export interface HarnessEmbeddedRuntime {
  kind: 'opencode'
  /** Pinned opencode version this session ran, e.g. "1.18.23". */
  version: string
  /** Ephemeral local port opencode's headless server bound to. */
  processPort: number
  /** opencode's own session id, for correlating with its own logs/SDK calls. */
  openCodeSessionId: string
  /** Total tool calls intercepted and executed in this session, lifetime (not rate-limited). */
  toolCallCount?: number
  /** Number of assistant turns executed. */
  turnCount?: number
  /** Configured tool-call rate limit for this session, calls allowed per rolling 60-second window. */
  maxToolCallsPerMinute?: number
  /** Tool calls made within the current rolling 60-second window. */
  toolCallsInLastMinute?: number
  /** True if the session was stopped by Ostler for human review due to exceeding the rate limit. */
  stoppedForReview?: boolean
  /**
   * Reason why the embedded session concluded. `idle` means the agent finished
   * and submitted its required report; `unreported` and `abandoned` are the two
   * ways going idle is *not* a completion -- see `HarnessTaskReport.outcome`.
   */
  stopReason?:
    | 'idle'
    | 'unreported'
    | 'abandoned'
    /** The model never answered: no assistant output, no tool calls, nothing ran. */
    | 'no-response'
    | 'tool_call_rate_exceeded'
    | 'error'
    | 'manual'
    | 'timeout'
    /** Ostler's stall watchdog ended it: a call hung and the session did not recover. */
    | 'stalled'
    | string
  /** How many continuation nudges Ostler sent after the agent went idle without finishing. */
  nudgeCount?: number
  /**
   * Whether the model ever produced anything in this session -- assistant text
   * or a tool call. False means Ostler started opencode and opencode answered,
   * but the AI behind it never did: a broken connection, not a finished task.
   */
  modelResponded?: boolean
  /**
   * The last time the agent showed any sign of life: a tool call starting or
   * returning, or any event from opencode. A running session whose
   * `lastProgressAt` is minutes old is stuck, not thinking.
   */
  lastProgressAt?: string
  /**
   * Present while Ostler's stall watchdog considers the session stuck: what is
   * stuck, and since when. Cleared as soon as the agent moves again.
   */
  stall?: { since: string; reason: string }
  /** How many times the stall watchdog aborted a stuck call in this session. */
  stallAborts?: number
  /** The model this run used, fixed when it started (D42). */
  model?: string
  /** The effort this run used; absent is the provider's default. */
  effort?: AIEffortLevel
  /** Best-effort token usage reported by provider/opencode. */
  usage?: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
  }
}

export interface HarnessSession {
  id: string
  title: string
  startedAt: string
  lastUpdate: string
  statusNote: string
  status: 'active' | 'blocked' | 'done'
  blocked: boolean
  workspace: HarnessWorkspace | null
  /**
   * The session's own password (simplify pass §2.3), scoped to this session
   * alone: there is no project-wide one, so a session ending never
   * disconnects any other session.
   */
  token: string
  /** Set whenever the agent identifies this session in an authenticated harness request. Null until the agent connects. */
  lastSeenAt: string | null
  /**
   * The task this session was started for, kept for the session's whole life.
   *
   * Deliberately distinct from `HarnessTask.claimedBy`: a failed run releases
   * its task back to pending and clears `claimedBy`, but the session stays in
   * review still holding a workspace slot. Resolving the pair through
   * `claimedBy` alone therefore lost every such session, leaving its workspace
   * unreachable from the UI and its slot leaked for good. Null for a session
   * started with no task (the bare "New agent session" flow), and absent only
   * on sessions persisted before this field existed -- callers fall back to
   * `HarnessTask.claimedBy` for those.
   */
  taskId?: string | null
  /** Who/what is actually running this session. Defaults to 'external' for every session started the existing way. */
  provenance: HarnessSessionProvenance
  /** Present only when `provenance === 'embedded'`. */
  embeddedRuntime?: HarnessEmbeddedRuntime
  /** The run's plan, for a plan-first task, once the agent has sent one (N9.3a). */
  plan?: HarnessPlan
  /**
   * The task's library attachments as this session was given them: copied
   * into an embedded session's attachments folder at start, or listed to an
   * external session when it took the task.
   */
  attachmentsGiven?: HarnessAttachmentGiven[]
  /** Each time an external session downloaded one of its attachments, oldest first. */
  attachmentFetches?: HarnessAttachmentFetch[]
  /**
   * Draft line comments the person has written in Review changes (N9.2a),
   * kept until Send back carries them or the session ends.
   */
  reviewDrafts?: HarnessReviewComment[]
  /** Set on a reviewer's run (N9.5a): the session whose change it reviews. Never in review itself. */
  reviewOf?: HarnessReviewOf
  /** What reviewers said about this session's change (N9.5a), the reviewers' words, newest last. */
  reviewerReports?: HarnessReviewerReport[]
  /** When its latest review was asked for (N9.5b): the 30-minute wait counts from here. */
  reviewRequestedAt?: string
  /** Reviewer findings the person dismissed in Review changes (N9.5b), by id. */
  dismissedFindingIds?: string[]
  /**
   * Where its latest review stands (N9.5b), worked out when the state is read:
   * absent when it was never reviewed.
   */
  review?: HarnessReviewWait
}

/**
 * Where a session's latest review stands (N9.5b). running: queued or under
 * way, under 30 minutes; overdue: still not finished after 30 minutes;
 * reported: the reviewer reported; failed: it ended without a report.
 */
export interface HarnessReviewWait {
  status: 'running' | 'overdue' | 'reported' | 'failed'
  requestedAt: string | null
}

/**
 * A session as a start-session call returns it to the renderer: without its
 * token. The prompt that carries the token is built and copied by main
 * (`copyHarnessSessionPrompt`).
 */
export type RendererHarnessSession = Omit<HarnessSession, 'token'>

/** One download of a task attachment over the harness API. */
export interface HarnessAttachmentFetch {
  libraryItemId: string
  revision: number
  /** `original` file, a document's extracted `text`, or the `markdown` of a text item. */
  form: 'original' | 'text' | 'markdown'
  fetchedAt: string
}

/** One library attachment as a coding session was given it. */
export interface HarnessAttachmentGiven {
  libraryItemId: string
  kind: LibraryItemKind
  title: string
  revision: number
  attachedBy: LibraryAttachedBy
}

export interface HarnessQuestion {
  id: string
  sessionId: string
  sessionTitle: string
  question: string
  answer: string | null
  askedAt: string
  answeredAt: string | null
  status: 'pending' | 'answered'
}

/**
 * A message the person sent to a running agent run (D41). Kept with the
 * session in the harness data, so an undelivered one survives a restart.
 */
export interface HarnessGuidance {
  id: string
  sessionId: string
  /** Markdown, as the person wrote it. */
  text: string
  /** The person's name from Settings, which the agent sees on the message. */
  from: string
  /** Where it was sent from: the app, or the automation API on the person's behalf. */
  via: 'app' | 'automation'
  sentAt: string
  /**
   * When the agent received it: posted into an embedded session, or returned
   * on an external agent's next read of its session. Null until then.
   */
  deliveredAt: string | null
}

/** What an agent event is about (D41). */
export type AgentEventType =
  | 'run.started'
  | 'run.updated'
  | 'run.review'
  | 'run.ended'
  | 'question.asked'
  | 'question.answered'
  | 'task.queued'
  | 'task.claimed'
  | 'task.released'
  | 'blocker.reported'
  | 'blocker.resolved'
  | 'guidance.sent'
  | 'guidance.delivered'
  /** Plan first (N9.3a): an agent sent a plan, or a new version of one. */
  | 'plan.submitted'
  /** The person approved a plan, asked for changes or cancelled the run. */
  | 'plan.decided'

/** One entry of the harness and automation APIs' `GET /events` (D41). */
export interface AgentEvent {
  /** Increases with every event; pass the last one seen as `since`. */
  cursor: number
  type: AgentEventType
  at: string
  projectId: string
  sessionId?: string
  taskId?: string
  questionId?: string
  guidanceId?: string
  blockerId?: string
  workItemId?: string
  /** A guidance message's text, on guidance.sent only. */
  text?: string
}

export interface ProjectAutoDispatchConfig {
  projectId: string
  enabled: boolean
  maxConcurrentEmbeddedSessions: number
  /** Use this project's provider/model instead of the global Settings > AI selection. */
  aiOverrideEnabled: boolean
  defaultProvider: string
  defaultModel: string
  /** The effort for `defaultModel` ('' is the provider's default); used only with the override (D42). */
  defaultEffort: AIEffortSetting
  /**
   * Move Done work items into the project archive once they have sat untouched
   * for this many days. 0 turns it off.
   */
  autoArchiveDoneAfterDays: number
  /**
   * Agents plan first (N9.3b): a queued task whose own Plan first is "Project
   * default" asks its agent for a plan before it changes anything. Off by
   * default; always set by the config store.
   */
  agentsPlanFirst?: boolean
  /**
   * Review agent work before me (N9.5b, N63): each session entering review
   * with changes starts a reviewer run first. Off by default; always set by
   * the config store.
   */
  reviewBeforeMe?: boolean
}

/**
 * Agent-authored completion report: the files it changed and a short
 * summary of what it did, submitted through the harness API alongside
 * `done: true`. Distinct from anything Ostler itself generates, so the UI
 * must always label it as coming from the agent, not from Ostler.
 */
export interface HarnessTaskReport {
  filesChanged: string[]
  summary: string
  submittedAt: string
  /** Tool names intercepted by Ostler for an embedded session. */
  toolsRun?: string[]
  /** Ostler could not capture the agent's required final report. Review is needed. */
  missing?: boolean
  /**
   * The agent actually submitted the required structured report (embedded:
   * `ostler_complete_task`). False/absent means Ostler assembled this report from
   * observed evidence instead, and nothing here is the agent's own account of
   * being done. Anything that auto-accepts a session must require this.
   */
  structured?: boolean
  /** Verbatim `blockers` from a structured report, so callers need not parse it back out of `summary`. */
  blockers?: string
  /**
   * Where `filesChanged` came from. `agent` is the list the agent itself
   * reported; `ostler` means the agent named no files and Ostler filled the list
   * in from the workspace diff.
   *
   * Worth recording because an `ostler` list inside an otherwise structured
   * report is a red flag: an agent that changed files but reported none was not
   * describing the work in front of it. One such report summarised an unrelated
   * Python task while Ostler's own list showed five TypeScript files.
   */
  filesChangedSource?: 'agent' | 'ostler'
  /**
   * The agent's own account does not line up with what Ostler observed, so the
   * report should not be trusted or auto-accepted without a human reading the
   * transcript. Set alongside `structured: true` -- the report was submitted,
   * it just does not match the evidence.
   */
  inconsistent?: boolean
  /** Why `inconsistent` was set, in one human-readable line. */
  inconsistentReason?: string
  /**
   * Ostler's own verdict on how the session ended, independent of what the agent said:
   * - `reported`  - structured report submitted.
   * - `unreported` - committed work exists, but the agent never reported. Needs a human read.
   * - `abandoned` - went quiet with no commits and no report. Treat the task as not done.
   * - `blocked` - reported blockers and committed nothing. The task is held, not done.
   */
  outcome?: 'reported' | 'unreported' | 'abandoned' | 'blocked' | 'no-response'
  /**
   * Token usage the agent reported itself in its completion report (R5.3).
   * Optional, and never checked: the app labels it as reported by the agent.
   */
  usage?: HarnessReportedUsage
  /**
   * Pictures the agent took of its work (N9.1), copied out of its copy when
   * the report arrived: names under the session's picture folder, never bytes.
   */
  pictures?: HarnessReportPicture[]
  /** Pictures the agent named that Ostler did not copy, and why. */
  picturesLeftOut?: HarnessReportPictureLeftOut[]
  /** Where to start reading a large change, stop by stop (N9.1). */
  walkthrough?: HarnessWalkthroughStop[]
  /**
   * The command the agent suggests for Try it (N9.4), one line. Shown beside
   * Use this command, never run: only a command the person saves runs.
   */
  tryCommand?: string
  /**
   * The pictures as the agent named them, before Ostler copies them out. Only
   * between the report's arrival and the copy: never stored.
   */
  pictureRequests?: HarnessReportPictureRequest[]
  /**
   * A reviewer's findings as it sent them (N9.5a), before Ostler checks them
   * against the diff. Only between the report's arrival and the check: never stored.
   */
  findingRequests?: unknown[]
  /**
   * The agent's answers to the line comments its task was last sent back
   * with (N9.2b), one per comment id it answered. The agent's claim, not a
   * fact Ostler checked.
   */
  commentAnswers?: HarnessCommentAnswer[]
  /** Ids the agent answered that were not in the latest rejection: ignored, listed for the alert. */
  commentAnswersIgnored?: string[]
}

/** An agent's answer to one line comment (N9.2b). */
export interface HarnessCommentAnswer {
  /** The comment's id, from `HarnessTaskRejection.comments`. */
  id: string
  status: 'done' | 'not-done'
  /** Plain text, up to 1,000 characters; required for `not-done`. */
  note: string
  /** Where the change now is, in the new version: a file relative to the copy, and its lines. */
  path?: string
  startLine?: number
  endLine?: number
}

/** A picture an agent names in its report: a path inside its copy. */
export interface HarnessReportPictureRequest {
  path: string
  caption?: string
}

/** A picture Ostler copied out of a task's copy (N9.1). */
export interface HarnessReportPicture {
  /** The file's name in the session's picture folder, as the picture routes take it. */
  name: string
  /** The path the agent gave, inside its copy. */
  path: string
  caption?: string
  size: number
}

export type HarnessReportPictureLeftOutReason =
  'outside-copy' | 'not-found' | 'not-image' | 'too-large' | 'too-many'

export interface HarnessReportPictureLeftOut {
  path: string
  reason: HarnessReportPictureLeftOutReason
}

/** One stop of a walkthrough: lines of a changed file and what they are for. */
export interface HarnessWalkthroughStop {
  path: string
  /** First and last line in the changed file, from 1. */
  startLine: number
  endLine: number
  note: string
}

/** Usage an agent reports in its completion report (R5.3, D43). */
export interface HarnessReportedUsage {
  inputTokens?: number
  outputTokens?: number
  /** The model the agent says it used. */
  model?: string
}

/** Why a human sent an agent's finished work back, and what they asked for next. */
export interface HarnessTaskRejection {
  reason: string
  rejectedAt: string
  /**
   * 'retry' puts the task back in the queue for another agent, carrying the
   * reason; 'rework' cancels the queue entry so a human can revise the work
   * item first; 'hold' keeps the task queued but held, which reads as Blocked
   * on the board.
   */
  disposition: 'retry' | 'rework' | 'hold'
  /** The session whose work was rejected. */
  sessionId: string
  /**
   * The person's comments on lines of the change (N9.2a), with the code each
   * was about. Only the latest three rejections keep them.
   */
  comments?: HarnessSentReviewComment[]
  /** How many line comments it carried, kept when older comments are dropped. */
  commentCount?: number
}

/**
 * A person's comment on a line or lines of an agent's change, made in Review
 * changes (N9.2a). Anchored to the parsed diff: the file, and the line numbers
 * on its new side, or on its old side for removed lines.
 */
export interface HarnessReviewComment {
  id: string
  /** The file's path as the diff names it (its old path for a deleted file). */
  file: string
  side: 'new' | 'old'
  firstLine: number
  lastLine: number
  /** Plain text, up to 2,000 characters. */
  comment: string
}

/** The change a review run reviews (N9.5a): a session in review, from its base to its head commit. */
export interface HarnessReviewOf {
  sessionId: string
  baseCommit: string
  headCommit: string
}

export type HarnessFindingSeverity = 'must-fix' | 'should-fix' | 'nit'

/**
 * A reviewer's finding (N9.5a): a line comment with a severity, checked
 * against the reviewed diff. `general` marks one on lines the diff does not
 * show; it has no excerpt.
 */
export interface HarnessReviewFinding extends HarnessReviewComment {
  severity: HarnessFindingSeverity
  /** The lines with three around them, from the reviewed diff; '' for a general finding. */
  excerpt: string
  general?: true
}

/** One review of a session's change, kept with the reviewed session as the reviewer's (N9.5a). */
export interface HarnessReviewerReport {
  reviewerSessionId: string
  reviewTaskId: string
  provenance: HarnessSessionProvenance
  /** The reviewer's model, when known (the built-in agent's, or the one an external agent reported). */
  model?: string
  startedAt: string
  endedAt: string
  /** reported: it sent a report; not-reported: it ended without one; stopped: the reviewed task ended first. */
  outcome: 'reported' | 'not-reported' | 'stopped'
  /** The reviewer's summary, or "The reviewer did not report". */
  summary: string
  findings: HarnessReviewFinding[]
  /** Findings Ostler could not read or that came past the 50th. */
  findingsLeftOut?: number
}

/** A line comment as Send back carried it: with an excerpt of the diff it was about. */
export interface HarnessSentReviewComment extends HarnessReviewComment {
  /** The commented lines with three around them, as diff lines, from the attempt sent back. */
  excerpt: string
}

export interface HarnessTask {
  id: string
  title: string
  status: 'pending' | 'claimed' | 'complete' | 'cancelled'
  claimedBy: string | null
  details: string
  priority: PlanningPriority
  /** Durable planning origin for linked tasks, including after an execution is cancelled. */
  planningWorkItemId: string | null
  /** Human-enabled: this queued task may be handed to the same agent after it finishes its current task. */
  autoContinue: boolean
  /** Human-enabled: paused/held task skipped by the automatic dispatcher. */
  hold?: boolean
  /**
   * Every time a human rejected an attempt at this task, newest last. Kept on
   * the task rather than the session so the reason survives the workspace it
   * came from and reaches whoever picks the work up next.
   */
  rejections?: HarnessTaskRejection[]
  /**
   * Planning dependencies still standing between this queued task and an agent.
   * Above zero the task waits in the queue and every claim path refuses it;
   * it needs no human action and clears itself as the work ahead finishes.
   */
  waitingOnDependencies?: number
  /** Set when the completing agent submitted a completion report. Never present for a still-pending or claimed task. */
  report?: HarnessTaskReport | null
  /**
   * The model chosen for this run of the task, for the built-in agent only
   * (D42). '' or absent uses the project's default, then Settings'. Can change
   * while the task waits in the queue; fixed once a run takes it.
   */
  model?: string
  /** The effort chosen for this run ('' or absent: the default's effort, see `resolveAgentModel`). */
  effort?: AIEffortSetting
  /** The task's prepared copy, while it waits in the queue. Absent: "Waiting" (§2.2). */
  copy?: HarnessTaskCopy
  /**
   * Plan first (N9.3a): the agent sends a plan and waits for the person
   * before changing anything. Absent or false: it starts at once.
   */
  planFirst?: boolean
  /** A review run's task (N9.5a): whose change it reviews. Queued ahead of ordinary work. */
  reviewOf?: HarnessReviewOf
  /** Queued by Run playbook (N9.6b): the playbook it came from, as it was named then. */
  playbook?: HarnessTaskPlaybook
  /** Queued by its repeat's schedule (N9.7): "Scheduled" on its queue and run cards. */
  scheduled?: true
}

/** The playbook a queued task came from (N9.6b). */
export interface HarnessTaskPlaybook {
  templateId: string
  name: string
}

/**
 * Where a plan stands (N9.3a): waiting on the person, approved, sent back for
 * changes (the agent sends a new version), or cancelled with its run.
 */
export type HarnessPlanStatus = 'pending' | 'approved' | 'changes-requested' | 'cancelled'

/**
 * An agent's plan for a plan-first task (N9.3a), kept on its session. The
 * steps, files and risks are the agent's own text: plain text, capped.
 */
export interface HarnessPlan {
  /** 1 for the first plan, one more for each new version. */
  version: number
  steps: string[]
  /** Paths relative to the project. */
  files: string[]
  risks: string
  status: HarnessPlanStatus
  submittedAt: string
  decidedAt: string | null
  /** The person's note when they asked for changes. */
  changesNote: string | null
  /**
   * Files the task's copy had already changed, committed or not, when the plan
   * was approved. Absent when there were none.
   */
  changedBeforeApproval?: { files: string[] }
}

/**
 * One version of a plan as kept with its task (N9.3b, `task_plans`): every
 * version an agent sent and the person's decision on it, kept after the run
 * ends. `changedBeforeApproval` lists files the copy had changed before the
 * plan was approved (empty when none).
 */
export interface TaskPlanRecord {
  id: string
  projectId: string
  /** The task (planning work item) the run was for, when it had one. */
  workItemId: string | null
  sessionId: string
  /** The harness task the run claimed. */
  taskId: string | null
  version: number
  steps: string[]
  files: string[]
  risks: string
  status: HarnessPlanStatus
  changesNote: string | null
  submittedAt: string
  decidedAt: string | null
  changedBeforeApproval: string[]
}

/** A session's plan as the Plan dialog shows it: the latest version and every earlier one. */
export interface SessionPlanView {
  sessionId: string
  title: string
  plan: HarnessPlan | null
  /** Every version kept for this run, oldest first. */
  history: TaskPlanRecord[]
}

/** What Apply did (§3.2). */
export interface HarnessApplyResult {
  session: HarnessSession
  /**
   * `applied`: the work is in the project folder. `nothing_changed`: the task
   * finished with no changes and was closed. `sent_back`: the project changed
   * while the agent worked and the work clashes, so it went back to its agent.
   */
  outcome: 'applied' | 'nothing_changed' | 'sent_back'
  /** Entries added to the folder's history, one per task. */
  entries: number
}

export interface HarnessSessionCompletionResult {
  session: HarnessSession
  nextAssignment: { task: HarnessTask; prompt: string; tokenUnchanged: true } | null
}

export type HarnessReportHealth = 'healthy' | 'warning' | 'error'

export interface HarnessReportAlert {
  severity: 'info' | 'warning' | 'error'
  code: string
  title: string
  detail: string
}

export interface HarnessReportEvent {
  timestamp: number
  eventType: string
  sessionId: string
  sessionTitle: string
  details: string
}

export interface HarnessReport {
  projectId: string
  generatedAt: string
  windowStart: string
  windowEnd: string
  healthStatus: HarnessReportHealth
  summary: string
  metrics: {
    activeSessions: number
    reviewSessions: number
    staleSessions: number
    pendingTasks: number
    claimedTasks: number
    completedTasks: number
    recentEvents: number
    pendingQuestions: number
  }
  alerts: HarnessReportAlert[]
  recentEvents: HarnessReportEvent[]
}

export interface HarnessAutomationStatus {
  enabled: boolean
  running: boolean
  pollIntervalMs: number
  reportIntervalMs: number
  staleSessionThresholdMs: number
  lastReportAt: string | null
  lastReportHealth: HarnessReportHealth | null
}

export interface HarnessProjectState {
  projectId: string
  hasHarness: boolean
  activeSessions: HarnessSession[]
  /** Finished sessions whose copies wait for the person: Apply, Send back or Discard. */
  reviewSessions: HarnessSession[]
  taskQueue: HarnessTask[]
  questions: HarnessQuestion[]
  /** Messages the person sent to running agents (D41), oldest first. */
  guidance?: HarnessGuidance[]
  watcherRunning: boolean
  automation?: HarnessAutomationStatus
  /**
   * Why moving this project's agent work from before the update failed (§6),
   * when it did: the project shows "needs attention" with Try again.
   */
  legacyMigrationProblem?: string
  /**
   * The version (line of work) the project folder is on now, or null when it
   * has none or Ostler cannot tell. A running task started from another one
   * shows a notice (§4).
   */
  folderVersion?: string | null
}

export type HarnessEventType =
  | 'session_start'
  | 'session_end'
  | 'task_claimed'
  | 'task_complete'
  | 'task_cancelled'
  | 'task_reordered'
  | 'task_priority_changed'
  | 'file_checkout'
  | 'file_lock'
  | 'question_asked'
  | 'question_answered'
  | 'attachment_fetched'
  /** A task was added to the queue (P5.2: the task's activity). */
  | 'task_queued'
  /** An agent filed its completion report for a task (P5.2). */
  | 'task_report_submitted'
  /** A person chose the model and effort for a queued task's run (R5.2). */
  | 'task_model_changed'
  /** Plan first (N9.3a): an agent sent a plan for the person to decide on. */
  | 'plan_submitted'
  /** The person approved a plan, asked for changes or cancelled the run (N9.3a). */
  | 'plan_decided'

/** What the guided agent setup checks before agents go on (P7.2). */
export interface AgentRequirements {
  /** `git --version`, or null when Git could not be run. */
  gitVersion: string | null
  /** Ostler AI has a model and a key, or a keyless local provider. */
  aiConfigured: boolean
  /** The built-in agent's runtime ships with this copy of the app. */
  runtimePresent: boolean
}

/** How an agent run ended, as the Agents view's Recent runs shows it (P7.2). */
export type AgentRunOutcome = 'accepted' | 'discarded' | 'rejected' | 'ended'

/** One finished agent run: a session that is done and no longer in review. */
export interface RecentAgentRun {
  sessionId: string
  title: string
  /** The task the run was started for, when it had one. */
  taskId: string | null
  provenance: HarnessSessionProvenance
  startedAt: number
  endedAt: number
  outcome: AgentRunOutcome
  /** How the run ended, in Ostler's words ("Merged into main", "Rejected: …"). */
  detail: string
}

/**
 * How a run in the history ended (R5.3, D43). `in_review` is a run whose work
 * waits for a person; the review's verdict (accepted, discarded, rejected)
 * replaces it. The rest say how the run itself ended.
 */
export type AgentRunRecordOutcome =
  | 'in_review'
  | 'accepted'
  | 'discarded'
  | 'rejected'
  | 'abandoned'
  | 'unreported'
  | 'stopped'
  | 'failed'

/** One agent run, embedded or external, as the history keeps it (R5.3, D43). */
export interface AgentRunRecord {
  sessionId: string
  projectId: string
  /** The task the run worked, when it had one (the last one, for an auto-continued run). */
  taskId: string | null
  title: string
  /** `embedded` is the built-in agent; `external` a connected one. */
  provenance: HarnessSessionProvenance
  /** The model the run used (R5.2); for an external agent, the one it reported, if any. */
  model: string | null
  effort: string | null
  startedAt: number
  endedAt: number
  durationMs: number
  /** Where the run stands now: the review's verdict once there is one. */
  outcome: AgentRunRecordOutcome
  /** How the run itself ended, before any review. */
  endedAs: AgentRunRecordOutcome
  /** Ostler's note on how it ended. */
  detail: string
  /** Stuck calls the stall watchdog caught. */
  stalls: number
  /** Continuation nudges the completion gate sent. */
  nudges: number
  /** Guidance messages the person sent the run (R5.1). */
  guidance: number
  /** Commits on the run's branch; null when Ostler could not read them. */
  commits: number | null
  filesChanged: number | null
  /** Tokens in and out; null when nothing was measured or reported. */
  inputTokens: number | null
  outputTokens: number | null
  /** The tokens come from the agent's own completion report, not from Ostler. */
  usageReported: boolean
}

/** A price per million tokens for one model, entered by the person (D43). */
export interface AgentModelPrice {
  model: string
  inputPerMillion: number
  outputPerMillion: number
}

/** What the history shows: every filter is optional. */
export interface AgentRunFilter {
  outcome?: AgentRunRecordOutcome
  model?: string
  /** Local days, `YYYY-MM-DD`, inclusive; a run belongs to the day it started. */
  from?: string
  to?: string
}

/** Totals over a set of runs. */
export interface AgentRunTotals {
  runs: number
  /** Runs no longer waiting for review. */
  finished: number
  accepted: number
  /** Accepted out of finished; null with nothing finished. */
  successRate: number | null
  medianDurationMs: number | null
  inputTokens: number
  outputTokens: number
  /** Cost of the runs whose model has a price; null when none has. */
  cost: number | null
  /** Some runs with tokens have no price, so `cost` leaves them out. */
  costIncomplete: boolean
  /** Some of the tokens were reported by the agents themselves. */
  includesReportedUsage: boolean
}

export interface AgentRunHistory {
  runs: AgentRunRecord[]
  totals: AgentRunTotals
  byModel: (AgentRunTotals & { model: string | null })[]
  /** Every model in the project's history, for the model filter. */
  models: string[]
}

/** A project's token limits for the built-in agent (D43); null is no limit. */
export interface AgentUsageLimits {
  tokensPerDay: number | null
  tokensPerMonth: number | null
}

export interface AgentLimitUsage {
  period: 'day' | 'month'
  limit: number | null
  /** Built-in agent tokens, in and out, of runs started in this period. */
  used: number
  /** When the period starts again: local midnight, or the first of next month. */
  resetsAt: number
  reached: boolean
}

export interface AgentUsageStatus {
  projectId: string
  day: AgentLimitUsage
  month: AgentLimitUsage
}
