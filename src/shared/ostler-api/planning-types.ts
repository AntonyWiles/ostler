import type { ActivityActor } from './activity-types'
import type { AIProvider } from './ai-types'
import type { GithubLink } from './github-types'
import type { HarnessTask } from './harness-types'
import type { AIDraftSource, LibraryItem } from './library-types'
import type {
  PlanningFieldFills,
  PlanningFieldValues,
  PlanningFieldValuesInput
} from './field-types'
import type { PlanningRuleRunSummary } from './rule-types'
import type { GoalCheckIn, GoalMeasure } from '../goal-measures'
import type { MilestoneRepeat } from '../milestone-rounds'
import type { ProjectIcon } from '../project-icons'
import type { PlanFirstChoice } from '../plan-first'

// ─── Planning Types ─────────────────────────────────────────────────────────

export type PlanningGoalStatus = 'active' | 'achieved' | 'archived'
export type PlanningMilestoneStatus = 'planned' | 'active' | 'complete' | 'archived'
/** What a repeat's schedule did with an occurrence (N9.7). */
export type PlanningScheduledQueueOutcome =
  'queued' | 'agentsOff' | 'noFolder' | 'alreadyQueued' | 'refused'

export interface PlanningScheduledQueue {
  outcome: PlanningScheduledQueueOutcome
  /** When, in ms. */
  at: number
  /** Why it was refused ('refused' only). */
  note?: string
}

export type PlanningWorkItemStatus = 'backlog' | 'ready' | 'active' | 'blocked' | 'review' | 'done'

/**
 * What a project holds, as far as its views care: the facts that earn a view
 * its tab (`isInUse` in the renderer's view registry) and offer To triage.
 */
export const PROJECT_USAGE_FACTS = [
  'triage',
  'scheduled',
  'milestones',
  'decisions',
  'someday',
  'scores',
  'costs',
  'shopping',
  'time'
] as const
export type ProjectUsageFact = (typeof PROJECT_USAGE_FACTS)[number]

/** Each project's facts, by project id; a project that holds none has an empty list. */
export type ProjectUsage = Record<string, ProjectUsageFact[]>

export interface PlanningStatusTransition {
  workItemId: string
  from: PlanningWorkItemStatus | null
  to: PlanningWorkItemStatus
  at: number
}

export interface PlanningWorkItemMetrics {
  leadTimeMs: number | null
  cycleTimeMs: number | null
  queueAgeMs: number
  blockedTimeMs: number
  completedAt: number | null
}

export interface PlanningAggregateMetrics {
  itemCount: number
  completedCount: number
  averageLeadTimeMs: number | null
  averageCycleTimeMs: number | null
  averageQueueAgeMs: number
  totalBlockedTimeMs: number
  throughput: Array<{ periodStart: number; count: number }>
}

export type PlanningReadinessState = 'pass' | 'fail' | 'warning'
export interface PlanningReadinessCheck {
  id:
    | 'linked-work'
    | 'acceptance-criteria'
    | 'blocked-or-stale'
    | 'workspace-review'
    | 'agent-questions'
    | 'git-state'
    | 'human-sign-off'
  label: string
  state: PlanningReadinessState
  detail: string
  evidence: string[]
}
export interface PlanningHumanSignOff {
  id: string
  label: string
  completed: boolean
}
export interface PlanningReadinessReport {
  milestoneId: string
  generatedAt: number
  /**
   * The report's answer, so a reader does not have to fold six checks into one:
   * `ready` only when every check passes, `not-ready` when any fails,
   * `attention` when nothing fails but something still wants a human.
   */
  verdict: 'ready' | 'attention' | 'not-ready'
  checks: PlanningReadinessCheck[]
  signOffs: PlanningHumanSignOff[]
}
export type PlanningPriority = 'low' | 'medium' | 'high' | 'critical'
export type PlanningWorkItemOrigin = 'human' | 'ai-approved' | 'imported'

export type PlanningVerificationStatus =
  'unverified' | 'pending' | 'passed' | 'failed' | 'needs-rework'
export type PlanningVerifiedBy = 'human' | 'ai-review'

export interface PlanningGoal {
  id: string
  projectId: string
  title: string
  outcome: string
  status: PlanningGoalStatus
  /** Its number (N5.6a): a unit, start, target and dates; null without one. Always set by the service. */
  measure?: GoalMeasure | null
  createdAt: number
  updatedAt: number
}

/** What a check-in did (N5.6a): the reading, and the one it replaced that day, for Undo. */
export interface GoalCheckInResult {
  checkIn: GoalCheckIn
  replaced: GoalCheckIn | null
}

export interface PlanningMilestone {
  id: string
  projectId: string
  goalId: string | null
  /** The workstream (sub-project) it belongs to, or null for the whole project. Optional only for records built outside the database. */
  subprojectId?: string | null
  name: string
  outcome: string
  targetDate: string | null
  successCriteria: string[]
  status: PlanningMilestoneStatus
  createdAt: number
  updatedAt: number
  /**
   * Its round schedule (N5.7a, N42): when the next round starts and how long
   * a round lasts. Left out when it has never repeated; `on: false` after
   * Stop repeating.
   */
  repeat?: MilestoneRepeat | null
  /** The round it was made from (N5.7a); left out for a milestone that is no later round. */
  previousRoundId?: string | null
  /** The day this round started, `YYYY-MM-DD` (N5.7a); left out when it is no round yet. */
  roundStart?: string | null
}

/** A checklist item's due date and person (N2.2, N17), keyed by the item's text. */
export interface PlanningChecklistDetail {
  text: string
  /** `YYYY-MM-DD`, or null. */
  dueDate: string | null
  /** A person (`Person.id`), or null. */
  assigneeId: string | null
}

/** What `setChecklistItemDetails` changes: a field left out keeps its value, null clears it. */
export interface PlanningChecklistDetailInput {
  dueDate?: string | null
  assigneeId?: string | null
}

/**
 * How a waits-on link reads its two tasks' dates (N7.2a, decision N50):
 * - `finish-to-start` (the default, and every link made before): this task
 *   starts on or after the other is due, plus the lag.
 * - `start-to-start`: it starts on or after the other starts, plus the lag.
 * - `finish-to-finish`: it is due on or after the other is due, plus the lag.
 * Only finish-to-start links hold a task back from Ready and the agent queue.
 */
export const PLANNING_DEPENDENCY_TYPES = [
  'finish-to-start',
  'start-to-start',
  'finish-to-finish'
] as const
export type PlanningDependencyType = (typeof PLANNING_DEPENDENCY_TYPES)[number]

/** The most a lag can be, either way, in calendar days. A negative lag is a lead. */
export const MAX_DEPENDENCY_LAG_DAYS = 365

/** One waits-on link: the task waited on, how, and by how many calendar days. */
export interface PlanningDependencyLink {
  id: string
  type: PlanningDependencyType
  lagDays: number
}

/** A waits-on link as a caller gives it: left out, the type is finish to start and the lag 0. */
export interface PlanningDependencyLinkInput {
  id: string
  type?: PlanningDependencyType
  lagDays?: number
}

/**
 * The kinds of link between two tasks besides waits-on (N2.4, N19). None of
 * them schedules anything: they are stored and typed apart from
 * `dependencyIds`, and never part of `PlanningWorkItem`.
 */
export const PLANNING_LINK_KINDS = ['relates', 'duplicates', 'copied-from'] as const
export type PlanningLinkKind = (typeof PLANNING_LINK_KINDS)[number]

/**
 * How a link reads from one of its tasks: "relates to" the same from both
 * ends; a duplicate is a "duplicate of" its original, which is "duplicated
 * by" it; a copy is "copied from" its original, which was "copied to" it.
 */
export type PlanningLinkRole =
  'relates' | 'duplicate-of' | 'duplicated-by' | 'copied-from' | 'copied-to'

/** One link as one of its tasks sees it, with the other task's title and state. */
export interface PlanningTaskLink {
  id: string
  projectId: string
  kind: PlanningLinkKind
  role: PlanningLinkRole
  /** The task this link was read from. */
  workItemId: string
  /** The task at the other end. */
  otherWorkItemId: string
  otherTitle: string
  otherStatus: PlanningWorkItemStatus
  /** The other task is archived (or closed as won't do) or in the recycle bin. */
  otherClosed: boolean
  createdAt: number
}

/** How many description versions a task keeps (N2.6, N21); older ones are deleted. */
export const MAX_DESCRIPTION_VERSIONS = 50

/**
 * One earlier text of a task's description (N2.6, N21): what it said before
 * a sitting of changes by one actor began. It stays on this PC: never in CSV,
 * the project file or a template.
 */
export interface PlanningDescriptionVersion {
  id: number
  projectId: string
  workItemId: string
  /** The description as it was before this sitting's first change. */
  text: string
  /** Who made the sitting's changes, named as activity names them. */
  actor: ActivityActor
  /** The sitting's first and last change. */
  startedAt: number
  endedAt: number
}

/** What Mark as duplicate did: the task closed as won't do and the link added. */
export interface MarkDuplicateResult {
  workItem: PlanningWorkItem
  link: PlanningTaskLink
  /** A queued agent task was cancelled so the task could close. */
  cancelledTask: boolean
}

/** What Copy task made: the copy and its "copied from" link. */
export interface CopyWorkItemResult {
  workItem: PlanningWorkItem
  link: PlanningTaskLink
}

export interface PlanningWorkItem {
  id: string
  projectId: string
  milestoneId: string | null
  /** The workstream (sub-project) it belongs to, or null for the whole project. Optional only for records built outside the database. */
  subprojectId?: string | null
  title: string
  description: string
  status: PlanningWorkItemStatus
  /**
   * The project's own column (MOP-26) the task is in, or null for the
   * column of its status. A custom column counts as one of the six
   * statuses, which `status` always holds, so agents, reports and anything
   * that knows only the six read the task as that status.
   */
  columnId?: string | null
  priority: PlanningPriority
  labels: string[]
  acceptanceCriteria: string[]
  dependencyIds: string[]
  /**
   * The same links as `dependencyIds`, in the same order, with their type and
   * lag (N7.2a). Left out, every link is finish to start with no lag; read it
   * through `dependencyLinksOf` (`@shared/planning/dependency-links`).
   */
  dependencyLinks?: PlanningDependencyLink[]
  /** The due date, `YYYY-MM-DD`. */
  targetDate: string | null
  /** The start date, `YYYY-MM-DD`; never after `targetDate`. */
  startDate: string | null
  /** The person doing it (`Person.id`), or null. */
  assigneeId: string | null
  /** In the project's `estimateUnit`, 0 to 1000, or null. */
  estimate: number | null
  /**
   * The acceptance criteria that are ticked: the checklist's state (D21).
   * Derived from the checks table and never written directly; tick with
   * `setChecklistItemChecked`.
   */
  checkedCriteria: string[]
  /**
   * The checklist items that have a due date or a person (N2.2, N17), in list
   * order, keyed by their text like the ticks. Derived from the details table;
   * set with `setChecklistItemDetails`. Optional only for records built
   * outside the database (tests, drafts).
   */
  checklistDetails?: PlanningChecklistDetail[]
  origin: PlanningWorkItemOrigin
  /** Set only by the later, explicit human-confirmed harness handoff flow. */
  linkedHarnessTaskId: string | null
  autoQueue: boolean
  /**
   * Plan first (N9.3b): whether an agent on this task sends a plan before it
   * changes anything. "default" follows the project's Agents plan first.
   * Optional only for records built outside the database.
   */
  planFirst?: PlanFirstChoice
  /** Why the task is blocked, in a few words; empty when it says nothing or is not blocked. */
  blockedReason?: string
  /**
   * Scheduled agent tasks (N9.7): what this occurrence's repeat did, once,
   * when its start date (or due date) came: queued it for agents, or why not.
   * Absent until then, and for a task whose repeat does not go to agents.
   */
  scheduledQueue?: PlanningScheduledQueue
  /**
   * The task's number (N9.8a, N66), unique within its project and never
   * reused: with the project's `taskPrefix` it makes the task's ID, SHOP-12
   * (`taskKey` in `src/shared/task-key.ts`). Given by `createWorkItem` only.
   * Optional only for records built outside the database.
   */
  number?: number | null
  /**
   * The task's ID, SHOP-12 (N9.8a): worked out from the project's prefix and
   * `number` each time the task is read, so changing the prefix changes every
   * ID at once. Never stored, and never used in place of `id`.
   */
  key?: string | null
  /** Nesting parent for agent plan split subtasks (depth <= 3). Null for top-level items. */
  parentWorkItemId: string | null
  /** Human-readable agent plan split identity, e.g. "B4" or "B4.1.1". Empty for non-plan items. */
  taskCode: string
  /** The phase code this item belongs to, e.g. "B". Empty for non-plan items. */
  phaseCode: string
  /** The phase label this item belongs to. Empty for non-plan items. */
  phaseName: string
  /**
   * 1-based phase number scoped to `parentWorkItemId` — meaningless without
   * it. Two different parents can each have their own "phase 1" without
   * conflict, since the pair (parentWorkItemId, subtaskPhaseNumber) is what's
   * unique, not the number alone. Null when parentWorkItemId is null.
   */
  subtaskPhaseNumber: number | null
  /** Free-text label for the subtask phase, shared by every sibling in it. Empty until set. */
  subtaskPhaseName: string
  verificationStatus: PlanningVerificationStatus
  verifiedBy: PlanningVerifiedBy | null
  verifiedAt: number | null
  verificationNotes: string
  createdAt: number
  updatedAt: number
  /** Set when the finished item was moved out of the Board into the project archive. */
  archivedAt?: number | null
  /** Set while the item sits in the recycle bin; purged for good after 30 days. */
  deletedAt?: number | null
  /**
   * How a closed task ended without being done (N1.2, N8): `'wont-do'`, or
   * null for an open or finished task. A won't-do task is also archived,
   * keeps its status, and counts nowhere in reports. Optional only for
   * records built outside the database (tests, drafts).
   */
  resolution?: PlanningResolution | null
  /** Why it was closed as won't do; empty when no reason was given. */
  resolutionReason?: string
  /**
   * The first day the task can be acted on, `YYYY-MM-DD` (N1.1a, N9): until
   * then it is hidden from Today, Upcoming, My work, the Board and the List.
   * Optional only for records built outside the database (tests, drafts).
   */
  showFrom?: string | null
  /** Parked for one day, maybe (N9): a flag, not a status. Hidden like a future show-from date. */
  someday?: boolean
  /**
   * How much it would matter, 1 to 5, or null (N1.1b, N10): ideas in Someday
   * are scored for impact and effort. Optional only for records built
   * outside the database (tests, drafts).
   */
  impact?: number | null
  /** How much work it would take, 1 to 5, or null (N1.1b). */
  effort?: number | null
  /**
   * Waiting in its project's To triage view (N4.3a, N33): a quick capture
   * nobody has looked at yet. It counts nowhere (`isHiddenNow`) until it is
   * accepted. Optional only for records built outside the database.
   */
  inTriage?: boolean
  /** How a task in triage was captured, or null (N4.3a). */
  capturedBy?: TriageCapture | null
  /**
   * Only on the item an update returns, when that update made it Done and it
   * repeats (P5.6): the next occurrence's id, or why it could not be made.
   */
  repeatedAs?: string
  repeatError?: string
  /**
   * Only on the item a write returns, when rules (R6.2) acted because of that
   * write: the run, which the write's undo passes back as `undoRuleRun`.
   */
  ruleRun?: PlanningRuleRunSummary
  /**
   * Only on the item a write returns, when that write took it out of the
   * agent queue (it was queued, not started): its Undo queues it again.
   */
  leftQueue?: boolean
  /** It has a repeat rule (P5.6); read for filters (P5.7), set with `setRecurrence`. */
  recurring?: boolean
  /** The import it came in with (P6.1), or null; "Undo import" uses it. */
  importBatchId?: string | null
  /**
   * Its place in the project's manual order (D31): tasks sort by this key,
   * byte by byte. Internal and read-only: move a task with
   * `movePlanningWorkItem`, never by sending a key. Optional only for records
   * built outside the database (tests, drafts).
   */
  orderKey?: string
  /**
   * Its custom field values (R2.2, D32), by field id. A field with no value
   * has no key. Loaded with the task in one query per project.
   */
  fieldValues?: PlanningFieldValues
  /**
   * Who filled each of its values (N8.4), by field id: the person, or Ostler
   * AI with the hash of the text it was filled from. Loaded with the values.
   */
  fieldFills?: PlanningFieldFills
  /**
   * Its GitHub issues and pull requests (R4.4, D40), with the title and state
   * cached from the last fetch. Absent when it links none. Loaded with the
   * task in one query per project; change them with the GitHub link calls.
   */
  githubLinks?: GithubLink[]
  /**
   * The iteration it is in (R6.1, D44), or null. A task is in at most one.
   * Optional only for records built outside the database (tests, drafts).
   */
  iterationId?: string | null
  /**
   * Its task type (N2.7a, N22), or null for none. A task has at most one.
   * Optional only for records built outside the database (tests, drafts).
   */
  typeId?: string | null
  /**
   * The task of the earlier round it was copied from (N5.7a), so a task can
   * be followed across rounds. Left out for a task that is no such copy.
   */
  roundSourceId?: string | null
}

/**
 * Where to move a task in the manual order: exactly one of `beforeId`,
 * `afterId` (another task of the same project) or `position` (the start or
 * end of `status`, or of its own status). With `status`, the task also moves
 * to that status.
 */
export interface PlanningWorkItemPlacement {
  beforeId?: string
  afterId?: string
  position?: 'start' | 'end'
  status?: PlanningWorkItemStatus
  /** With `status`: the custom column (MOP-26) it moves into, or null for the status's own. */
  columnId?: string | null
}

/** How a task was closed without being done (N1.2). Only won't do so far. */
export type PlanningResolution = 'wont-do'
export const PLANNING_RESOLUTIONS: readonly PlanningResolution[] = ['wont-do']

/** The longest reason a won't-do task can carry, in characters. */
export const MAX_RESOLUTION_REASON_LENGTH = 500

/** What closing tasks as won't do may also do (N1.2). */
export interface WontDoOptions {
  /** Optional; at most `MAX_RESOLUTION_REASON_LENGTH` characters. */
  reason?: string
  /** Also close its open subtasks the same way, with the same reason. */
  includeSubtasks?: boolean
  /** Cancel queued agent work first; the app asks the person before it sets this. */
  cancelQueuedWork?: boolean
}

/** What closing a task as won't do did. */
export interface WontDoResult {
  /** The task, now archived as won't do. */
  workItem: PlanningWorkItem
  /** Every task closed, the task first, then its subtasks: undo reopens them all. */
  closedIds: string[]
  /** Queued agent work that was cancelled first. */
  cancelledTask: boolean
  /** A repeating task's next occurrence, when closing it made one. */
  repeatedAs?: string
}

/** Which slice of a project's work items to list. `live` is everything on the Board. */
/**
 * `live` is neither archived nor binned; `planned` is live and not in triage
 * (what the Board, List, Calendar and Timeline show, N4.3a); `triage` is the
 * live tasks waiting in To triage.
 */
export type PlanningWorkItemScope = 'live' | 'planned' | 'triage' | 'archived' | 'deleted'

/** Days a work item stays in the recycle bin before it is permanently deleted. */
export const RECYCLE_BIN_RETENTION_DAYS = 30

export interface CreatePlanningGoalInput {
  title: string
  outcome?: string
  /** A measure (N5.6a), checked by `parseGoalMeasure`. */
  measure?: GoalMeasure | null
}

/** `measure: null` takes a goal's measure away (its check-ins stay, for when it has one again). */
export type UpdatePlanningGoalInput = Partial<
  Pick<PlanningGoal, 'title' | 'outcome' | 'status'> & { measure: GoalMeasure | null }
>

export type PlanningIterationStatus = 'planned' | 'active' | 'finished'

/** What happens to an iteration's unfinished tasks when it is finished. */
export type PlanningIterationCarryOver = 'next' | 'none'

/** What a finished iteration keeps: what was done and what was carried over. */
export interface PlanningIterationSummary {
  doneCount: number
  /** The done tasks' estimates added up; tasks without one count 0. */
  doneEstimate: number
  carriedCount: number
  carriedEstimate: number
  carryOver: PlanningIterationCarryOver
  /** The iteration the unfinished tasks went to, when `carryOver` is `next`. */
  carriedToIterationId: string | null
}

/**
 * A sprint or cycle (R6.1, D44): a fixed period of a project's work. Dates
 * are local days, the end included. A project's iterations never overlap,
 * and at most one is active.
 */
export interface PlanningIteration {
  id: string
  projectId: string
  name: string
  /** `YYYY-MM-DD`. */
  startDate: string
  /** `YYYY-MM-DD`, included; never before `startDate`. */
  endDate: string
  /** An optional sentence: what this iteration is for. */
  goal: string
  status: PlanningIterationStatus
  /** Set once it is finished. */
  summary: PlanningIterationSummary | null
  finishedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface CreatePlanningIterationInput {
  name: string
  startDate: string
  endDate: string
  goal?: string
}

export type UpdatePlanningIterationInput = Partial<
  Pick<PlanningIteration, 'name' | 'startDate' | 'endDate' | 'goal'>
>

/** What finishing an iteration did. */
export interface PlanningIterationFinish {
  iteration: PlanningIteration
  /** The unfinished tasks that were moved (to the next iteration, or out of any). */
  movedTaskIds: string[]
}

/** A deleted iteration and the tasks that were in it, so Undo can put both back. */
export interface PlanningIterationDeletion {
  iteration: PlanningIteration
  taskIds: string[]
}

export interface CreatePlanningMilestoneInput {
  name: string
  outcome?: string
  goalId?: string | null
  /** A workstream of the same project. */
  subprojectId?: string | null
  targetDate?: string | null
  successCriteria?: string[]
}

export type UpdatePlanningMilestoneInput = Partial<
  Pick<
    PlanningMilestone,
    'name' | 'outcome' | 'goalId' | 'targetDate' | 'successCriteria' | 'status'
  >
> & {
  /** Moves it into a workstream of the same project; `null` for the whole project. */
  subprojectId?: string | null
}

export interface CreatePlanningWorkItemInput {
  title: string
  description?: string
  milestoneId?: string | null
  status?: PlanningWorkItemStatus
  /** A custom column (MOP-26) of the project; its status is what the column counts as. */
  columnId?: string | null
  priority?: PlanningPriority
  labels?: string[]
  acceptanceCriteria?: string[]
  dependencyIds?: string[]
  /**
   * Waits-on links with their type and lag (N7.2a). Given, it replaces
   * `dependencyIds`; an id in `dependencyIds` alone is finish to start, 0 days.
   */
  dependencyLinks?: PlanningDependencyLinkInput[]
  targetDate?: string | null
  startDate?: string | null
  /** Hidden until this day, `YYYY-MM-DD` (N9). */
  showFrom?: string | null
  /** In Someday (N9). */
  someday?: boolean
  /** Impact, 1 to 5, or null (N1.1b). */
  impact?: number | null
  /** Effort, 1 to 5, or null (N1.1b). */
  effort?: number | null
  assigneeId?: string | null
  estimate?: number | null
  autoQueue?: boolean
  /** Plan first (N9.3b): "default", "yes" or "no"; "default" when left out. */
  planFirst?: PlanFirstChoice
  /** Why it is blocked, up to 200 characters; kept only while the status is blocked. */
  blockedReason?: string
  parentWorkItemId?: string | null
  taskCode?: string
  phaseCode?: string
  phaseName?: string
  /** Required (and only meaningful) when parentWorkItemId is set. Defaults to 1 if omitted. */
  subtaskPhaseNumber?: number | null
  subtaskPhaseName?: string
  /** Custom field values by field id (R2.2). */
  fieldValues?: PlanningFieldValuesInput
  /** The iteration it goes in (R6.1), or null. */
  iterationId?: string | null
  /** The workstream (sub-project) it goes in, of the same project, or null. */
  subprojectId?: string | null
  /** Its task type (N2.7a), or null for none. */
  typeId?: string | null
  /**
   * How it was captured (N4.3a): a quick capture lands in To triage when its
   * project has Triage new captures on. Every other surface leaves it out.
   */
  capture?: TriageCapture
}

/** The ways a quick capture is made (N4.3a): quick add, Snip to task, tasks from text, the API. */
export const TRIAGE_CAPTURES = ['quick-add', 'snip', 'text', 'api'] as const
export type TriageCapture = (typeof TRIAGE_CAPTURES)[number]

/** What Accept may set on a task leaving To triage (N4.3a). */
export type TriageAcceptFields = Partial<
  Pick<
    PlanningWorkItem,
    'status' | 'priority' | 'assigneeId' | 'labels' | 'targetDate' | 'milestoneId'
  >
>

/** A project's To triage (N4.3a): the waiting tasks, oldest first, and their pictures. */
export interface TriageList {
  items: PlanningWorkItem[]
  /** Each task's first attached picture, by task id, for its thumbnail. */
  pictures: Record<string, LibraryItem>
}

/** A task moved to another project's To triage (N4.3a): the new task, and what undo needs. */
export interface TriageMoveResult {
  workItem: PlanningWorkItem
  /** The original, now in the recycle bin. */
  movedFromId: string
  /** The Library items copied into the other project for the new task. */
  copiedItemIds: string[]
}

/** The fields a task in a batch can refuse about, so a plan grid can mark that cell. */
export type PlanningRefusedField = 'dueDate' | 'dependencyIds' | 'parentWorkItemId'

/**
 * One task in a batch (the plan grid's rows, `POST /work-items/batch`). The
 * refs name other rows of the same batch: `parentRef` makes a subtask,
 * `dependencyRefs` the rows it waits on, `milestoneRef` a milestone named in
 * the batch. A row may also name existing tasks and milestones by id.
 */
export interface PlanningWorkItemBatchRow extends CreatePlanningWorkItemInput {
  /** A short name for this row: letters, digits, - or _. */
  ref?: string
  milestoneRef?: string
  parentRef?: string
  dependencyRefs?: string[]
}

/** Why one row of a batch was refused. `index` is -1 when the batch itself is malformed. */
export interface PlanningWorkItemBatchRowError {
  index: number
  field: PlanningRefusedField | null
  message: string
}

export type UpdatePlanningWorkItemInput = Partial<
  Pick<
    PlanningWorkItem,
    | 'title'
    | 'description'
    | 'milestoneId'
    | 'status'
    | 'columnId'
    | 'priority'
    | 'labels'
    | 'acceptanceCriteria'
    | 'dependencyIds'
    | 'targetDate'
    | 'startDate'
    | 'showFrom'
    | 'someday'
    | 'impact'
    | 'effort'
    | 'inTriage'
    | 'assigneeId'
    | 'estimate'
    | 'autoQueue'
    | 'planFirst'
    | 'blockedReason'
    | 'subtaskPhaseNumber'
    | 'subtaskPhaseName'
    | 'iterationId'
    | 'typeId'
    | 'subprojectId'
  >
> & {
  /** Custom field values by field id (R2.2): only the fields named change; `null` clears one. */
  fieldValues?: PlanningFieldValuesInput
  /**
   * Waits-on links with their type and lag (N7.2a): replaces every link. With
   * `dependencyIds` alone, a link kept keeps its type and lag and a new one is
   * finish to start, 0 days.
   */
  dependencyLinks?: PlanningDependencyLinkInput[]
  /**
   * This update undoes an earlier one (R6.2): the `ruleRun.id` that update
   * returned. What those rules did is undone first, in the same transaction,
   * and the undo itself sets off no rules.
   */
  undoRuleRun?: string
}

/** The narrow, four-column write path used by ACCEPT_TASK_STATUS_REVIEW. Nothing else is touched. */
export interface UpdatePlanningVerificationInput {
  verificationStatus: PlanningVerificationStatus
  verifiedBy: PlanningVerifiedBy
  verificationNotes?: string
}

/** Optional per-project, per-column WIP limits for the Kanban board. Advisory only — never enforced as a hard gate. */
export type PlanningWipLimits = Partial<Record<PlanningWorkItemStatus, number>>

/**
 * A project's Board columns (R2.4, D34): display names and hidden columns.
 * The six statuses never change; these are words and visibility only.
 * Read a label through `taskStatusLabel(status, columns)`.
 */
export interface PlanningColumnSettings {
  /** A display name by status; a status not listed shows its standard word. */
  names: Partial<Record<PlanningWorkItemStatus, string>>
  /** Hidden statuses, in Board order: only ready, blocked and review. */
  hidden: PlanningWorkItemStatus[]
  /** The project's own columns (MOP-26), in Board order; left out when there are none. */
  custom?: PlanningCustomColumn[]
}

/**
 * A column of the project's own (MOP-26): a status with its own name that
 * counts as one of the six, shown on the Board after that status's column.
 */
export interface PlanningCustomColumn {
  id: string
  name: string
  countsAs: PlanningWorkItemStatus
  hidden: boolean
}

/** The change a person or the API asks for: a blank name restores the standard word. */
export interface UpdatePlanningColumnSettingsInput {
  names?: Partial<Record<PlanningWorkItemStatus, string | null>>
  hidden?: PlanningWorkItemStatus[]
  /**
   * The project's own columns, the whole list in Board order (MOP-26). A
   * column with a known `id` is kept and changed; one without is added; a
   * column left out is deleted, and its tasks go back to the column it
   * counted as.
   */
  custom?: { id?: string; name: string; countsAs: PlanningWorkItemStatus; hidden?: boolean }[]
}

/** The longest column name. */
export const MAX_COLUMN_NAME_LENGTH = 40
/** The most columns of its own a project may have (MOP-26). */
export const MAX_CUSTOM_COLUMNS = 20

export type PlanningDecisionOrigin = 'human' | 'ai-approved'

export interface PlanningDecision {
  id: string
  projectId: string
  title: string
  context: string
  decision: string
  alternativesConsidered: string
  consequences: string
  date: string
  linkedWorkItemIds: string[]
  origin: PlanningDecisionOrigin
  createdAt: number
  updatedAt: number
}

export interface CreatePlanningDecisionInput {
  title: string
  context?: string
  decision: string
  alternativesConsidered?: string
  consequences?: string
  date?: string
  linkedWorkItemIds?: string[]
}

export type UpdatePlanningDecisionInput = Partial<
  Pick<
    PlanningDecision,
    | 'title'
    | 'context'
    | 'decision'
    | 'alternativesConsidered'
    | 'consequences'
    | 'date'
    | 'linkedWorkItemIds'
  >
>

export interface AIDecisionDraft {
  schemaVersion: 1
  /** `PROMPT_VERSIONS` for the prompt that wrote it. */
  promptVersion: number
  draftId: string
  projectId: string
  generatedAt: string
  provider: AIProvider
  model: string
  title: string
  context: string
  decision: string
  alternativesConsidered: string
  consequences: string
  date: string
  linkedWorkItemIds: string[]
  rationale: string
  evidence: string[]
  assumptions: string[]
  warnings: string[]
}

export interface AIDecisionApproval {
  title: string
  context: string
  decision: string
  alternativesConsidered: string
  consequences: string
  date: string
  linkedWorkItemIds: string[]
}

/** Result of an explicit human-approved planning-to-harness handoff. */
export interface PlanningHarnessHandoff {
  workItem: PlanningWorkItem
  task: HarnessTask
}

/**
 * Result of queuing a selection at once. `skipped` is the honest half: work the
 * board offered but that was not dispatchable, each with the reason, so a
 * partial success never looks like a silent failure.
 */
export interface PlanningBulkQueueResult {
  queued: PlanningHarnessHandoff[]
  skipped: { workItemId: string; title: string; reason: string }[]
}

/** Result of a human queue-management action that may also update linked planning work. */
export interface HarnessTaskPlanningUpdate {
  task: HarnessTask
  workItem: PlanningWorkItem | null
}

export interface AIPlanningSuggestion {
  title: string
  description: string
  priority: PlanningPriority
  acceptanceCriteria: string[]
  rationale: string
  evidence: string[]
  /**
   * Library item ids Ostler AI proposes to attach for this task's agent, taken
   * from the context it was given and checked through `aiVisibleItem`.
   */
  attachments?: string[]
}

export interface AIPlanningDraft {
  /** Library items, at their revisions, that fed this draft. */
  sources?: AIDraftSource[]
  schemaVersion: 1
  /** `PROMPT_VERSIONS` for the prompt that wrote it. */
  promptVersion: number
  projectId: string
  goalId: string
  generatedAt: string
  provider: AIProvider
  model: string
  summary: string
  assumptions: string[]
  warnings: string[]
  suggestions: AIPlanningSuggestion[]
}

export interface AIPlanningSuggestionApproval {
  suggestionIndex: number
  title: string
  description: string
  priority: PlanningPriority
  acceptanceCriteria: string[]
  /** The suggestion's proposed attachments the human left ticked. */
  attachments?: string[]
}

/** Counts of the bounded Ostler database records supplied to an AI next-task draft. */
export interface AINextTasksEvidenceSummary {
  goals: number
  milestones: number
  workItems: number
  watchEvents: number
  gitCommits: number
  harnessEvents: number
  windowDays: number
}

/** A persisted, read-only AI proposal. Nothing is added to planning until human approval. */
export interface AINextTasksDraft {
  /** Library items, at their revisions, that fed this draft. */
  sources?: AIDraftSource[]
  schemaVersion: 1
  /** `PROMPT_VERSIONS` for the prompt that wrote it. */
  promptVersion: number
  draftId: string
  projectId: string
  generatedAt: string
  provider: AIProvider
  model: string
  summary: string
  assumptions: string[]
  warnings: string[]
  evidenceSummary: AINextTasksEvidenceSummary
  suggestions: AIPlanningSuggestion[]
}

/** Human-edited selection from a persisted next-task draft. */
export interface AINextTaskApproval {
  suggestionIndex: number
  title: string
  description: string
  priority: PlanningPriority
  acceptanceCriteria: string[]
  milestoneId: string | null
  status: 'backlog' | 'ready'
  /** The suggestion's proposed attachments the human left ticked. */
  attachments?: string[]
}

export interface AIProjectBriefAction {
  id: string
  title: string
  rationale: string
  evidence: string[]
  reviewStatus: 'pending' | 'approved' | 'rejected'
  reviewNotes: string
  creation: {
    type: 'goal' | 'milestone' | 'work-item'
    recordId: string
    createdAt: string
  } | null
}

export interface AIProjectBrief {
  /** Library items, at their revisions, that fed this draft. */
  sources?: AIDraftSource[]
  schemaVersion: 1
  /** `PROMPT_VERSIONS` for the prompt that wrote it. */
  promptVersion: number
  projectId: string
  generatedAt: string
  provider: AIProvider
  model: string
  health: 'on-track' | 'at-risk' | 'blocked'
  headline: string
  summary: string
  nextActions: AIProjectBriefAction[]
  risks: string[]
  assumptions: string[]
  warnings: string[]
}

export type PlanningBlockerStatus = 'open' | 'resolved'
export type PlanningBlockerReportedBy = 'agent' | 'human' | 'ai-review'

export interface PlanningBlocker {
  id: string
  workItemId: string
  description: string
  reportedBy: PlanningBlockerReportedBy
  reportedAt: number
  status: PlanningBlockerStatus
  resolutionOptions: string[]
  resolutionChoice: string | null
  resolutionNote: string
  resolvedAt: number | null
  resolvedBy: string | null
}

/** A blocker joined with the work item it's attached to, for the overview panel. */
export interface PlanningBlockerWithWorkItem extends PlanningBlocker {
  workItemTitle: string
  workItemCode: string
}

/**
 * "Plan work from these": a goal Ostler AI proposed from library items. Never
 * stored; the human edits it and the goal exists only once they confirm.
 */
export interface AILibraryGoalProposal {
  projectId: string
  title: string
  outcome: string
  warnings: string[]
  /** Library items, at their revisions, that fed this proposal. */
  sources: AIDraftSource[]
}

export interface AIMasterPlanDraft {
  /** Library items, at their revisions, that fed this draft. */
  sources?: AIDraftSource[]
  schemaVersion: 1
  /** `PROMPT_VERSIONS` for the prompt that wrote it. */
  promptVersion: number
  draftId: string
  projectId: string
  goalId: string
  generatedAt: string
  provider: AIProvider
  model: string
  summary: string
  auditFindings: string[]
  nonNegotiableRules: string[]
  phases: { code: string; name: string; objective: string }[]
  assumptions: string[]
  warnings: string[]
}

/** Human-edited selection from a persisted master-plan draft. */
export interface AIMasterPlanApproval {
  summary: string
  auditFindings: string[]
  nonNegotiableRules: string[]
  phases: { code: string; name: string; objective: string; included: boolean }[]
}

export interface AIPlanTaskNode {
  /** "B4", "B4.1", "B4.1.1" — assigned at parse time by array position, never by the model. */
  code: string
  depth: 1 | 2 | 3
  title: string
  context: string
  task: string
  constraints: string[]
  acceptanceCriteria: string[]
  outOfScope: string[]
  /**
   * Checks the executing agent makes before changing anything ("Do not start
   * if"). Optional on every briefing list below: drafts stored before they
   * existed simply lack them.
   */
  preconditions?: string[]
  /** What to read first ("Refer to"): earlier tasks' deliverables by path, attachments by title. */
  references?: string[]
  /** What the task leaves committed: a repo-relative path, its form and required contents. */
  deliverables?: string[]
  /** Codes of other tasks in this draft that must be Done first. */
  reliesOn: string[]
  priority: PlanningPriority
  rationale: string
  evidence: string[]
  /** Library item ids proposed for this task's agent; see AIPlanningSuggestion.attachments. */
  attachments?: string[]
  subtasks: AIPlanTaskNode[]
}

export interface AITaskSplitDraft {
  /** Library items, at their revisions, that fed this draft. */
  sources?: AIDraftSource[]
  schemaVersion: 1
  /** `PROMPT_VERSIONS` for the prompt that wrote it. */
  promptVersion: number
  draftId: string
  projectId: string
  goalId: string
  masterPlanDraftId: string
  generatedAt: string
  provider: AIProvider
  model: string
  phases: { code: string; name: string; tasks: AIPlanTaskNode[] }[]
  /** Per-phase notes (the vision fallback); absent on drafts stored before it existed. */
  warnings?: string[]
}

/** Human-edited selection from a persisted task-split draft. Flat by code; tree shape is rebuilt server-side. */
export interface AITaskSplitNodeApproval {
  code: string
  included: boolean
  title: string
  context: string
  task: string
  constraints: string[]
  acceptanceCriteria: string[]
  outOfScope: string[]
  preconditions?: string[]
  references?: string[]
  deliverables?: string[]
  reliesOn: string[]
  priority: PlanningPriority
  /** The node's proposed attachments the human left ticked. */
  attachments?: string[]
}

export interface AITaskSplitApproval {
  phases: { code: string; name: string }[]
  nodes: AITaskSplitNodeApproval[]
}

export type TaskSplitPhaseStatus = 'pending' | 'running' | 'done' | 'failed'

export interface TaskSplitPhaseProgress {
  code: string
  name: string
  status: TaskSplitPhaseStatus
  /** Nodes produced for this phase, counting subtasks. Zero until it completes. */
  taskCount: number
  error: string | null
}

/**
 * A task split running in the background, one phase per model call. The split is
 * the longest AI operation in Ostler (minutes, not seconds), so it runs detached
 * from the wizard: the window can be closed and reopened without losing progress,
 * and a phase that fails can be retried on its own instead of redoing the rest.
 */
export interface TaskSplitJob {
  jobId: string
  projectId: string
  goalId: string
  masterPlanDraftId: string
  /** Id the assembled draft will be stored under; null until every phase is done. */
  draftId: string | null
  status: 'running' | 'done' | 'failed' | 'cancelled'
  phases: TaskSplitPhaseProgress[]
  startedAt: string
  updatedAt: string
  error: string | null
}

export interface TaskStatusReviewItem {
  workItemId: string
  claimedStatus: string
  evidenceAssessment: string
  concerns: string[]
  recommendedVerification: PlanningVerificationStatus
  confidence: 'low' | 'medium' | 'high'
}

/** Output of the read-only second-AI-session auditor. Never writable beyond the four verification columns. */
export interface TaskStatusReviewDraft {
  schemaVersion: 1
  /** `PROMPT_VERSIONS` for the prompt that wrote it. */
  promptVersion: number
  draftId: string
  projectId: string
  generatedAt: string
  provider: AIProvider
  model: string
  items: TaskStatusReviewItem[]
}

export interface AIWorkItemImprovement {
  /** Library items, at their revisions, that fed this draft. */
  sources?: AIDraftSource[]
  schemaVersion: 1
  /** `PROMPT_VERSIONS` for the prompt that wrote it. */
  promptVersion: number
  projectId: string
  workItemId: string
  generatedAt: string
  provider: AIProvider
  model: string
  title: string
  description: string
  priority: PlanningPriority
  acceptanceCriteria: string[]
  rationale: string
  assumptions: string[]
  warnings: string[]
  /** Library item ids proposed for this work item's agent; see AIPlanningSuggestion.attachments. */
  attachments?: string[]
}

// ─── AI Task Review ─────────────────────────────────────────────────────────

/**
 * A single async, AI-generated review of one work item: what happened while
 * it was worked (backward evidence) and what it affects downstream (forward
 * evidence), plus an optional proposal for a human to accept, comment on, or
 * dismiss. Reviews are append-only history per work item - see
 * AIStorageService's task-reviews namespace.
 */
export interface TaskReview {
  id: string
  workItemId: string
  projectId: string
  generatedAt: string
  evidenceFingerprint: string
  diagnosis: string
  proposal: {
    title: string
    description: string
    priority: PlanningPriority
    acceptanceCriteria: string[]
  } | null
  downstreamEffects: { workItemId: string; workItemTitle: string; impact: string }[]
  status: 'open' | 'accepted' | 'dismissed'
  humanComment: string
  error: string | null
  /** Set once the proposal is accepted and a new work item is created from it. */
  createdWorkItemId?: string | null
}

/**
 * A read-only AI assessment of one milestone. Deterministic rules already say
 * what the next mechanical step is; this covers the judgement they cannot
 * reach - overlapping scope, missing decisions, a plan the evidence no longer
 * supports. Persisted per milestone so the card can show the last verdict
 * without spending a call on every render.
 */
export interface AIMilestoneAdvisory {
  /** Library items, at their revisions, that fed this draft. */
  sources?: AIDraftSource[]
  schemaVersion: 1
  /** `PROMPT_VERSIONS` for the prompt that wrote it. */
  promptVersion: number
  projectId: string
  milestoneId: string
  generatedAt: string
  provider: AIProvider
  model: string
  /**
   * `ready-to-close` is never the model's to choose: Ostler sets it when every
   * linked task is done, by the same rule as the card's badge.
   */
  health: 'on-track' | 'at-risk' | 'blocked' | 'ready-to-close'
  headline: string
  summary: string
  recommendations: AIMilestoneRecommendation[]
  risks: string[]
  assumptions: string[]
  warnings: string[]
  /**
   * Hash of the evidence the advisory was built from. When the milestone's
   * current evidence hashes differently the card marks the advisory stale
   * rather than quietly presenting it as current.
   */
  evidenceFingerprint: string
}

export interface AIMilestoneRecommendation {
  title: string
  rationale: string
  evidence: string[]
  /**
   * One concrete edit the owner can make with a click. Advice for a human, not
   * a queued action: nothing changes until they press the button, and every id
   * in it was checked against the evidence the model was shown.
   */
  action?: AIMilestoneAction
}

export type AIMilestoneAction =
  | { kind: 'add-task'; title: string; description: string }
  | { kind: 'add-success-criterion'; text: string }
  | { kind: 'add-acceptance-criterion'; workItemId: string; text: string }
  | { kind: 'include-library-item'; itemId: string; title: string }

/** How far along a workstream is. */
export type PlanningSubprojectStatus = 'active' | 'on_hold' | 'done'

/**
 * A named part of one project (a team, a workstream). It shares everything
 * with its project; only tasks and milestones say which part they belong to.
 */
export interface PlanningSubproject {
  id: string
  projectId: string
  name: string
  description: string
  color: string
  icon: ProjectIcon | null
  leadId: string | null
  memberIds: string[]
  status: PlanningSubprojectStatus
  position: number
  archivedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface CreatePlanningSubprojectInput {
  name: string
  description?: string
  /** Left out, the project's colour. */
  color?: string
  icon?: ProjectIcon | null
  leadId?: string | null
  memberIds?: string[]
  status?: PlanningSubprojectStatus
}

export type UpdatePlanningSubprojectInput = Partial<CreatePlanningSubprojectInput>
