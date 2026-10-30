import type { RecurrenceRule } from '../recurrence'
import type { TaskFilter } from '../task-filter'
import type {
  PlanningMilestoneStatus,
  PlanningPriority,
  PlanningWorkItemStatus
} from './planning-types'
import type { EstimateUnit } from './people-types'
import type { SnipPreview } from '../snip'

// ─── Home, Inbox, reminders and recurring tasks (P5.6) ──────────────────────

/** A task as Home lists it, with its project's name and colour. */
export interface HomeTask {
  id: string
  projectId: string
  projectName: string
  projectColor: string
  /** The sub-project (shown as a workstream) the task is in, or null. */
  subprojectId?: string | null
  title: string
  status: PlanningWorkItemStatus
  priority: PlanningPriority
  /** The due date, `YYYY-MM-DD`. */
  targetDate: string | null
  assigneeId: string | null
  /** Queued for an agent: its status follows the agent run. */
  linked: boolean
  /** Why it is in Today. Absent in Upcoming. */
  reason?: 'overdue' | 'today' | 'new-today' | 'in-progress'
  /** In the project's `estimateUnit`, or null (N1.4: Plan my day's total). */
  estimate?: number | null
  estimateUnit?: EstimateUnit
}

/** The most tasks one day's My day list may hold. */
export const MAX_MY_DAY_TASKS = 200

/** A task in My day (N1.4), with its estimate for the day's total. */
export interface MyDayTask extends HomeTask {
  estimate: number | null
  estimateUnit: EstimateUnit
}

/** The next morning's offer (N1.4): the unfinished tasks of the last day that had a list. */
export interface MyDayLeftOver {
  /** That day, `YYYY-MM-DD`: yesterday, or an earlier day when there was no list since. */
  date: string
  tasks: MyDayTask[]
}

/** What Plan my day offers to pick from (`getPlanMyDay`, N1.4). */
export interface PlanMyDayCandidates {
  /** Today's list as it is, in order; empty before the day is planned. */
  myDay: MyDayTask[]
  leftOver: MyDayLeftOver | null
  /** Today's automatic list (`getMyWork`'s Today), with estimates. */
  today: MyDayTask[]
  /** Open high and critical tasks assigned to Me with no due date, a short list. */
  highPriority: MyDayTask[]
}

/** Where to put a task in a day's list: at the end, or before or after another entry. */
export interface MyDayPlacement {
  /** The person's local date, `YYYY-MM-DD`. */
  date: string
  beforeId?: string | null
  afterId?: string | null
}

/** What adding to My day did, and whether the task was brought back first (N1.1a). */
export interface MyDayAddResult {
  workItemId: string
  date: string
  broughtBack: 'someday' | 'later' | null
  /** It was already in the day's list; nothing changed. */
  already: boolean
}

/** How many days Upcoming covers, after today (Home and Print my week). */
export const UPCOMING_DAYS = 7

/**
 * A dated checklist item as Home and My work list it (N2.2, N17): "item, in
 * task". Only unticked items of open, shown tasks.
 */
export interface HomeChecklistItem {
  workItemId: string
  projectId: string
  projectName: string
  projectColor: string
  /** The task's title. */
  taskTitle: string
  /** The item's text: its key on the task. */
  text: string
  /** `YYYY-MM-DD`. */
  dueDate: string
  assigneeId: string | null
  /** Before today. */
  overdue: boolean
}

/** One day of Upcoming. */
export interface HomeDay {
  date: string
  tasks: HomeTask[]
  /** Checklist items due that day (N2.2); absent when there are none. */
  items?: HomeChecklistItem[]
}

/**
 * Home's Today and Upcoming (`getMyWork`), across every enabled project.
 * Today: overdue, due today and in progress, assigned to Me or to nobody.
 * Upcoming: due in the next 7 days, assigned to Me only.
 */
export interface MyWork {
  today: HomeTask[]
  /**
   * Checklist items for Today (N2.2): overdue or due today, assigned to Me or
   * to nobody. Optional only for records built outside the service (tests).
   */
  todayItems?: HomeChecklistItem[]
  upcoming: HomeDay[]
  /** Today's My day (N1.4), in the person's order; empty when the day is not planned. */
  myDay: MyDayTask[]
  /** The unfinished tasks of the last day that had a list, until the person chooses. */
  leftOver: MyDayLeftOver | null
}

/**
 * A task as My work lists it (R3.1): a live task assigned to one person, with
 * its project's name, colour and estimate unit and its milestone's name.
 */
export interface AssignedTask {
  id: string
  projectId: string
  projectName: string
  projectColor: string
  estimateUnit: EstimateUnit
  title: string
  status: PlanningWorkItemStatus
  /** The project's own column it is in (MOP-26), for its name. */
  columnId?: string | null
  priority: PlanningPriority
  /** The due date, `YYYY-MM-DD`. */
  targetDate: string | null
  startDate: string | null
  assigneeId: string | null
  milestoneId: string | null
  milestoneName: string | null
  estimate: number | null
  labels: string[]
  /** Queued for an agent: its status follows the agent run. */
  linked: boolean
  createdAt: number
  updatedAt: number
}

/** What My work asks for (`getAssignedTasks`). */
export interface AssignedTasksQuery {
  /** The person whose tasks to list; an archived person is allowed. */
  personId: string
  /** One project only; null or absent for every enabled project. */
  projectId?: string | null
  /** Leave out done tasks. */
  hideDone?: boolean
  /** Words the title or description contains. */
  query?: string
  filter?: TaskFilter
  /** The renderer's local date, `YYYY-MM-DD`, for relative date filters. */
  today: string
}

/** What My work asks for its checklist items (`getAssignedChecklistItems`, N2.2). */
export interface AssignedChecklistItemsQuery {
  personId: string
  /** One project only; null or absent for every enabled project. */
  projectId?: string | null
  /** The renderer's local date, `YYYY-MM-DD`: earlier items are overdue. */
  today: string
}

/** What Workload asks for (`getWorkloadTasks`, R3.2). */
export interface WorkloadTasksQuery {
  /** Only these projects; null or absent for every enabled project. */
  projectIds?: string[] | null
  /** The last day shown, `YYYY-MM-DD`: tasks starting later are left out. */
  through: string
}

/** A dated milestone on the Timeline across projects (`getTimelineOverview`, N5.4). */
export interface TimelineOverviewMilestone {
  id: string
  name: string
  /** `YYYY-MM-DD`: milestones without a target date are left out. */
  targetDate: string
  status: PlanningMilestoneStatus
}

/** One enabled project's row on the Timeline across projects (N5.4). */
export interface TimelineOverviewProject {
  projectId: string
  /** Its dated milestones, by date. */
  milestones: TimelineOverviewMilestone[]
  /** The first and last day of its dated live tasks, or null when none has a date. */
  firstDate: string | null
  lastDate: string | null
}

/**
 * What Reschedule plans (N1.3, `previewReschedule`): the overdue tasks named,
 * or, when none are, the person's overdue tasks as Home's Today counts them.
 */
export interface RescheduleQuery {
  /** The renderer's local date, `YYYY-MM-DD`. */
  today: string
  mode: 'today' | 'tomorrow' | 'date' | 'spread'
  /** The day for `date`. */
  date?: string
  /** Working days for `spread`, 1 to 30; 5 by default. */
  days?: number
  workItemIds?: string[]
  /** Whose capacity and working days count; Me when left out. */
  personId?: string | null
}

export type NeedsYouKind = 'blocked' | 'question' | 'review' | 'plan'

/** Something waiting for the person (`getNeedsYou`). */
export interface NeedsYouEntry {
  key: string
  kind: NeedsYouKind
  projectId: string
  title: string
  /** The task it is about, when there is one. */
  taskId: string | null
  /** A plan waiting for approval (N9.3b): the run that sent it. */
  sessionId?: string
  /** A review (N9.5b): where its reviewer got to, when it was reviewed. */
  reviewer?: NeedsYouReviewer
}

/** Where a reviewed session's reviewer got to (N9.5b), as Needs you and the Inbox say it. */
export type NeedsYouReviewer = 'running' | 'overdue' | 'reported' | 'failed'

export type InboxItemKind =
  | 'reminder'
  | 'question'
  | 'review'
  /** A plan waiting for approval (N9.3b). */
  | 'plan'
  | 'blocker'
  | 'import'
  | 'update'
  /** A project's built-in agent reached a token limit (R5.3). */
  | 'agentLimit'
  /** A rule's "Notify me" (R6.2). */
  | 'rule'
  /** Backups could not be copied to the second place (N6.1). */
  | 'backupCopy'
  /** It is time for the weekly review (N1.5). */
  | 'weeklyReview'
  /** It is time for a project's status update (N5.5). */
  | 'statusUpdate'
  /** A repeating milestone's next round was started on schedule (N5.7a). */
  | 'round'
  /** A new commit says it fixes an open task: Mark as done is offered (N9.8b). */
  | 'commit'
  /** Tasks wait in a project's To triage (N4.3a): one item per project. */
  | 'triage'
  /** Another person mentioned you in a comment (prompt 14). */
  | 'mention'
  /** Someone asked you to sign a task, decision or milestone off (prompt 17). */
  | 'signOff'
  /** A repeating task's occurrence was queued for agents by its schedule, or could not be (N9.7). */
  | 'scheduled'

/**
 * One thing that happened and wants attention. Every source returns this
 * shape; P6.1 (imports) and P10.1 (updates) add sources through the same
 * registry (`InboxService.registerSource`).
 */
export interface InboxItem {
  /** Stable across reloads: `reminder:<id>`, `question:<projectId>:<id>`… */
  key: string
  kind: InboxItemKind
  title: string
  body: string
  projectId: string | null
  taskId: string | null
  createdAt: number
  /** The milestone it is about (a round, N5.7a), when there is one. */
  milestoneId?: string
  /** The decision it is about (a sign-off asked of you, prompt 17), when there is one. */
  decisionId?: string
  /** The run whose plan waits for approval (a plan, N9.3b). */
  sessionId?: string
  /**
   * A reminder that keeps reminding and still is (N1.7): the Inbox offers
   * Done and Stop reminding as well as Snooze.
   */
  nudging?: boolean
  /**
   * The task's status when a commit says it fixes it (a commit, N9.8b): Mark
   * as done's Undo puts it back.
   */
  fromStatus?: PlanningWorkItemStatus
  /**
   * An occurrence its repeat's schedule could not queue for agents, its task
   * not done (scheduled): the Inbox offers Queue it now.
   */
  queueNow?: boolean
}

/** An Inbox item with its stored state. */
export interface InboxEntry extends InboxItem {
  readAt: number | null
}

export interface InboxList {
  /** Newest first; archived items left out. */
  items: InboxEntry[]
  unreadCount: number
}

/** When a snoozed reminder comes back. */
export type InboxSnooze = 'hour' | 'tomorrow'

export type ReminderKind = 'due' | 'custom'

export interface PlanningReminder {
  id: string
  projectId: string
  workItemId: string
  /** The instant, in ms. */
  remindAt: number
  kind: ReminderKind
  deliveredAt: number | null
  dismissedAt: number | null
  /** Keep reminding (N1.7): after delivery it comes back every `intervalMinutes`. */
  keepReminding: boolean
  /** Minutes between nudges, or null when it does not keep reminding. */
  intervalMinutes: number | null
  /** When its notification was last shown (delivery counts). */
  lastNudgedAt: number | null
  /** When it stopped: Stop reminding, the task finished, or midnight (missed). */
  stoppedAt: number | null
}

/** How to add a reminder (N1.7): keep reminding, and how often. */
export interface PlanningReminderOptions {
  keepReminding?: boolean
  /** 5, 15, 30 or 60; the Settings › Notifications default when left out. */
  intervalMinutes?: number
}

/** A task's repeat rule (`planning_recurrences`). */
export interface PlanningRecurrence {
  workItemId: string
  projectId: string
  rule: RecurrenceRule
  endsOn: string | null
  /** Occurrences still to come after this one; null for no limit. */
  remaining: number | null
  /** Take turns (N2.3): person ids in order, or null. */
  rotation: string[] | null
  /** Whose turn is next, an index into `rotation`. */
  nextIndex: number
  /**
   * Go to agents when it comes round (N9.7, N65): each occurrence is queued
   * for agents once, on its start date (or its due date). Moves with the rule.
   */
  goToAgents: boolean
}

/** What `setPlanningRecurrence` accepts. Null removes the repeat. */
export interface PlanningRecurrenceInput {
  rule: RecurrenceRule
  endsOn?: string | null
  remaining?: number | null
  /** Take turns (N2.3): person ids in order; null or empty for none. */
  rotation?: string[] | null
  /** Whose turn is next. Left out, the person who was next stays next. */
  nextIndex?: number
  /** Go to agents when it comes round (N9.7). Left out, it stays as it was (off for a new repeat). */
  goToAgents?: boolean
}

/** "Remind me about due tasks" (Settings › Notifications). */
export const DUE_REMINDER_MODES = ['off', 'dueDate', 'dayBefore', 'both'] as const
export type DueReminderMode = (typeof DUE_REMINDER_MODES)[number]

/** How long an in-app notification stays on screen (Settings › Notifications). */
export const IN_APP_NOTIFICATION_DURATIONS = ['short', 'normal', 'long', 'untilClosed'] as const
export type InAppNotificationDuration = (typeof IN_APP_NOTIFICATION_DURATIONS)[number]

/**
 * A navigate event from main: a notification was clicked, or a deep link
 * (`src/shared/deep-link.ts`) or jump-list entry arrived. The renderer builds
 * the path itself (`navigation/paths.ts`) and checks a project view against
 * the registry.
 */
export type NavigateRequest =
  | { kind: 'task'; projectId: string; taskId: string }
  | { kind: 'project'; projectId: string; view: string }
  | { kind: 'inbox' }
  | { kind: 'quick-add' }
  /** Snip to task (N4.2a): quick add opens with the picture just snipped. Never from a link. */
  | { kind: 'snip'; snip: SnipPreview }
  /** The weekly review (N1.5): its reminder's notification and Inbox entry open it. */
  | { kind: 'weekly-review' }
  /** A project's status update reminder (N5.5): opens the posting dialog on its Overview. */
  | { kind: 'status-update'; projectId: string }
  /** A milestone, decision or Library item (N4.4a): links in texts and from outside Ostler. */
  | { kind: 'milestone' | 'decision' | 'library'; projectId: string; id: string }
  /** A goal of one's own (N5.6b) in the Goals view: its countdown in the tray and jump list. */
  | { kind: 'personal-goal'; id: string }
  /**
   * A join link (prompt 07): the Join dialog opens filled in. The invite stays in main
   * under `inviteId`; the renderer never sees its text.
   */
  | { kind: 'join-share'; inviteId: string }
  /** Settings › Devices: a device asking to join this person's personal space (people and devices, D16). */
  | { kind: 'devices' }

// ─── Weekly review (N1.5, N13) ──────────────────────────────────────────────

/** The review's steps, in order. */
export const WEEKLY_REVIEW_STEPS = [
  'inbox',
  'overdue',
  'blocked',
  'stale',
  'someday',
  'upcoming',
  'milestones'
] as const
export type WeeklyReviewStepId = (typeof WEEKLY_REVIEW_STEPS)[number]

/** What one step showed, and how many of those the person changed in it. */
export interface WeeklyReviewStepCounts {
  shown: number
  changed: number
}

/** A finished review. */
export interface WeeklyReviewRecord {
  id: string
  finishedAt: number
  /** The steps the person went through; a skipped step is absent. */
  steps: Partial<Record<WeeklyReviewStepId, WeeklyReviewStepCounts>>
}

/** A task in a review step, with the moment its step measures from. */
export interface WeeklyReviewTask extends HomeTask {
  /**
   * Blocked: when it was last moved to Blocked. Nothing changed: when it was
   * last updated. Someday: when it was made. Otherwise when it was last updated.
   */
  since: number
}

/** A milestone in a review step. */
export interface WeeklyReviewMilestone {
  projectId: string
  projectName: string
  projectColor: string
  milestoneId: string
  name: string
  targetDate: string | null
  /** Why it is at risk, in words (the reports' at-risk section); empty in the next two weeks. */
  reason: string
}

/** One day of the next two weeks. */
export interface WeeklyReviewDay {
  date: string
  tasks: HomeTask[]
  milestones: WeeklyReviewMilestone[]
}

/** Every step's list, read across the enabled projects (`getWeeklyReview`). */
export interface WeeklyReview {
  today: string
  /** Inbox items waiting (not archived). */
  inboxCount: number
  overdue: WeeklyReviewTask[]
  blocked: WeeklyReviewTask[]
  stale: WeeklyReviewTask[]
  someday: WeeklyReviewTask[]
  upcoming: WeeklyReviewDay[]
  milestones: WeeklyReviewMilestone[]
}
