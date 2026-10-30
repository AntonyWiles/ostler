import { openFindings } from '@shared/reviewer-runs'
import { commentAnswerAlerts } from '@shared/comment-answers'
import type { ProjectArea } from '@shared/project-areas'
import { normalizeProjectStage, type ProjectStage } from '@shared/project-stages'
import type { UpdateReminder } from '@shared/status-updates'
import { isProgressWeekStart } from '@shared/planning/progress'
import type { ProgressService } from './progress-service'
import { createServer, IncomingMessage, Server, ServerResponse } from 'http'
import { appendFileSync, createReadStream, mkdirSync, rmSync, statSync } from 'fs'
import { Readable, Writable } from 'stream'
import { pipeline } from 'stream/promises'
import { join } from 'path'
import type {
  OstlerConfig,
  BriefingProject,
  CreateLibraryItemInput,
  LibraryAiAccess,
  LibraryItem,
  LibraryItemKind,
  LibraryQuery,
  UpdateLibraryItemInput,
  WorkItemAttachment,
  WorkItemSource,
  TaskTemplateOverrides,
  PlanningRecurrenceInput,
  CreatePlanningWorkItemInput,
  PlanningPriority,
  PlanningReadinessReport,
  PlanningWorkItem,
  PlanningWorkItemScope,
  ProjectAutoDispatchConfig,
  TaskPlanRecord,
  PlanningWorkItemStatus,
  UpdatePlanningWorkItemInput,
  HarnessGuidance,
  PlanningWorkItemPlacement,
  HarnessQuestion,
  HarnessSession,
  SessionTranscriptEntry,
  WatchedProject,
  ProjectLesson,
  ActivityQuery,
  ProjectReport
} from '@shared/ostler-api'
import {
  LIBRARY_MAX_FILE_BYTES,
  LIBRARY_MAX_TASK_ATTACHMENTS,
  MAX_RESOLUTION_REASON_LENGTH
} from '@shared/ostler-api'
import type { AgentSetupSetting } from '@shared/workspace-setup'
import type { PlanningService } from './planning-service'
import type { PeopleService } from './people-service'
import type { DaysOffService } from './days-off-service'
import type { OutsideCalendarService } from './outside-calendar-service'
import type { LibraryService } from './library-service'
import type { HarnessService } from './harness-service'
import type { ProjectPackageService } from './project-package-service'
import type { ImportService } from './import-service'
import type { GithubLinkService } from './github/github-link-service'
import {
  buildProjectCalendarFile,
  buildProjectTimelineSlides,
  buildProjectShareReport,
  buildTasksCsv
} from './export-service'
import { latestReviewComments } from '@shared/review-comments'
import { RescheduleService } from './reschedule-service'
import type { FocusService } from './focus-service'
import { ARCHIVE_LIMITS } from './project-archive'
import type { CsvField, CsvImportOptions } from '@shared/ostler-api'
import { CSV_FIELDS, detectDelimiter, parseCsv } from '@shared/import/csv-import'
import { CSV_PRESETS } from '@shared/import/csv-presets'
import { MAX_IMPORT_FILE_BYTES } from '@shared/import/import-plan'
import {
  archiveWorkItem,
  closeAsWontDo,
  markAsDuplicate,
  deleteWorkItem,
  deleteWorkItemForever,
  wontDoOptions
} from './planning-deletion'
import { acceptFromTriage, moveFromTriage, readAcceptFields } from './triage-service'
import { projectWorkItemStatus } from '@shared/work-item-status'
import { dependencyConflicts } from '@shared/planning/timeline'
import { criticalPath } from '@shared/planning/critical-path'
import { queueNewTask, queueWorkItemForHarness } from './task-intake'
import { updateWorkItemThroughQueue } from './queue-exit'
import { checkTemplateBodyAgent, runPlaybook, validatePlaybookAgent } from './playbooks'
import { validateAgentRunChoice, validateRunAgainChoice } from './agent-run-model'
import type { AgentRunChoice } from '@shared/agent-model'
import { syncAgentWorkItemStatus } from './agent-status-sync'
import { batchRowsFrom, checkWorkItemBatch, createWorkItemBatch } from './planning-batch'
import {
  bearerToken,
  logRouteFailure,
  readJsonRecord,
  readJsonValue,
  respondJson,
  routeFailureBody
} from './loopback-http'
import { AGENT_WORK_RESOURCES, mcpToolsFromRoutes, type McpRouteRequest } from './mcp/mcp-tools'
import {
  createMcpServer,
  mcpRequestRefusal,
  serveMcpHttp,
  type CapturedRouteResponse
} from './mcp/mcp-endpoint'
import { Refusal } from '@shared/refusal'
import { parseTaskKey } from '@shared/task-key'
import { MAX_PLAN_CHANGES_NOTE_LENGTH } from '@shared/plan-first'
import type { LinkedFromEntry, LinkTargetKind } from '@shared/ostler-api'
import { PPTX_CONTENT_TYPE } from '@shared/export/timeline-pptx'
import { normalizeAgentLimits } from '@shared/agent-run-history'
import { isFolderRequiredError, projectFolder, requireProjectFolder } from '@shared/project-folder'
import { matchesFilter, parseTaskFilter } from '@shared/task-filter'
import { SEARCH_ENTITY_TYPES } from '@shared/ostler-api'
import type { SavedViewType, SearchEntityType } from '@shared/ostler-api'
import type { ReportService } from './report-service'
import type { ProjectAiSettingsService } from './project-ai-settings'
import { EventWaitLimitError, parseEventQuery, type AgentEventStream } from './agent-events'
import { GuidanceRefusal } from './harness/guidance'
import { reminderOptions } from './planning-reminders'
import { AUTOMATION_ACTOR, queryFlag } from './automation/common'
import { PROJECT_SETTINGS_ROUTES } from './automation/project-settings'
import { SETUP_ROUTES } from './automation/setup'
import { MY_DAY_ROUTES } from './automation/my-day'
import { PROJECT_TOOLS_ROUTES } from './automation/project-tools'
import { MILESTONES_ROUTES } from './automation/milestones'
import { GOALS_ROUTES } from './automation/goals'
import { GITHUB_ROUTES } from './automation/github'
import { PINS_ROUTES } from './automation/pins'
import { TIME_ROUTES } from './automation/time'
import { MONEY_ROUTES } from './automation/money'
import { CALENDARS_ROUTES } from './automation/calendars'
import { PEOPLE_ROUTES } from './automation/people'
import { DAYS_OFF_ROUTES } from './automation/days-off'
import { CONTACTS_ROUTES } from './automation/contacts'
import {
  helpRoute,
  matchRoute,
  routeOwns,
  type AutomationRoute,
  type AutomationRouteDef
} from './automation/route-table'

export interface AutomationStatus {
  project: {
    id: string
    name: string
    enabled: boolean
  }
  harness: {
    queue: {
      pending: number
      active: number
      review: number
      done: number
    }
    unansweredQuestions: number
    workspacesAwaitingReview: number
  }
  planning: {
    goals: Record<'active' | 'achieved' | 'archived', number>
    milestones: Record<'planned' | 'active' | 'complete' | 'archived', number>
    workItems: Record<'backlog' | 'ready' | 'active' | 'blocked' | 'review' | 'done', number>
    metrics: ReturnType<PlanningService['getProjectMetrics']>
  }
  readinessReports?: PlanningReadinessReport[]
}

export interface AutomationAuditEntry {
  route: string
  summary: string
  projectId: string
  origin: 'automation-api'
}

/** How a run's model is chosen over this API (D42), said once for every route that takes one. */
const RUN_CHOICE_RULE =
  "model and effort choose the built-in agent's model for this run: model is one the app offers for the provider in effect (Settings › Agents, or the project's override), effort is minimal, low, medium, high, xhigh or max and is checked with the model's provider as Settings checks it; \"\" or left out is the default (the project's, else Settings'). A refused choice is HTTP 400. External agents choose their own model; a model on a task applies only if the built-in agent runs it."

/** A protected project file's header and tag, on top of the plain file's limit (N45). */
const PROTECTED_OVERHEAD_BYTES = 65

/**
 * A project file's password (N45), from the Ostler-File-Password header,
 * never the address. Its bytes are read as UTF-8. Never logged.
 */
function filePasswordHeader(req: IncomingMessage): string | undefined {
  const value = req.headers['ostler-file-password']
  if (typeof value !== 'string' || value === '') return undefined
  return Buffer.from(value, 'latin1').toString('utf8')
}

/** A path segment as text, or '' when it is not valid percent-encoding. */
function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return ''
  }
}

/** Every route: its help and its handler (routes not moved yet are answered by `handle()` itself). */
const ROUTES: AutomationRouteDef[] = [
  {
    method: 'GET',
    path: '/projects',
    mcp: { excluded: 'It lists every project; an MCP connection reaches one project only.' },
    description:
      'List all registered watched projects, in the sidebar order, without filesystem paths or credential values. hasFolder is false for a project that lives only in Ostler. areaId is the area the project is in (GET /areas), or null for "No area"; icon is its icon id, or null; stage is planning, active, on-hold or done (GET and PUT /stage). Requires any valid automation token.',
    response:
      '{ ok: true, value: Array<{ id, name, enabled, hasFolder, automationTokenConfigured, areaId, icon, stage }> }'
  },
  {
    method: 'GET',
    path: '/areas',
    mcp: { excluded: 'Areas group every project; an MCP connection reaches one project only.' },
    description:
      'List the areas that group projects in the sidebar, on Home and in project pickers, in their order. Areas are made, renamed, reordered and removed in the app only. Requires any valid automation token.',
    response: '{ ok: true, value: Array<{ id, name }> }'
  },
  {
    method: 'GET',
    path: '/help',
    mcp: { excluded: 'MCP lists its own tools.' },
    description: 'Describe this API, response envelopes, and the typical flow.',
    response: '{ ok: true, value: { instructions, routes } }'
  },
  {
    method: 'GET',
    path: '/tasks',
    description:
      'List the project harness task queue. A task its repeat queued on schedule (goToAgents on POST /work-items/:workItemId/recurrence) carries scheduled: true.',
    response: '{ ok: true, value: HarnessTask[] }'
  },
  {
    method: 'GET',
    path: '/status',
    description:
      'Return report-backed harness counts, planning status counts and metrics, and deterministic readiness reports when available.',
    response: '{ ok: true, value: AutomationStatus }'
  },
  ...PROJECT_SETTINGS_ROUTES,
  {
    method: 'GET',
    path: '/report',
    description: 'Return the existing generated HarnessReport for this project.',
    response: '{ ok: true, value: HarnessReport }'
  },
  {
    method: 'POST',
    path: '/tasks',
    description:
      'Queue a task for an agent. Every task is a planning work item, so it shows on the Board: pass workItemId to queue an existing item, or a title to create a Ready work item and queue it in one step. Work whose dependencies are not done can be queued: the task waits (waitingOnDependencies) until every dependency is merged, so a whole plan can be queued at once. The agent always gets the current text of its work item, so edit the item rather than re-queueing. GET /work-items reports the Board column of each item (Ready while queued, Active while an agent has it, Review until merged, Done after).',
    request: `JSON body: { workItemId } or { title, description?/details?, priority? }, either with model? and effort?. ${RUN_CHOICE_RULE} The task returns them as model and effort; a run returns what it used as embeddedRuntime.model and embeddedRuntime.effort on GET /sessions.`,
    response: '{ ok: true, value: HarnessTask }',
    exampleBody: {
      title: 'Review the release notes',
      description: 'Check the final wording',
      priority: 'medium'
    }
  },
  {
    method: 'POST',
    path: '/tasks/reorder',
    description: 'Reorder all unreserved pending tasks.',
    request: 'JSON body: { taskIds: string[] } (orderedTaskIds is also accepted).',
    response: '{ ok: true, value: HarnessTask[] }',
    exampleBody: { taskIds: ['task-id-1', 'task-id-2'] }
  },
  {
    method: 'PATCH',
    path: '/tasks/:taskId/priority',
    description: 'Change a task priority.',
    request: 'JSON body: { priority: "low" | "medium" | "high" | "critical" }.',
    response: '{ ok: true, value: HarnessTask }',
    exampleBody: { priority: 'high' }
  },
  {
    method: 'PATCH',
    path: '/tasks/:taskId/model',
    description:
      "Change the model and effort for a queued task's run, as the app's queue card does. Only while the task waits in the queue: once a run has taken it, the run's model is fixed and this is refused (HTTP 400).",
    request: `JSON body: { model?, effort? }. ${RUN_CHOICE_RULE} Send both as "" to go back to the default.`,
    response: '{ ok: true, value: HarnessTask }',
    exampleBody: { model: 'claude-haiku-5-5', effort: '' }
  },
  {
    method: 'POST',
    path: '/tasks/:taskId/start-embedded',
    description: 'Start a pending task immediately as an Ostler-managed embedded session.',
    request: 'No body.',
    response: '{ ok: true, value: HarnessSession }'
  },
  {
    method: 'POST',
    path: '/tasks/:taskId/hold',
    description:
      'Hold or resume a queued task (the desktop Hold/Resume). A held task is never dispatched; resuming it returns it to the queue. Ostler holds a task whose agent gave up, so this is how automation puts it back to work.',
    request: 'JSON body: { hold: boolean }.',
    response: '{ ok: true, value: HarnessTask }',
    exampleBody: { hold: false }
  },
  {
    method: 'POST',
    path: '/tasks/:taskId/cancel',
    description:
      'Cancel a queued task nobody is working on (the desktop Cancel). A linked work item has its handoff cleared so it can be queued again. DELETE /tasks/:taskId does the same; tasks are never hard-deleted.',
    request: 'No body.',
    response: '{ ok: true, value: { task: HarnessTask, workItem: PlanningWorkItem | null } }'
  },
  {
    method: 'DELETE',
    path: '/tasks/:taskId',
    description: 'Alias for POST /tasks/:taskId/cancel.',
    response: '{ ok: true, value: { task: HarnessTask, workItem: PlanningWorkItem | null } }'
  },
  {
    method: 'POST',
    path: '/sessions/:sessionId/apply',
    description:
      'Apply a finished task\'s work to the project folder (the desktop Apply): the task is brought up to date with the folder first, the person\'s own edits are saved as a "Your edits" entry, a restore point is kept, and the work is added as one history entry per task. outcome "sent_back" means the task clashed with newer changes in the folder and went back to its agent to bring its work up to date; nothing in the folder changed. When the folder is on a different version from the task\'s, the work is not applied unless the body says { onCurrentVersion: true }.',
    request: 'Optional JSON body: { onCurrentVersion?: boolean }.',
    response:
      '{ ok: true, value: { session: HarnessSession, outcome: "applied" | "nothing_changed" | "sent_back", entries: number } }'
  },
  {
    method: 'POST',
    path: '/sessions/:sessionId/review',
    description:
      'Ask a reviewer: starts a review of a session in review, as Ask a reviewer in Review changes does. The review is a task queued ahead of other work for an embedded or external agent; it reads the change in a detached copy of its own, changes nothing, and reports findings, which show on the session in GET /sessions (reviewerReports, review). It is a run like any other and counts towards usage limits. No body. Refused for a review run, work not in review, or work already being reviewed; Apply, Discard, Send back or Stop of the session stops its review.',
    response: '{ ok: true, value: HarnessTask }'
  },
  {
    method: 'POST',
    path: '/sessions/:sessionId/send-back',
    description:
      'Send a finished task back with a reason recorded on the task. disposition: "retry" returns it to its agent in the same copy, "rework" cancels the queue entry and keeps the work aside, "hold" keeps it queued but held. Defaults to "retry". comments are line comments on the change, as Review changes in the app makes them: each { file, side?: "new" | "old" (default new; old is for removed lines, numbered in the old version), firstLine, lastLine?, comment (up to 2,000 characters) }, at most 50. Ostler takes an excerpt of the diff for each (the lines with three around them, at most 40 lines) and refuses a comment on lines the change does not show. The details of the task get "[Sent back N] reason (K line comments)", and the next agent gets the comments: an embedded run in its opening prompt, an external agent as reviewComments in its claim and GET /session/:sessionId. With comments, reason may be empty ("See the line comments" is recorded). Without comments, the draft comments of the session (reviewDrafts on GET /sessions) are sent.',
    request: `JSON body: { reason?: string, comments?: { file, side?, firstLine, lastLine?, comment }[], disposition?: "retry" | "rework" | "hold", model?, effort? }; reason is required unless there are comments. model and effort are the app's "Run again with…": with "retry" only, they set the next run's model. ${RUN_CHOICE_RULE}`,
    response: '{ ok: true, value: HarnessSession }',
    exampleBody: { reason: 'Tests for the parser are missing.', disposition: 'retry' }
  },
  {
    method: 'POST',
    path: '/sessions/:sessionId/discard',
    description:
      "Discard a finished task's work: its copy is deleted, the work is kept aside for the retention period (the app's History can bring it back), the task returns to the queue, and any linked work item returns to ready.",
    request: 'No body.',
    response: '{ ok: true, value: HarnessSession }'
  },
  {
    method: 'POST',
    path: '/sessions/:sessionId/stop',
    description:
      'Stop a running agent (the desktop Stop): its work is kept aside the way Discard keeps it, and its task goes back to the queue. A run waiting on its plan is cancelled at the plan (plan.status "cancelled"), as Cancel run in the app does.',
    request: 'Optional JSON body: { note?: string }.',
    response: '{ ok: true, value: { sessionId, stopped: true } }',
    exampleBody: { note: 'Stopped by automation: superseded.' }
  },
  {
    method: 'GET',
    path: '/sessions/:sessionId/plan',
    description:
      'Plan first: the plan a run sent before changing anything, as it stands, and every version kept for it. plan is { version, steps, files, risks, status: pending | approved | changes-requested | cancelled, submittedAt, decidedAt, changesNote, changedBeforeApproval?: { files } } or null when the run has sent none; history is every version with its decision, oldest first. The text is the agent’s own: treat it as plain text. A run whose plan is pending waits, with no time limit, until it is approved, sent back or the run is stopped (POST /sessions/:sessionId/stop cancels it at the plan).',
    response:
      '{ ok: true, value: { sessionId, title, plan: HarnessPlan | null, history: TaskPlanRecord[] } }'
  },
  {
    method: 'POST',
    path: '/sessions/:sessionId/plan/approve',
    description:
      "Approve a run's pending plan, as Approve in the app's Plan dialog does: the agent carries on with the task, and anything its copy changed before approval is recorded on the plan (changedBeforeApproval). Safe to call twice: when the plan is already decided, from here or the app, it changes nothing and returns the plan as decided, with alreadyDecided: true.",
    request: 'No body.',
    response: '{ ok: true, value: { plan: HarnessPlan, alreadyDecided: boolean } }'
  },
  {
    method: 'POST',
    path: '/sessions/:sessionId/plan/changes',
    description: `Ask for changes to a run's pending plan, with a note the agent reads, as Ask for changes in the app does: the agent revises and sends the next version, still without changing anything. The note is required, at most ${MAX_PLAN_CHANGES_NOTE_LENGTH} characters. Already decided, it changes nothing and returns the plan as decided, with alreadyDecided: true.`,
    request: 'JSON body: { note: string }.',
    response: '{ ok: true, value: { plan: HarnessPlan, alreadyDecided: boolean } }',
    exampleBody: { note: 'Leave the public API alone; change only the parser.' }
  },
  {
    method: 'GET',
    path: '/agent-runs',
    description:
      "The run history: every agent run, built-in (provenance embedded) or connected (external), newest first, with totals and a breakdown by model, as the Agents view's History shows it. A run is { sessionId, taskId, title, provenance, model, effort, startedAt, endedAt, durationMs (epoch ms), outcome: in_review | accepted | discarded | rejected | abandoned | unreported | stopped | failed (the review's verdict once there is one), endedAs (how the run itself ended), detail, stalls, nudges, guidance, commits, filesChanged, inputTokens, outputTokens, usageReported }. usageReported true means the tokens are what a connected agent reported in its completion, not measured by Ostler. totals and byModel carry runs, finished, accepted, successRate (accepted out of finished), medianDurationMs, inputTokens, outputTokens and cost (null unless the person entered prices in Settings › Agents › Usage; never guessed). Filters: ?outcome=, ?model=, ?from=YYYY-MM-DD&to=YYYY-MM-DD (the local day a run started, inclusive). ?format=csv returns the CSV the app's Export CSV writes (Content-Type text/csv).",
    response: '{ ok: true, value: AgentRunHistory } (format=csv: text/csv)'
  },
  {
    method: 'GET',
    path: '/agent-usage',
    description:
      "The built-in agent's token limits and how much of each is used: limits { tokensPerDay, tokensPerMonth } (null is no limit), and day and month { limit, used, resetsAt (epoch ms: local midnight, or the first of next month), reached }. A run counts in the day and month it started. At a limit no new built-in run starts and a running one stops at its next turn boundary, its work kept for review. Read only: limits are a safety control set in the app, in Project settings › Agents, and no route changes them.",
    response:
      '{ ok: true, value: { projectId, limits: AgentUsageLimits, day: AgentLimitUsage, month: AgentLimitUsage } }'
  },
  {
    method: 'GET',
    path: '/sessions',
    description:
      'List active and review-pending harness sessions. Completion reports live on the task (GET /tasks: task.report, with report.missing set when the embedded agent never filed one); each session here also carries report, the report of the last task it completed (null while it has none). A report may hold pictures, [{ name, path, caption?, size }]: screenshots the agent took, copied out of its copy when the report arrived (read one with GET /sessions/:sessionId/pictures/:name); picturesLeftOut, [{ path, reason: outside-copy | not-found | not-image | too-large | too-many }]; and walkthrough, [{ path, startLine, endLine, note }]: where to start reading the change, stop by stop, with lines in the new version of each file. Line comments: reviewDrafts, on a session in review, are the comments the person has written in Review changes and not yet sent, each { id, file, side, firstLine, lastLine, comment }; lastReviewComments are the comments its task was last sent back with, each with the excerpt of the diff they were about. Answers: report.commentAnswers, [{ id, status: done | not-done, note, path?, startLine?, endLine? }], are the answers the agent gave to lastReviewComments, by id (its claim, which Ostler does not check; path and lines say where the change now is in the new version); report.commentAnswersIgnored lists ids it answered that were not in the last review. commentAnswerAlerts are what the app shows next to Apply, such as "3 of 4 comments answered" when a comment has no answer; they are empty until a report comes after the last Send back, and a report with an outcome other than reported answers nothing. Reviewer runs: reviewerReports, newest last, are what reviewers said about the change, the reviewers’ words and never sent to the agent: each { reviewerSessionId, reviewTaskId, provenance, model?, startedAt, endedAt, outcome: reported | not-reported | stopped, summary, findings, findingsLeftOut? }, each finding { id, file, side, firstLine, lastLine, comment, severity: must-fix | should-fix | nit, excerpt, general? } (general: on lines the change does not show); dismissedFindingIds are the findings the person dismissed; review is where the latest review stands, { status: running | overdue | reported | failed, requestedAt } (overdue: not finished after 30 minutes), absent when it was never reviewed. openFindings are the latest review\'s findings not dismissed; Apply in the app asks first while any of them is must-fix.',
    response:
      '{ ok: true, value: { active: (HarnessSession & { report: HarnessTaskReport | null, lastReviewComments: HarnessSentReviewComment[], commentAnswerAlerts: string[] })[], review: (HarnessSession & { report: HarnessTaskReport | null, lastReviewComments: HarnessSentReviewComment[], commentAnswerAlerts: string[] })[] } }'
  },
  {
    method: 'GET',
    path: '/sessions/:sessionId/pictures/:name',
    description:
      "One picture from a session's report, by the name in report.pictures: the image itself (PNG, JPEG, GIF or WebP), read only. 404 for any other name. A session's pictures are deleted with its record, and a project's with the project.",
    response: 'The image bytes, with Content-Type image/png, image/jpeg, image/gif or image/webp'
  },
  {
    method: 'GET',
    path: '/sessions/:sessionId/transcript',
    description:
      'Return the session transcript, live from a running embedded agent when available and the stored copy otherwise. This is what to read when a task report comes back with missing: true.',
    response: '{ ok: true, value: SessionTranscriptEntry[] }'
  },
  {
    method: 'GET',
    path: '/questions',
    description:
      'List questions asked by embedded agents through ostler_ask_question. Pass ?status=pending to see only the ones blocking an agent right now.',
    response: '{ ok: true, value: HarnessQuestion[] }'
  },
  {
    method: 'POST',
    path: '/questions/:questionId/answer',
    description:
      'Answer a pending agent question. The blocked embedded agent receives the answer and resumes immediately.',
    request: 'JSON body: { answer: string }.',
    response: '{ ok: true, value: HarnessQuestion }',
    exampleBody: { answer: 'Use the existing migration; do not add a new one.' }
  },
  {
    method: 'POST',
    path: '/sessions/:sessionId/guidance',
    description:
      "Send guidance to a running agent run on the person's behalf, labelled with their name from Settings › People, exactly as Send guidance in the app does. A built-in (embedded) run gets it in its session at once, without its current turn being aborted; an external agent gets it on its next GET /session/:sessionId and as a guidance.sent event. It never counts against the run's continuation nudges. Refused with 409 when the run is not running, 413 over 4000 characters, 429 over 5 messages to one run in 10 minutes.",
    request: 'JSON body: { text: string } (Markdown).',
    response:
      '{ ok: true, value: HarnessGuidance }: { id, sessionId, text, from, via: "automation", sentAt, deliveredAt (null until the agent has it) }',
    exampleBody: {
      text: 'The tests for the old parser can stay as they are; only cover the new one.'
    }
  },
  {
    method: 'GET',
    path: '/sessions/:sessionId/guidance',
    description:
      'The guidance sent to a run, oldest first, with deliveredAt showing whether its agent has received each message.',
    response: '{ ok: true, value: HarnessGuidance[] }'
  },
  {
    method: 'GET',
    path: '/events',
    description:
      "Wait for agent activity in this project instead of polling. ?since=<cursor> returns the events after that cursor at once; when there are none, ?wait=<seconds> (0 to 60, default 0) waits up to that long for one and then returns an empty list. Leave since out on the first call to start from now, and pass each response's cursor as the next since. Event types: run.started, run.updated, run.review, run.ended, question.asked, question.answered, plan.submitted, plan.decided, task.queued, task.claimed, task.released, blocker.reported, blocker.resolved, guidance.sent, guidance.delivered. Events are kept in memory only, a few hundred per project: { resync: true } means your cursor is older than that (or from before Ostler restarted), so read state afresh (GET /sessions, /questions, /tasks) and continue from the returned cursor. At most 4 requests may wait at once per token (429 beyond that); a waiting request ends early, with what there is, when Ostler stops.",
    request: 'Query: since (cursor, optional), wait (seconds, optional).',
    response:
      '{ ok: true, value: { events: Array<{ cursor, type, at, projectId, sessionId?, taskId?, questionId?, guidanceId?, blockerId?, workItemId?, text? }>, cursor, resync?: true } }'
  },
  ...GOALS_ROUTES,
  ...MILESTONES_ROUTES,
  ...SETUP_ROUTES,
  {
    method: 'GET',
    path: '/task-templates',
    description:
      'List the task templates this project can use: its own and those for every project, by name. A task template is one task, with its subtasks one level deep, saved to make again. Its body holds title, description, checklist (list of text), checklistDetails (items’ due dates and people: [{ text, dueDate, assigneeId }], the date relative like dueDate), labels, priority, estimate, assigneeId (a person id), fieldValues (custom field values by field id), startDate and dueDate (days after the day it is used: "+3d", "+2w", or null) and subtasks ([{ title, description, checklist }]). projectId is null for a template every project can use. Comments, activity, attachments, dependencies and agent links never travel. A playbook (playbook: true) is a template for agents: its body may also hold agent: { model (a model Settings offers for the provider in effect, or "" for the default), effort ("" for the default, or an effort level the model takes), planFirst ("default" | "yes" | "no"), instructions (Markdown, up to 4,000 characters, added to the queued task’s details under "Playbook instructions") }. Run one with POST /task-templates/:templateId/run.',
    response:
      '{ ok: true, value: Array<{ id, projectId: string | null, name, body, playbook: boolean, createdAt, updatedAt }> }'
  },
  {
    method: 'POST',
    path: '/task-templates',
    description:
      'Save a task template, from a body or from one of this project’s tasks (its subtasks come too). scope is "project" (this one, the default) or "every". A template of the same name in the same scope is refused unless replace is true, which replaces it and keeps its id. From a task, name defaults to its title, and keepDates (default false) keeps its start and due dates as days after today; a date already past counts as today. playbook: true saves a playbook; from a task, giving agent saves it as a playbook with that agent part (like "Save as playbook…"). A model the provider does not offer, or an effort the model does not take, is refused.',
    request:
      'JSON body: { name: string (up to 80 characters), scope?: "project" | "every", body: TaskTemplateBody (with an optional agent part), playbook?: boolean, replace?: boolean } or { fromWorkItemId: string, name?: string, scope?: "project" | "every", keepDates?: boolean, replace?: boolean, agent?: { model?, effort?, planFirst?, instructions? } }',
    response: '{ ok: true, value: TaskTemplate }',
    exampleBody: {
      name: 'Weekly invoice run',
      scope: 'project',
      body: {
        title: 'Send this week’s invoices',
        checklist: ['Export hours', 'Check totals', 'Send'],
        labels: ['admin'],
        dueDate: '+2d',
        subtasks: [{ title: 'Chase last week’s unpaid invoices' }]
      }
    }
  },
  {
    method: 'PATCH',
    path: '/task-templates/:templateId',
    description:
      'Rename a task template, change its scope ("project" moves it to this project, "every" makes it every project’s), replace its body (its agent part included), or make it a playbook or stop it being one (playbook; the agent part stays in the body). A name already used in that scope is refused.',
    request: 'JSON body with any of { name, scope: "project" | "every", body, playbook: boolean }.',
    response: '{ ok: true, value: TaskTemplate }',
    exampleBody: { name: 'Invoice run', scope: 'every' }
  },
  {
    method: 'DELETE',
    path: '/task-templates/:templateId',
    description: 'Delete a task template. Tasks made from it stay as they are.',
    response: '{ ok: true, value: { template: TaskTemplate } }'
  },
  {
    method: 'POST',
    path: '/task-templates/:templateId/use',
    description:
      'Make a task, and its subtasks, from a template, in one transaction, as New task does in the app: dates are counted from today, and the project’s rules, reminders and activity see a normal create. overrides win over the template, for any of title, description, status, priority, labels, acceptanceCriteria, milestoneId, iterationId, typeId, assigneeId, startDate, targetDate (YYYY-MM-DD), estimate, dependencyIds, fieldValues and autoQueue. An assignee who is gone, and custom fields this project does not have (or values they no longer take), are left out and counted in dropped; that never refuses the create.',
    request: 'JSON body: { overrides?: { title?, targetDate?, labels?, … } }',
    response:
      '{ ok: true, value: { workItem: PlanningWorkItem, subtasks: PlanningWorkItem[], dropped: { assignee: boolean, fieldCount: number } } }',
    exampleBody: { overrides: { targetDate: '2026-11-02' } }
  },
  {
    method: 'POST',
    path: '/task-templates/:templateId/run',
    mcp: { excluded: 'Running a playbook queues its task for agents.' },
    description:
      'Run playbook, as the app’s Run playbook does: makes the task from a playbook with the same function as /use (status Ready, dates from today), then queues it for agents on the normal queue path, in one step. The run uses the playbook’s model and effort (built-in agent only), its plan-first choice is set on the task, and its instructions are added to the queued task’s details under "Playbook instructions". The task’s activity says it came from the playbook, and the queued task carries playbook: { templateId, name }. overrides may change title, model, effort, planFirst and instructions for this run; an overridden model or effort is checked as Settings checks it. A model of the playbook’s own that the provider no longer offers is not refused: the run uses the project’s default and modelNotOffered names it. Refused when agents are off, the project has no linked folder, or the template is not a playbook; nothing is made then.',
    request:
      'JSON body: { overrides?: { title?: string, model?: string, effort?: string, planFirst?: "default" | "yes" | "no", instructions?: string } }',
    response:
      '{ ok: true, value: { workItem: PlanningWorkItem, subtasks: PlanningWorkItem[], dropped: { assignee: boolean, fieldCount: number }, task: HarnessTask, modelNotOffered?: string } }',
    exampleBody: { overrides: { title: 'Update the dependencies for November' } }
  },
  {
    method: 'GET',
    path: '/work-items',
    description:
      'List work items on the Board, in manual order (the order the Board shows under Manual order; move one with POST /work-items/:workItemId/move). ?scope=archived lists the project archive; ?scope=deleted lists the recycle bin (each item has deletedAt; it is purged 30 days after). ?filter=<JSON TaskFilter> keeps only the tasks that match, by the same rule as every view in the app: { match: "all" | "any", conditions: [{ field, op, value }] }. Fields and operators: text contains|notContains "words"; status, priority is|isNot [values]; assignee is|isNot [person ids, "me", "nobody"]; labels hasAny|hasAll|hasNone [labels]; milestone, goal is|isNot [ids, "none"]; subproject is|isNot [workstream ids, "none"] (a workstream is a sub-project; see GET /subprojects); iteration is|isNot [iteration ids, "none", "current"] ("current" is the active iteration, or with none active the unfinished one whose dates include today, its end day too); due, start is "today"|"overdue"|"thisWeek"|"next7Days"|"none"|"any", or before|after "YYYY-MM-DD"; created, updated is "today"|"thisWeek"|"last7Days", or before|after a date; estimate, impact, effort is "set"|"empty", or equals|lessThan|greaterThan a number; checklist is "complete"|"incomplete"; hasComments, recurring, someday, inTriage is true|false (inTriage: waiting in To triage; ?scope=triage lists only those, oldest first); showFrom is "hidden"|"shown"|"today"|"none"|"any", or before|after "YYYY-MM-DD" ("hidden" is a task in Someday or shown from a later day, by the same rule that keeps it off Home, My work, the Board and the List; "shown" is every other task). Custom fields: { field: "custom", fieldId, op, value }: text contains|notContains "words"; number equals|lessThan|greaterThan a number, or between [low, high]; date before|after "YYYY-MM-DD"; choice is|isNot [option ids]; choices hasAny|hasAll|hasNone [option ids]; checkbox is true|false; any field isEmpty "empty"|"set". An invalid filter is refused with HTTP 400 and a message saying what is wrong. URL-encode the JSON. ?include=linkedFrom adds linkedFrom to each: the texts of this project that link to it, as in GET /links.',
    request:
      '?filter=%7B%22conditions%22%3A%5B%7B%22field%22%3A%22due%22%2C%22op%22%3A%22is%22%2C%22value%22%3A%22overdue%22%7D%5D%7D (the URL-encoded form of {"conditions":[{"field":"due","op":"is","value":"overdue"}]})',
    response:
      '{ ok: true, value: PlanningWorkItem[] }; with ?include=linkedFrom, each also has linkedFrom: LinkedFromEntry[]'
  },
  {
    method: 'GET',
    path: '/search',
    description:
      "Search this project's tasks, comments, decisions, milestones, goals and Library items by their words. Each word matches as a prefix; every word must appear. Results are best first, a title match above a match in the text, with a snippet whose matching words are marked. Library items are found by the words inside their files too (PDF, text, Word .docx, PowerPoint .pptx and Excel .xlsx); for a PDF, slide deck or workbook, location says where the passage is: { kind: page, label: 7 }, { kind: slide, label: 3 } or { kind: sheet, label: Budget } (label is a string). Archived and recycle-bin items are left out unless ?includeArchived=true. ?types=task,comment,decision,milestone,goal,library narrows the kinds; ?limit= (1-200, default 50).",
    request: '?q=colour+scheme',
    response:
      '{ ok: true, value: Array<{ type, id, projectId, title, snippet: Array<{ text, match }>, workItemId, location?, score }> } (workItemId: the task a task or comment belongs to; location: the page, slide or sheet of a Library file)'
  },
  {
    method: 'GET',
    path: '/views',
    description:
      "List the project's saved views: Board, List, Calendar and Timeline views with their filter, search text and options. The one view per type with isDefault: true is what that view opens with in the app. ?viewType=board|list|calendar|timeline narrows it.",
    response: '{ ok: true, value: SavedView[] }'
  },
  {
    method: 'GET',
    path: '/views/:viewId',
    description: 'Read one saved view.',
    response: '{ ok: true, value: SavedView }'
  },
  {
    method: 'POST',
    path: '/views',
    description:
      "Save a view. config.filter is a TaskFilter, the same shape GET /work-items?filter= takes; config.query is the search box text; config.options holds the view's own settings as the app stores them (sort, grouping, columns, zoom, mode).",
    request:
      'JSON body: { name: string (up to 80 characters), viewType: "board" | "list" | "calendar" | "timeline", config: { filter?, query?, options? } }',
    response: '{ ok: true, value: SavedView }',
    exampleBody: {
      name: 'Overdue',
      viewType: 'list',
      config: {
        filter: { match: 'all', conditions: [{ field: 'due', op: 'is', value: 'overdue' }] },
        query: '',
        options: {}
      }
    }
  },
  {
    method: 'PATCH',
    path: '/views/:viewId',
    description:
      'Rename a saved view, change its configuration, or move it (position). The default view keeps its name; change its config to change what the view opens with.',
    request: 'JSON body with any of { name, config, position }.',
    response: '{ ok: true, value: SavedView }',
    exampleBody: { name: 'Overdue, mine' }
  },
  {
    method: 'POST',
    path: '/views/:viewId/set-default',
    description:
      'Make this saved view\'s configuration what its view type opens with in this project (the app\'s "Set as default for this project"). The saved view itself is unchanged.',
    response: '{ ok: true, value: SavedView } (the default view)'
  },
  {
    method: 'DELETE',
    path: '/views/:viewId',
    description:
      'Delete a saved view. The tasks it showed are not changed. The default view cannot be deleted.',
    response: '{ ok: true, value: SavedView } (what was deleted)'
  },
  ...PINS_ROUTES,
  ...MONEY_ROUTES,
  {
    method: 'POST',
    path: '/work-items',
    description: 'Create a work item without queueing or touching the harness.',
    request:
      'JSON body: { title: string, description?, status?, columnId?, priority?, milestoneId?, subprojectId?, iterationId?, typeId?, labels?, acceptanceCriteria?, dependencyIds?, dependencyLinks?, targetDate?, startDate?, showFrom?, someday?, impact?, effort?, assigneeId?, estimate?, autoQueue?, planFirst?, parentWorkItemId?, subtaskPhaseNumber?, subtaskPhaseName?, fieldValues?, triage? }. triage: true makes it a quick capture: when the project has Triage new captures on (GET /triage) it waits in To triage (inTriage: true, capturedBy: "api") and counts nowhere until it is accepted (POST /work-items/:workItemId/accept); with the setting off it is an ordinary task. planFirst is "default" (follow the project\'s agentsPlanFirst, GET /auto-dispatch), "yes" or "no": whether an agent on this task sends a plan and waits for approval before it changes anything; it is read when the task is queued. showFrom (YYYY-MM-DD, or null) hides the task until that day, and someday: true parks it in Someday: either way it stays off Today, Upcoming, My work, the Board and the List, is never auto-queued, and queueing it for an agent is refused until it is brought back (PATCH someday: false, or showFrom: null). Reminders still fire. impact and effort score an idea: each a whole number from 1 to 5, or null for none; anything else (0, 6, 2.5, text) is refused. The app’s Someday view sorts and grids ideas by them (impact high to low, then effort low to high), and impact 4 or 5 with effort 1 or 2 is a quick win. fieldValues sets custom fields by field id (see GET /fields); a value the field does not take is refused. targetDate is the due date and startDate the start date, both YYYY-MM-DD; a start date after the due date is refused. assigneeId is a person id from GET /people, or null. estimate is a number from 0 to 1000 in the project\'s unit (points or hours). dependencyIds are tasks in this project that must be done first. subprojectId puts the task in one of this project\'s workstreams (see GET /subprojects), or null for none (the top level of the project); a workstream of another project is refused. iterationId puts the task in one of this project\'s iterations (see GET /iterations), or null for none; a task is in at most one. typeId gives it one of this project\'s task types (see GET /task-types), or null for none. parentWorkItemId makes the task a subtask of that task (up to three levels); subtaskPhaseNumber (default 1) and subtaskPhaseName place it in a phase of its parent. The returned item\'s checkedCriteria lists the ticked acceptance criteria; tick them with POST /work-items/:workItemId/checklist. columnId puts the task in one of the project\'s own columns (the id from GET /columns custom): its status becomes the one that column counts as. On PATCH, columnId null puts it back in its status\'s own column, and a new status without columnId moves it there too. dependencyLinks is Array<{ id, type?, lagDays? }>: each waits-on link with its type, "finish-to-start" (the default: starts on or after the other is due), "start-to-start" (starts on or after the other starts) or "finish-to-finish" (is due on or after the other is due), and lagDays, a whole number of calendar days from -365 to 365 (0 by default; negative is a lead). Given, it replaces every link; dependencyIds alone still works and means finish-to-start, 0 days for a new link (a link kept keeps its type and lag). Only finish-to-start links hold a task back from Ready and the agent queue; the others are about dates only. The returned PlanningWorkItem has dependencyIds and dependencyLinks, in the same order.',
    response: '{ ok: true, value: PlanningWorkItem }',
    exampleBody: {
      title: 'Document the sea-trial checklist',
      description: 'Capture the repeatable pre-launch checks.',
      milestoneId: '<milestone-id>',
      status: 'backlog',
      priority: 'medium',
      labels: ['documentation'],
      acceptanceCriteria: ['Checklist is reviewed by the crew'],
      assigneeId: '<person-id>',
      startDate: '2026-09-01',
      targetDate: '2026-09-10',
      estimate: 3,
      dependencyLinks: [{ id: '<task-id>', type: 'start-to-start', lagDays: 2 }]
    }
  },
  {
    method: 'POST',
    path: '/work-items/batch',
    description:
      "Create a whole plan in one step: its tasks, subtasks, dependencies and milestones, the way the plan grid does. Each task gets the same rules as POST /work-items, and the batch is one transaction: a refused task creates nothing, and the answer (400) names the task and the reason. A task names the other tasks of the plan by ref (letters, digits, - or _): parentRef makes it a subtask of that task, dependencyRefs lists the tasks it waits on, and milestoneRef names a milestone of the plan. A subtask without a milestone of its own takes its parent's. A task can also name existing tasks (dependencyIds, parentWorkItemId) and milestones (milestoneId). Up to 500 tasks. ?dryRun=1 checks the plan and writes nothing: { ok: true, value: { valid, errors: [{ index, field, message }] } }; index is the task's position in items.",
    request:
      'JSON body: { items: Array<{ ref?, parentRef?, dependencyRefs?, milestoneRef?, title, ...any field POST /work-items accepts }> }. Items are created in the order they wait on each other, whatever order they are sent in.',
    response: '{ ok: true, value: PlanningWorkItem[] } in the order sent',
    exampleBody: {
      items: [
        {
          ref: 'design',
          title: 'Design the checklist',
          milestoneId: '<milestone-id>',
          targetDate: '2026-09-20'
        },
        {
          ref: 'build',
          title: 'Build the checklist',
          dependencyRefs: ['design'],
          estimate: 5,
          assigneeId: '<person-id>'
        },
        { ref: 'tests', title: 'Write the tests', parentRef: 'build' }
      ]
    }
  },
  {
    method: 'GET',
    path: '/work-items/by-key/:key',
    description:
      "Return one work item by its ID, such as SHOP-12: this project's prefix (GET /task-prefix) and the task's number, in capitals or small letters. Finds it in the archive and the recycle bin too. An ID of another project, or a number no task has, is HTTP 404. Every work item carries number (never reused in its project, even after a task is deleted) and key (the ID); the id stays the key every other route takes.",
    response: '{ ok: true, value: PlanningWorkItem }'
  },
  {
    method: 'PATCH',
    path: '/work-items/:workItemId',
    description:
      'Update work-item title, description, status, priority, milestone, labels, acceptance criteria, dependencies, due date (targetDate), start date, show-from date (showFrom), Someday (someday: true moves the task to Someday, false brings it back), impact and effort (1 to 5, or null to clear), assignee, estimate, autoQueue, planFirst ("default", "yes" or "no"; read when the task is next queued), or custom field values (fieldValues: only the fields you send change; null clears one). Changing acceptanceCriteria drops the ticks of items whose text is no longer on the list. A queued item follows the app’s queue rule: while no agent has claimed its task, status blocked holds the task and ready releases it, and any other status, someday: true or a showFrom later than today cancels the task and clears the link (the returned item has leftQueue: true; queue it again with POST /tasks to undo); while an agent runs it or its work waits for review, the change is refused. The project’s rules (GET /rules) run on this change as on one made in the app; when they did something, the returned item has ruleRun { id, ruleNames }, and a later PATCH that puts the old values back can send undoRuleRun: <that id> to undo what the rules did too (the undo itself sets off no rules). Note: parentWorkItemId, taskCode, phaseCode, phaseName, and the verification fields are not writable here — they are read-only on the returned PlanningWorkItem, set only by the guided Agent Plan & Split workflow (task/phase identity) or the in-app AI review accept flow (verification).',
    request:
      'JSON body with any fields accepted by POST /work-items, plus optional moveDependents: true | "preview". When the due date moves later by N days, moveDependents: true also moves every task that waits on this one and is now too early for its link (as GET /dependency-conflicts judges it, with the link’s type and lag; a start-to-start link is pushed by how far this task’s first day moved) later by N days, keeping its start-to-due gap and landing on one of Me’s working days (GET /people; Monday to Friday when unknown; Me’s days off and everyone’s, GET /days-off, are not working days), then the tasks waiting on those, each once, all in the same transaction. Done tasks and tasks without a due date never move. Moving a task earlier moves nothing else. moveDependents: "preview" changes nothing and returns the plan for the change as sent.',
    response:
      '{ ok: true, value: PlanningWorkItem }. With moveDependents: true, { ok: true, value: { workItem: PlanningWorkItem, dependents: { changed: Array<{ id, fromDue, toDue, fromStart, toStart }>, skipped: Array<{ id, title, reason: "changed" | "missing" }>, left: Array<{ id, title, reason: "done" | "undated" }> } } }; skipped lists tasks that changed while the plan was made, never overwritten. To undo, PATCH each changed task back to its fromDue and fromStart. With moveDependents: "preview", { ok: true, value: { entries: Array<{ id, title, dependencyId, days, fromDue, toDue, fromStart, toStart }>, skipped: Array<{ id, title, reason: "done" | "undated" }> } }.',
    exampleBody: { targetDate: '2026-10-20', moveDependents: 'preview' }
  },
  {
    method: 'DELETE',
    path: '/work-items/:workItemId',
    description:
      'Move a work item to the recycle bin (restorable for 30 days, then purged). Refused while linked agent work is queued, running, or awaiting review (cancel, stop, apply, send back or discard it first). Add ?permanent=true to delete an item that is already in the bin for good. Same rules as the desktop app.',
    response: '{ ok: true, value: { id, deleted: true } }'
  },
  {
    method: 'POST',
    path: '/work-items/:workItemId/move',
    description:
      "Move a work item in the project's manual order, the order the Board and List show under Manual order and a task's subtasks are listed in: before or after another work item of the project, or to the start or end of a status. Only this item's place changes, and its updatedAt stays. With status, it also moves to that status, exactly as PATCH status would. GET /work-items lists items in this order. This is not the agent queue's order, which is separate. With { projectId } instead, a task in To triage moves to that project, as the app's Move to project… does: it is made again there, waiting in that project's To triage when it has Triage new captures on (GET /triage) and as an ordinary Backlog task (inTriage: false) when it is off (title, description, checklist, priority, due date, assignee; labels by name where that project has them; its Library attachments copied into that project's Library) and the original goes to the recycle bin, in one step; if a Library copy fails, nothing moves. Refused for a task not in To triage.",
    request:
      'JSON body: exactly one of { beforeId: string }, { afterId: string } or { position: "start" | "end" }, plus optional status (backlog, ready, active, blocked, review, done) and, with status, columnId: one of the project\'s own columns counting as that status (GET /columns), or null or left out for the status\'s own column. position without status means the start or end of its current status. Or { projectId: string } for a task in To triage.',
    response:
      '{ ok: true, value: PlanningWorkItem }; with projectId, { ok: true, value: { workItem: PlanningWorkItem (the new task), movedFromId, copiedItemIds } }',
    exampleBody: { beforeId: '<work-item-id>', status: 'ready' }
  },
  ...PROJECT_TOOLS_ROUTES,
  ...MY_DAY_ROUTES,
  {
    method: 'POST',
    path: '/work-items/:workItemId/checklist',
    description:
      "Change one item of a work item's checklist (its acceptance criteria), named by its exact text, in one transaction: renameTo renames it and carries its tick, due date and person to the new text; dueDate (YYYY-MM-DD, or null to clear) and assigneeId (a person id from GET /people, or null) set its date and person; checked ticks or unticks it. Send at least one. Fields left out keep their values. The task's status never changes with a tick. A dated item shows on its person's Home (Today, Upcoming) and My work, whoever the task is assigned to; an item with a date and nobody counts on Me's Today, as a task does. The work item's checklistDetails lists the items with a date or person: [{ text, dueDate, assigneeId }]. Items are keyed by their text: two alike are one item, and renaming to another item's text is refused. A PATCH /work-items that replaces acceptanceCriteria drops the tick, date and person of every item whose text is gone; rename with renameTo to keep them. Agents still receive every item as a plain acceptance criterion, without dates or people.",
    request:
      'JSON body: { text: string, checked?: boolean, dueDate?: string | null, assigneeId?: string | null, renameTo?: string }.',
    response: '{ ok: true, value: PlanningWorkItem }',
    exampleBody: {
      text: 'Checklist is reviewed by the crew',
      dueDate: '2026-10-23',
      checked: false
    }
  },
  ...GITHUB_ROUTES,
  ...TIME_ROUTES,
  {
    method: 'GET',
    path: '/work-items/:workItemId/recurrence',
    description:
      'A task’s repeat rule, or null. The rule lives on the latest occurrence: when a repeating task is moved to done (by any route), its next occurrence is created once, due on the first rule date after the old due date that is today or later, and the rule moves to it. The next occurrence copies the title, description, priority, labels, assignee, estimate, checklist (unticked) and milestone (unless complete), not dependencies, agent links, subtasks, comments or attachments. The PATCH that made it done returns repeatedAs (the new task’s id) or repeatError. A repeat that takes turns has rotation (person ids, in order) and nextIndex (whose turn is next): each new occurrence, whether the last was done or closed as won’t do, goes to the next person in rotation who is not archived instead of copying the assignee, and nextIndex moves on; if everyone in it is archived, the assignee is copied and the activity says why. Changing a task’s assignee by hand does not change whose turn is next. goToAgents (off by default) makes each occurrence go to agents when it comes round: on its start date (or its due date, without one), once, Ostler moves it from backlog to ready and queues it for agents on the normal queue path (the queued task has scheduled: true), and it lands in review as usual; nothing is applied without the person. It moves with the rule, as does the task’s planFirst choice. It is checked when Ostler starts and every hour, so a day missed while Ostler was closed is caught up once, never once per day. When agents are off, the project has no linked folder, or the task is already queued or running, it is not queued and stays an ordinary task; the Inbox says why. It is never queued later by itself: queue it with POST /tasks, or the person uses Queue it now on its Inbox note, which takes the schedule’s path and sets scheduledQueue to queued (still refused, to the reason as it stands). The task’s scheduledQueue { outcome: "queued" | "agentsOff" | "noFolder" | "alreadyQueued" | "refused", at, note? } says what its schedule did. Whether queued work starts by itself is the project’s auto-dispatch (GET /auto-dispatch), and usage limits apply as to any run.',
    response:
      '{ ok: true, value: { workItemId, projectId, rule: { every, interval, weekdays?, monthDay? }, endsOn, remaining, rotation: string[] | null, nextIndex, goToAgents: boolean } | null }'
  },
  {
    method: 'POST',
    path: '/work-items/:workItemId/recurrence',
    description:
      'Make a task repeat, or change how. every is day, week, month or year; interval is every 1 to 99 of them; weekdays (week only) are 0 (Sunday) to 6 (Saturday), default the due date’s weekday; monthDay (month or year only) is 1 to 31, and lands on the last day of shorter months. End it on a date (endsOn, YYYY-MM-DD) or after a number of further occurrences (remaining), not both; leave both out to repeat forever. Take turns: rotation is up to 50 person ids (from GET /people), each once, in order; null or [] for none. nextIndex (0 to rotation length − 1) says whose turn is next; leave it out to keep the person who was next as next (if they were taken out, the person after them). goToAgents: true makes each occurrence go to agents when it comes round (see GET); leave it out to keep it as it was (off for a new repeat).',
    request:
      'JSON body: { rule: { every, interval?, weekdays?, monthDay? }, endsOn?: string | null, remaining?: number | null, rotation?: string[] | null, nextIndex?: number, goToAgents?: boolean }.',
    response: '{ ok: true, value: PlanningRecurrence }',
    exampleBody: { rule: { every: 'week', interval: 2, weekdays: [1, 4] }, remaining: 10 }
  },
  {
    method: 'DELETE',
    path: '/work-items/:workItemId/recurrence',
    description: 'Stop a task repeating.',
    response: '{ ok: true, value: null }'
  },
  {
    method: 'GET',
    path: '/work-items/:workItemId/reminders',
    description:
      'A task’s reminders still to come, soonest first, then any delivered reminder that keeps reminding and has not stopped. kind is due (planned from the due date by the reminder setting in Settings › Notifications, and kept in step with it) or custom. Reminders fire as Windows notifications and Inbox items, and only while Ostler is running.',
    response:
      '{ ok: true, value: Array<{ id, workItemId, remindAt (ms), kind, deliveredAt, keepReminding, intervalMinutes, lastNudgedAt, stoppedAt }> }'
  },
  {
    method: 'POST',
    path: '/work-items/:workItemId/reminders',
    description:
      'Add a custom reminder ("Remind me…"). remindAt is an ISO date and time with its offset, or milliseconds since 1970, and must be in the future. With keepReminding: true the notification comes back every intervalMinutes (5, 15, 30 or 60; the Settings › Notifications default when left out) after it fires, outside quiet hours, until the task is finished, the reminder is snoozed or stopped, or local midnight on the day it fired (the Inbox then says Missed). A done, archived or deleted task has no reminders; marking a task done cancels its reminders.',
    request:
      'JSON body: { remindAt: string | number, keepReminding?: boolean, intervalMinutes?: number }.',
    response: '{ ok: true, value: PlanningReminder }',
    exampleBody: { remindAt: '2026-10-14T09:00:00+13:00', keepReminding: true, intervalMinutes: 15 }
  },
  {
    method: 'POST',
    path: '/work-items/:workItemId/reminders/:reminderId/stop',
    description:
      'Stop reminding: a reminder that keeps reminding does not come back. Its Inbox item stays. A reminder that does not keep reminding is refused.',
    response: '{ ok: true, value: PlanningReminder }'
  },
  {
    method: 'DELETE',
    path: '/work-items/:workItemId/reminders/:reminderId',
    description: 'Remove one of a task’s reminders.',
    response: '{ ok: true, value: { id, deleted: true } }'
  },
  {
    method: 'GET',
    path: '/work-items/:workItemId/comments',
    description: 'List a task’s comments, oldest first. Deleted comments are left out.',
    response:
      '{ ok: true, value: Array<{ id, workItemId, authorKind, authorPersonId, body, createdAt, updatedAt }> }'
  },
  {
    method: 'POST',
    path: '/work-items/:workItemId/comments',
    description:
      'Write a comment on a task. body is markdown (at most 10,000 characters). Comments written here are by the automation API; coding agents cannot comment.',
    request: 'JSON body: { body: string }.',
    response: '{ ok: true, value: PlanningComment }',
    exampleBody: { body: 'Checked with **design**: ship it.' }
  },
  {
    method: 'PATCH',
    path: '/comments/:commentId',
    description: 'Edit a comment’s text.',
    request: 'JSON body: { body: string }.',
    response: '{ ok: true, value: PlanningComment }',
    exampleBody: { body: 'Checked with design: ship it on Friday.' }
  },
  {
    method: 'DELETE',
    path: '/comments/:commentId',
    description:
      'Delete a comment. It can be put back with POST /comments/:commentId/restore until its task is deleted for good.',
    response: '{ ok: true, value: PlanningComment (with deletedAt) }'
  },
  {
    method: 'POST',
    path: '/comments/:commentId/restore',
    description: 'Undo a comment delete.',
    request: 'No body.',
    response: '{ ok: true, value: PlanningComment }'
  },
  {
    method: 'GET',
    path: '/work-items/:workItemId/activity',
    description:
      'A task’s history, newest first: comments, field changes, status moves and its agent runs (queued, started, questions, report, accepted, discarded, sent back). Each entry has actor { kind: human | agent | ostler-ai | automation | system | unknown, name } and a plain-language summary. Page with ?limit= (1–100, default 25) and ?before=<nextBefore>; ?filter=comments or ?filter=changes narrows it.',
    response:
      '{ ok: true, value: { entries: Array<{ id, kind, workItemId, workItemTitle, at, actor, summary, comment?, field? }>, nextBefore: string | null } }'
  },
  {
    method: 'GET',
    path: '/briefing',
    description:
      'Since you were last here: what happened in this project from ?since=<ms> (required, a Unix time in milliseconds) until now, from Ostler’s own records, as Home’s card shows it. Tasks finished and added, each counted by who did it (actor: person | agent | rule | import | automation | ostler-ai | system, with name for a person or rule) with up to five titles; comments and the tasks they were on; due dates that passed in the span and are still open; reminders that went off; and, while AI agents are on, agent runs that ended, runs waiting for review and the number of agent questions waiting. value is null when nothing happened. Read only.',
    response:
      '{ ok: true, value: { since, until, project: { projectId, projectName, projectColor, finished: Array<{ actor, name, count, tasks: Array<{ id, title }> }>, added: same, comments: { count, tasks }, overdue: { count, tasks }, reminders: { count, tasks }, runsFinished: { count, tasks }, runsInReview: { count, tasks }, questions: number } | null } }'
  },
  {
    method: 'GET',
    path: '/progress',
    description:
      'Tasks finished per week in this project, by the rule Home’s progress card uses: a task counts once, at its latest move to Done, if it is still Done, assigned to Me or to nobody, and not deleted (archived tasks count; a reopened task does not). ?from= and ?to= are local days (YYYY-MM-DD, both required, at most ten years apart); weeks run from the week holding from to the week holding to, and only finishes from from to to count. ?weekStart= is the first day of the week, 0 (Sunday) to 6 (Saturday), Monday (1) by default. Read only; a disabled project has nothing finished.',
    response: '{ ok: true, value: { from, to, weekStart, weeks: Array<{ weekStart, count }> } }'
  },
  {
    method: 'GET',
    path: '/year-in-review',
    description:
      'This project’s part of Your year for ?year= (required, such as 2026), from the same rule as /progress: tasks and milestones finished each month (months is January to December; approximate is true when a milestone that month was complete before Ostler kept completion times, so its time is its last update), the busiest week (?weekStart= as for /progress), whether the project was finished that year (no open tasks left, its last task finished that year), and time tracked by Me or by no one by month (seconds; time is null when none was tracked). years lists the years with finished work. Read only.',
    response:
      '{ ok: true, value: { year, years, totalTasks, totalMilestones, months: Array<{ month, tasks, milestones, approximate }>, busiestWeek: { weekStart, count } | null, projectsFinished: Array<{ projectId, projectName, finishedOn }>, topProjects: Array<{ projectId, projectName, count }>, time: { byMonth: number[], byProject, totalSeconds } | null } }'
  },
  {
    method: 'GET',
    path: '/activity',
    description:
      'The same history across every task in the project, newest first. Page with ?limit= and ?before=<nextBefore>.',
    response: '{ ok: true, value: { entries: ActivityEntry[], nextBefore: string | null } }'
  },
  {
    method: 'GET',
    path: '/templates',
    description:
      'List the project templates: the built-in ones (source "built-in", the sample project among them with id "sample") and the ones saved from projects (source "saved"), each with its description, icon, milestone and task counts and its first few tasks. Templates are shared by every project.',
    response:
      '{ ok: true, value: Array<{ id, source, name, description, icon, milestoneCount, taskCount, firstTasks }> }'
  },
  {
    method: 'POST',
    path: '/templates',
    description:
      'Save this project as a template, like "Save as template…" in the app. Comments, activity, agent links and completed state are never saved: Done tasks go back to the backlog and ticks are cleared. include chooses what travels (each defaults to true): tasks, milestones (with goals), labels, people (assignees, matched by name when used), decisions, library (briefs, guides, notes and links), taskTemplates (the project’s own task templates). relativeDates (default true) turns dates into offsets from today, so the plan starts on the day the template is used.',
    request:
      'JSON body: { name: string (up to 80 characters), description?: string (up to 200), include?: { tasks?, milestones?, labels?, people?, decisions?, library?, taskTemplates? }, relativeDates?: boolean }',
    response: '{ ok: true, value: ProjectTemplateSummary }',
    exampleBody: { name: 'Quarterly launch', description: 'Our usual launch plan' }
  },
  {
    method: 'PATCH',
    path: '/templates/:templateId',
    description: 'Rename a saved template. Built-in templates cannot be changed.',
    request: 'JSON body: { name: string }',
    response: '{ ok: true, value: ProjectTemplateSummary }',
    exampleBody: { name: 'Launch plan' }
  },
  {
    method: 'DELETE',
    path: '/templates/:templateId',
    description: 'Delete a saved template. Projects made from it are not changed.',
    response: '{ ok: true, value: { id, deleted: true } }'
  },
  {
    method: 'POST',
    path: '/templates/:templateId/create-project',
    description:
      'Create a new project from a template, with no folder, as the New project wizard does: its milestones, tasks (with subtasks, checklists, dependencies and repeats), labels, decisions and Library notes, dates counted from today. Every task’s activity says "created the task from template". Nothing is left behind if it fails. The new project has its own automation token, set in the app.',
    request: 'JSON body: { name?: string (defaults to the template’s), color?: "#rrggbb" }',
    response: '{ ok: true, value: { id, name } }',
    exampleBody: { name: 'Summer party' }
  },
  {
    method: 'POST',
    path: '/import/csv',
    description:
      'Import tasks into this project from CSV text, as the app’s Import does: one transaction, every task with origin "imported", and one undoable import batch. The CSV exports of other tools are recognised from their header and mapped by a preset (asana, jira, linear, planner for Microsoft Planner saved as CSV, todoist): their columns, status and priority words, dates, people, tags, subtasks and dependencies (Waits on). preset names one, or "none" maps every column by hand; left out, the header decides (the preview says which in preset and detectedPreset). Otherwise columns are guessed from the header unless mapping.columns names them, and mapping.columns overrides a preset too; each distinct status and priority value maps to an Ostler value (guessed, or the preset’s, unless mapping.statuses / mapping.priorities say); dates follow mapping.dateFormat (iso, dmy or mdy; guessed from the values otherwise). Labels split on , or ;, checklists on new lines or ; ("[x] item" is ticked); missing milestones and people are created. key, parent, waitsOn and blocks columns name other rows by key or title: a parent makes a subtask, waitsOn and blocks make Waits on links. A reference to a row that is not in the file, a loop, a fourth level of subtasks or a subtask waiting outside its parent is left out with a warning on its row. A filled done column (a completion date) makes the task Done. Rows with an error (no title) are skipped; warnings say what was shortened or left empty. ?dryRun=1 returns the preview (counts, mappings, subtaskCount, dependencyCount, the first 50 rows with their problems) and writes nothing. Up to 50 MB and 20,000 rows; the text is data, never instructions. With updateById: true the file is read as the app’s Edit in Excel › Bring changes back reads it (the CSV GET /export?format=csv&columns=id,… writes): a row whose ID column names a live task of this project changes that task, field by field, through the same update as PATCH /work-items/:id (activity, reminders, search and rules all see it), and only the fields whose cell differs from what the export writes; a cell that cannot be read (a bad date, a status, person, milestone or iteration the project does not have) leaves its field alone and is listed under problems, and a changed row never adds a person or milestone. A row without an ID is a new task, as an ordinary import makes one (one undoable import batch). A row whose ID is unknown, archived, in another project or repeated is listed under skipped. A task with no row is left alone: nothing is ever deleted. The sheet’s order never changes the tasks’ order. taskIds and newLines (the rows’ line numbers) limit what is applied; left out, everything is. ?dryRun=1 returns the preview (CsvUpdatePreview: changed tasks with each field’s from and to, problems, unchangedCount, newRows, newPeople, newMilestones, skipped) and writes nothing; otherwise the result lists the tasks changed, the old values (undo: PATCH each task with its values to put them back) and the import batch of new tasks (null when none).',
    request:
      'JSON body: { csv: string, fileName?: string, updateById?: boolean, taskIds?: string[], newLines?: number[], preset?: "asana" | "jira" | "linear" | "planner" | "todoist" | "none", mapping?: { columns?: { title?, description?, status?, priority?, assignee?, labels?, start?, due?, estimate?, milestone?, showFrom?, someday?, impact?, effort?, checklist?, key?, parent?, waitsOn?, blocks?, done?: header name | index | null }, statuses?: { [value]: status }, priorities?: { [value]: priority }, dateFormat?: "iso" | "dmy" | "mdy", delimiter?: "," | ";" | "\\t" } }',
    response:
      '{ ok: true, value: ImportResult { batch: { id, projectId, source, fileName, createdAt, itemCount, undoneAt }, projectId, projectName, skipped, warnings } } or, with ?dryRun=1, { ok: true, value: CsvImportPreview }. With updateById: { ok: true, value: CsvUpdateResult { changed: { taskId, title, columns }[], undo: { id, values }[], batch: ImportBatch | null } } or, with ?dryRun=1, { ok: true, value: CsvUpdatePreview }',
    exampleBody: {
      csv: 'Title,Status,Due\nBook the venue,In progress,2026-10-20\n',
      fileName: 'tasks.csv',
      mapping: { columns: { title: 'Title' }, statuses: { 'In progress': 'active' } }
    }
  },
  {
    method: 'POST',
    path: '/import/github',
    description:
      "Import a GitHub repository's issues as tasks, as the app's Import tasks › From GitHub issues does: one transaction, every task with origin \"imported\", one undoable import batch (DELETE /import/:batchId), and each task linked to its issue. Issues are read from api.github.com (read only), oldest first, at most 1,000; pull requests are never imported. repository is owner/repo or a github.com URL, and defaults to the project's GitHub repository. state is open (the default) or all; labels keeps issues with every label named; milestone is a milestone's title or number. An issue a task in the project already links (outside the recycle bin) is skipped, so importing again adds only new issues. The title becomes the task's title, the body its description (Markdown), labels become labels, the milestone a milestone (created when missing), the first assignee is matched to a person by name, any case, or added; a closed issue becomes a Done task. ?dryRun=1 returns the preview (counts, issueCount, alreadyLinkedCount, truncated, the first 50 rows) and writes nothing. Ostler's saved GitHub token is used when there is one, and is never returned.",
    request:
      'JSON body: { repository?: string, state?: "open" | "all", labels?: string[], milestone?: string }',
    response:
      '{ ok: true, value: ImportResult { batch, projectId, projectName, skipped, warnings } } or, with ?dryRun=1, { ok: true, value: GithubImportPreview }',
    exampleBody: { repository: 'octo-org/octo-repo', state: 'open', labels: ['bug'] }
  },
  {
    method: 'POST',
    path: '/import/project',
    mcp: { excluded: 'Its body is the project file itself, which a tool call cannot carry.' },
    description:
      'Import a project file (.ostler-project, as Export project… or GET /export?format=file writes it) as a new project, with its Library files, as the app’s Import does. The request body is the file itself (Content-Type application/zip), up to 2 GB. The file is treated as hostile: it is unpacked only under the data folder, refused with a plain message if it holds absolute paths, drive letters, .., links, more than 10,000 entries or more than 2 GB unpacked, and the unpacked copy is removed whether the import works or not. ?name= names the new project (otherwise the file’s project name, numbered when a project already has it: "Name (2)"); ?fileName= is shown in the import history. An export folder from an earlier version is imported in the app (Import an export folder from an earlier version…). A password-protected project file (Protect with a password) needs its password in the Ostler-File-Password request header, never in the address: it is decrypted under the data folder and its authentication tag checked before anything is unpacked; a wrong password or a damaged file is refused with "This password does not open the file, or the file is damaged" and nothing is imported. The header is ignored for an ordinary project file.',
    request:
      'Body: the .ostler-project file (application/zip). Query: name?, fileName?. Header: Ostler-File-Password? (for a protected file)',
    response:
      '{ ok: true, value: ImportResult { batch, projectId, projectName, skipped, warnings } }: projectId is the new project'
  },
  {
    method: 'DELETE',
    path: '/import/:batchId',
    description:
      'Undo an import: its tasks go to the recycle bin (restorable from Recycle bin). Tasks changed since the import are kept and listed in kept, unless ?includeChanged=1. An import is undone once.',
    response: '{ ok: true, value: { batch, movedIds: string[], kept: Array<{ id, title }> } }'
  },
  {
    method: 'GET',
    path: '/export',
    description:
      'Export this project. ?format=csv (the default) returns every live task as CSV text (UTF-8 with a BOM, RFC 4180 quoting, Content-Type text/csv), with every column or the ones in ?columns=title,status,… (key, id, title, description, status, priority, type, assignee, start, due, estimate, milestone, iteration, labels, checklist, comments, updated, created, timeLogged, showFrom, someday, impact, effort, field:<field id>; key is the task’s ID such as SHOP-12 (the Task ID column, first in every column); id is the record’s own id, never in the default columns: put it first to edit the file and send it back with POST /import/csv and updateById: true; every column includes Type once the project has task types, Iteration once it has an iteration, Time logged (hours) once it has time entries, and a column per custom field). ?format=file returns the project file the app’s Export project… writes (<name>.ostler-project, a zip of project.json and library/ with the Library’s files; Content-Type application/zip), comments included unless ?comments=false; with an Ostler-File-Password request header (at least 8 characters, never in the address) the file is protected with that password: encrypted whole with AES-256-GCM under a key from scrypt, still named .ostler-project, and openable only with the password (there is no recovery). ?format=package returns just its project.json: the project package (kind export: tasks, milestones, goals, labels, people, decisions, finished time entries, Library text items and, unless ?comments=false, comments), without the Library’s files. A project too large to import again (such as one with more than 2,000 tasks, or a project.json over 1 MB) is refused for file and package with HTTP 400, as the app refuses it. ?format=ics returns the calendar file the app’s Export to calendar file… writes (iCalendar, Content-Type text/calendar): an all-day event per task with a due date (from its start date when it has one) and per dated milestone, each with a stable UID and the task’s ostler:// link; finished tasks and milestones only with ?includeFinished=true; with ?blocks=true also each time block as a timed event in UTC (from its wall-clock time when exported, UID from the block’s id, the task’s link in the description). ?format=html returns the web page the app’s Share as a web page… writes (Content-Type text/html; one file, no scripts, no network requests): key numbers, milestones with progress and the task list; ?groupBy=status|milestone (default status), ?descriptions=true, ?decisions=true, ?finished=false, ?people=false, ?statusUpdate=true (the latest status update, its health, note, who and when, first). ?format=pptx returns the Timeline as a PowerPoint file the app’s Export to PowerPoint slide… writes (Content-Type application/vnd.openxmlformats-officedocument.presentationml.presentation): 16:9 slides with a date axis (weeks with ?zoom=week, months with month, the default, or quarter), one row per dated task (a text box for its title and a rounded rectangle from its start to its due date, finished tasks paler), milestone diamonds with their names, bold group headings and a line for today, every item its own editable shape; ?from=YYYY-MM-DD&to=YYYY-MM-DD for the range (default: the months the dated tasks and milestones cover, at most 1098 days), ?groupBy=milestone|assignee|none (default milestone), finished tasks only with ?includeFinished=true; 18 rows a slide, more on further slides marked (2 of 3), and tasks without dates left out and counted in the first slide’s notes. Library files are never included.',
    response:
      'format=csv: text/csv. format=file: application/zip (a .ostler-project file). format=package: { ok: true, value: ProjectPackage } (src/shared/project-package.ts). format=ics: text/calendar. format=html: text/html. format=pptx: application/vnd.openxmlformats-officedocument.presentationml.presentation'
  },
  ...PEOPLE_ROUTES,
  ...CONTACTS_ROUTES,
  ...DAYS_OFF_ROUTES,
  ...CALENDARS_ROUTES,
  {
    method: 'POST',
    path: '/work-items/:workItemId/archive',
    description:
      'Move a finished work item off the Board into the project archive. Same gate as delete; the link to its agent task is kept so the report stays readable.',
    request: 'No body.',
    response: '{ ok: true, value: PlanningWorkItem }'
  },
  {
    method: 'POST',
    path: '/work-items/:workItemId/unarchive',
    description:
      'Return an archived work item to the Board. A won’t-do task is reopened: its resolution and resolutionReason are cleared and it comes back with the status it had.',
    request: 'No body.',
    response: '{ ok: true, value: PlanningWorkItem }'
  },
  {
    method: 'POST',
    path: '/work-items/:workItemId/accept',
    description:
      "Accept a task waiting in To triage, as the app's Accept does: it leaves To triage with any fields sent set first, in the Backlog unless a status is sent, and counts from then on. The other decisions use their own routes, which take it out of To triage too: PATCH someday: true (Someday), POST /work-items/:workItemId/wont-do, POST /work-items/:workItemId/duplicate-of, and POST /work-items/:workItemId/move with { projectId }. Refused for a task not in To triage.",
    request:
      'JSON body (all optional): { status?, priority?, assigneeId?, labels?, targetDate?, milestoneId? }, checked as PATCH checks them. Any other field is refused.',
    response: '{ ok: true, value: PlanningWorkItem }',
    exampleBody: { status: 'ready', priority: 'high' }
  },
  {
    method: 'POST',
    path: '/work-items/:workItemId/wont-do',
    description:
      'Close an unfinished task as won’t do: it keeps its status, moves to the project archive with resolution "wont-do" and the reason, and never counts as done (reports, burn-up, throughput and milestone progress leave it out). Refused for a Done task (archive it instead), one already won’t do or archived, running agent work and work waiting for review. Queued agent work is cancelled first only with cancelQueuedWork: true; otherwise it refuses. includeSubtasks: true closes its open subtasks the same way, with the same reason. A repeating task skips this occurrence: its next one is made as if it were done. No rule runs. POST /work-items/:workItemId/unarchive reopens it.',
    request: `JSON body: { reason?: string (at most ${MAX_RESOLUTION_REASON_LENGTH} characters), includeSubtasks?: boolean, cancelQueuedWork?: boolean }.`,
    response:
      '{ ok: true, value: { workItem: PlanningWorkItem, closedIds: string[] (the task first, then its subtasks), cancelledTask: boolean, repeatedAs?: string (the next occurrence’s id) } }',
    exampleBody: { reason: 'No longer needed', includeSubtasks: true }
  },
  {
    method: 'GET',
    path: '/links',
    description:
      'Backlinks: the texts of this project that link to one item. ?to=<kind>:<id> names it, kind one of task, milestone, decision or library. A link is ordinary Markdown in a task description, a comment, a decision (context, decision, alternatives or consequences) or a Library item (summary or body): [words](ostler://<kind>/<projectId>/<id>), the item\u2019s deep link. Write one by writing that text through the usual routes (PATCH /work-items/:workItemId, POST /work-items/:workItemId/comments, PATCH /library/:itemId); the index is kept as each text is saved. Links to another project\u2019s items still open in the app but are not listed. Deleted comments and tasks in the recycle bin are left out. sourceKind says where the link is written; for a comment, title is its task\u2019s title and workItemId its task. An item that is not in this project is HTTP 400.',
    request: '?to=task:<id> (or milestone:, decision:, library:). No body.',
    response:
      '{ ok: true, value: Array<{ sourceKind: "task" | "comment" | "decision" | "library", sourceId, projectId, title, workItemId: string | null }> }'
  },
  {
    method: 'GET',
    path: '/work-items/:workItemId/links',
    description:
      'A task’s links besides waits-on: "relates to", "duplicates" and "copied from", to other tasks of this project, read from this task’s end. role says how it reads here: relates (the same from both ends), duplicate-of or duplicated-by, copied-from or copied-to. Each has the other task’s id, title, status and otherClosed (archived, closed as won’t do or in the recycle bin). Links never move dates, raise conflicts, change the critical path, readiness or the agent queue: only dependencyIds (waits-on) do.',
    request: 'No body.',
    response:
      '{ ok: true, value: Array<{ id, projectId, kind: "relates" | "duplicates" | "copied-from", role, workItemId, otherWorkItemId, otherTitle, otherStatus, otherClosed: boolean, createdAt }> }'
  },
  {
    method: 'GET',
    path: '/work-items/:workItemId/description-versions',
    description:
      'A task’s description history, newest first: what the description said before each sitting of changes. Changes by the same actor within five minutes of the last are one sitting, so one version keeps the text from before the sitting began. The newest 50 are kept per task; deleting the task for good removes them, and they are never in CSV, the project file or templates. To restore one, PATCH /work-items/:workItemId with { description: <its text> }: that is a change of its own, and the text it replaces becomes a version too.',
    request: 'No body.',
    response:
      '{ ok: true, value: Array<{ id: number, projectId, workItemId, text: string, actor: { kind, personId, name, ruleName? }, startedAt: number, endedAt: number }> }'
  },
  {
    method: 'POST',
    path: '/work-items/:workItemId/links',
    description:
      'Link this task to another task of the same project, with an activity entry on both. kind "duplicates" makes this task a duplicate of toWorkItemId, and "copied-from" says this task was copied from it; "relates" reads the same both ways. Refused for a link to itself, to another project’s task or one in the recycle bin, an unknown kind, and a pair that already has a link of that kind, whichever way round. Deleting either task for good removes the link.',
    request: 'JSON body: { toWorkItemId: string, kind: "relates" | "duplicates" | "copied-from" }.',
    response: '{ ok: true, value: TaskLink (as GET /work-items/:workItemId/links lists them) }',
    exampleBody: { toWorkItemId: '<work item id>', kind: 'relates' }
  },
  {
    method: 'DELETE',
    path: '/work-items/:workItemId/links/:linkId',
    description:
      'Remove a link from either of its tasks, with an activity entry on both. The tasks themselves are untouched.',
    request: 'No body.',
    response: '{ ok: true, value: { id: string, deleted: true } }'
  },
  {
    method: 'POST',
    path: '/work-items/:workItemId/duplicate-of',
    description:
      'Mark this task as a duplicate of originalId, as the app’s Mark as duplicate does: it adds a "duplicates" link and closes this task as won’t do with the reason "Duplicate of <original’s title>", by the same rule as POST /work-items/:workItemId/wont-do, so every refusal there applies (a Done task, one already closed or archived, running agent work, work waiting for review; queued agent work only with cancelQueuedWork: true). The link is checked first, so a refusal changes nothing. The original may itself be a duplicate: chains are never followed. To undo, POST /work-items/:workItemId/unarchive and DELETE the link.',
    request: 'JSON body: { originalId: string, cancelQueuedWork?: boolean }.',
    response:
      '{ ok: true, value: { workItem: PlanningWorkItem, link: TaskLink, cancelledTask: boolean } }',
    exampleBody: { originalId: '<work item id>' }
  },
  {
    method: 'POST',
    path: '/work-items/:workItemId/copy',
    description:
      'Copy a task, as the app’s Copy task does: a new task in Backlog at the end of the order, with the same title followed by "(copy)", description, checklist (unticked), labels, priority, estimate, assignee, start, due and show-from dates, milestone, iteration and custom field values, and a "copied-from" link back. Comments, activity, attachments, waits-on, subtasks and agent links are not copied. It is a create like POST /work-items, so rules see it as one.',
    request: 'No body.',
    response: '{ ok: true, value: { workItem: PlanningWorkItem, link: TaskLink } }'
  },
  {
    method: 'POST',
    path: '/work-items/:workItemId/restore',
    description:
      'Take a work item out of the recycle bin, back to the Board (or the archive, if it was archived).',
    request: 'No body.',
    response: '{ ok: true, value: PlanningWorkItem }'
  },
  {
    method: 'GET',
    path: '/library',
    description:
      'List the project library: briefs, guides, images, documents, links, notes and whiteboards (a whiteboard\u2019s body is its outline, written from the board\u2019s objects). This token acts for the human, so human-only items are included and marked humanOnly: true (Ostler AI never reads those). Filter with ?kind=, ?access=always|when-selected|human-only, ?tag=, ?search=, ?includeArchived=true. ?include=linkedFrom adds linkedFrom to each: the texts of this project that link to it, as in GET /links.',
    response: '{ ok: true, value: Array<LibraryItem & { humanOnly, linkedFrom? }> }'
  },
  {
    method: 'GET',
    path: '/library/:itemId',
    description:
      'One library item with its readable text (markdown body, a whiteboard\u2019s outline, or text extracted from a document) and the work items it is a source of. ?include=linkedFrom adds linkedFrom to each: the texts of this project that link to it, as in GET /links.',
    response: '{ ok: true, value: LibraryItem & { humanOnly, text, sourceOf, linkedFrom? } }'
  },
  {
    method: 'GET',
    path: '/library/:itemId/file',
    description:
      'The stored original of an image or document, as raw bytes with its content type. Briefs, guides, notes, links and whiteboards have none.',
    response: 'The file bytes, or 404 { ok: false } when the item has no stored file.'
  },
  {
    method: 'POST',
    path: '/library',
    description:
      'Create a brief, guide, note or link. Whiteboards are made in the app and cannot be created here. Briefs and guides default to aiAccess "always", links to "when-selected", notes to "human-only". isPrimaryBrief: true makes a brief the primary brief.',
    request:
      'JSON body: { kind: "brief" | "guide" | "note" | "link", title, summary?, body?, url? (links), aiAccess?, tags?, isPrimaryBrief? }.',
    response: '{ ok: true, value: LibraryItem & { humanOnly } }',
    exampleBody: {
      kind: 'brief',
      title: 'Design brief',
      summary: 'Purpose, audience and look of the app',
      body: '## Purpose\n...',
      isPrimaryBrief: true
    }
  },
  {
    method: 'POST',
    path: '/library/upload',
    description:
      'Import an image (png, jpg, webp, gif, svg) or document (pdf, md, txt, other files stored as-is), capped at 25 MB. Uploading a file the project already holds returns that item with duplicateOf set. Set its summary afterwards with PATCH.',
    request: 'JSON body: { fileName, mimeType, base64 }.',
    response: '{ ok: true, value: { item: LibraryItem & { humanOnly }, duplicateOf? } }',
    exampleBody: { fileName: 'home-screen.png', mimeType: 'image/png', base64: '<base64>' }
  },
  {
    method: 'PATCH',
    path: '/library/:itemId',
    description:
      'Edit an item. Changing title, summary or body creates a new revision, which flags work items written from the older one. isPrimaryBrief: true/false sets or clears the primary brief. A whiteboard\u2019s body is written from its objects and is refused; its title, summary, aiAccess and tags can be edited.',
    request: 'JSON body with any of { title, summary, body, url, aiAccess, tags, isPrimaryBrief }.',
    response: '{ ok: true, value: LibraryItem & { humanOnly } }',
    exampleBody: { summary: 'Match this layout and spacing', aiAccess: 'when-selected' }
  },
  {
    method: 'POST',
    path: '/library/:itemId/archive',
    description: 'Archive an item. Archived items are hidden from Ostler AI.',
    request: 'No body.',
    response: '{ ok: true, value: LibraryItem & { humanOnly } }'
  },
  {
    method: 'DELETE',
    path: '/library/:itemId',
    description:
      'Delete an item permanently, with its revisions, stored files and work item links.',
    response: '{ ok: true, value: { id, deleted: true } }'
  },
  {
    method: 'GET',
    path: '/work-items/:workItemId/sources',
    description:
      'The library items a work item was written from, with the revision recorded at link time, the current revision, and changedSince.',
    response: '{ ok: true, value: Array<WorkItemSource> }'
  },
  {
    method: 'POST',
    path: '/work-items/:workItemId/sources',
    description:
      'Record a library item as a source of a work item, at its current revision (re-adding refreshes the revision). Sources are a record for the human; they do not change what the agent is asked to do.',
    request: 'JSON body: { itemId }.',
    response: '{ ok: true, value: Array<WorkItemSource> }',
    exampleBody: { itemId: '<library-item-id>' }
  },
  {
    method: 'DELETE',
    path: '/work-items/:workItemId/sources/:itemId',
    description: 'Remove a library item from a work item’s sources.',
    response: '{ ok: true, value: Array<WorkItemSource> }'
  },
  {
    method: 'GET',
    path: '/work-items/:workItemId/attachments',
    description:
      "The library items attached for a work item's agent, with who attached each (human, ostler-ai or automation), the revision at attach time, the current revision, and changedSince.",
    response: '{ ok: true, value: Array<WorkItemAttachment> }'
  },
  {
    method: 'POST',
    path: '/work-items/:workItemId/attachments',
    description: `Attach a library item for the work item's agent, recorded as attachedBy "automation" (re-attaching refreshes the revision). Only live items Ostler AI may read can be attached: human-only and archived items are refused, and a work item carries at most ${LIBRARY_MAX_TASK_ATTACHMENTS}. The task text lists attachments, and every coding session can read the files, read-only: embedded sessions as copies, external harness sessions through GET /tasks/:taskId/attachments on the harness API.`,
    request: 'JSON body: { itemId }.',
    response: '{ ok: true, value: Array<WorkItemAttachment> }',
    exampleBody: { itemId: '<library-item-id>' }
  },
  {
    method: 'DELETE',
    path: '/work-items/:workItemId/attachments/:itemId',
    description: "Remove a library item from a work item's agent attachments.",
    response: '{ ok: true, value: Array<WorkItemAttachment> }'
  },
  {
    method: 'GET',
    path: '/reports',
    description:
      "The project dashboard, exactly as the Overview's Insights show it: key numbers (open, done in range, overdue, due in 7 days, median and 85th-percentile cycle time, median lead time), a burn-up per milestone (scope and done per day, in tasks, and in estimates when every task has one), cumulative flow (tasks per status per day), weekly throughput, cycle-time buckets, workload per assignee and the at-risk list (overdue, blocked over 3 days, dependency conflicts, milestones behind pace with the forecast as a range of days, or 'not enough history'), and while an iteration is active its burn-down as iterationBurndown (remaining tasks and estimate at the end of each day against an ideal line, from the status history; null after today), whatever the range. Each chart carries a one-sentence summary. Query: range=30d (default), 90d or milestone:<milestoneId>, which also narrows every section to that milestone's tasks. Days before a task existed are left out rather than drawn as zeros. splitBy=type adds byType to throughput and cycleTime, as the Overview's Split by type draws them: one entry per series, each { series: { key (a type id, \"none\" for tasks with no type, or \"other\"), name, icon, color (null for No type and Other), typeIds }, then weeks and total (throughput) or buckets and sampleSize (cycle time), and summary (\"Bug: …\") }. The series are the types that finished something in range, in the project's order, then No type; past six, the six that finished most keep their own and the rest share Other, last. The series' weeks and buckets sum exactly to the unsplit chart. A project with no task types gets empty lists. Any other splitBy is refused.",
    response:
      '{ ok: true, value: { projectId, range, rangeLabel, from, to, generatedAt, estimateUnit, keyNumbers, burnUp: [...], cumulativeFlow: { points, summary }, throughput: { weeks, summary, byType? }, cycleTime: { buckets, sampleSize, summary, byType? }, workload: { rows, summary }, atRisk: { overdue, blocked, conflicts, lateMilestones, unforecastMilestones, summary } } }'
  },
  {
    method: 'GET',
    path: '/dependency-conflicts',
    description:
      "List every waits-on link whose dates are broken, as the Timeline flags them. A task starts on its startDate, or its targetDate when it has none. finish-to-start: the task starts on or after the other's targetDate plus lagDays; start-to-start: it starts on or after the other's first day plus lagDays; finish-to-finish: its targetDate is on or after the other's targetDate plus lagDays. A link missing a date it needs is no conflict, and landing on the earliest day is fine. Fix one by PATCHing the task's or the dependency's dates, or the link (dependencyLinks).",
    response:
      '{ ok: true, value: Array<{ taskId, dependencyId, start: YYYY-MM-DD (the task’s date the link measures: its first day, or targetDate for finish-to-finish), dependencyDue: YYYY-MM-DD (the other’s date it measures from: its targetDate, or its first day for start-to-start), and, only for a link that is not finish-to-start with lagDays 0, type, lagDays and earliest: YYYY-MM-DD (dependencyDue plus lagDays) }> }'
  },
  {
    method: 'GET',
    path: '/critical-path',
    description:
      "Show critical path, as the Timeline does: the chain of open tasks that sets the project's end (the latest due date among open tasks), and how many calendar days every other open dated task can slip. ?milestoneId= measures against that milestone's targetDate (or its latest task's due date when it has none), counting its tasks and everything they wait on. Worked out from the dates as set and the waits-on links, each by its type and lagDays (finish to start: a task may start on the day what it waits on is due plus the lag; start to start: on its first day plus the lag; finish to finish: be due on its due date plus the lag). A task's span is startDate to targetDate; a targetDate or a startDate alone is one day. Done tasks are left out; open tasks with no dates are listed in undatedTaskIds and not counted. slackDays is negative when a task is already late against the end; critical is slackDays <= 0. chains lists the critical tasks first to last, at most 10 (moreChains is true when more tie). An unknown milestoneId answers 404.",
    request: 'Optional query ?milestoneId=',
    response:
      "{ ok: true, value: { milestoneId: string | null, end: YYYY-MM-DD | null, endFrom: 'milestone' | 'tasks', chains: string[][], moreChains: boolean, tasks: Array<{ taskId, start, end, latestEnd, slackDays, critical }>, undatedTaskIds: string[] } }"
  },
  {
    method: 'GET',
    path: '/blockers',
    description: 'List every open blocker for the project, newest-reported last.',
    response: '{ ok: true, value: PlanningBlockerWithWorkItem[] }'
  },
  {
    method: 'POST',
    path: '/blockers',
    description:
      'Report a blocker on a work item. Marks it ineligible for (re-)dispatch until resolved.',
    request:
      'JSON body: { workItemId: string, description: string, resolutionOptions?: string[] }.',
    response: '{ ok: true, value: PlanningBlocker }',
    exampleBody: {
      workItemId: '<work-item-id>',
      description: 'Waiting on a design decision before this can proceed.',
      resolutionOptions: ['Proceed with option A', 'Cancel this task']
    }
  },
  {
    method: 'POST',
    path: '/blockers/:blockerId/resolve',
    description:
      'Resolve an open blocker. If nothing else blocks the work item, it becomes eligible for dispatch again immediately.',
    request: 'JSON body: { choice: string, note?: string }.',
    response: '{ ok: true, value: PlanningBlocker }',
    exampleBody: { choice: 'Proceed with option A', note: 'Confirmed with the team.' }
  }
]

export const HELP_ROUTES: AutomationRoute[] = ROUTES.map(helpRoute)

/** The largest JSON body any route takes: an import's CSV text. */
const IMPORT_MAX_BODY_BYTES = Math.ceil(MAX_IMPORT_FILE_BYTES * 1.1) + 64 * 1024

/** The MCP tools (D39): the route table's, made once. */
const MCP_TOOLS = mcpToolsFromRoutes(HELP_ROUTES)

/** A response a route writes when a tool runs it in-process: kept in memory. */
class CapturedResponse extends Writable {
  status = 200
  headers: Record<string, unknown> = {}
  private readonly chunks: Buffer[] = []

  writeHead(status: number, headers?: Record<string, unknown>): this {
    this.status = status
    if (headers) this.headers = headers
    return this
  }

  override _write(chunk: unknown, _encoding: BufferEncoding, done: () => void): void {
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
    done()
  }

  captured(): CapturedRouteResponse {
    return {
      status: this.status,
      contentType: String(this.headers['Content-Type'] ?? ''),
      body: Buffer.concat(this.chunks)
    }
  }
}

export class AutomationHttpServer {
  private server: Server | null = null
  /** The port listened on, which an MCP request's Host must name. */
  private port: number | null = null
  /** The version the MCP server reports; main sets the app's. */
  mcpVersion = '0.0.0'
  /**
   * Whether AI agents are on (D10). The API has its own switch (D38), so its
   * agent-work routes check this: agent work must never be made while the
   * screens that show it are hidden.
   */
  agentsOn: () => boolean = () => true
  /**
   * The settings a model chosen for a run is checked against (D42), exactly as
   * the app checks it; main sets it. Unset, choosing a model is refused.
   */
  getConfig: (() => OstlerConfig) | null = null
  /**
   * Areas and project icons (N5.1): the areas, and saving the area and icon
   * of a project through the config store, as Project settings does. Main sets it.
   */
  appearance: {
    areas(): ProjectArea[]
    update(
      projectId: string,
      updates: { areaId?: string | null; icon?: string | null }
    ): { areaId: string | null; icon: string | null }
  } | null = null
  /** Plans kept with their tasks (N9.3b), for a run's plan history. Main sets it. */
  taskPlans: { listForSession(sessionId: string): TaskPlanRecord[] } | null = null
  /**
   * A project's stage (N5.3): saved through the config store, as the board
   * and Project settings do. Main sets it.
   */
  projectStage: { update(projectId: string, stage: ProjectStage): ProjectStage } | null = null
  /** Triage new captures (N4.3a): saved through the config store, as Project settings does. Main sets it. */
  triageSetting: { update(projectId: string, enabled: boolean): boolean } | null = null
  /**
   * A project's task prefix (N9.8a): saved through `configStore.updateProject`,
   * which checks it, as Project settings does. Main sets it.
   */
  taskPrefix: { update(projectId: string, taskPrefix: string): string } | null = null
  /**
   * The status update reminder (N5.5), saved through `configStore.updateProject`
   * as Project settings does (it validates). Main sets it.
   */
  updateReminder: {
    update(projectId: string, reminder: Partial<UpdateReminder>): UpdateReminder
  } | null = null
  /**
   * GitHub links on tasks (R4.4, D40), the app's own service; main sets it.
   * Requests go to GitHub only when a caller asks for them here, with the
   * token saved in Ostler, which is never returned.
   */
  github: GithubLinkService | null = null
  /**
   * Since you were last here (N1.6): one project's part of the briefing, from
   * the app's own `BriefingService`; main sets it.
   */
  getBriefing:
    ((project: WatchedProject, since: number, until: number) => BriefingProject | null) | null =
    null
  /** Progress and your year (N3.6): the app's own `ProgressService`; main sets it. */
  progress: ProgressService | null = null
  /**
   * Days off (N3.2): global, like people; main sets it. `notify` pushes
   * ON_PROJECT_STATE_CHANGE with field 'daysOff'.
   */
  daysOff: { service: DaysOffService; notify(): void } | null = null
  /**
   * Outside calendars (N3.3a): global, like days off; main sets it. `notify`
   * pushes ON_PROJECT_STATE_CHANGE with field 'calendars'.
   */
  calendars: { service: OutsideCalendarService; notify(): void } | null = null
  /** Focus (N3.5): global, like the timer; main sets it. Its own listener tells the window. */
  focus: FocusService | null = null
  /** Contacts (N6.5) changed: pushes ON_PROJECT_STATE_CHANGE with field 'contacts'; main sets it. */
  contactsChanged: (() => void) | null = null
  /** Aborted by stop(), which ends every GET /events still waiting. */
  private running = new AbortController()
  constructor(
    readonly getProjects: () => WatchedProject[],
    readonly dataDir: string,
    readonly auditMutation: (entry: AutomationAuditEntry) => void = (entry) => this.audit(entry),
    readonly planning?: PlanningService,
    readonly harness?: HarnessService,
    readonly onHarnessStateChange?: (project: WatchedProject) => void,
    readonly getReadinessReports?: (project: WatchedProject) => Promise<PlanningReadinessReport[]>,
    readonly startEmbeddedTask?: (project: WatchedProject, taskId: string) => Promise<unknown>,
    readonly getSessionTranscript?: (
      project: WatchedProject,
      sessionId: string
    ) => Promise<SessionTranscriptEntry[]>,
    readonly answerQuestion?: (
      project: WatchedProject,
      questionId: string,
      answer: string
    ) => Promise<HarnessQuestion>,
    readonly stopEmbeddedSession?: (
      project: WatchedProject,
      sessionId: string,
      note?: string
    ) => Promise<void>,
    readonly autoDispatch?: {
      get(projectId: string): ProjectAutoDispatchConfig
      update(
        projectId: string,
        updates: Partial<ProjectAutoDispatchConfig>
      ): ProjectAutoDispatchConfig
    },
    readonly library?: {
      service: LibraryService
      /** Pushes ON_PROJECT_STATE_CHANGE with field 'library'. */
      notify(project: WatchedProject): void
    },
    /** Pushes ON_PROJECT_STATE_CHANGE with field 'planning' after a planning change. */
    readonly onPlanningChange?: (project: WatchedProject) => void,
    readonly people?: {
      service: PeopleService
      /** Pushes ON_PROJECT_STATE_CHANGE with field 'people'. */
      notify(): void
      /** Pushes ON_PROJECT_STATE_CHANGE with field 'planning': a deleted person's tasks moved. */
      notifyPlanning?(projectId: string): void
    },
    readonly templates?: {
      service: ProjectPackageService
      /** Starts watching a project created from a template, as the wizard does. */
      projectCreated(project: WatchedProject): void
    },
    readonly imports?: {
      service: ImportService
      /** After an import or an undo: the app's Board, Home and Inbox read again. */
      changed(project: WatchedProject): void
    },
    readonly reports?: ReportService,
    readonly projectAi?: ProjectAiSettingsService,
    /** Project conventions for coding agents (D25), saved as Project settings does. */
    readonly conventions?: {
      update(projectId: string, text: string): string
      /** Lessons (N9.6a), checked by `src/shared/project-lessons.ts` as Project settings is. */
      addLesson?(projectId: string, text: unknown): ProjectLesson
      updateLesson?(
        projectId: string,
        lessonId: string,
        changes: { text?: unknown; enabled?: unknown }
      ): ProjectLesson
      removeLesson?(projectId: string, lessonId: string): void
    },
    /** How a new agent workspace is prepared (Project settings › Agents), validated as the settings dialog validates it. */
    readonly workspaceSetup?: {
      update(projectId: string, value: unknown): AgentSetupSetting
    },
    /** The agent event stream and guidance to running runs (D41). */
    readonly agentRuns?: {
      events: AgentEventStream
      sendGuidance(
        project: WatchedProject,
        sessionId: string,
        text: string
      ): Promise<HarnessGuidance>
    }
  ) {}

  start(port: number): void {
    this.stop()
    this.port = port
    this.server = createServer((req, res) =>
      this.handle(req, res).catch((error: unknown) => {
        logRouteFailure(
          'Automation API',
          `${req.method ?? 'GET'} ${(req.url ?? '/').split('?')[0]}`,
          error
        )
        respondJson(res, 500, { ok: false, error: 'Internal server error' })
      })
    )
    // An in-use port must disable the automation API, not crash Ostler.
    this.server.on('error', (error) => {
      console.error(
        `[AutomationHttpServer] Could not listen on 127.0.0.1:${port}: ${error.message}. ` +
          'The automation API is unavailable until this is resolved.'
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
    this.port = null
  }

  /**
   * Runs one route in-process, exactly as a request over HTTP would run it:
   * the same token check, validation, refusals and audit. This is how an MCP
   * tool call reaches the API (D39).
   */
  async invokeRoute(
    projectId: string,
    token: string,
    request: McpRouteRequest
  ): Promise<CapturedRouteResponse> {
    const search = new URLSearchParams(request.query).toString()
    const url = `/automation/${encodeURIComponent(projectId)}${request.path}${search ? `?${search}` : ''}`
    const body =
      request.body === undefined ? [] : [Buffer.from(JSON.stringify(request.body), 'utf8')]
    const req = Object.assign(Readable.from(body), {
      method: request.method,
      url,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
    }) as unknown as IncomingMessage
    const res = new CapturedResponse()
    try {
      await this.handle(req, res as unknown as ServerResponse)
    } catch (error) {
      logRouteFailure('Automation API', `MCP ${request.method} ${request.path}`, error)
      respondJson(res as unknown as ServerResponse, 500, {
        ok: false,
        error: 'Internal server error'
      })
    }
    if (res.writableEnded && !res.writableFinished)
      await new Promise((resolve) => res.once('finish', resolve))
    return res.captured()
  }

  /** POST /automation/:projectId/mcp: the project's MCP endpoint (D39). */
  private async handleMcp(
    req: IncomingMessage,
    res: ServerResponse,
    project: WatchedProject
  ): Promise<void> {
    const refusal = mcpRequestRefusal(req, this.port)
    if (refusal) return respondJson(res, 403, { ok: false, error: refusal })
    const token = bearerToken(req)
    if (!project.automationToken || token !== project.automationToken) {
      return respondJson(res, 401, { ok: false, error: 'Invalid or missing automation token' })
    }
    // Stateless: there is no session to stream to or end.
    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST', 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Method not allowed: send MCP messages with POST' },
          id: null
        })
      )
      return
    }
    let body: unknown
    try {
      body = await readJsonValue(req, IMPORT_MAX_BODY_BYTES)
    } catch (error) {
      return respondJson(res, 400, {
        jsonrpc: '2.0',
        error: { code: -32700, message: error instanceof Error ? error.message : 'Parse error' },
        id: null
      })
    }
    const server = createMcpServer({
      projectId: project.id,
      tools: MCP_TOOLS,
      invoke: (request) => this.invokeRoute(project.id, token, request),
      version: this.mcpVersion,
      maximumFileBytes: LIBRARY_MAX_FILE_BYTES
    })
    await serveMcpHttp(req, res, body, server)
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts[0] !== 'automation' || !parts[1])
      return respondJson(res, 404, { ok: false, error: 'Unknown route' })
    const projects = this.getProjects()
    if (req.method === 'GET' && parts[1] === 'projects' && parts.length === 2) {
      const token = bearerToken(req)
      if (!token || !projects.some((project) => project.automationToken === token)) {
        return respondJson(res, 401, { ok: false, error: 'Invalid or missing automation token' })
      }
      return respondJson(res, 200, {
        ok: true,
        value: projects.map((entry) => ({
          id: entry.id,
          name: entry.name,
          enabled: entry.enabled,
          hasFolder: projectFolder(entry) !== null,
          automationTokenConfigured: Boolean(entry.automationToken),
          areaId: entry.areaId ?? null,
          icon: entry.icon ?? null,
          stage: normalizeProjectStage(entry.stage)
        }))
      })
    }
    if (req.method === 'GET' && parts[1] === 'areas' && parts.length === 2) {
      const token = bearerToken(req)
      if (!token || !projects.some((project) => project.automationToken === token)) {
        return respondJson(res, 401, { ok: false, error: 'Invalid or missing automation token' })
      }
      return respondJson(res, 200, { ok: true, value: this.appearance?.areas() ?? [] })
    }
    const project = projects.find((p) => p.id === parts[1])
    if (!project) return respondJson(res, 404, { ok: false, error: 'Unknown project' })
    if (parts[2] === 'mcp' && parts.length === 3) return this.handleMcp(req, res, project)
    const isHelp = req.method === 'GET' && parts.slice(2).join('/') === 'help'
    const token = bearerToken(req)
    if (!isHelp && (!project.automationToken || token !== project.automationToken)) {
      return respondJson(res, 401, { ok: false, error: 'Invalid or missing automation token' })
    }
    if (isHelp) return respondJson(res, 200, { ok: true, value: buildHelp(project.id) })
    if (!project.enabled && req.method !== 'GET') {
      return respondJson(res, 403, {
        ok: false,
        error: 'Project is disabled; automation cannot modify it'
      })
    }
    if (AGENT_WORK_RESOURCES.has(parts[2] ?? '') && !this.agentsOn()) {
      return respondJson(res, 409, {
        ok: false,
        error:
          'AI agents are off in Ostler, so routes about agent work are unavailable. Only the human can turn agents on, in Settings › Agents.'
      })
    }
    try {
      const resource = parts[2]
      const id = parts[3]
      const action = parts[4]
      // Uploads carry base64 (4/3 of the 25 MB file cap); everything else stays small.
      const isUpload = req.method === 'POST' && resource === 'library' && id === 'upload'
      // An import carries its CSV text (up to 50 MB, as from a file).
      const isImport = req.method === 'POST' && resource === 'import'
      // A project file is the request body itself, streamed to disk by the import.
      const isProjectFile = isImport && id === 'project'
      const matched = matchRoute(ROUTES, req.method ?? 'GET', parts.slice(2))
      const body = isProjectFile
        ? {}
        : await readJsonRecord(
            req,
            matched?.route.maxBodyBytes ??
              (isUpload
                ? Math.ceil((LIBRARY_MAX_FILE_BYTES * 4) / 3) + 64 * 1024
                : isImport
                  ? IMPORT_MAX_BODY_BYTES
                  : undefined)
          )
      if (matched?.route.handler) {
        return await matched.route.handler({
          server: this,
          req,
          res,
          project,
          path: `/${parts.slice(2).join('/')}`,
          params: matched.params,
          query: url.searchParams,
          body
        })
      }
      if (routeOwns(ROUTES, parts.slice(2)))
        return respondJson(res, 404, { ok: false, error: 'Unknown route' })
      if (resource === 'import' || resource === 'export') {
        return await this.handleImportExport(req, res, project, parts, body)
      }
      if (
        resource === 'library' ||
        (resource === 'work-items' && (action === 'sources' || action === 'attachments'))
      ) {
        return await this.handleLibrary(req, res, project, parts, body)
      }
      if (resource === 'templates') {
        return await this.handleTemplates(req, res, project, parts, body)
      }
      if (req.method === 'GET' && resource === 'status' && !id && !action) {
        return respondJson(res, 200, { ok: true, value: await this.getStatus(project) })
      }
      if (req.method === 'GET' && resource === 'report' && !id && !action) {
        if (!this.harness) throw new Error('Harness API unavailable')
        return respondJson(res, 200, { ok: true, value: this.harness.getReport(project) })
      }
      if (req.method === 'GET' && resource === 'tasks' && !id && !action) {
        if (!this.harness) throw new Error('Harness API unavailable')
        return respondJson(res, 200, { ok: true, value: this.harness.getState(project).taskQueue })
      }
      if (this.harness && resource === 'tasks' && parts.length <= 5) {
        let value: unknown
        if (req.method === 'POST' && !id && !action) {
          if (!this.planning) throw new Error('Planning API unavailable')
          // Same path and the same rule as the desktop app and auto-queue: every
          // task is a work item, so it is a card on the Board, and work may be
          // queued before its dependencies land -- the queue holds it until they
          // merge. Refusing that here alone meant an API driver could not queue
          // a plan, only poll and queue each item as the one before it merged.
          const workItemId = typeof body?.workItemId === 'string' ? body.workItemId : null
          // Checked before anything is queued or created, so a refused model
          // leaves nothing behind.
          const runChoice = await this.runChoiceFrom(project, body)
          value = (
            workItemId
              ? queueWorkItemForHarness(this.planning, this.harness, project, workItemId, {
                  allowUnmetDependencies: true,
                  attachments: this.agentAttachmentsFor(project.id, workItemId),
                  runChoice
                })
              : queueNewTask(
                  this.planning,
                  this.harness,
                  project,
                  {
                    title: body.title as string,
                    details: (body.description ?? body.details ?? '') as string,
                    priority: (body.priority ?? 'medium') as PlanningPriority,
                    runChoice
                  },
                  AUTOMATION_ACTOR
                )
          ).task
        } else if (req.method === 'POST' && id === 'reorder' && !action) {
          value = this.harness.reorderPendingTasks(
            project,
            (body.taskIds ?? body.orderedTaskIds) as string[]
          )
        } else if (req.method === 'PATCH' && id && action === 'priority') {
          const linkedWorkItem = this.planning
            ?.listWorkItems(project.id)
            .find((item) => item.linkedHarnessTaskId === id)
          const priority = body.priority as PlanningPriority
          value = this.harness.setTaskPriority(project, id, priority, linkedWorkItem?.id ?? null)
          if (linkedWorkItem)
            this.planning!.updateWorkItem(linkedWorkItem.id, { priority }, AUTOMATION_ACTOR)
        } else if (req.method === 'POST' && id && action === 'start-embedded') {
          if (!this.startEmbeddedTask) throw new Error('Embedded runner unavailable')
          requireProjectFolder(project, 'Starting an agent session')
          value = await this.startEmbeddedTask(project, id)
        } else if (req.method === 'PATCH' && id && action === 'model') {
          value = this.harness.setTaskRunModel(
            project,
            id,
            await validateAgentRunChoice(this.requireConfig(), project, body)
          )
        } else if (req.method === 'POST' && id && action === 'hold') {
          if (typeof body.hold !== 'boolean') throw new Refusal('hold must be true or false')
          value = this.harness.setTaskHold(project, id, body.hold)
        } else if (
          (req.method === 'POST' && id && action === 'cancel') ||
          (req.method === 'DELETE' && id && !action)
        ) {
          // Same as the desktop Cancel: only an unreserved queued task, and a
          // linked work item's handoff is cleared so it can be queued again.
          const linked = this.linkedWorkItem(project, id)
          const task = this.harness.cancelTask(project, id, linked?.id ?? null)
          const workItem = linked
            ? this.planning!.clearHarnessHandoff(project.id, linked.id, id)
            : null
          value = { task, workItem }
        } else {
          value = undefined
        }
        if (value !== undefined) {
          this.recordMutation(
            project,
            `/${parts.slice(2).join('/')}`,
            `automation-api task ${(req.method ?? '').toLowerCase()}`
          )
          this.onHarnessStateChange?.(project)
          return respondJson(res, 200, { ok: true, value })
        }
      }
      if (resource === 'events' && !id && req.method === 'GET') {
        return await this.handleEvents(req, res, project)
      }
      if (resource === 'agent-runs' && !id && !action && req.method === 'GET') {
        if (!this.harness) throw new Error('Harness API unavailable')
        const params = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams
        const filter = {
          outcome: params.get('outcome') ?? undefined,
          model: params.get('model') ?? undefined,
          from: params.get('from') ?? undefined,
          to: params.get('to') ?? undefined
        }
        if (params.get('format') === 'csv') {
          const text = await this.harness.getRunHistoryCsv(project, filter)
          res.writeHead(200, {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Length': Buffer.byteLength(text)
          })
          res.end(text)
          return
        }
        return respondJson(res, 200, {
          ok: true,
          value: await this.harness.getRunHistory(project, filter)
        })
      }
      if (resource === 'agent-usage' && !id && !action) {
        if (!this.harness) throw new Error('Harness API unavailable')
        if (req.method !== 'GET') {
          return respondJson(res, 405, {
            ok: false,
            error:
              'Token limits are read only through the API: the person sets them in Project settings › Agents.'
          })
        }
        return respondJson(res, 200, {
          ok: true,
          value: {
            ...this.harness.getAgentUsage(project),
            limits: normalizeAgentLimits(project.agentLimits)
          }
        })
      }
      if (resource === 'sessions' && id && action === 'guidance' && parts.length === 5) {
        return await this.handleGuidance(req, res, project, id, body)
      }
      if (resource === 'sessions') {
        if (!this.harness) throw new Error('Harness API unavailable')
        if (req.method === 'GET' && !id && !action) {
          const state = this.harness.getState(project)
          // A session's report is on the last task it completed (N9.1).
          // Drafts ride on the session (reviewDrafts); the comments its task was
          // last sent back with are lastReviewComments (N9.2a).
          // Answers to those comments ride on the report (N9.2b), with the
          // alerts the app shows next to Apply.
          const withReport = (session: HarnessSession) => {
            const report =
              state.taskQueue.filter((task) => task.claimedBy === session.id && task.report).at(-1)
                ?.report ?? null
            const rejections = state.taskQueue.find(
              (task) => task.id === session.taskId
            )?.rejections
            const lastReviewComments = latestReviewComments(rejections)
            // Only a report that came after the last Send back answers its comments.
            const answering =
              report && report.submittedAt >= (rejections?.at(-1)?.rejectedAt ?? '') ? report : null
            return {
              ...session,
              report,
              openFindings: openFindings(session),
              lastReviewComments,
              commentAnswerAlerts: answering
                ? commentAnswerAlerts(lastReviewComments, answering)
                : []
            }
          }
          const value = {
            active: state.activeSessions.map(withReport),
            review: state.reviewSessions.map(withReport)
          }
          return respondJson(res, 200, { ok: true, value })
        }
        if (req.method === 'GET' && id && action === 'pictures' && parts.length === 6) {
          const picture = this.harness.readReportPicture(project, id, parts[5])
          if (!picture) {
            return respondJson(res, 404, { ok: false, error: 'No such picture in this session' })
          }
          res.writeHead(200, {
            'Content-Type': picture.mimeType,
            'Content-Length': picture.bytes.length,
            'X-Content-Type-Options': 'nosniff'
          })
          res.end(picture.bytes)
          return
        }
        if (req.method === 'GET' && id && action === 'transcript' && parts.length === 5) {
          if (!this.getSessionTranscript) throw new Error('Session transcripts unavailable')
          return respondJson(res, 200, {
            ok: true,
            value: await this.getSessionTranscript(project, id)
          })
        }
        if (id && action === 'plan') {
          return await this.handlePlan(req, res, project, id, parts[5], body)
        }
        if (req.method === 'POST' && id && action === 'review' && parts.length === 5) {
          const task = await this.harness.startReview(project, id)
          this.recordMutation(
            project,
            `/${parts.slice(2).join('/')}`,
            'automation-api session review'
          )
          this.onHarnessStateChange?.(project)
          return respondJson(res, 200, { ok: true, value: task })
        }
        if (req.method === 'POST' && id && action === 'stop' && parts.length === 5) {
          if (!this.stopEmbeddedSession) throw new Error('Embedded runner unavailable')
          const note = typeof body?.note === 'string' ? body.note.trim() : ''
          await this.stopEmbeddedSession(project, id, note || undefined)
          // A run waiting on its plan is cancelled at the plan (N9.3b).
          await this.harness.stopRun(project, id)
          this.recordMutation(
            project,
            `/${parts.slice(2).join('/')}`,
            'automation-api session stop'
          )
          this.onHarnessStateChange?.(project)
          return respondJson(res, 200, { ok: true, value: { sessionId: id, stopped: true } })
        }
        if (
          req.method === 'POST' &&
          id &&
          parts.length === 5 &&
          (action === 'apply' || action === 'discard' || action === 'send-back')
        ) {
          // Mirrors the desktop review actions, including keeping a linked
          // work item's status in step with what happened to the work.
          const taskIds = this.sessionTaskIds(project, id)
          let value: unknown
          if (action === 'apply') {
            const result = await this.harness.applyTaskWork(
              project,
              id,
              body?.onCurrentVersion === true
            )
            for (const taskId of taskIds) {
              const status = this.harness.workItemStatusForTask(project, taskId)
              if (status) this.syncLinkedWorkItem(project, taskId, status)
            }
            value = result
          } else if (action === 'discard') {
            value = await this.harness.discardTaskWork(project, id)
            for (const taskId of taskIds) {
              const status = this.harness.workItemStatusForTask(project, taskId)
              if (status) this.syncLinkedWorkItem(project, taskId, status)
            }
          } else {
            const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''
            const comments: unknown = body?.comments
            const hasComments = Array.isArray(comments) && comments.length > 0
            if (!reason && !hasComments)
              throw new Refusal('reason is required unless there are comments')
            const disposition = body?.disposition ?? 'retry'
            if (disposition !== 'retry' && disposition !== 'rework' && disposition !== 'hold')
              throw new Refusal('disposition must be "retry", "rework", or "hold"')
            const runAgainWith =
              body?.model !== undefined || body?.effort !== undefined
                ? await validateRunAgainChoice(this.requireConfig(), project, disposition, {
                    model: body.model,
                    effort: body.effort
                  })
                : undefined
            // Comments are checked, and their excerpts taken, by Send back itself.
            value = await this.harness.sendBackTaskWork(
              project,
              id,
              reason,
              disposition,
              runAgainWith,
              comments
            )
          }
          this.recordMutation(
            project,
            `/${parts.slice(2).join('/')}`,
            `automation-api session ${action}`
          )
          this.onHarnessStateChange?.(project)
          return respondJson(res, 200, { ok: true, value })
        }
      }
      if (resource === 'questions') {
        if (!this.harness) throw new Error('Harness API unavailable')
        if (req.method === 'GET' && !id && !action) {
          const status = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('status')
          const all = this.harness.getState(project).questions
          const value =
            status === 'pending' || status === 'answered'
              ? all.filter((question) => question.status === status)
              : all
          return respondJson(res, 200, { ok: true, value })
        }
        if (req.method === 'POST' && id && action === 'answer' && parts.length === 5) {
          if (!this.answerQuestion) throw new Error('Embedded runner unavailable')
          const answer = typeof body?.answer === 'string' ? body.answer.trim() : ''
          if (!answer) throw new Refusal('answer is required')
          const value = await this.answerQuestion(project, id, answer)
          this.recordMutation(
            project,
            `/${parts.slice(2).join('/')}`,
            'automation-api question answer'
          )
          this.onHarnessStateChange?.(project)
          return respondJson(res, 200, { ok: true, value })
        }
      }
      if (resource === 'briefing' && !id && !action) {
        if (req.method !== 'GET')
          return respondJson(res, 405, { ok: false, error: 'The briefing is read only.' })
        if (!this.getBriefing) throw new Error('Briefing unavailable')
        const raw = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('since')
        const since = raw !== null && /^\d{1,16}$/.test(raw) ? Number(raw) : NaN
        if (!Number.isSafeInteger(since))
          throw new Refusal('since must be a time in milliseconds, such as ?since=1760000000000')
        const until = Date.now()
        return respondJson(res, 200, {
          ok: true,
          value: { since, until, project: this.getBriefing(project, since, until) }
        })
      }
      if ((resource === 'progress' || resource === 'year-in-review') && !id && !action) {
        if (req.method !== 'GET')
          return respondJson(res, 405, { ok: false, error: 'Progress is read only.' })
        if (!this.progress) throw new Error('Progress unavailable')
        const params = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams
        const rawWeekStart = params.get('weekStart')
        const weekStart =
          rawWeekStart === null ? 1 : /^\d$/.test(rawWeekStart) ? Number(rawWeekStart) : NaN
        if (!isProgressWeekStart(weekStart))
          throw new Refusal('weekStart must be a weekday number, 0 (Sunday) to 6 (Saturday)')
        if (resource === 'progress') {
          const from = params.get('from') ?? ''
          const to = params.get('to') ?? ''
          return respondJson(res, 200, {
            ok: true,
            value: {
              from,
              to,
              weekStart,
              weeks: this.progress.weeks(project.id, from, to, weekStart)
            }
          })
        }
        const rawYear = params.get('year')
        const year = rawYear !== null && /^\d{4}$/.test(rawYear) ? Number(rawYear) : NaN
        if (!Number.isInteger(year)) throw new Refusal('year must be a year such as ?year=2026')
        return respondJson(res, 200, {
          ok: true,
          value: this.progress.year({ year, weekStart }, [project.id])
        })
      }
      if (!this.planning)
        return respondJson(res, 500, { ok: false, error: 'Planning API unavailable' })
      if (
        resource === 'activity' ||
        resource === 'comments' ||
        (resource === 'work-items' && (action === 'comments' || action === 'activity'))
      ) {
        return await this.handleActivity(req, res, project, parts, body)
      }
      if (resource === 'work-items' && (action === 'recurrence' || action === 'reminders')) {
        return this.handleRepeatAndReminders(req, res, project, parts, body)
      }
      if (
        resource === 'work-items' &&
        id &&
        (action === 'links' || action === 'duplicate-of' || action === 'copy')
      ) {
        return this.handleLinks(req, res, project, parts, body)
      }
      if (resource === 'work-items' && id && action === 'description-versions') {
        // Description history (N2.6): read here; restoring is a PATCH of the description.
        if (req.method !== 'GET' || parts.length > 5)
          return respondJson(res, 404, { ok: false, error: 'Unknown route' })
        if (this.planning.getWorkItem(id).projectId !== project.id)
          throw new Refusal('Planning work item belongs to another project')
        return respondJson(res, 200, {
          ok: true,
          value: this.planning.listDescriptionVersions(id)
        })
      }
      if (req.method === 'GET' && resource === 'task-templates' && !id)
        return respondJson(res, 200, {
          ok: true,
          value: this.planning.taskTemplates.listForProject(project.id)
        })
      if (resource === 'search' || resource === 'views') {
        return this.handleSearchAndViews(req, res, project, parts, body)
      }
      if (req.method === 'GET' && resource === 'links' && !id) {
        const params = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams
        const [kind, targetId] = (params.get('to') ?? '').split(':')
        if (!kind || !targetId)
          throw new Refusal('Send ?to=<kind>:<id>, kind one of task, milestone, decision, library')
        return respondJson(res, 200, {
          ok: true,
          value: this.planning.listLinkedFrom(kind, targetId, project.id)
        })
      }
      if (req.method === 'GET' && resource === 'work-items' && id === 'by-key' && action) {
        // A task by its ID (N9.8a): this project's prefix and the task's number.
        const parsed = parseTaskKey(safeDecode(action))
        if (!parsed || parsed.prefix !== project.taskPrefix)
          return respondJson(res, 404, {
            ok: false,
            error: `No task of this project has that ID; its IDs start with ${project.taskPrefix ?? '?'}-`
          })
        const found = this.planning.findWorkItemByNumber(project.id, parsed.number)
        if (!found) return respondJson(res, 404, { ok: false, error: 'No task has that ID' })
        const harness = this.harness?.getState(project)
        return respondJson(res, 200, {
          ok: true,
          value: { ...found, status: projectWorkItemStatus(found, harness) }
        })
      }
      if (req.method === 'GET' && resource === 'work-items' && !id) {
        const params = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams
        const scope = params.get('scope')
        const items = this.withLinkedFrom(
          project,
          'task',
          params,
          this.projectedWorkItems(
            project,
            scope === 'archived' || scope === 'deleted' || scope === 'triage' ? scope : 'live'
          )
        )
        const filterText = params.get('filter')
        if (filterText === null) return respondJson(res, 200, { ok: true, value: items })
        let raw: unknown
        try {
          raw = JSON.parse(filterText)
        } catch {
          throw new Refusal(
            'filter must be URL-encoded JSON, for example {"conditions":[{"field":"due","op":"is","value":"overdue"}]}'
          )
        }
        const filter = parseTaskFilter(raw)
        // Statuses here are already the projected ones, as the app shows them.
        const context = this.planning.taskFilterContext(project.id)
        return respondJson(res, 200, {
          ok: true,
          value: items.filter((item) => matchesFilter(item, filter, context))
        })
      }
      if (req.method === 'GET' && resource === 'reports' && !id) {
        if (!this.reports)
          return respondJson(res, 503, { ok: false, error: 'Reports are unavailable' })
        const query = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams
        const splitBy = query.get('splitBy')
        if (splitBy !== null && splitBy !== 'type')
          return respondJson(res, 400, { ok: false, error: 'splitBy must be "type"' })
        const report = this.reports.getReport(project, query.get('range') ?? undefined)
        // Split by type (N2.7b) only when asked: the same report the Overview reads.
        return respondJson(res, 200, {
          ok: true,
          value: splitBy === 'type' ? withTypeSplit(report) : withoutTypeSplit(report)
        })
      }
      if (req.method === 'GET' && resource === 'dependency-conflicts' && !id)
        return respondJson(res, 200, {
          ok: true,
          value: dependencyConflicts(this.projectedWorkItems(project, 'live'))
        })
      if (req.method === 'GET' && resource === 'critical-path' && !id) {
        const milestoneId = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get(
          'milestoneId'
        )
        const milestone = milestoneId
          ? this.planning.listMilestones(project.id).find((item) => item.id === milestoneId)
          : null
        if (milestoneId && !milestone)
          return respondJson(res, 404, { ok: false, error: 'Planning milestone not found' })
        return respondJson(res, 200, {
          ok: true,
          value: criticalPath(this.projectedWorkItems(project, 'live'), milestone ?? null)
        })
      }
      if (req.method === 'GET' && resource === 'blockers' && !id)
        return respondJson(res, 200, {
          ok: true,
          value: this.planning.listOpenBlockers(project.id)
        })
      let value: unknown
      if (req.method === 'POST' && resource === 'work-items' && id === 'batch' && !action) {
        // A whole plan: one transaction, refused as a whole. ?dryRun=1 only checks it.
        const rows = batchRowsFrom(body.items)
        const dryRun = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('dryRun')
        if (dryRun === '1' || dryRun === 'true') {
          const errors = checkWorkItemBatch(this.planning, project.id, rows, AUTOMATION_ACTOR)
          value = { valid: errors.length === 0, errors }
        } else {
          value = createWorkItemBatch(this.planning, project.id, rows, AUTOMATION_ACTOR)
        }
      } else if (req.method === 'POST' && resource === 'work-items' && !id) {
        // triage: true asks for To triage (N4.3a); capture is not the caller's to name.
        const { triage, ...input } = body
        delete input.capture
        if (triage !== undefined && typeof triage !== 'boolean')
          throw new Refusal('triage must be true or false')
        value = this.planning.createWorkItem(
          project.id,
          {
            ...(input as unknown as CreatePlanningWorkItemInput),
            ...(triage ? { capture: 'api' as const } : {})
          },
          AUTOMATION_ACTOR,
          'human'
        )
      } else if (
        req.method === 'POST' &&
        resource === 'work-items' &&
        id &&
        action === 'accept' &&
        parts.length === 5
      )
        value = acceptFromTriage(
          this.planning,
          project,
          id,
          readAcceptFields(body),
          AUTOMATION_ACTOR
        )
      else if (
        req.method === 'POST' &&
        resource === 'work-items' &&
        id &&
        action === 'move' &&
        parts.length === 5 &&
        body.projectId !== undefined
      ) {
        if (typeof body.projectId !== 'string') throw new Refusal('projectId must be a string')
        const toProject = this.getProjects().find((entry) => entry.id === body.projectId)
        if (!toProject) throw new Refusal('Project not found')
        value = await moveFromTriage(
          { planning: this.planning, library: this.library?.service ?? null },
          project,
          id,
          toProject,
          AUTOMATION_ACTOR
        )
        if (this.library) this.library.notify(toProject)
      } else if (req.method === 'PATCH' && resource === 'work-items' && id && !action) {
        const current = this.planning.getWorkItem(id)
        if (current.projectId !== project.id)
          throw new Refusal('Planning work item belongs to another project')
        value = this.updateWorkItem(project, current, body)
      } else if (req.method === 'DELETE' && resource === 'work-items' && id && !action) {
        const permanent =
          new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('permanent') === 'true'
        if (permanent) {
          // Only from the recycle bin, so one call can never skip it.
          deleteWorkItemForever(this.planning, project, id, AUTOMATION_ACTOR)
          value = { id, deleted: true, permanent: true }
        } else {
          // The same rule the desktop UI uses (see planning-deletion.ts): work
          // still queued, running or in review blocks it; otherwise the item
          // goes to the recycle bin.
          const { clearedHandoff } = deleteWorkItem(
            this.planning,
            this.harness,
            project,
            id,
            AUTOMATION_ACTOR
          )
          if (clearedHandoff) this.onHarnessStateChange?.(project)
          value = { id, deleted: true, permanent: false }
        }
      } else if (
        req.method === 'POST' &&
        resource === 'work-items' &&
        id &&
        parts.length === 5 &&
        (action === 'archive' ||
          action === 'unarchive' ||
          action === 'restore' ||
          action === 'wont-do')
      ) {
        if (action === 'archive') {
          value = archiveWorkItem(this.planning, this.harness, project, id, AUTOMATION_ACTOR)
        } else if (action === 'wont-do') {
          // The same rule the app uses (planning-deletion.ts).
          const result = closeAsWontDo(
            this.planning,
            this.harness,
            project,
            id,
            AUTOMATION_ACTOR,
            wontDoOptions(body)
          )
          if (result.cancelledTask) this.onHarnessStateChange?.(project)
          value = result
        } else {
          if (this.planning.getWorkItem(id).projectId !== project.id)
            throw new Refusal('Planning work item belongs to another project')
          value =
            action === 'unarchive'
              ? this.planning.unarchiveWorkItem(id, AUTOMATION_ACTOR)
              : this.planning.restoreWorkItem(id, AUTOMATION_ACTOR)
        }
      } else if (
        req.method === 'POST' &&
        resource === 'work-items' &&
        id &&
        action === 'move' &&
        parts.length === 5
      ) {
        if (this.planning.getWorkItem(id).projectId !== project.id)
          throw new Refusal('Planning work item belongs to another project')
        const placement: PlanningWorkItemPlacement = {}
        for (const field of ['beforeId', 'afterId', 'position', 'status', 'columnId'] as const) {
          const given = body[field]
          if (given === undefined || given === null) continue
          if (typeof given !== 'string') throw new Refusal(`${field} must be a string`)
          ;(placement as Record<string, string>)[field] = given
        }
        const current = this.planning.getWorkItem(id)
        const { status, ...place } = placement
        const planning = this.planning
        value =
          current.linkedHarnessTaskId && status !== undefined
            ? updateWorkItemThroughQueue(
                planning,
                this.harness,
                project,
                id,
                { status: status as PlanningWorkItemStatus },
                AUTOMATION_ACTOR,
                (updates) =>
                  planning.moveWorkItemInOrder(
                    id,
                    {
                      ...place,
                      ...(updates.status !== undefined ? { status: updates.status } : {})
                    },
                    AUTOMATION_ACTOR
                  )
              )
            : planning.moveWorkItemInOrder(id, placement, AUTOMATION_ACTOR)
        if (current.linkedHarnessTaskId && status !== undefined)
          this.onHarnessStateChange?.(project)
      } else if (
        req.method === 'POST' &&
        resource === 'work-items' &&
        id &&
        action === 'checklist' &&
        parts.length === 5
      ) {
        if (this.planning.getWorkItem(id).projectId !== project.id)
          throw new Refusal('Planning work item belongs to another project')
        if (typeof body.text !== 'string') throw new Refusal('text is required')
        const { checked, dueDate, assigneeId, renameTo } = body
        if (checked !== undefined && typeof checked !== 'boolean')
          throw new Refusal('checked must be true or false')
        if (renameTo !== undefined && typeof renameTo !== 'string')
          throw new Refusal('renameTo must be text')
        if (
          checked === undefined &&
          dueDate === undefined &&
          assigneeId === undefined &&
          renameTo === undefined
        )
          throw new Refusal('Send checked, dueDate, assigneeId or renameTo')
        const workItemId = id
        const planning = this.planning
        // One item, one transaction (N2.2): rename first, so the rest reach the new text.
        value = planning.runInTransaction(() => {
          let text = body.text as string
          let item = planning.getWorkItem(workItemId)
          if (renameTo !== undefined) {
            item = planning.renameChecklistItem(workItemId, text, renameTo, AUTOMATION_ACTOR)
            text = renameTo.trim()
          }
          if (dueDate !== undefined || assigneeId !== undefined)
            item = planning.setChecklistItemDetails(
              workItemId,
              text,
              {
                ...(dueDate !== undefined ? { dueDate: dueDate as string | null } : {}),
                ...(assigneeId !== undefined ? { assigneeId: assigneeId as string | null } : {})
              },
              AUTOMATION_ACTOR
            )
          if (checked !== undefined)
            item = planning.setChecklistItemChecked(workItemId, text, checked, AUTOMATION_ACTOR)
          return item
        })
      } else if (resource === 'task-templates' && parts.length <= 5) {
        // Task templates (N2.1): the same store and checks as the app.
        value = await this.handleTaskTemplates(req.method ?? 'GET', project, id, action, body)
        if (value === undefined) return respondJson(res, 404, { ok: false, error: 'Unknown route' })
      } else if (req.method === 'POST' && resource === 'blockers' && !id) {
        const workItemId = body.workItemId as string
        const current = this.planning.getWorkItem(workItemId)
        if (current.projectId !== project.id)
          throw new Refusal('Planning work item belongs to another project')
        const resolutionOptions = Array.isArray(body.resolutionOptions)
          ? body.resolutionOptions.filter((option): option is string => typeof option === 'string')
          : []
        value = this.planning.reportBlocker(
          workItemId,
          body.description as string,
          'agent',
          resolutionOptions
        )
      } else if (
        req.method === 'POST' &&
        resource === 'blockers' &&
        id &&
        action === 'resolve' &&
        parts.length === 5
      ) {
        value = this.planning.resolveBlocker(
          id,
          body.choice as string,
          (body.note ?? '') as string,
          'automation-api'
        )
        this.onHarnessStateChange?.(project)
      } else return respondJson(res, 404, { ok: false, error: 'Unknown route' })
      if (req.method === 'POST' || req.method === 'PATCH' || req.method === 'DELETE') {
        this.recordMutation(
          project,
          `/${parts.slice(2).join('/')}`,
          `${req.method} planning ${resource}`
        )
        // The Board refreshes on this push rather than on a poll.
        this.onPlanningChange?.(project)
      }
      return respondJson(res, 200, { ok: true, value })
    } catch (error) {
      // A folder route on a project without a folder is a conflict with the
      // project's state, not a malformed request.
      logRouteFailure(
        'Automation API',
        `${req.method ?? 'GET'} /${parts.slice(2).join('/')}`,
        error
      )
      return respondJson(
        res,
        isFolderRequiredError(error) ? 409 : 400,
        error instanceof Error ? routeFailureBody(error) : { ok: false, error: 'Invalid request' }
      )
    }
  }

  /**
   * GET /events (D41): the project's agent events after `since`, at once, or
   * after waiting up to `wait` seconds for one. Ends early when the server
   * stops or the client goes away.
   */
  private async handleEvents(
    req: IncomingMessage,
    res: ServerResponse,
    project: WatchedProject
  ): Promise<void> {
    if (!this.agentRuns) throw new Error('Agent events unavailable')
    const { since, wait } = parseEventQuery(
      new URL(req.url ?? '/', 'http://127.0.0.1').searchParams
    )
    const clientGone = new AbortController()
    res.once('close', () => clientGone.abort())
    try {
      const value = await this.agentRuns.events.wait(
        project.id,
        since,
        wait,
        () => true,
        project.automationToken ?? '',
        AbortSignal.any([this.running.signal, clientGone.signal])
      )
      return respondJson(res, 200, { ok: true, value })
    } catch (error) {
      if (!(error instanceof EventWaitLimitError)) throw error
      logRouteFailure('Automation API', 'GET /events', error)
      return respondJson(res, 429, { ok: false, error: error.message })
    }
  }

  /**
   * Guidance to a running run on the person's behalf (D41): the same path as
   * the app's Send guidance, labelled with the person's name.
   */
  private async handleGuidance(
    req: IncomingMessage,
    res: ServerResponse,
    project: WatchedProject,
    sessionId: string,
    body: Record<string, unknown>
  ): Promise<void> {
    if (!this.agentRuns || !this.harness) throw new Error('Agent runs unavailable')
    if (req.method === 'GET') {
      const value = (this.harness.getState(project).guidance ?? []).filter(
        (entry) => entry.sessionId === sessionId
      )
      return respondJson(res, 200, { ok: true, value })
    }
    if (req.method !== 'POST') return respondJson(res, 404, { ok: false, error: 'Unknown route' })
    const text = typeof body?.text === 'string' ? body.text : ''
    try {
      const value = await this.agentRuns.sendGuidance(project, sessionId, text)
      this.recordMutation(
        project,
        `/sessions/${sessionId}/guidance`,
        'automation-api guidance sent'
      )
      this.onHarnessStateChange?.(project)
      return respondJson(res, 200, { ok: true, value })
    } catch (error) {
      if (!(error instanceof GuidanceRefusal)) throw error
      logRouteFailure('Automation API', 'POST /sessions/:sessionId/guidance', error)
      return respondJson(res, error.status, { ok: false, error: error.message })
    }
  }

  /**
   * Task templates (N2.1): this project's and every project's, through
   * `planning.taskTemplates` as the app does. `scope` is "project" (this
   * one) or "every". Returns undefined for a route that does not exist.
   */
  private async handleTaskTemplates(
    method: string,
    project: WatchedProject,
    id: string | undefined,
    action: string | undefined,
    body: Record<string, unknown>
  ): Promise<unknown> {
    const templates = this.planning!.taskTemplates
    // A playbook's agent part (N9.6b): its model and effort checked as Settings checks them.
    const agentScope = (projectId: string | null) => (projectId === null ? null : project)
    const scopeOf = (value: unknown): string | null | undefined => {
      if (value === undefined) return undefined
      if (value === 'project') return project.id
      if (value === 'every') return null
      throw new Refusal('scope must be "project" or "every"')
    }
    if (method === 'POST' && !id) {
      const replace = body.replace === true
      if (body.fromWorkItemId !== undefined) {
        if (typeof body.fromWorkItemId !== 'string')
          throw new Refusal('fromWorkItemId must be a task id')
        if (this.planning!.getWorkItem(body.fromWorkItemId).projectId !== project.id)
          throw new Refusal('Planning work item belongs to another project')
        if (body.keepDates !== undefined && typeof body.keepDates !== 'boolean')
          throw new Refusal('keepDates must be true or false')
        const every = scopeOf(body.scope) === null
        if (body.agent !== undefined)
          await validatePlaybookAgent(this.requireConfig(), every ? null : project, body.agent)
        return templates.saveFromWorkItem(body.fromWorkItemId, {
          name: typeof body.name === 'string' ? body.name : undefined,
          scope: every ? 'every' : 'project',
          keepDates: body.keepDates === true,
          replace,
          ...(body.agent !== undefined ? { agent: body.agent } : {})
        })
      }
      // "every" is null, so a left-out scope (undefined) alone means this project.
      const scoped = scopeOf(body.scope)
      const projectId = scoped === undefined ? project.id : scoped
      await checkTemplateBodyAgent(() => this.requireConfig(), agentScope(projectId), body.body)
      return templates.save({
        name: body.name as string,
        projectId,
        body: body.body,
        ...(body.playbook !== undefined ? { playbook: body.playbook as boolean } : {}),
        replace
      })
    }
    if (!id) return undefined
    if (method === 'POST' && action === 'use') {
      const overrides = body.overrides ?? {}
      if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides))
        throw new Refusal('overrides must be an object')
      return templates.use(project.id, id, AUTOMATION_ACTOR, overrides as TaskTemplateOverrides)
    }
    if (method === 'POST' && action === 'run') {
      // Run playbook (N9.6b): the same function as the app's Run.
      if (!this.harness) throw new Error('Harness API unavailable')
      return runPlaybook(
        {
          config: this.requireConfig(),
          planning: this.planning!,
          harness: this.harness,
          actor: AUTOMATION_ACTOR,
          attachmentsFor: (projectId, workItemId) => this.agentAttachmentsFor(projectId, workItemId)
        },
        project,
        id,
        body.overrides ?? {}
      )
    }
    if (action || (method !== 'PATCH' && method !== 'DELETE')) return undefined
    const current = templates.requireUsableIn(id, project.id)
    if (method === 'PATCH') {
      const projectId = body.scope !== undefined ? scopeOf(body.scope) : current.projectId
      if (body.body !== undefined)
        await checkTemplateBodyAgent(
          () => this.requireConfig(),
          agentScope(projectId ?? null),
          body.body
        )
      return templates.update(id, {
        ...(body.name !== undefined ? { name: body.name as string } : {}),
        ...(body.scope !== undefined ? { projectId: scopeOf(body.scope) } : {}),
        ...(body.body !== undefined ? { body: body.body } : {}),
        ...(body.playbook !== undefined ? { playbook: body.playbook as boolean } : {})
      })
    }
    if (method === 'DELETE') return templates.delete(id)
    return undefined
  }

  /**
   * Comments and activity (P5.2). The token acts for the human, so comments
   * written here are by `automation`. Coding agents have no comment routes.
   */
  /** A task's repeat rule and its reminders (P5.6), the same calls the drawer makes. */
  private handleRepeatAndReminders(
    req: IncomingMessage,
    res: ServerResponse,
    project: WatchedProject,
    parts: string[],
    body: Record<string, unknown> | null
  ): void {
    const planning = this.planning!
    const [, , , id, action, extra] = parts
    const stopRoute = parts.length === 7 && action === 'reminders' && parts[6] === 'stop'
    if (parts.length > 6 && !stopRoute)
      return respondJson(res, 404, { ok: false, error: 'Unknown route' })
    if (planning.getWorkItem(id).projectId !== project.id)
      throw new Refusal('Planning work item belongs to another project')
    let value: unknown
    let mutated = true
    if (action === 'recurrence' && !extra && req.method === 'GET') {
      value = planning.getRecurrence(id)
      mutated = false
    } else if (action === 'recurrence' && !extra && req.method === 'POST') {
      value = planning.setRecurrence(
        id,
        (body ?? {}) as unknown as PlanningRecurrenceInput,
        AUTOMATION_ACTOR
      )
    } else if (action === 'recurrence' && !extra && req.method === 'DELETE') {
      value = planning.setRecurrence(id, null, AUTOMATION_ACTOR)
    } else if (action === 'reminders' && !extra && req.method === 'GET') {
      value = planning.listReminders(id)
      mutated = false
    } else if (action === 'reminders' && !extra && req.method === 'POST') {
      const at = body?.remindAt
      const remindAt = typeof at === 'string' ? Date.parse(at) : at
      if (typeof remindAt !== 'number' || !Number.isFinite(remindAt))
        throw new Refusal('remindAt must be an ISO date and time, or milliseconds since 1970')
      value = planning.addReminder(id, Math.round(remindAt), reminderOptions(body))
    } else if (stopRoute && req.method === 'POST') {
      value = planning.stopReminder(id, extra)
    } else if (action === 'reminders' && extra && !stopRoute && req.method === 'DELETE') {
      planning.deleteReminder(id, extra)
      value = { id: extra, deleted: true }
    } else return respondJson(res, 404, { ok: false, error: 'Unknown route' })
    if (mutated) {
      this.recordMutation(
        project,
        `/${parts.slice(2).join('/')}`,
        `${req.method} work item ${action}`
      )
      this.onPlanningChange?.(project)
    }
    return respondJson(res, 200, { ok: true, value })
  }

  /**
   * Links between tasks (N2.4), Mark as duplicate and Copy task: the same
   * calls the drawer and the task menu make, so activity and rules see them.
   */
  private handleLinks(
    req: IncomingMessage,
    res: ServerResponse,
    project: WatchedProject,
    parts: string[],
    body: Record<string, unknown> | null
  ): void {
    const planning = this.planning!
    const [, , , id, action, extra] = parts
    if (parts.length > 6 || (extra && action !== 'links'))
      return respondJson(res, 404, { ok: false, error: 'Unknown route' })
    if (planning.getWorkItem(id).projectId !== project.id)
      throw new Refusal('Planning work item belongs to another project')
    let value: unknown
    let mutated = true
    if (action === 'links' && !extra && req.method === 'GET') {
      value = planning.listWorkItemLinks(id)
      mutated = false
    } else if (action === 'links' && !extra && req.method === 'POST') {
      value = planning.addWorkItemLink(id, body?.toWorkItemId, body?.kind, AUTOMATION_ACTOR)
    } else if (action === 'links' && extra && req.method === 'DELETE') {
      planning.removeWorkItemLink(id, extra, AUTOMATION_ACTOR)
      value = { id: extra, deleted: true }
    } else if (action === 'duplicate-of' && req.method === 'POST') {
      const cancelQueuedWork = body?.cancelQueuedWork
      if (cancelQueuedWork !== undefined && typeof cancelQueuedWork !== 'boolean')
        throw new Refusal('cancelQueuedWork must be true or false')
      // The same rule the app uses (planning-deletion.ts), so Won't do's refusals apply.
      const result = markAsDuplicate(
        planning,
        this.harness,
        project,
        id,
        body?.originalId,
        AUTOMATION_ACTOR,
        { cancelQueuedWork: cancelQueuedWork === true }
      )
      if (result.cancelledTask) this.onHarnessStateChange?.(project)
      value = result
    } else if (action === 'copy' && req.method === 'POST') {
      value = planning.copyWorkItem(id, AUTOMATION_ACTOR)
    } else return respondJson(res, 404, { ok: false, error: 'Unknown route' })
    if (mutated) {
      this.recordMutation(
        project,
        `/${parts.slice(2).join('/')}`,
        `${req.method} work item ${action}`
      )
      this.onPlanningChange?.(project)
    }
    return respondJson(res, 200, { ok: true, value })
  }

  private async handleActivity(
    req: IncomingMessage,
    res: ServerResponse,
    project: WatchedProject,
    parts: string[],
    body: Record<string, unknown>
  ): Promise<void> {
    const planning = this.planning!
    const [, , resource, id, action] = parts
    if (parts.length > 5) return respondJson(res, 404, { ok: false, error: 'Unknown route' })
    const search = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams
    const pageQuery = (): ActivityQuery => {
      const limit = search.get('limit')
      const filter = search.get('filter')
      return {
        ...(search.get('before') ? { before: search.get('before') as string } : {}),
        ...(limit !== null ? { limit: Number(limit) } : {}),
        ...(filter === 'comments' || filter === 'changes' ? { filter } : {})
      }
    }
    const ownWorkItem = (workItemId: string) => {
      if (planning.getWorkItem(workItemId).projectId !== project.id)
        throw new Refusal('Planning work item belongs to another project')
    }
    const ownComment = (commentId: string) => {
      if (planning.getComment(commentId).projectId !== project.id)
        throw new Refusal('Comment not found')
    }
    let value: unknown
    let mutated = true
    if (req.method === 'GET' && resource === 'activity' && !id) {
      value = planning.listProjectActivity(project.id, pageQuery())
      mutated = false
    } else if (req.method === 'GET' && resource === 'work-items' && id && action === 'activity') {
      ownWorkItem(id)
      value = planning.listActivity(project.id, id, pageQuery())
      mutated = false
    } else if (req.method === 'GET' && resource === 'work-items' && id && action === 'comments') {
      ownWorkItem(id)
      value = planning.listComments(id)
      mutated = false
    } else if (req.method === 'POST' && resource === 'work-items' && id && action === 'comments') {
      ownWorkItem(id)
      value = planning.addComment(id, body.body as string, AUTOMATION_ACTOR)
    } else if (req.method === 'PATCH' && resource === 'comments' && id && !action) {
      ownComment(id)
      value = planning.updateComment(id, body.body as string, AUTOMATION_ACTOR)
    } else if (req.method === 'DELETE' && resource === 'comments' && id && !action) {
      ownComment(id)
      value = planning.deleteComment(id, AUTOMATION_ACTOR)
    } else if (req.method === 'POST' && resource === 'comments' && id && action === 'restore') {
      ownComment(id)
      value = planning.restoreComment(id, AUTOMATION_ACTOR)
    } else return respondJson(res, 404, { ok: false, error: 'Unknown route' })
    if (mutated) {
      this.recordMutation(project, `/${parts.slice(2).join('/')}`, `${req.method} planning comment`)
      this.onPlanningChange?.(project)
    }
    return respondJson(res, 200, { ok: true, value })
  }

  /**
   * Search and saved views (P5.7): the same service calls the app makes, for
   * this project only.
   */
  private handleSearchAndViews(
    req: IncomingMessage,
    res: ServerResponse,
    project: WatchedProject,
    parts: string[],
    body: Record<string, unknown>
  ): void {
    const planning = this.planning!
    const [, , resource, id, action] = parts
    if (parts.length > 5) return respondJson(res, 404, { ok: false, error: 'Unknown route' })
    const params = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams
    if (resource === 'search') {
      if (req.method !== 'GET' || id)
        return respondJson(res, 404, { ok: false, error: 'Unknown route' })
      const query = params.get('q') ?? ''
      if (!query.trim()) throw new Refusal('Send the words to search for as ?q=')
      const typesText = params.get('types')
      const types = typesText ? typesText.split(',').map((type) => type.trim()) : undefined
      const unknown = types?.find((type) => !SEARCH_ENTITY_TYPES.includes(type as SearchEntityType))
      if (unknown)
        throw new Refusal(`Unknown type "${unknown}". Use: ${SEARCH_ENTITY_TYPES.join(', ')}`)
      const limitText = params.get('limit')
      const limit = limitText === null ? undefined : Number(limitText)
      if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 200))
        throw new Refusal('limit must be a whole number from 1 to 200')
      return respondJson(res, 200, {
        ok: true,
        value: planning.search.search(query, {
          projectId: project.id,
          types: types as SearchEntityType[] | undefined,
          limit,
          includeArchived: params.get('includeArchived') === 'true'
        })
      })
    }
    const views = planning.views
    const ownView = (viewId: string) => {
      const view = views.get(viewId)
      if (view.projectId !== project.id) throw new Refusal('Saved view not found')
      return view
    }
    if (req.method === 'GET' && !id) {
      const viewType = params.get('viewType')
      return respondJson(res, 200, {
        ok: true,
        value: views.list(project.id, (viewType ?? undefined) as SavedViewType | undefined)
      })
    }
    if (req.method === 'GET' && id && !action)
      return respondJson(res, 200, { ok: true, value: ownView(id) })
    let value: unknown
    if (req.method === 'POST' && !id) {
      value = views.create(project.id, body as never)
    } else if (req.method === 'PATCH' && id && !action) {
      ownView(id)
      const { name, config, position } = body
      if ([name, config, position].every((field) => field === undefined))
        throw new Refusal('Send at least one of: name, config, position')
      value = views.update(id, { name, config, position } as never)
    } else if (req.method === 'POST' && id && action === 'set-default') {
      const view = ownView(id)
      value = views.setDefault(project.id, view.viewType, view.config)
    } else if (req.method === 'DELETE' && id && !action) {
      ownView(id)
      value = views.delete(id)
    } else return respondJson(res, 404, { ok: false, error: 'Unknown route' })
    this.recordMutation(project, `/${parts.slice(2).join('/')}`, `${req.method} saved view`)
    this.onPlanningChange?.(project)
    return respondJson(res, 200, { ok: true, value })
  }

  /**
   * Pins (N5.2a): this project's overview pins and the sidebar pins that point
   * at its items, through the same service the app uses.
   */
  /**
   * Templates (P5.8): shared by every project, like people, so any project's
   * token may list and change them. Saving reads this project; creating from
   * a template makes a new project, exactly as the wizard does.
   */
  private async handleTemplates(
    req: IncomingMessage,
    res: ServerResponse,
    project: WatchedProject,
    parts: string[],
    body: Record<string, unknown>
  ): Promise<void> {
    if (!this.templates) throw new Error('Templates API unavailable')
    const templates = this.templates.service
    const [, , , id, action] = parts
    const done = (value: unknown, summary: string) => {
      this.recordMutation(project, `/${parts.slice(2).join('/')}`, `automation-api ${summary}`)
      return respondJson(res, 200, { ok: true, value })
    }
    if (req.method === 'GET' && !id) {
      return respondJson(res, 200, { ok: true, value: templates.listTemplates() })
    }
    if (req.method === 'POST' && !id) {
      const include = body.include
      return done(
        templates.saveProjectAsTemplate(project.id, {
          name: body.name as string,
          description: body.description as string | undefined,
          include:
            include && typeof include === 'object' && !Array.isArray(include)
              ? (include as Record<string, boolean>)
              : undefined,
          relativeDates: body.relativeDates !== false
        }),
        'save template'
      )
    }
    if (req.method === 'PATCH' && id && !action) {
      return done(templates.renameTemplate(id, body.name as string), 'rename template')
    }
    if (req.method === 'DELETE' && id && !action) {
      templates.deleteTemplate(id)
      return done({ id, deleted: true }, 'delete template')
    }
    if (req.method === 'POST' && id && action === 'create-project' && parts.length === 5) {
      const result = await templates.createProjectFromTemplate(id, {
        name: typeof body.name === 'string' ? body.name : undefined,
        color: typeof body.color === 'string' ? body.color : undefined
      })
      this.templates.projectCreated(result.project)
      return done(
        { id: result.project.id, name: result.project.name },
        'create project from template'
      )
    }
    return respondJson(res, 404, { ok: false, error: 'Unknown route' })
  }

  /**
   * Import and export (P6.1), with the app's own dry run, writer and undo:
   * `POST /import/csv` (CSV text and a mapping; `?dryRun=1` writes nothing),
   * `POST /import/project` (a project file, as a new project),
   * `DELETE /import/:batchId` (undo) and `GET /export?format=csv|package|file`.
   */
  private async handleImportExport(
    req: IncomingMessage,
    res: ServerResponse,
    project: WatchedProject,
    parts: string[],
    body: Record<string, unknown>
  ): Promise<void> {
    const [, , resource, id] = parts
    const query = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams
    if (resource === 'export' && req.method === 'GET' && !id) {
      const format = query.get('format') ?? 'csv'
      if (format === 'csv') {
        if (!this.planning) throw new Error('Planning API unavailable')
        const columns = query.get('columns')
        const { text } = buildTasksCsv(this.planning, project, {
          columns: columns ? columns.split(',').map((column) => column.trim()) : undefined
        })
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Length': Buffer.byteLength(text)
        })
        res.end(text)
        return
      }
      if (format === 'package') {
        if (!this.templates) throw new Error('Export unavailable')
        const value = this.templates.service.exportProjectAsPackage(project.id, {
          kind: 'export',
          relativeDates: false,
          include: { comments: query.get('comments') !== 'false' }
        })
        return respondJson(res, 200, { ok: true, value })
      }
      if (format === 'file') {
        if (!this.templates) throw new Error('Export unavailable')
        // The app's own project file (D29), written under the data folder, sent, then removed.
        const filePath = this.templates.service.exportProjectTemporaryFile(project.id, {
          comments: query.get('comments') !== 'false',
          password: filePasswordHeader(req)
        })
        try {
          res.writeHead(200, {
            'Content-Type': 'application/zip',
            'Content-Length': statSync(filePath).size,
            'Content-Disposition': `attachment; filename="project.ostler-project"; filename*=UTF-8''${encodeURIComponent(`${project.name}.ostler-project`)}`
          })
          await pipeline(createReadStream(filePath), res)
        } finally {
          rmSync(filePath, { force: true })
        }
        return
      }
      if (format === 'ics') {
        if (!this.planning) throw new Error('Planning API unavailable')
        // The app's own calendar file (D37): every dated task and milestone, finished ones on request.
        const { text } = buildProjectCalendarFile(this.planning, project, {
          includeFinished: queryFlag(query, 'includeFinished', false),
          includeBlocks: queryFlag(query, 'blocks', false)
        })
        res.writeHead(200, {
          'Content-Type': 'text/calendar; charset=utf-8',
          'Content-Length': Buffer.byteLength(text),
          'Content-Disposition': `attachment; filename="project.ics"; filename*=UTF-8''${encodeURIComponent(`${project.name}.ics`)}`
        })
        res.end(text)
        return
      }
      if (format === 'html') {
        if (!this.planning || !this.reports) throw new Error('Export unavailable')
        // The app's own shareable report (D37): one page, no scripts, no requests.
        const groupBy = query.get('groupBy')
        if (groupBy !== null && groupBy !== 'status' && groupBy !== 'milestone')
          throw new Refusal('groupBy must be status or milestone')
        const html = buildProjectShareReport(this.planning, this.reports, project, {
          descriptions: queryFlag(query, 'descriptions', false),
          decisions: queryFlag(query, 'decisions', false),
          finished: queryFlag(query, 'finished', true),
          people: queryFlag(query, 'people', true),
          groupBy: groupBy ?? 'status',
          statusUpdate: queryFlag(query, 'statusUpdate', false)
        })
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Length': Buffer.byteLength(html),
          'Content-Disposition': `attachment; filename="project.html"; filename*=UTF-8''${encodeURIComponent(`${project.name}.html`)}`
        })
        res.end(html)
        return
      }
      if (format === 'pptx') {
        if (!this.planning) throw new Error('Planning API unavailable')
        // The Timeline as editable PowerPoint slides (N54), in its rows and grouping.
        const groupBy = query.get('groupBy')
        if (
          groupBy !== null &&
          groupBy !== 'milestone' &&
          groupBy !== 'assignee' &&
          groupBy !== 'none'
        )
          throw new Refusal('groupBy must be milestone, assignee or none')
        const zoom = query.get('zoom')
        if (zoom !== null && zoom !== 'week' && zoom !== 'month' && zoom !== 'quarter')
          throw new Refusal('zoom must be week, month or quarter')
        let slides: ReturnType<typeof buildProjectTimelineSlides>
        try {
          slides = buildProjectTimelineSlides(this.planning, project, {
            from: query.get('from') ?? undefined,
            to: query.get('to') ?? undefined,
            groupBy: groupBy ?? undefined,
            zoom: zoom ?? undefined,
            includeFinished: queryFlag(query, 'includeFinished', false)
          })
        } catch (error) {
          throw new Refusal(error instanceof Error ? error.message : String(error))
        }
        res.writeHead(200, {
          'Content-Type': PPTX_CONTENT_TYPE,
          'Content-Length': slides.bytes.byteLength,
          'Content-Disposition': `attachment; filename="timeline.pptx"; filename*=UTF-8''${encodeURIComponent(`${project.name} timeline.pptx`)}`
        })
        res.end(Buffer.from(slides.bytes))
        return
      }
      throw new Refusal('format must be csv, package, file, ics, html or pptx')
    }
    if (resource !== 'import' || !this.imports)
      return respondJson(res, 404, { ok: false, error: 'Unknown route' })
    const imports = this.imports.service
    if (req.method === 'POST' && id === 'project' && parts.length === 4) {
      if (!this.templates) throw new Error('Import unavailable')
      const fileName = query.get('fileName')?.trim() || 'project.ostler-project'
      const file = await imports.readProjectFileStream(
        req,
        fileName,
        ARCHIVE_LIMITS.maxTotalBytes + PROTECTED_OVERHEAD_BYTES,
        filePasswordHeader(req)
      )
      const value = await imports.runImport(
        file.fileId,
        { kind: 'package' },
        { kind: 'new', name: query.get('name')?.trim() || undefined },
        AUTOMATION_ACTOR
      )
      const created = this.getProjects().find((entry) => entry.id === value.projectId)
      if (created) this.templates.projectCreated(created)
      this.recordMutation(project, '/import/project', 'automation-api import project file')
      return respondJson(res, 200, { ok: true, value })
    }
    if (req.method === 'POST' && id === 'csv' && parts.length === 4) {
      const dryRun = query.get('dryRun') === '1' || query.get('dryRun') === 'true'
      if (body.updateById === true) {
        // Edit in Excel's Bring changes back (N2.8): rows matched to tasks by their ID.
        const value = imports.updateCsvText(
          project.id,
          body.csv as string,
          typeof body.fileName === 'string' && body.fileName.trim()
            ? body.fileName.trim()
            : 'import.csv',
          {
            ...(Array.isArray(body.taskIds)
              ? { taskIds: body.taskIds.filter((entry) => typeof entry === 'string') }
              : {}),
            ...(Array.isArray(body.newLines)
              ? { newLines: body.newLines.filter((entry) => Number.isInteger(entry)) }
              : {})
          },
          dryRun,
          AUTOMATION_ACTOR
        )
        if (!dryRun) {
          this.recordMutation(project, '/import/csv', 'automation-api update csv by id')
          this.imports.changed(project)
        }
        return respondJson(res, 200, { ok: true, value })
      }
      const value = imports.importCsvText(
        project.id,
        body.csv as string,
        {
          ...csvOptionsFrom(body.mapping, typeof body.csv === 'string' ? body.csv : ''),
          ...csvPresetFrom(body.preset)
        },
        typeof body.fileName === 'string' && body.fileName.trim()
          ? body.fileName.trim()
          : 'import.csv',
        dryRun,
        AUTOMATION_ACTOR
      )
      if (!dryRun) {
        this.recordMutation(project, '/import/csv', 'automation-api import csv')
        this.imports.changed(project)
      }
      return respondJson(res, 200, { ok: true, value })
    }
    if (req.method === 'POST' && id === 'github' && parts.length === 4) {
      const dryRun = query.get('dryRun') === '1' || query.get('dryRun') === 'true'
      const value = await imports.importGithubIssues(
        project.id,
        {
          repository:
            typeof body.repository === 'string' && body.repository.trim()
              ? body.repository
              : (project.githubRepository ?? ''),
          state: body.state === 'all' ? 'all' : 'open',
          labels: Array.isArray(body.labels) ? (body.labels as string[]) : [],
          milestone: typeof body.milestone === 'string' ? body.milestone : ''
        },
        dryRun,
        AUTOMATION_ACTOR
      )
      if (!dryRun) {
        this.recordMutation(project, '/import/github', 'automation-api import GitHub issues')
        this.imports.changed(project)
      }
      return respondJson(res, 200, { ok: true, value })
    }
    if (req.method === 'DELETE' && id && parts.length === 4) {
      const batch = imports.listBatches().find((entry) => entry.id === id)
      if (!batch || batch.projectId !== project.id)
        return respondJson(res, 404, { ok: false, error: 'Import not found' })
      const includeChanged =
        query.get('includeChanged') === '1' || query.get('includeChanged') === 'true'
      const value = imports.undo(id, includeChanged, AUTOMATION_ACTOR)
      this.recordMutation(project, `/import/${id}`, 'automation-api undo import')
      this.imports.changed(project)
      return respondJson(res, 200, { ok: true, value })
    }
    return respondJson(res, 404, { ok: false, error: 'Unknown route' })
  }

  /** A work item's agent-visible attachments for its task text; queueing reports any bad id itself. */
  private requireConfig(): OstlerConfig {
    if (!this.getConfig) throw new Error('Agent settings unavailable')
    return this.getConfig()
  }

  /** A run's model and effort from a queueing body (D42), or none when it names neither. */
  private async runChoiceFrom(
    project: WatchedProject,
    body: Record<string, unknown> | undefined
  ): Promise<AgentRunChoice | undefined> {
    if (body?.model === undefined && body?.effort === undefined) return undefined
    return validateAgentRunChoice(this.requireConfig(), project, {
      model: body.model,
      effort: body.effort
    })
  }

  private agentAttachmentsFor(projectId: string, workItemId: string): WorkItemAttachment[] {
    try {
      return this.library?.service.agentAttachments(projectId, workItemId).given ?? []
    } catch {
      return []
    }
  }

  /**
   * Library and work item source routes. The automation token acts for the
   * human, so human-only items are listed too, each marked `humanOnly`. Nothing
   * here reaches the harness API.
   */
  private async handleLibrary(
    req: IncomingMessage,
    res: ServerResponse,
    project: WatchedProject,
    parts: string[],
    body: Record<string, unknown>
  ): Promise<void> {
    if (!this.library) throw new Error('Library API unavailable')
    const library = this.library.service
    const [, , resource, id, action, extra] = parts
    const route = `/${parts.slice(2).join('/')}`
    const mutated = (value: unknown): void => {
      this.recordMutation(
        project,
        route,
        `automation-api ${(req.method ?? '').toLowerCase()} ${resource}`
      )
      this.library!.notify(project)
      respondJson(res, 200, { ok: true, value })
    }

    if (resource === 'work-items' && action === 'attachments') {
      if (!id) throw new Refusal('Work item id is required')
      if (req.method === 'GET' && !extra) {
        return respondJson(res, 200, {
          ok: true,
          value: library.listWorkItemAttachments(project.id, id).map(markSource)
        })
      }
      if (req.method === 'POST' && !extra) {
        const itemId = typeof body.itemId === 'string' ? body.itemId : ''
        if (!itemId) throw new Refusal('itemId is required')
        return mutated(
          library.attachToWorkItem(project.id, id, itemId, 'automation').map(markSource)
        )
      }
      if (req.method === 'DELETE' && extra && parts.length === 6) {
        return mutated(library.detachFromWorkItem(project.id, id, extra).map(markSource))
      }
      return respondJson(res, 404, { ok: false, error: 'Unknown route' })
    }

    if (resource === 'work-items') {
      if (!id) throw new Refusal('Work item id is required')
      if (req.method === 'GET' && !extra) {
        return respondJson(res, 200, {
          ok: true,
          value: library.listWorkItemSources(project.id, id).map(markSource)
        })
      }
      if (req.method === 'POST' && !extra) {
        const itemId = typeof body.itemId === 'string' ? body.itemId : ''
        if (!itemId) throw new Refusal('itemId is required')
        return mutated(library.addWorkItemSource(project.id, id, itemId).map(markSource))
      }
      if (req.method === 'DELETE' && extra && parts.length === 6) {
        return mutated(library.removeWorkItemSource(project.id, id, extra).map(markSource))
      }
      return respondJson(res, 404, { ok: false, error: 'Unknown route' })
    }

    if (req.method === 'GET' && !id) {
      const params = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams
      const query: LibraryQuery = {}
      const kind = params.get('kind')
      if (kind) query.kind = kind as LibraryItemKind
      const access = params.get('access')
      if (access) query.access = access as LibraryAiAccess
      const tag = params.get('tag')
      if (tag) query.tag = tag
      const search = params.get('search')
      if (search) query.search = search
      if (params.get('includeArchived') === 'true') query.includeArchived = true
      return respondJson(res, 200, {
        ok: true,
        value: this.withLinkedFrom(
          project,
          'library',
          params,
          library.listItems(project.id, query).map(markLibraryItem)
        )
      })
    }
    if (req.method === 'GET' && id && !action) {
      const item = library.getItem(project.id, id)
      const params = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams
      const [withLinks] = this.withLinkedFrom(project, 'library', params, [
        {
          ...markLibraryItem(item),
          text: library.getItemText(project.id, id),
          sourceOf: library.listItemWorkItems(project.id, id)
        }
      ])
      return respondJson(res, 200, { ok: true, value: withLinks })
    }
    if (req.method === 'GET' && id && action === 'file' && parts.length === 5) {
      const stored = library.storedFile(project.id, id, 'file')
      if (!stored) {
        return respondJson(res, 404, { ok: false, error: 'This library item has no stored file' })
      }
      const size = statSync(stored.path).size
      res.writeHead(200, { 'Content-Type': stored.mimeType, 'Content-Length': size })
      await new Promise<void>((resolve, reject) => {
        const stream = createReadStream(stored.path)
        stream.on('error', reject)
        stream.on('end', () => resolve())
        stream.pipe(res)
      })
      return
    }
    if (req.method === 'POST' && id === 'upload' && !action) {
      const fileName = typeof body.fileName === 'string' ? body.fileName : ''
      const mimeType = typeof body.mimeType === 'string' ? body.mimeType : ''
      const base64 = typeof body.base64 === 'string' ? body.base64 : ''
      if (!fileName || !base64) throw new Refusal('fileName and base64 are required')
      const bytes = new Uint8Array(Buffer.from(base64, 'base64'))
      if (bytes.byteLength > LIBRARY_MAX_FILE_BYTES) {
        throw new Refusal(`Files are limited to ${LIBRARY_MAX_FILE_BYTES / 1024 / 1024} MB`)
      }
      const [result] = await library.importFiles(project.id, [{ fileName, mimeType, bytes }])
      return mutated({ ...result, item: markLibraryItem(result.item) })
    }
    if (req.method === 'POST' && !id) {
      const item = library.createItem(project.id, body as unknown as CreateLibraryItemInput)
      return mutated(markLibraryItem(item))
    }
    if (req.method === 'PATCH' && id && !action) {
      const updates: UpdateLibraryItemInput = {}
      for (const key of ['title', 'summary', 'body', 'url', 'aiAccess', 'tags'] as const) {
        if (body[key] !== undefined) (updates as Record<string, unknown>)[key] = body[key]
      }
      let item = library.getItem(project.id, id)
      if (Object.keys(updates).length > 0) item = library.updateItem(project.id, id, updates)
      if (typeof body.isPrimaryBrief === 'boolean' && body.isPrimaryBrief !== item.isPrimaryBrief) {
        library.setPrimaryBrief(project.id, body.isPrimaryBrief ? id : null)
        item = library.getItem(project.id, id)
      }
      return mutated(markLibraryItem(item))
    }
    if (req.method === 'POST' && id && action === 'archive' && parts.length === 5) {
      return mutated(markLibraryItem(library.archiveItem(project.id, id)))
    }
    if (req.method === 'DELETE' && id && !action) {
      library.deleteItem(project.id, id)
      return mutated({ id, deleted: true })
    }
    return respondJson(res, 404, { ok: false, error: 'Unknown route' })
  }

  private async getStatus(project: WatchedProject): Promise<AutomationStatus> {
    if (!this.harness) throw new Error('Harness API unavailable')
    if (!this.planning) throw new Error('Planning API unavailable')

    // HarnessReport is the single source for harness health/counts. This keeps
    // status and report from drifting into separate queue/question logic.
    const report = this.harness.getReport(project)
    const goals = this.planning.listGoals(project.id)
    const milestones = this.planning.listMilestones(project.id)
    const workItems = this.projectedWorkItems(project)
    const readinessReports = this.getReadinessReports
      ? await this.getReadinessReports(project)
      : undefined

    const status: AutomationStatus = {
      project: { id: project.id, name: project.name, enabled: project.enabled },
      harness: {
        queue: {
          pending: report.metrics.pendingTasks,
          active: report.metrics.claimedTasks,
          review: report.metrics.reviewSessions,
          done: report.metrics.completedTasks
        },
        unansweredQuestions: report.metrics.pendingQuestions,
        workspacesAwaitingReview: report.metrics.reviewSessions
      },
      planning: {
        goals: countStatuses(goals, ['active', 'achieved', 'archived']),
        milestones: countStatuses(milestones, ['planned', 'active', 'complete', 'archived']),
        workItems: countStatuses(workItems, [
          'backlog',
          'ready',
          'active',
          'blocked',
          'review',
          'done'
        ]),
        metrics: this.planning.getProjectMetrics(project.id)
      }
    }
    if (readinessReports) status.readinessReports = readinessReports
    return status
  }

  /**
   * `?include=linkedFrom` (N4.4a): each item with the texts that link to it,
   * read for the whole list in one query. Without it the items are as they were.
   */
  withLinkedFrom<T extends { id: string }>(
    project: WatchedProject,
    kind: LinkTargetKind,
    params: URLSearchParams,
    items: T[]
  ): (T | (T & { linkedFrom: LinkedFromEntry[] }))[] {
    const include = (params.get('include') ?? '').split(',').map((part) => part.trim())
    if (!include.includes('linkedFrom')) return items
    const linked = this.planning!.linkedFromInProject(project.id, kind)
    return items.map((item) => ({ ...item, linkedFrom: linked.get(item.id) ?? [] }))
  }

  /** Work items with `status` set to the Board column, the same projection the UI uses. */
  projectedWorkItems(
    project: WatchedProject,
    scope: PlanningWorkItemScope = 'live'
  ): PlanningWorkItem[] {
    const harness = this.harness?.getState(project)
    return this.planning!.listWorkItems(project.id, scope).map((item) => ({
      ...item,
      status: projectWorkItemStatus(item, harness)
    }))
  }

  private linkedWorkItem(project: WatchedProject, taskId: string): PlanningWorkItem | undefined {
    return this.planning
      ?.listWorkItems(project.id)
      .find((item) => item.linkedHarnessTaskId === taskId)
  }

  private sessionTaskId(project: WatchedProject, sessionId: string): string | null {
    const state = this.harness!.getState(project)
    const session = [...state.activeSessions, ...state.reviewSessions].find(
      (item) => item.id === sessionId
    )
    if (session?.taskId) return session.taskId
    return state.taskQueue.find((task) => task.claimedBy === sessionId)?.id ?? null
  }

  /** Every task a session holds or finished: one agent may do several in a row. */
  private sessionTaskIds(project: WatchedProject, sessionId: string): string[] {
    const ids = new Set(
      this.harness!.getState(project)
        .taskQueue.filter((task) => task.claimedBy === sessionId)
        .map((task) => task.id)
    )
    const own = this.sessionTaskId(project, sessionId)
    if (own) ids.add(own)
    return [...ids]
  }

  private syncLinkedWorkItem(
    project: WatchedProject,
    taskId: string | null,
    status: PlanningWorkItemStatus
  ): void {
    syncAgentWorkItemStatus(this.planning!, project.id, taskId, status)
  }

  /** Hook for future mutating routes; summaries must never contain credentials or request bodies. */
  /**
   * Reschedule (N1.3): the same plan and the same apply as the app's, through
   * `RescheduleService`, for this token's project only.
   */
  /** The same service the app's Reschedule and Move what waits on it use. */
  rescheduleService(): RescheduleService {
    if (!this.planning || !this.people) throw new Error('Planning API unavailable')
    const people = this.people.service
    return new RescheduleService({
      planning: this.planning,
      getProjects: this.getProjects,
      getPerson: (personId) =>
        people.list({ includeArchived: true }).find((person) => person.id === personId) ?? null,
      getMe: () => people.getMe(),
      getDaysOff: () => this.daysOff?.service.list() ?? []
    })
  }

  /**
   * Plan first (N9.3b): GET /sessions/:id/plan, POST …/plan/approve and
   * POST …/plan/changes, through the same harness methods as the app's Plan
   * dialog. A second decision returns the first.
   */
  private async handlePlan(
    req: IncomingMessage,
    res: ServerResponse,
    project: WatchedProject,
    sessionId: string,
    step: string | undefined,
    body: Record<string, unknown>
  ): Promise<void> {
    const harness = this.harness!
    if (req.method === 'GET' && !step) {
      const state = harness.getState(project)
      const session = [...state.activeSessions, ...state.reviewSessions].find(
        (item) => item.id === sessionId
      )
      return respondJson(res, 200, {
        ok: true,
        value: {
          sessionId,
          title: session?.title ?? '',
          plan: harness.getSessionPlan(project, sessionId),
          history: this.taskPlans?.listForSession(sessionId) ?? []
        }
      })
    }
    if (req.method === 'POST' && (step === 'approve' || step === 'changes')) {
      const before = harness.getSessionPlan(project, sessionId)
      const alreadyDecided = !!before && before.status !== 'pending'
      const plan =
        step === 'approve'
          ? await harness.approvePlan(project, sessionId)
          : harness.requestPlanChanges(
              project,
              sessionId,
              typeof body?.note === 'string' ? body.note : ''
            )
      if (!alreadyDecided) {
        this.recordMutation(
          project,
          `/sessions/${sessionId}/plan/${step}`,
          `automation-api plan ${step}`
        )
        this.onHarnessStateChange?.(project)
      }
      return respondJson(res, 200, { ok: true, value: { plan, alreadyDecided } })
    }
    return respondJson(res, 405, { ok: false, error: 'Method not allowed' })
  }

  /**
   * PATCH /work-items/:workItemId. With `moveDependents: true` the tasks that
   * wait on it and now start too early move too, in the same transaction
   * (N7.1); with `"preview"` nothing changes and the plan comes back.
   */
  private updateWorkItem(
    project: WatchedProject,
    current: PlanningWorkItem,
    body: Record<string, unknown>
  ): unknown {
    const planning = this.planning!
    const { moveDependents, ...patch } = body
    const input = patch as UpdatePlanningWorkItemInput
    // A queued task's move out of Ready or into Someday: the app's queue rule.
    const update = () => {
      const saved = updateWorkItemThroughQueue(
        planning,
        this.harness,
        project,
        current.id,
        input,
        AUTOMATION_ACTOR
      )
      if (current.linkedHarnessTaskId && (input.status !== undefined || saved.leftQueue))
        this.onHarnessStateChange?.(project)
      return saved
    }
    if (moveDependents === undefined || moveDependents === false) return update()
    if (moveDependents !== true && moveDependents !== 'preview')
      throw new Refusal('moveDependents must be true or "preview"')
    const reschedule = this.rescheduleService()
    const from = { id: current.id, fromDue: current.targetDate, fromStart: current.startDate }
    if (moveDependents === 'preview') {
      const toDue = input.targetDate === undefined ? current.targetDate : input.targetDate
      const toStart = input.startDate === undefined ? current.startDate : input.startDate
      return reschedule.planDependents(
        [{ ...from, toDue: toDue ?? null, toStart: toStart ?? null }],
        project.id
      )
    }
    return planning.runInTransaction(() => {
      const workItem = update()
      const dependents = reschedule.moveDependents(
        [{ ...from, toDue: workItem.targetDate, toStart: workItem.startDate }],
        AUTOMATION_ACTOR,
        project.id
      )
      return { workItem, dependents }
    })
  }

  recordMutation(project: WatchedProject, route: string, summary: string): void {
    this.auditMutation({ projectId: project.id, route, summary, origin: 'automation-api' })
  }
  private audit(entry: AutomationAuditEntry): void {
    try {
      const dir = join(this.dataDir, 'logs')
      mkdirSync(dir, { recursive: true })
      appendFileSync(
        join(dir, 'automation-audit.log'),
        `${JSON.stringify({ timestamp: new Date().toISOString(), ...entry })}\n`
      )
    } catch {
      /* audit failure must not break the API */
    }
  }
}

/** A library item as the automation API returns it: human-only items are marked. */
function markLibraryItem(item: LibraryItem): LibraryItem & { humanOnly: boolean } {
  return { ...item, humanOnly: item.aiAccess === 'human-only' }
}

function markSource<T extends WorkItemSource | WorkItemAttachment>(
  source: T
): T & { item: LibraryItem & { humanOnly: boolean } } {
  return { ...source, item: markLibraryItem(source.item) }
}

function countStatuses<T extends { status: string }, S extends string>(
  items: T[],
  statuses: readonly S[]
): Record<S, number> {
  return Object.fromEntries(
    statuses.map((status) => [status, items.filter((item) => item.status === status).length])
  ) as Record<S, number>
}

function buildHelp(projectId: string) {
  return {
    instructions: `Ostler automation API for project ${projectId}. Responses use { ok: true, value } or { ok: false, error }. Typical flow: call GET /help, then call documented routes with Authorization: Bearer <automation token>. A project can live only in Ostler, with no folder linked (hasFolder: false in GET /projects). Then the routes that need its folder (queuing tasks for agents, starting embedded sessions, applying a task's work) answer HTTP 409 with a message saying the project needs a linked folder; planning and Library routes keep working. Only the human can link a folder, in Ostler.`,
    routes: HELP_ROUTES
  }
}

const API_STATUSES = ['backlog', 'ready', 'active', 'blocked', 'review', 'done']
const API_PRIORITIES = ['low', 'medium', 'high', 'critical']

/** `POST /import/csv`'s preset: a tool's id, "none" to map by hand, or left out to detect. */
function csvPresetFrom(preset: unknown): Pick<CsvImportOptions, 'preset'> {
  if (preset === undefined || preset === null) return {}
  if (preset === 'none' || CSV_PRESETS.some((entry) => entry.id === preset))
    return { preset: preset as CsvImportOptions['preset'] }
  throw new Refusal(
    `preset must be one of ${CSV_PRESETS.map((entry) => entry.id).join(', ')} or none`
  )
}

/**
 * `POST /import/csv`'s mapping as the importer's options: columns by header
 * name (or index), each status and priority value to an Ostler one, the date
 * format and the delimiter. Anything left out is guessed, as in the app.
 */
function csvOptionsFrom(mapping: unknown, csv: string): CsvImportOptions {
  if (mapping === undefined || mapping === null) return {}
  if (typeof mapping !== 'object' || Array.isArray(mapping))
    throw new Refusal('mapping must be an object')
  const input = mapping as Record<string, unknown>
  const options: CsvImportOptions = {}
  if (input.delimiter !== undefined) {
    if (input.delimiter !== ',' && input.delimiter !== ';' && input.delimiter !== '\t')
      throw new Refusal('mapping.delimiter must be ",", ";" or a tab')
    options.delimiter = input.delimiter
  }
  if (input.dateFormat !== undefined) {
    if (input.dateFormat !== 'iso' && input.dateFormat !== 'dmy' && input.dateFormat !== 'mdy')
      throw new Refusal('mapping.dateFormat must be iso, dmy or mdy')
    options.dateFormat = input.dateFormat
  }
  const values = (key: 'statuses' | 'priorities', allowed: string[]) => {
    const raw = input[key]
    if (raw === undefined) return undefined
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new Refusal(`mapping.${key} must be an object`)
    for (const [value, mapped] of Object.entries(raw)) {
      if (typeof mapped !== 'string' || !allowed.includes(mapped))
        throw new Refusal(`mapping.${key}["${value}"] must be one of ${allowed.join(', ')}`)
    }
    return raw as Record<string, never>
  }
  options.statusMap = values('statuses', API_STATUSES)
  options.priorityMap = values('priorities', API_PRIORITIES)
  if (input.columns !== undefined) {
    if (!input.columns || typeof input.columns !== 'object' || Array.isArray(input.columns))
      throw new Refusal('mapping.columns must be an object')
    const delimiter = options.delimiter ?? detectDelimiter(csv)
    const headers = (
      parseCsv(csv.replace(/^\ufeff/, '').slice(0, 64 * 1024), delimiter)[0] ?? []
    ).map((header) => header.trim().toLowerCase())
    const columns: Partial<Record<CsvField, number | null>> = {}
    for (const [field, value] of Object.entries(input.columns as Record<string, unknown>)) {
      if (!(CSV_FIELDS as readonly string[]).includes(field))
        throw new Refusal(`mapping.columns.${field} is not a field: use ${CSV_FIELDS.join(', ')}`)
      if (value === null) columns[field as CsvField] = null
      else if (typeof value === 'number' && Number.isInteger(value))
        columns[field as CsvField] = value
      else if (typeof value === 'string') {
        const index = headers.indexOf(value.trim().toLowerCase())
        if (index < 0)
          throw new Refusal(`mapping.columns.${field}: the file has no column "${value}"`)
        columns[field as CsvField] = index
      } else throw new Refusal(`mapping.columns.${field} must be a header name, an index or null`)
    }
    options.columns = columns
  }
  return options
}

/** GET /reports?splitBy=type (N2.7b): the split, empty for a project with no task types. */
function withTypeSplit(report: ProjectReport): ProjectReport {
  return {
    ...report,
    throughput: { ...report.throughput, byType: report.throughput.byType ?? [] },
    cycleTime: { ...report.cycleTime, byType: report.cycleTime.byType ?? [] }
  }
}

/** GET /reports without splitBy: the report as it was before the split. */
function withoutTypeSplit(report: ProjectReport): ProjectReport {
  const throughput = { ...report.throughput }
  const cycleTime = { ...report.cycleTime }
  delete throughput.byType
  delete cycleTime.byType
  return { ...report, throughput, cycleTime }
}
