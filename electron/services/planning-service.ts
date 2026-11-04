import Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import type {
  AIPlanTaskNode,
  CreatePlanningDecisionInput,
  CreatePlanningGoalInput,
  CreatePlanningMilestoneInput,
  CreatePlanningWorkItemInput,
  GithubLink,
  PlanningBlocker,
  PlanningBlockerReportedBy,
  PlanningBlockerWithWorkItem,
  PlanningDecision,
  PlanningDecisionOrigin,
  PlanningGoal,
  PlanningGoalStatus,
  PlanningMilestone,
  PlanningMilestoneStatus,
  PlanningPriority,
  PlanningVerificationStatus,
  PlanningVerifiedBy,
  PlanningWipLimits,
  PlanningWorkItem,
  PlanningLinkKind,
  PlanningTaskLink,
  PlanningDescriptionVersion,
  CopyWorkItemResult,
  PlanningWorkItemOrigin,
  PlanningWorkItemPlacement,
  PlanningWorkItemScope,
  PlanningWorkItemStatus,
  PlanningRefusedField,
  PlanningLabel,
  PlanningLabelDeletion,
  UpdatePlanningDecisionInput,
  UpdatePlanningGoalInput,
  UpdatePlanningMilestoneInput,
  UpdatePlanningVerificationInput,
  UpdatePlanningWorkItemInput,
  PlanningChecklistDetailInput,
  ActivityPage,
  ActivityQuery,
  PlanningActor,
  PlanningComment,
  PlanningRecurrence,
  PlanningRecurrenceInput,
  PlanningScheduledQueueOutcome,
  PlanningReminder,
  PlanningReminderOptions,
  CreatePlanningFieldInput,
  PlanningFieldDefinition,
  PlanningFieldDeletion,
  PlanningFieldFills,
  AiFieldFillInput,
  AiFieldFillResult,
  AiFieldFillUndo,
  UpdatePlanningFieldInput,
  PlanningDependencyLink
} from '@shared/ostler-api'
import {
  DEFAULT_CONFIG,
  MAX_DEPENDENCY_LAG_DAYS,
  PLANNING_DEPENDENCY_TYPES,
  MAX_RESOLUTION_REASON_LENGTH,
  RECYCLE_BIN_RETENTION_DAYS,
  TRIAGE_CAPTURES
} from '@shared/ostler-api'
import type { ProjectUsage, ProjectUsageFact, ShareRole, TriageCapture } from '@shared/ostler-api'
import {
  dependencyLinksOf,
  isDependencyLag,
  isDependencyType,
  normalisedDependencyLink
} from '@shared/planning/dependency-links'
import { isoDaysBetween, shiftIsoDate, todayIsoDate } from '@shared/dates'
import {
  advanceRecurrence,
  nextOccurrenceDate,
  nextInRotation,
  normalizeRecurrence,
  rotationIndexAfterEdit,
  type RecurrenceSettings
} from '@shared/recurrence'
import { isHexColor, paletteColorFor } from '@shared/project-colors'
import { PeopleRepository } from './database/people-repository'
import { aggregateMetrics, historiesByWorkItem, metricsForItem } from './planning-metrics'
import type {
  PlanningAggregateMetrics,
  PlanningStatusTransition,
  PlanningWorkItemMetrics
} from '@shared/ostler-api'
import { PlanningWorkflowService } from './planning-workflow-service'
import { PlanningActivity, type HarnessActivityResolver } from './planning-activity'
import { PlanningReminders, type ReminderSettings } from './planning-reminders'
import { SearchService } from './search-service'
import type { TaskFilterContext } from '@shared/task-filter'
import { SavedViewsService } from './saved-views-service'
import { PinService } from './pin-service'
import { CommitLinkService } from './commit-link-service'
import { StatusUpdateService } from './status-update-service'
import { CostService } from './cost-service'
import { ShoppingService } from './shopping-service'
import { BaselineService } from './baseline-service'
import { BillingService } from './billing-service'
import { ContactsService } from './contacts-service'
import { GoalCheckInService } from './goal-check-in-service'
import { PersonalGoalService } from './personal-goal-service'
import { goalProgress, type GoalGlance, type GoalMeasure } from '@shared/goal-measures'
import { t } from '@shared/i18n'
import { customColumns } from '@shared/board-columns'
import { Refusal } from '@shared/refusal'
import { commentPermissions } from '@shared/comment-permissions'
import { MilestoneRounds } from './milestone-rounds'
import { taskCopyInput } from './task-copy'
import { LINK_TARGET_KINDS, rewriteItemLinks, type ItemLinkIdMaps } from '@shared/item-links'
import { BRAND } from '@shared/brand'
import type { ItemLinkInfo, ItemLinkRef, LinkedFromEntry, LinkTargetKind } from '@shared/ostler-api'
import { PlanningOrder, type OrderPlacement } from './planning-order'
import { PlanningFields } from './planning-fields'
import { PlanningAiFills } from './planning-ai-fills'
import { TimeTracking } from './time-tracking'
import { PlanningGithubLinks } from './planning-github-links'
import { PlanningChecklistDetails, detailsInOrder } from './planning-checklist-details'
import { PlanningTaskLinks, type TaskLinkRow } from './planning-task-links'
import { PlanningDescriptionVersions } from './planning-description-versions'
import { isLinkKind, linkRole } from '@shared/planning/links'
import { PlanningColumns } from './planning-columns'
import { PlanningIterations } from './planning-iterations'
import { PlanningTaskTypes } from './planning-task-types'
import { PlanningSubprojects } from './planning-subprojects'
import { PlanningRules } from './planning-rules'
import { TaskTemplates } from './task-templates'
import type { RuleChange } from '@shared/planning/rules'
import { currentIteration } from '@shared/planning/iterations'
import { parseTaskKey, taskKey } from '@shared/task-key'
import { attachChangeRecorder } from './change-history/recorder'
import { myRoleOf } from './sync/roles'
import { takeTaskNumber } from './sync/task-numbers'
import { autoFollowTask } from './follow-service'
import { statusUpdateHealthLabel } from '@shared/status-updates'
import type { TeamEvent } from './webhook-service'
import { resolveBlockersOfDoneTask } from './planning-done-blockers'
import { startMilestoneIfPlanned, writeChecklistCheck } from '@shared/planning/task-writes'
import {
  toRecurrence,
  toGoal,
  toMilestone,
  toDecision,
  toBlocker,
  jsonStringList,
  dependencyLinkFromRow,
  type GoalRow,
  type MilestoneRow,
  type WorkItemRow,
  type RecurrenceRow,
  type ChecklistCheckRow,
  type DependencyRow,
  type BlockerRow,
  type DecisionRow
} from './planning-rows'
import {
  measureValue,
  requiredText,
  optionalText,
  textList,
  uniqueIds,
  targetDate,
  planFirstChoice,
  flag,
  score,
  calendarDate,
  validateDateRange,
  estimate,
  enumValue
} from './planning-work-item-input'

const GOAL_STATUSES: PlanningGoalStatus[] = ['active', 'achieved', 'archived']
const MILESTONE_STATUSES: PlanningMilestoneStatus[] = ['planned', 'active', 'complete', 'archived']
const WORK_ITEM_STATUSES: PlanningWorkItemStatus[] = [
  'backlog',
  'ready',
  'active',
  'blocked',
  'review',
  'done'
]
const PRIORITIES: PlanningPriority[] = ['low', 'medium', 'high', 'critical']

/**
 * Owns human-authored planning records. It deliberately has no HarnessService
 * or AI provider dependency; those boundaries are joined later by explicit
 * composition flows rather than hidden service-to-service writes.
 */
/**
 * A refusal about one field of a task. The message is the one every surface
 * shows; the field only tells a plan grid which cell to put it on.
 */
export class PlanningFieldError extends Error {
  constructor(
    message: string,
    readonly field: PlanningRefusedField
  ) {
    super(message)
    this.name = 'PlanningFieldError'
  }
}

/** Runs a check and tags any refusal it throws with the field it is about. */
function onField<T>(field: PlanningRefusedField, check: () => T): T {
  try {
    return check()
  } catch (error) {
    if (error instanceof PlanningFieldError || !(error instanceof Error)) throw error
    throw new PlanningFieldError(error.message, field)
  }
}

/** Which blocker changed, and how: the agent event stream's blocker events (D41). */
export interface BlockerChange {
  kind: 'reported' | 'resolved'
  blockerId: string
  workItemId: string
}

export type BlockersChangedListener = (projectId: string, change: BlockerChange) => void

export class PlanningService {
  private readonly db: Database.Database
  private readonly workflows: PlanningWorkflowService
  private readonly people: PeopleRepository
  private readonly activity: PlanningActivity
  /** The manual order (D31): every task's place among the project's tasks. */
  private readonly order: PlanningOrder
  /** Custom fields (R2.2): definitions and values. */
  private readonly fields: PlanningFields
  /** Saving Ostler AI's values for AI fields (N8.4), on the person's Fill with AI. */
  private readonly aiFills: PlanningAiFills
  readonly reminders: PlanningReminders
  /** Time tracking (R2.3): entries and the one timer, for every surface. */
  readonly time: TimeTracking
  /** GitHub links on tasks (R4.4): stored here, fetched by `GithubLinkService`. */
  readonly githubLinks: PlanningGithubLinks
  /** Checklist items' dates and people (N2.2), beside the ticks. */
  private readonly checklistDetails: PlanningChecklistDetails
  /** Links between tasks besides waits-on (N2.4): never read by scheduling. */
  private readonly taskLinks: PlanningTaskLinks
  /** Description history (N2.6): the text before each sitting of changes. */
  private readonly descriptionVersions: PlanningDescriptionVersions
  /** A project's column names and hidden columns (R2.4), for every surface. */
  readonly columns: PlanningColumns
  /** Iterations (R6.1, D44): sprints and cycles, for every surface. */
  readonly iterations: PlanningIterations
  /** Task types (N2.7a, N22). */
  readonly taskTypes: PlanningTaskTypes
  /** Sub-projects, shown as workstreams: named parts of one project. */
  readonly subprojects: PlanningSubprojects
  /** Rules (R6.2, D45): applied in the transaction of the change that sets them off. */
  readonly rules: PlanningRules
  /** Task templates (N2.1): a task and its subtasks, saved to make again. */
  readonly taskTemplates: TaskTemplates
  /** Above zero while rules are off: imports, project files, templates and undo. */
  private rulesPaused = 0
  /** Content search (P5.7), kept at each write point below. */
  readonly search: SearchService
  /** Saved views (P5.7), on the same connection. */
  readonly views: SavedViewsService
  /** Pins (N5.2a): the sidebar's and each Overview's shortcuts, on the same connection. */
  readonly pins: PinService
  /** Smart commits (N9.8b): tasks linked to the commits that name their IDs, on the same connection. */
  readonly commitLinks: CommitLinkService
  /** Status updates (N5.5): the person's word on how the project is going, on the same connection. */
  readonly statusUpdates: StatusUpdateService
  /** Goals' check-ins (N5.6a), on the same connection. */
  readonly goalCheckIns: GoalCheckInService
  /** Repeating rounds of milestones (N5.7a), on the same connection. */
  readonly rounds: MilestoneRounds
  /** Budgets and costs (N6.3a), on the same connection. */
  readonly costs: CostService
  /** The shopping list (N6.3b): buying an item makes a paid cost, on the same connection. */
  readonly shopping: ShoppingService
  /** Baselines (N7.4): snapshots of the plan's dates, on the same connection. */
  readonly baselines: BaselineService
  /** Billable time (N6.4): rates, the Time report and billings, on the same connection. */
  readonly billing: BillingService
  /** Contacts (N6.5): shared by every project, and the tasks that name them, on the same connection. */
  readonly contacts: ContactsService
  /** Goals of one's own (N5.6b): outside projects, shared by every project, on the same connection. */
  readonly personalGoals: PersonalGoalService

  /**
   * Projects being created from a package (P5.8): their records are written
   * before their config entry, so they count as known while that runs.
   */
  private readonly pendingProjectIds = new Set<string>()
  private readonly getProjectIds: () => string[]

  constructor(
    dbPath: string,
    getRegisteredProjectIds: () => string[],
    getReminderSettings: () => ReminderSettings = () => DEFAULT_CONFIG.notifications,
    /**
     * A project's task prefix (N9.8a), from its settings: every work item
     * read here carries its ID, worked out from it and the task's number.
     */
    private readonly getTaskPrefix: (projectId: string) => string | null = () => null
  ) {
    const getProjectIds = () => [...getRegisteredProjectIds(), ...this.pendingProjectIds]
    this.getProjectIds = getProjectIds
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    attachChangeRecorder(this.db)
    this.workflows = new PlanningWorkflowService(this)
    this.people = new PeopleRepository(this.db)
    this.columns = new PlanningColumns(this.db, getProjectIds, (projectId) =>
      this.changed(projectId)
    )
    this.activity = new PlanningActivity(this.db, this.people, (projectId) =>
      this.columns.read(projectId)
    )
    this.order = new PlanningOrder(this.db)
    this.fields = new PlanningFields(this.db)
    this.time = new TimeTracking(this.db, {
      requireProject: (projectId) => this.requireProject(projectId),
      meId: () => this.people.getMe()?.id ?? null,
      personExists: (personId) => this.people.get(personId) !== null,
      changed: (projectId) => this.changed(projectId)
    })
    this.checklistDetails = new PlanningChecklistDetails(this.db)
    this.taskLinks = new PlanningTaskLinks(this.db)
    this.descriptionVersions = new PlanningDescriptionVersions(this.db, (kind, personId, rule) =>
      this.activity.nameActor(kind, personId, rule)
    )
    this.githubLinks = new PlanningGithubLinks(this.db, (projectId) =>
      this.requireProject(projectId)
    )
    this.iterations = new PlanningIterations(this.db, {
      requireProject: (projectId) => this.requireProject(projectId),
      changed: (projectId) => this.changed(projectId),
      recordMove: (task, from, to, actor, at) =>
        this.activity.recordChange(task, 'iteration', from, to, actor, at),
      reindexTask: (taskId) => this.search.indexEntity('task', taskId)
    })
    this.taskTypes = new PlanningTaskTypes(this.db, {
      requireProject: (projectId) => this.requireProject(projectId),
      changed: (projectId) => this.changed(projectId),
      fieldIdsOf: (projectId) => this.fields.list(projectId).map((field) => field.id),
      requireTemplateUsable: (templateId, projectId) => {
        this.taskTemplates.requireUsableIn(templateId, projectId)
      }
    })
    this.subprojects = new PlanningSubprojects(this.db, {
      requireProject: (projectId) => this.requireProject(projectId),
      changed: (projectId) => this.changed(projectId)
    })
    this.rules = new PlanningRules(this.db, {
      requireProject: (projectId) => this.requireProject(projectId),
      changed: (projectId) => this.changed(projectId),
      getWorkItem: (workItemId) => this.requireWorkItem(workItemId),
      updateWorkItem: (workItemId, patch, actor) => this.updateWorkItem(workItemId, patch, actor),
      addComment: (workItemId, body, actor) => this.addComment(workItemId, body, actor),
      deleteComment: (commentId, actor) => void this.deleteComment(commentId, actor),
      archiveWorkItem: (workItemId, actor) => void this.archiveWorkItem(workItemId, actor),
      unarchiveWorkItem: (workItemId, actor) => void this.unarchiveWorkItem(workItemId, actor),
      withoutRules: (operation) => this.withoutRules(operation),
      personExists: (personId, projectId) => this.canBeGivenWork(personId, projectId),
      milestoneInProject: (milestoneId, projectId) =>
        this.db
          .prepare('SELECT 1 FROM planning_milestones WHERE id = ? AND project_id = ?')
          .get(milestoneId, projectId) !== undefined,
      columnInProject: (columnId, status, projectId) =>
        customColumns(this.columns.read(projectId)).some(
          (column) => column.id === columnId && column.countsAs === status
        ),
      fieldInProject: (fieldId, projectId) =>
        this.fields.list(projectId).some((field) => field.id === fieldId)
    })
    this.taskTemplates = new TaskTemplates(this.db, {
      requireProject: (projectId) => this.requireProject(projectId),
      getWorkItem: (workItemId) => this.requireWorkItem(workItemId),
      subtasksOf: (item) =>
        this.listWorkItems(item.projectId).filter(
          (candidate) => candidate.parentWorkItemId === item.id
        ),
      createWorkItem: (projectId, input, actor) => this.createWorkItem(projectId, input, actor),
      runInTransaction: (operation) => this.runInTransaction(operation),
      setChecklistItemDetails: (workItemId, text, input, actor) =>
        this.setChecklistItemDetails(workItemId, text, input, actor),
      personExists: (personId, projectId) => this.canBeGivenWork(personId, projectId),
      listFields: (projectId) => this.fields.list(projectId),
      fieldTakes: (projectId, fieldId, value) => {
        try {
          this.fields.validate(projectId, { [fieldId]: value })
          return true
        } catch {
          return false
        }
      },
      templateRemoved: (templateId) => this.taskTypes.removeTemplate(templateId),
      templateRestored: (template, typeIds) => this.taskTypes.restoreTemplate(template, typeIds),
      templateMoved: (templateId, projectId) => this.taskTypes.templateMoved(templateId, projectId)
    })
    this.aiFills = new PlanningAiFills(this.db, {
      fields: this.fields,
      getWorkItem: (workItemId) => {
        try {
          return this.requireWorkItem(workItemId)
        } catch {
          return null
        }
      },
      listTaskTypes: (projectId) => this.taskTypes.list(projectId),
      recordChange: (item, field, from, to, actor, at) =>
        this.activity.recordChange(item, field, from, to, actor, at),
      reindexTask: (taskId) => this.search.indexEntity('task', taskId),
      changed: (projectId) => this.changed(projectId)
    })
    this.reminders = new PlanningReminders(this.db, getReminderSettings)
    this.search = new SearchService(this.db, getProjectIds, getTaskPrefix)
    this.views = new SavedViewsService(this.db, getProjectIds)
    this.pins = new PinService(this.db, getProjectIds, (projectId) => this.changed(projectId))
    this.commitLinks = new CommitLinkService(this.db, getTaskPrefix)
    this.costs = new CostService(this.db, getProjectIds, (projectId) => this.changed(projectId))
    this.shopping = new ShoppingService(this.db, this.costs, getProjectIds, (projectId) =>
      this.changed(projectId)
    )
    this.baselines = new BaselineService(this.db, getProjectIds, (projectId) =>
      this.changed(projectId)
    )
    this.billing = new BillingService(this.db, {
      getProjectIds,
      currency: (projectId) => this.costs.getBudget(projectId).currency,
      time: this.time,
      changed: (projectId) => this.changed(projectId)
    })
    this.contacts = new ContactsService(this.db, {
      getProjectIds,
      requireWorkItem: (workItemId) => {
        const item = this.requireWorkItem(workItemId)
        this.requireProject(item.projectId)
        return item
      },
      changed: (projectId) => this.changed(projectId),
      search: this.search
    })
    this.statusUpdates = new StatusUpdateService(
      this.db,
      getProjectIds,
      (kind, personId) => this.activity.nameActor(kind, personId, null),
      (projectId) => this.changed(projectId),
      Date.now,
      (update) =>
        this.teamEvent({
          kind: 'statusUpdate',
          projectId: update.projectId,
          title: t('settings:webhooks.event.statusUpdate', {
            health: statusUpdateHealthLabel(update.health)
          }),
          text: update.note
        })
    )
    this.goalCheckIns = new GoalCheckInService(
      this.db,
      (goalId) => this.getGoal(goalId),
      (projectId) => this.changed(projectId)
    )
    this.personalGoals = new PersonalGoalService(this.db, {
      getProjectIds,
      requireProjectGoal: (goalId) => this.getGoal(goalId),
      changed: () => this.changed('')
    })
    this.rounds = new MilestoneRounds(this.db, {
      requireMilestone: (milestoneId) => this.requireMilestone(milestoneId),
      requireProject: (projectId) => this.requireProject(projectId),
      keptTasks: (projectId) => this.listKeptWorkItems(projectId),
      createMilestone: (projectId, input) => this.createMilestone(projectId, input),
      createWorkItem: (projectId, input, actor) => this.createWorkItem(projectId, input, actor),
      replaceDependencies: (workItemId, dependencyIds) =>
        this.replaceDependencies(workItemId, dependencyIds),
      recordChange: (item, field, from, to, actor, at) =>
        this.activity.recordChange(item, field, from, to, actor, at),
      requireActor: (actor) => this.activity.requireActor(actor),
      changed: (projectId) => this.changed(projectId),
      getProjectIds
    })
  }

  /** The open database, for the read-only cross-project queries (Home, Inbox). */
  get database(): Database.Database {
    return this.db
  }

  private changedListener: ((projectId: string) => void) | null = null

  /**
   * Called after anything Home, the Inbox or the reminder timer reads may
   * have changed: a task written, archived, deleted or restored, a blocker,
   * a repeat or a reminder. From every surface, since this is the one write
   * path.
   */
  setChangedListener(listener: ((projectId: string) => void) | null): void {
    this.changedListener = listener
  }

  /**
   * A person creates, is assigned or comments on a task here, so they follow it (prompt 15). Only
   * a person's own action follows: agents and rules do not make Me follow anything, and neither do
   * the records of a new project (a template, a demo, an import), which nobody chose one by one.
   * Written on this connection, so inside a transaction it joins it rather than waiting on its lock.
   */
  private autoFollow(projectId: string, taskId: string, actor: PlanningActor): void {
    if (actor.kind !== 'human' || this.pendingProjectIds.has(projectId)) return
    try {
      autoFollowTask(this.db, projectId, taskId, Date.now())
    } catch (error) {
      console.error('Auto follow failed:', error)
    }
  }

  /**
   * Refuses while the item has a sign-off waiting (D9). Applies to this PC's own edits only: a
   * change received from another PC is never gated.
   */
  private requireNoWaitingSignOff(kind: 'task' | 'milestone', itemId: string): void {
    const waiting = this.db
      .prepare(
        `SELECT person.name AS name FROM planning_sign_offs AS sign_off
         LEFT JOIN people AS person ON person.id = sign_off.approver_person_id
         WHERE sign_off.item_kind = ? AND sign_off.item_id = ? AND sign_off.state = 'waiting'
         ORDER BY sign_off.requested_at LIMIT 1`
      )
      .get(kind, itemId) as { name: string | null } | undefined
    if (waiting) throw new Refusal(t('errors:signOffs.waiting', { name: waiting.name ?? '?' }))
  }

  /** A deleted item takes its sign-offs with it (there is no foreign key: three tables hold items). */
  private deleteSignOffs(
    kind: 'task' | 'decision' | 'milestone',
    itemIds: readonly string[]
  ): void {
    const remove = this.db.prepare(
      'DELETE FROM planning_sign_offs WHERE item_kind = ? AND item_id = ?'
    )
    for (const itemId of itemIds) remove.run(kind, itemId)
  }

  private readonly teamListeners = new Set<(event: TeamEvent) => void>()

  /**
   * What a project tells its team (integrations phase 4): a status update
   * posted, a milestone done. From every surface. Returns the unsubscribe.
   */
  onTeamEvent(listener: (event: TeamEvent) => void): () => void {
    this.teamListeners.add(listener)
    return () => this.teamListeners.delete(listener)
  }

  private teamEvent(event: TeamEvent): void {
    for (const listener of this.teamListeners) {
      try {
        listener(event)
      } catch (error) {
        console.error('Team event listener failed:', error)
      }
    }
  }

  private blockersChangedListener: BlockersChangedListener | null = null

  /**
   * Called after a blocker is reported or resolved, from any surface (the
   * app, the harness API, the automation API), so the Overview's Blockers
   * panel updates as it happens instead of on a timer.
   */
  setBlockersChangedListener(listener: BlockersChangedListener | null): void {
    this.blockersChangedListener = listener
  }

  private blockersChanged(projectId: string, change: BlockerChange): void {
    this.changed(projectId)
    try {
      this.blockersChangedListener?.(projectId, change)
    } catch (error) {
      console.error('Blocker change listener failed:', error)
    }
  }

  /**
   * Personal planning beside a project's tasks changed (My day, N1.4): tell
   * the same listener a task change does, so Home is read again whichever
   * surface made the change.
   */
  markChanged(projectId: string): void {
    this.changed(projectId)
  }

  private changed(projectId: string): void {
    try {
      this.changedListener?.(projectId)
    } catch (error) {
      console.error('Planning change listener failed:', error)
    }
  }

  /** A person's name, archived or not; null for nobody or someone removed. */
  personName(personId: string | null): string | null {
    if (!personId) return null
    return this.people.get(personId)?.name ?? null
  }

  /** The desktop app's actor: a human, and that human is Me (P5.2). */
  humanActor(): PlanningActor {
    const me = this.people.getMe()
    return me ? { kind: 'human', personId: me.id } : { kind: 'human' }
  }

  /**
   * Runs `operation` with rules off (D45): imports, project files and
   * templates (with the sample project) write tasks without setting off
   * rules, and neither does an undo.
   */
  withoutRules<T>(operation: () => T): T {
    this.rulesPaused += 1
    try {
      return operation()
    } finally {
      this.rulesPaused -= 1
    }
  }

  /** Whether a write by `actor` may set off rules: never a rule's own write (no chains). */
  private rulesOn(actor: PlanningActor): boolean {
    return this.rulesPaused === 0 && actor.kind !== 'rule'
  }

  /** The parent's "all its subtasks are done", when `item` was its last open one. */
  private subtasksDoneChange(item: PlanningWorkItem): RuleChange[] {
    if (!item.parentWorkItemId || item.status !== 'done') return []
    const open = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM planning_work_items
         WHERE parent_work_item_id = ? AND deleted_at IS NULL AND status != 'done'`
      )
      .get(item.parentWorkItemId) as { n: number }
    if (open.n > 0) return []
    const parent = this.requireWorkItem(item.parentWorkItemId)
    return parent.deletedAt ? [] : [{ task: parent, subtasksDone: true }]
  }

  private triageOn: (projectId: string) => boolean = () => false

  /**
   * Whether a project has Triage new captures on (N4.3a), from its settings:
   * a quick capture made there lands in To triage.
   */
  setTriageSetting(lookup: ((projectId: string) => boolean) | null): void {
    this.triageOn = lookup ?? (() => false)
  }

  /** Lets the main process say which agent runs each harness event belongs to. */
  setHarnessActivityResolver(resolver: HarnessActivityResolver | null): void {
    this.activity.setHarnessResolver(resolver)
  }

  /** A task's history: comments, changes, status moves and its agent runs, newest first. */
  listActivity(projectId: string, workItemId: string, query: ActivityQuery = {}): ActivityPage {
    this.requireProject(projectId)
    this.requireWorkItemForProject(workItemId, projectId)
    return this.activity.list(projectId, workItemId, query)
  }

  /** The same across every task in the project. */
  listProjectActivity(projectId: string, query: ActivityQuery = {}): ActivityPage {
    this.requireProject(projectId)
    return this.activity.list(projectId, null, query)
  }

  listComments(workItemId: string): PlanningComment[] {
    this.getWorkItem(workItemId)
    return this.activity.listComments(workItemId)
  }

  getComment(commentId: string): PlanningComment {
    const comment = this.activity.getComment(commentId)
    this.requireProject(comment.projectId)
    return comment
  }

  addComment(workItemId: string, body: string, actor: PlanningActor): PlanningComment {
    const item = this.getWorkItem(workItemId)
    const comment = this.withIndex('comment', () =>
      this.activity.addComment(item, body, this.activity.requireActor(actor))
    )
    this.autoFollow(item.projectId, item.id, actor)
    return comment
  }

  updateComment(commentId: string, body: string, actor: PlanningActor): PlanningComment {
    this.allowComment(commentId, 'edit', actor)
    return this.withIndex('comment', () =>
      this.activity.updateComment(commentId, body, this.activity.requireActor(actor))
    )
  }

  /** Soft delete; `restoreComment` undoes it. A deleted comment leaves the search index. */
  deleteComment(commentId: string, actor: PlanningActor): PlanningComment {
    this.allowComment(commentId, 'delete', actor)
    return this.withIndex('comment', () =>
      this.activity.deleteComment(commentId, this.activity.requireActor(actor))
    )
  }

  pinComment(commentId: string, pinned: boolean, actor: PlanningActor): PlanningComment {
    this.allowComment(commentId, 'pin', actor)
    return this.withIndex('comment', () =>
      this.activity.pinComment(commentId, pinned, this.activity.requireActor(actor))
    )
  }

  restoreComment(commentId: string, actor: PlanningActor): PlanningComment {
    this.allowComment(commentId, 'delete', actor)
    return this.withIndex('comment', () =>
      this.activity.restoreComment(commentId, this.activity.requireActor(actor))
    )
  }

  /**
   * Refuses what the comment rule (`commentPermissions`, the one the feed shows) does not let a
   * person do with a comment, by their role in the project's share. The automation API is not a
   * person and keeps its own reach. Restoring is undoing a delete, so it takes the same right.
   */
  private allowComment(
    commentId: string,
    action: 'edit' | 'delete' | 'pin',
    actor: PlanningActor
  ): void {
    const comment = this.getComment(commentId)
    if (actor.kind !== 'human') return
    const share = this.db
      .prepare('SELECT my_role FROM sync_shares WHERE project_id = ?')
      .get(comment.projectId) as { my_role: ShareRole } | undefined
    const can = commentPermissions(share?.my_role ?? null, comment, actor.personId ?? null)
    if (!can[action]) throw new Refusal(t('errors:planningActivity.commentNotYours'))
  }

  /**
   * Runs a write and indexes the record it returns, in one transaction: the
   * search index can never disagree with what was written (P5.7).
   */
  private withIndex<T extends { id: string }>(
    type: 'task' | 'goal' | 'milestone' | 'decision' | 'comment',
    write: () => T
  ): T {
    return this.db.transaction(() => {
      const record = write()
      this.search.indexEntity(type, record.id)
      return record
    })()
  }

  /** Comments on each of a project's tasks, for the cards. */
  commentCounts(projectId: string): Record<string, number> {
    this.requireProject(projectId)
    return this.activity.commentCounts(projectId)
  }

  /**
   * What `matchesFilter` needs to know about a project beyond its tasks (P5.7):
   * today, Me, each milestone's goal and each task's comments. The automation
   * API builds its context here; the views build theirs from the same records.
   */
  taskFilterContext(projectId: string, today = todayIsoDate()): TaskFilterContext {
    const goals = new Map(
      this.listMilestones(projectId).map((milestone) => [milestone.id, milestone.goalId])
    )
    const comments = this.commentCounts(projectId)
    const contacts = this.contacts.marksForProject(projectId)
    return {
      today,
      contactsOf: (value) => contacts[value.id] ?? [],
      meId: this.people.getMe()?.id ?? null,
      goalIdForTask: (value) => (value.milestoneId ? (goals.get(value.milestoneId) ?? null) : null),
      commentCount: (value) => comments[value.id] ?? 0,
      currentIterationId: currentIteration(this.iterations.list(projectId), today)?.id ?? null
    }
  }

  close(): void {
    this.db.close()
  }

  listStatusTransitions(
    workItemId: string
  ): import('@shared/ostler-api').PlanningStatusTransition[] {
    const item = this.requireWorkItem(workItemId)
    this.requireProject(item.projectId)
    return this.db
      .prepare(
        'SELECT work_item_id as workItemId, from_status as "from", to_status as "to", at FROM planning_status_history WHERE work_item_id = ? ORDER BY at, sequence'
      )
      .all(workItemId) as import('@shared/ostler-api').PlanningStatusTransition[]
  }

  /**
   * Every status change of a project's counted tasks (live and archived, not the
   * recycle bin, not won't do), in one query, oldest first: the reports' input
   * (P6.2). A won't-do task (N1.2) leaves every report as if it had never
   * been in the plan.
   */
  listProjectStatusTransitions(projectId: string): PlanningStatusTransition[] {
    this.requireProject(projectId)
    return this.db
      .prepare(
        'SELECT history.work_item_id as workItemId, history.from_status as "from", history.to_status as "to", history.at ' +
          'FROM planning_status_history history ' +
          'JOIN planning_work_items item ON item.id = history.work_item_id ' +
          'WHERE item.project_id = ? AND item.deleted_at IS NULL AND item.resolution IS NULL ' +
          'AND item.in_triage = 0 ' +
          'ORDER BY history.at, history.sequence'
      )
      .all(projectId) as PlanningStatusTransition[]
  }

  /**
   * Live and archived tasks, the ones whose history counts: not the recycle
   * bin, not won't do (N1.2) and not in triage (N4.3a), which count nowhere.
   */
  listKeptWorkItemsForReports(projectId: string): PlanningWorkItem[] {
    return this.selectWorkItems(
      projectId,
      'deleted_at IS NULL AND resolution IS NULL AND in_triage = 0'
    )
  }

  /**
   * The most recent status-change time for every work item in a project, as a
   * single grouped query rather than one query per item.
   */
  latestStatusChanges(projectId: string): Record<string, number> {
    this.requireProject(projectId)
    const rows = this.db
      .prepare(
        'SELECT history.work_item_id AS workItemId, MAX(history.at) AS at ' +
          'FROM planning_status_history history ' +
          'JOIN planning_work_items item ON item.id = history.work_item_id ' +
          'WHERE item.project_id = ? ' +
          'GROUP BY history.work_item_id'
      )
      .all(projectId) as { workItemId: string; at: number }[]
    return Object.fromEntries(rows.map((row) => [row.workItemId, row.at]))
  }

  getWorkItemMetrics(workItemId: string, now = Date.now()): PlanningWorkItemMetrics {
    const item = this.requireWorkItem(workItemId)
    return metricsForItem(item, this.listStatusTransitions(item.id), now)
  }

  // The project's history in one query, not one per task (P9.1).
  getProjectMetrics(projectId: string, now = Date.now()): PlanningAggregateMetrics {
    return aggregateMetrics(
      this.listKeptWorkItemsForReports(projectId),
      this.listProjectStatusTransitions(projectId),
      now
    )
  }

  /**
   * Every live task's metrics in a project, by task id, from one history
   * query: what Home's project cards need, which used to ask once per task.
   */
  getProjectWorkItemMetrics(
    projectId: string,
    now = Date.now()
  ): Record<string, PlanningWorkItemMetrics> {
    const byItem = historiesByWorkItem(this.listProjectStatusTransitions(projectId))
    return Object.fromEntries(
      this.listWorkItems(projectId).map((item) => [
        item.id,
        metricsForItem(item, byItem.get(item.id) ?? [], now)
      ])
    )
  }

  getMilestoneMetrics(milestoneId: string, now = Date.now()): PlanningAggregateMetrics {
    const milestone = this.requireMilestone(milestoneId)
    const items = this.listKeptWorkItemsForReports(milestone.projectId).filter(
      (item) => item.milestoneId === milestoneId
    )
    const ids = new Set(items.map((item) => item.id))
    return aggregateMetrics(
      items,
      this.listProjectStatusTransitions(milestone.projectId).filter((event) =>
        ids.has(event.workItemId)
      ),
      now
    )
  }

  listGoals(projectId: string): PlanningGoal[] {
    this.requireProject(projectId)
    const rows = this.db
      .prepare('SELECT * FROM planning_goals WHERE project_id = ? ORDER BY updated_at DESC')
      .all(projectId) as GoalRow[]
    return rows.map((row) => toGoal(row))
  }

  /**
   * Each project's active goals that have a measure, with their progress on
   * `today`, in two queries (N5.6a): Home's cards. Unknown projects are left out.
   */
  goalGlances(projectIds: string[], today = todayIsoDate()): Record<string, GoalGlance[]> {
    const known = new Set(this.getProjectIds())
    const ids = projectIds.filter((id) => known.has(id))
    if (ids.length === 0) return {}
    const rows = this.db
      .prepare(
        `SELECT * FROM planning_goals
         WHERE project_id IN (SELECT value FROM json_each(?))
           AND status = 'active' AND measure_direction IS NOT NULL
         ORDER BY created_at, rowid`
      )
      .all(JSON.stringify(ids)) as GoalRow[]
    const checkIns = this.goalCheckIns.listForProjects(ids)
    const result: Record<string, GoalGlance[]> = {}
    for (const goal of rows.map((row) => toGoal(row))) {
      if (!goal.measure) continue
      ;(result[goal.projectId] ??= []).push({
        goalId: goal.id,
        projectId: goal.projectId,
        title: goal.title,
        measure: goal.measure,
        progress: goalProgress(goal.measure, checkIns[goal.id] ?? [], today)
      })
    }
    return result
  }

  getGoal(goalId: string): PlanningGoal {
    const goal = this.requireGoal(goalId)
    this.requireProject(goal.projectId)
    return goal
  }

  createGoal(projectId: string, input: CreatePlanningGoalInput): PlanningGoal {
    this.requireProject(projectId)
    const now = Date.now()
    const goal: PlanningGoal = {
      id: uuidv4(),
      projectId,
      title: requiredText(input.title, 'Goal title', 160),
      outcome: optionalText(input.outcome, 'Goal outcome', 4000),
      status: 'active',
      measure: measureValue(input.measure),
      createdAt: now,
      updatedAt: now
    }
    return this.withIndex('goal', () => {
      this.db
        .prepare(
          `INSERT INTO planning_goals
          (id, project_id, title, outcome, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          goal.id,
          goal.projectId,
          goal.title,
          goal.outcome,
          goal.status,
          goal.createdAt,
          goal.updatedAt
        )
      this.writeMeasure(goal.id, goal.measure ?? null)
      return goal
    })
  }

  updateGoal(goalId: string, updates: UpdatePlanningGoalInput): PlanningGoal {
    const current = this.requireGoal(goalId)
    this.requireProject(current.projectId)
    const goal: PlanningGoal = {
      ...current,
      title:
        updates.title === undefined
          ? current.title
          : requiredText(updates.title, 'Goal title', 160),
      outcome:
        updates.outcome === undefined
          ? current.outcome
          : optionalText(updates.outcome, 'Goal outcome', 4000),
      status:
        updates.status === undefined
          ? current.status
          : enumValue(updates.status, GOAL_STATUSES, 'goal status'),
      measure: updates.measure === undefined ? current.measure : measureValue(updates.measure),
      updatedAt: Date.now()
    }
    return this.withIndex('goal', () => {
      this.db
        .prepare(
          `UPDATE planning_goals
         SET title = ?, outcome = ?, status = ?, updated_at = ?
         WHERE id = ?`
        )
        .run(goal.title, goal.outcome, goal.status, goal.updatedAt, goal.id)
      if (updates.measure !== undefined) this.writeMeasure(goal.id, goal.measure ?? null)
      if (updates.measure !== undefined) this.changed(goal.projectId)
      return goal
    })
  }

  deleteGoal(goalId: string): void {
    const goal = this.requireGoal(goalId)
    this.requireProject(goal.projectId)
    if (this.listMilestones(goal.projectId).some((milestone) => milestone.goalId === goalId))
      throw new Refusal(t('errors:planningService.goalStillHasMilestones'))
    this.db.transaction(() => {
      this.search.removeEntity('goal', goalId)
      this.db.prepare('DELETE FROM goal_check_ins WHERE goal_id = ?').run(goalId)
      this.personalGoals.projectGoalDeleted(goalId)
      this.db.prepare('DELETE FROM planning_goals WHERE id = ?').run(goalId)
    })()
  }

  listMilestones(projectId: string): PlanningMilestone[] {
    this.requireProject(projectId)
    const rows = this.db
      .prepare('SELECT * FROM planning_milestones WHERE project_id = ? ORDER BY updated_at DESC')
      .all(projectId) as MilestoneRow[]
    return rows.map((row) => toMilestone(row))
  }

  createMilestone(projectId: string, input: CreatePlanningMilestoneInput): PlanningMilestone {
    this.requireProject(projectId)
    const goalId = input.goalId ?? null
    if (goalId) this.requireGoalForProject(goalId, projectId)
    const subprojectId = input.subprojectId ?? null
    if (subprojectId) this.subprojects.requireInProject(subprojectId, projectId)
    const now = Date.now()
    const milestone: PlanningMilestone = {
      id: uuidv4(),
      projectId,
      goalId,
      subprojectId,
      name: requiredText(input.name, 'Milestone name', 160),
      outcome: optionalText(input.outcome, 'Milestone outcome', 4000),
      targetDate: targetDate(input.targetDate),
      successCriteria: textList(input.successCriteria, 'Success criteria', 25, 500),
      status: 'planned',
      createdAt: now,
      updatedAt: now
    }
    return this.withIndex('milestone', () => {
      this.db
        .prepare(
          `INSERT INTO planning_milestones
          (id, project_id, goal_id, name, outcome, target_date, success_criteria, status, created_at, updated_at, subproject_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          milestone.id,
          milestone.projectId,
          milestone.goalId,
          milestone.name,
          milestone.outcome,
          milestone.targetDate,
          JSON.stringify(milestone.successCriteria),
          milestone.status,
          milestone.createdAt,
          milestone.updatedAt,
          milestone.subprojectId
        )
      return milestone
    })
  }

  updateMilestone(milestoneId: string, updates: UpdatePlanningMilestoneInput): PlanningMilestone {
    const current = this.requireMilestone(milestoneId)
    this.requireProject(current.projectId)
    const goalId = updates.goalId === undefined ? current.goalId : updates.goalId
    if (goalId) this.requireGoalForProject(goalId, current.projectId)
    const subprojectId =
      updates.subprojectId === undefined ? current.subprojectId : updates.subprojectId
    if (subprojectId) this.subprojects.requireInProject(subprojectId, current.projectId)
    const milestone: PlanningMilestone = {
      ...current,
      goalId,
      subprojectId,
      name:
        updates.name === undefined
          ? current.name
          : requiredText(updates.name, 'Milestone name', 160),
      outcome:
        updates.outcome === undefined
          ? current.outcome
          : optionalText(updates.outcome, 'Milestone outcome', 4000),
      targetDate:
        updates.targetDate === undefined ? current.targetDate : targetDate(updates.targetDate),
      successCriteria:
        updates.successCriteria === undefined
          ? current.successCriteria
          : textList(updates.successCriteria, 'Success criteria', 25, 500),
      status:
        updates.status === undefined
          ? current.status
          : enumValue(updates.status, MILESTONE_STATUSES, 'milestone status'),
      updatedAt: Date.now()
    }
    const finished = current.status !== 'complete' && milestone.status === 'complete'
    if (finished) this.requireNoWaitingSignOff('milestone', milestone.id)
    const saved = this.withIndex('milestone', () => {
      this.db
        .prepare(
          `UPDATE planning_milestones
         SET goal_id = ?, name = ?, outcome = ?, target_date = ?, success_criteria = ?, status = ?, updated_at = ?,
             subproject_id = ?
         WHERE id = ?`
        )
        .run(
          milestone.goalId,
          milestone.name,
          milestone.outcome,
          milestone.targetDate,
          JSON.stringify(milestone.successCriteria),
          milestone.status,
          milestone.updatedAt,
          milestone.subprojectId,
          milestone.id
        )
      return milestone
    })
    if (finished) {
      this.teamEvent({
        kind: 'milestoneDone',
        projectId: saved.projectId,
        title: t('settings:webhooks.event.milestoneDone', { name: saved.name }),
        text: saved.outcome
      })
    }
    return saved
  }

  /**
   * Deletes a milestone. Its archived tasks never block it: they are left without a milestone.
   * Live tasks block it unless `detachTasks` is set (the person confirmed), which does the same
   * for them; the automation API leaves it unset.
   */
  deleteMilestone(milestoneId: string, options: { detachTasks?: boolean } = {}): void {
    const milestone = this.requireMilestone(milestoneId)
    this.requireProject(milestone.projectId)
    const tied = this.listKeptWorkItems(milestone.projectId).filter(
      (item) => item.milestoneId === milestoneId
    )
    if (!options.detachTasks && tied.some((item) => item.archivedAt === null))
      throw new Refusal(t('errors:planningService.milestoneStillHasWork'))
    // A rule that sets it would fail, and refuse every change that sets it off.
    const rule = this.rules
      .list(milestone.projectId)
      .find((candidate) =>
        candidate.actions.some(
          (action) => action.kind === 'setMilestone' && action.milestoneId === milestoneId
        )
      )
    if (rule) throw new Refusal(t('errors:planningService.milestoneSetByRule', { name: rule.name }))
    this.db.transaction(() => {
      this.db
        .prepare(
          'UPDATE planning_work_items SET milestone_id = NULL, updated_at = ? WHERE milestone_id = ?'
        )
        .run(Date.now(), milestoneId)
      this.search.removeEntity('milestone', milestoneId)
      this.deleteSignOffs('milestone', [milestoneId])
      // A later round made from it starts its own series (N5.7a).
      this.db
        .prepare(
          'UPDATE planning_milestones SET previous_round_id = NULL WHERE previous_round_id = ?'
        )
        .run(milestoneId)
      this.db.prepare('DELETE FROM planning_milestones WHERE id = ?').run(milestoneId)
    })()
  }

  /**
   * `live` (the default) is what the Board, queue and readiness see: neither
   * archived nor in the recycle bin. Archive and bin views ask for theirs.
   */
  listWorkItems(projectId: string, scope: PlanningWorkItemScope = 'live'): PlanningWorkItem[] {
    const live = 'archived_at IS NULL AND deleted_at IS NULL'
    const where =
      scope === 'archived'
        ? 'archived_at IS NOT NULL AND deleted_at IS NULL'
        : scope === 'deleted'
          ? 'deleted_at IS NOT NULL'
          : scope === 'planned'
            ? `${live} AND in_triage = 0`
            : scope === 'triage'
              ? `${live} AND in_triage = 1`
              : live
    const items = this.selectWorkItems(projectId, where)
    // To triage lists the oldest capture first (N4.3a).
    return scope === 'triage' ? items.sort((a, b) => a.createdAt - b.createdAt) : items
  }

  /**
   * What each registered project holds that its views care about, in one
   * pass: a live task waiting in To triage (offered even with the setting
   * off), a live task with a start date (Timeline), milestones or goals,
   * decisions, Someday ideas, scored ideas (Matrix), a budget or costs,
   * a shopping list and logged time. Read-only.
   */
  listProjectUsage(): ProjectUsage {
    const usage: ProjectUsage = {}
    for (const id of this.getProjectIds()) usage[id] = []
    const live = 'archived_at IS NULL AND deleted_at IS NULL'
    const queries: Array<[ProjectUsageFact, string]> = [
      [
        'triage',
        `SELECT DISTINCT project_id FROM planning_work_items WHERE in_triage = 1 AND ${live}`
      ],
      [
        'scheduled',
        `SELECT DISTINCT project_id FROM planning_work_items WHERE start_date IS NOT NULL AND ${live}`
      ],
      [
        'milestones',
        'SELECT project_id FROM planning_milestones UNION SELECT project_id FROM planning_goals'
      ],
      ['decisions', 'SELECT DISTINCT project_id FROM planning_decisions'],
      [
        'someday',
        `SELECT DISTINCT project_id FROM planning_work_items WHERE someday = 1 AND ${live}`
      ],
      [
        'scores',
        'SELECT DISTINCT project_id FROM planning_work_items ' +
          `WHERE (impact IS NOT NULL OR effort IS NOT NULL) AND ${live}`
      ],
      [
        'costs',
        'SELECT project_id FROM costs UNION ' +
          'SELECT project_id FROM project_budgets WHERE amount IS NOT NULL'
      ],
      ['shopping', 'SELECT DISTINCT project_id FROM shopping_items'],
      ['time', 'SELECT DISTINCT project_id FROM planning_time_entries']
    ]
    for (const [fact, sql] of queries) {
      const rows = this.db.prepare(sql).all() as { project_id: string }[]
      for (const row of rows) usage[row.project_id]?.push(fact)
    }
    return usage
  }

  /** Live and archived items: everything that still counts as the project's history. */
  private listKeptWorkItems(projectId: string): PlanningWorkItem[] {
    return this.selectWorkItems(projectId, 'deleted_at IS NULL')
  }

  private selectWorkItems(projectId: string, where: string): PlanningWorkItem[] {
    this.requireProject(projectId)
    const rows = this.db
      .prepare(
        `SELECT * FROM planning_work_items WHERE project_id = ? AND ${where} ORDER BY order_key`
      )
      .all(projectId) as WorkItemRow[]
    const dependencies = this.dependenciesForProject(projectId)
    const checks = this.checksForProject(projectId)
    const details = this.checklistDetails.forProject(projectId)
    // One query for the whole project's custom field values, never one per task.
    const fieldValues = this.fields.valuesForProject(projectId)
    const fieldFills = this.fields.fillsForProject(projectId)
    const githubLinks = this.githubLinks.byWorkItem(projectId)
    const recurring = new Set(
      (
        this.db
          .prepare('SELECT work_item_id FROM planning_recurrences WHERE project_id = ?')
          .all(projectId) as { work_item_id: string }[]
      ).map((row) => row.work_item_id)
    )
    return rows.map((row) => ({
      ...this.toWorkItem(
        row,
        dependencies.get(row.id) ?? [],
        checks.get(row.id) ?? [],
        recurring.has(row.id)
      ),
      checklistDetails: detailsInOrder(
        jsonStringList(row.acceptance_criteria),
        details.get(row.id)
      ),
      fieldValues: fieldValues.get(row.id) ?? {},
      fieldFills: fieldFills.get(row.id) ?? {},
      ...withGithubLinks(githubLinks.get(row.id) ?? [])
    }))
  }

  getWorkItem(workItemId: string): PlanningWorkItem {
    const item = this.requireWorkItem(workItemId)
    this.requireProject(item.projectId)
    return item
  }

  /**
   * Checks whether a planning work item is eligible for automatic agent dispatch:
   * 1. Work item belongs to the requested project
   * 2. Status is 'ready' or 'active' (not 'blocked', 'backlog', or 'done')
   * 3. Every dependency is satisfied: done, finished by its agent, or gone
   * 4. No open `planning_blockers` row is attached to it
   * 5. It has no child work items — container/parent plan nodes are never directly dispatched
   */
  isWorkItemEligibleForDispatch(projectId: string, workItemId: string): boolean {
    return this.workflows.isWorkItemEligibleForDispatch(projectId, workItemId)
  }

  /** Lets the main process teach planning when an agent has finished a task. */
  setHarnessCompletionResolver(
    resolver: ((projectId: string, harnessTaskId: string, sessionId?: string) => boolean) | null
  ): void {
    this.workflows.setHarnessCompletionResolver(resolver)
  }

  /** The queueable subset of a selection, ordered dependencies-first. */
  orderWorkItemsForQueue(projectId: string, workItemIds: string[]): PlanningWorkItem[] {
    return this.workflows.orderWorkItemsForQueue(projectId, workItemIds)
  }
  prepareHarnessHandoff(
    projectId: string,
    workItemId: string,
    options: { allowUnmetDependencies?: boolean } = {}
  ): PlanningWorkItem {
    return this.workflows.prepareHarnessHandoff(projectId, workItemId, options)
  }

  /** How many of this item's dependencies are still in the way. */
  unmetDependencyCount(projectId: string, workItemId: string, sessionId?: string): number {
    return this.workflows.unmetDependencyCount(projectId, workItemId, sessionId)
  }

  clearHarnessHandoff(
    projectId: string,
    workItemId: string,
    harnessTaskId: string
  ): PlanningWorkItem {
    return this.workflows.clearHarnessHandoff(projectId, workItemId, harnessTaskId)
  }
  createWorkItem(
    projectId: string,
    input: CreatePlanningWorkItemInput,
    actor: PlanningActor,
    origin: PlanningWorkItemOrigin = 'human',
    /** The import this task comes in with (P6.1). */
    importBatchId: string | null = null,
    /**
     * The number a project file gave the task (N9.8a), kept when the project
     * has no task with it yet. Every other surface leaves it out and gets the
     * project's next number.
     */
    options: {
      number?: number | null
      /** Straight into To triage, captured this way (N4.3a's Move to project). */
      triage?: TriageCapture | null
    } = {}
  ): PlanningWorkItem {
    this.requireProject(projectId)
    const who = this.activity.requireActor(actor)
    const milestoneId = input.milestoneId ?? null
    if (milestoneId) this.requireMilestoneForProject(milestoneId, projectId)
    const iterationId = input.iterationId ?? null
    if (iterationId) this.iterations.requireInProject(iterationId, projectId)
    const typeId = input.typeId ?? null
    if (typeId) this.taskTypes.requireInProject(typeId, projectId)
    const parentWorkItemId = input.parentWorkItemId ?? null
    if (parentWorkItemId) this.requireWorkItemForProject(parentWorkItemId, projectId)
    // A subtask joins its parent's workstream unless it is given one (or null) of its own.
    const subprojectId =
      input.subprojectId === undefined && parentWorkItemId
        ? (this.requireWorkItem(parentWorkItemId).subprojectId ?? null)
        : (input.subprojectId ?? null)
    if (subprojectId) this.subprojects.requireInProject(subprojectId, projectId)
    // A quick capture waits in To triage when the project asks (N4.3a).
    const capture =
      input.capture === undefined ? null : enumValue(input.capture, [...TRIAGE_CAPTURES], 'capture')
    const inTriage = options.triage !== undefined || (capture !== null && this.triageOn(projectId))
    const now = Date.now()
    const id = uuidv4()
    const { subtaskPhaseNumber, subtaskPhaseName } = onField('parentWorkItemId', () =>
      this.validateSubtaskPlacement(
        id,
        projectId,
        parentWorkItemId,
        input.subtaskPhaseNumber,
        input.subtaskPhaseName
      )
    )
    const item: PlanningWorkItem = {
      id,
      projectId,
      milestoneId,
      title: requiredText(input.title, 'Work item title', 200),
      description: optionalText(input.description, 'Work item description', 8000),
      ...this.columnPlace(
        projectId,
        enumValue(input.status ?? 'backlog', WORK_ITEM_STATUSES, 'work item status'),
        input.columnId ?? null
      ),
      priority: enumValue(input.priority ?? 'medium', PRIORITIES, 'work item priority'),
      labels: textList(input.labels, 'Labels', 20, 80),
      acceptanceCriteria: textList(input.acceptanceCriteria, 'Acceptance criteria', 30, 500),
      ...this.dependencyLinksInput(input.dependencyLinks, input.dependencyIds, []),
      targetDate: targetDate(input.targetDate),
      startDate: calendarDate(input.startDate, 'Start date'),
      showFrom: calendarDate(input.showFrom, 'Show from date'),
      someday: flag(input.someday, 'Someday') ?? false,
      impact: score(input.impact, 'impact') ?? null,
      effort: score(input.effort, 'effort') ?? null,
      inTriage,
      capturedBy: inTriage ? (options.triage ?? capture) : null,
      assigneeId: this.assigneeId(input.assigneeId, projectId),
      estimate: estimate(input.estimate),
      checkedCriteria: [],
      checklistDetails: [],
      origin,
      linkedHarnessTaskId: null,
      autoQueue: Boolean(input.autoQueue),
      planFirst: planFirstChoice(input.planFirst) ?? 'default',
      blockedReason: optionalText(input.blockedReason, 'Blocked reason', 200),
      parentWorkItemId,
      taskCode: optionalText(input.taskCode, 'Task code', 40),
      phaseCode: optionalText(input.phaseCode, 'Phase code', 40),
      phaseName: optionalText(input.phaseName, 'Phase name', 160),
      subtaskPhaseNumber,
      subtaskPhaseName,
      verificationStatus: 'unverified',
      verifiedBy: null,
      verifiedAt: null,
      verificationNotes: '',
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      resolution: null,
      resolutionReason: '',
      deletedAt: null,
      recurring: false,
      importBatchId,
      orderKey: '',
      fieldValues: {},
      fieldFills: {},
      iterationId,
      typeId,
      subprojectId
    }
    if (item.status !== 'blocked') item.blockedReason = ''
    const fieldValues = this.fields.validate(projectId, input.fieldValues)
    for (const [fieldId, value] of fieldValues)
      if (value !== null) {
        item.fieldValues![fieldId] = value
        item.fieldFills![fieldId] = { filledBy: 'person', sourceHash: null }
      }
    onField('dueDate', () => validateDateRange(item.startDate, item.targetDate))
    onField('dependencyIds', () =>
      this.validateDependencies(item.id, projectId, item.dependencyIds, {
        parentWorkItemId: item.parentWorkItemId,
        subtaskPhaseNumber: item.subtaskPhaseNumber
      })
    )
    const insert = this.db.transaction(() => {
      // A new task goes to the end: the order is the person's, not the clock's.
      item.orderKey = this.order.nextKey(projectId)
      // Its number (N9.8a) is given here, in the same transaction, and only here.
      item.number = takeTaskNumber(this.db, projectId, options.number)
      item.key = taskKey(this.getTaskPrefix(projectId), item.number)
      this.db
        .prepare(
          `INSERT INTO planning_work_items
            (id, project_id, milestone_id, title, description, status, priority, labels,
             acceptance_criteria, target_date, start_date, assignee_id, estimate, origin,
             linked_harness_task_id, auto_queue, rating, rating_note,
             parent_work_item_id, task_code, phase_code, phase_name, subtask_phase_number, subtask_phase_name,
             verification_status, verified_by, verified_at, verification_notes, created_at, updated_at,
             import_batch_id, order_key, iteration_id, show_from, someday, type_id, plan_first, number,
             impact, effort, in_triage, captured_by, column_id, subproject_id, blocked_reason)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          item.id,
          item.projectId,
          item.milestoneId,
          item.title,
          item.description,
          item.status,
          item.priority,
          JSON.stringify(item.labels),
          JSON.stringify(item.acceptanceCriteria),
          item.targetDate,
          item.startDate,
          item.assigneeId,
          item.estimate,
          item.origin,
          item.linkedHarnessTaskId,
          item.autoQueue ? 1 : 0,
          0,
          '',
          item.parentWorkItemId,
          item.taskCode,
          item.phaseCode,
          item.phaseName,
          item.subtaskPhaseNumber,
          item.subtaskPhaseName,
          item.verificationStatus,
          item.verifiedBy,
          item.verifiedAt,
          item.verificationNotes,
          item.createdAt,
          item.updatedAt,
          importBatchId,
          item.orderKey,
          item.iterationId,
          item.showFrom ?? null,
          item.someday ? 1 : 0,
          item.typeId ?? null,
          item.planFirst ?? 'default',
          item.number,
          item.impact ?? null,
          item.effort ?? null,
          item.inTriage ? 1 : 0,
          item.capturedBy ?? null,
          item.columnId ?? null,
          item.subprojectId ?? null,
          item.blockedReason ?? ''
        )
      this.replaceDependencies(item.id, dependencyLinksOf(item))
      this.fields.write(projectId, item.id, fieldValues)
      this.activity.recordStatus(item.id, null, item.status, who, item.createdAt)
      this.activity.recordChange(item, 'created', undefined, undefined, who, item.createdAt)
      this.reminders.syncTask(item, item.createdAt)
      this.search.indexEntity('task', item.id)
      // Rules (D45): not for imports or templates, which say where they come
      // from, nor for a capture in triage, which nobody has looked at yet.
      if (this.rulesOn(who) && importBatchId === null && !who.template && !item.inTriage)
        return this.rules.afterChange([
          { task: item, created: true, statusFrom: null },
          ...this.subtasksDoneChange(item)
        ])
      return null
    })
    const ruleRun = insert()
    this.autoFollow(projectId, id, actor)
    this.changed(projectId)
    return ruleRun ? { ...this.requireWorkItem(id), ruleRun } : item
  }

  /**
   * Moves a task in the manual order (D31): before or after another task of
   * the project, or to the start or end of a status. With `status`, the task
   * also moves to that status, through `updateWorkItem` like any status
   * change. Writes the task's own row only; nothing else moves, and
   * `updatedAt` stays, since a new place is not an edit.
   */
  moveWorkItemInOrder(
    workItemId: string,
    placement: PlanningWorkItemPlacement,
    actor: PlanningActor
  ): PlanningWorkItem {
    const current = this.requireWorkItem(workItemId)
    this.requireProject(current.projectId)
    this.activity.requireActor(actor)
    const target = this.orderPlacement(current, placement)
    const status =
      placement.status === undefined
        ? undefined
        : enumValue(placement.status, WORK_ITEM_STATUSES, 'work item status')
    // A move into a column (MOP-26) names it; a move to a status alone is its own column.
    const columnId = status === undefined ? undefined : (placement.columnId ?? null)
    let item = current
    this.db.transaction(() => {
      if (
        status !== undefined &&
        (status !== current.status || columnId !== (current.columnId ?? null))
      )
        item = this.updateWorkItem(workItemId, { status, columnId }, actor)
      item = { ...item, orderKey: this.order.place(current.projectId, workItemId, target) }
    })()
    this.changed(current.projectId)
    return item
  }

  /**
   * Puts these tasks at the end of their project in the order given: a plan
   * or a project file creates parents and dependencies first, and this keeps
   * the order its tasks were listed in.
   */
  keepListedOrder(projectId: string, workItemIds: string[]): string[] {
    return this.order.appendInOrder(projectId, workItemIds)
  }

  private orderPlacement(
    item: PlanningWorkItem,
    placement: PlanningWorkItemPlacement
  ): OrderPlacement {
    const anchors = [placement.beforeId, placement.afterId, placement.position].filter(
      (value) => value !== undefined
    )
    if (anchors.length !== 1) throw new Refusal(t('errors:planningService.placementNeedsOneAnchor'))
    const anchorId = placement.beforeId ?? placement.afterId
    if (anchorId !== undefined) {
      if (typeof anchorId !== 'string' || anchorId === item.id)
        throw new Refusal(t('errors:planningService.placementAnchorInvalid'))
      this.requireWorkItemForProject(anchorId, item.projectId)
      return placement.beforeId !== undefined ? { beforeId: anchorId } : { afterId: anchorId }
    }
    if (placement.position !== 'start' && placement.position !== 'end')
      throw new Refusal(t('errors:planningService.placementPositionInvalid'))
    return {
      position: placement.position,
      status:
        placement.status === undefined
          ? item.status
          : enumValue(placement.status, WORK_ITEM_STATUSES, 'work item status')
    }
  }

  /** Several tasks through the normal create path, all or none (Make a task, N4.4b). */
  createWorkItemsTogether(
    projectId: string,
    inputs: CreatePlanningWorkItemInput[],
    actor: PlanningActor
  ): PlanningWorkItem[] {
    return this.db.transaction(() =>
      inputs.map((input) => this.createWorkItem(projectId, input, actor))
    )()
  }

  /** Deletes several tasks for good, all or none: the undo of a creation just made. */
  deleteWorkItemsTogether(workItemIds: string[], actor: PlanningActor): void {
    this.db.transaction(() => {
      for (const id of workItemIds) this.deleteWorkItem(id, actor)
    })()
  }

  /** `actor` is the human who approved the draft, with the draft's id. */
  createAIApprovedWorkItems(
    projectId: string,
    inputs: CreatePlanningWorkItemInput[],
    actor: PlanningActor
  ): PlanningWorkItem[] {
    if (inputs.length === 0 || inputs.length > 8) {
      throw new Refusal('AI planning approval must contain between one and eight suggestions')
    }
    return this.db.transaction(() =>
      inputs.map((input) => this.createWorkItem(projectId, input, actor, 'ai-approved'))
    )()
  }

  /**
   * Find actions and decisions (N4.1b): the ticked tasks and decisions in one
   * transaction, through the normal create paths, both `ai-approved`. Each
   * decision links every task made in the same step; `decisionContext` gives
   * its context (the caller names the note there).
   */
  createAIApprovedTasksAndDecisions(
    projectId: string,
    tasks: CreatePlanningWorkItemInput[],
    decisions: CreatePlanningDecisionInput[],
    actor: PlanningActor
  ): { tasks: PlanningWorkItem[]; decisions: PlanningDecision[] } {
    if (tasks.length > 8 || decisions.length > 8 || tasks.length + decisions.length === 0) {
      throw new Refusal('AI planning approval must contain between one and eight of each')
    }
    return this.db.transaction(() => {
      const created = tasks.map((input) =>
        this.createWorkItem(projectId, input, actor, 'ai-approved')
      )
      const linkedWorkItemIds = created.map((item) => item.id)
      return {
        tasks: created,
        decisions: decisions.map((input) =>
          this.createDecision(projectId, { ...input, linkedWorkItemIds }, 'ai-approved')
        )
      }
    })()
  }

  /**
   * The single write point for a task's fields. `actor` is required, so no
   * write path can leave a change without its author (P5.2); one
   * `planning_field_changes` row is recorded per changed field.
   */
  updateWorkItem(
    workItemId: string,
    updates: UpdatePlanningWorkItemInput,
    actor: PlanningActor,
    options: {
      renamedCriteria?: ReadonlyMap<string, string>
      /** The description's old text starts a version of its own (a restore, N2.6). */
      newDescriptionVersion?: boolean
    } = {}
  ): PlanningWorkItem {
    const current = this.requireWorkItem(workItemId)
    // A renamed checklist item keeps its tick (N2.5): `renamedCriteria` maps
    // an old text to its new one, and the tick moves with it in this update.
    const renamed = options.renamedCriteria ?? new Map<string, string>()
    const wasChecked = new Set(current.checkedCriteria.map((text) => renamed.get(text) ?? text))
    this.requireProject(current.projectId)
    const who = this.activity.requireActor(actor)
    if (updates?.undoRuleRun !== undefined) {
      // An undo (R6.2): what the rules did goes first, then the person's own
      // change goes back, in one transaction, and the undo sets off nothing.
      const { undoRuleRun, ...rest } = updates
      return this.db.transaction(() => {
        this.rules.undo(undoRuleRun, current.projectId, who)
        return this.withoutRules(() => this.updateWorkItem(workItemId, rest, actor))
      })()
    }
    const milestoneId =
      updates.milestoneId === undefined ? current.milestoneId : updates.milestoneId
    if (milestoneId) this.requireMilestoneForProject(milestoneId, current.projectId)
    const iterationId =
      updates.iterationId === undefined ? (current.iterationId ?? null) : updates.iterationId
    if (iterationId) this.iterations.requireInProject(iterationId, current.projectId)
    const typeId = updates.typeId === undefined ? (current.typeId ?? null) : updates.typeId
    if (typeId) this.taskTypes.requireInProject(typeId, current.projectId)
    const subprojectId =
      updates.subprojectId === undefined ? (current.subprojectId ?? null) : updates.subprojectId
    if (subprojectId) this.subprojects.requireInProject(subprojectId, current.projectId)
    const { dependencyIds, dependencyLinks } =
      updates.dependencyIds === undefined && updates.dependencyLinks === undefined
        ? { dependencyIds: current.dependencyIds, dependencyLinks: dependencyLinksOf(current) }
        : this.dependencyLinksInput(
            updates.dependencyLinks,
            updates.dependencyIds,
            dependencyLinksOf(current)
          )
    const { subtaskPhaseNumber, subtaskPhaseName } =
      updates.subtaskPhaseNumber === undefined && updates.subtaskPhaseName === undefined
        ? {
            subtaskPhaseNumber: current.subtaskPhaseNumber,
            subtaskPhaseName: current.subtaskPhaseName
          }
        : onField('parentWorkItemId', () =>
            this.validateSubtaskPlacement(
              current.id,
              current.projectId,
              current.parentWorkItemId,
              updates.subtaskPhaseNumber === undefined
                ? current.subtaskPhaseNumber
                : updates.subtaskPhaseNumber,
              updates.subtaskPhaseName === undefined
                ? current.subtaskPhaseName
                : updates.subtaskPhaseName
            )
          )
    onField('dependencyIds', () =>
      this.validateDependencies(current.id, current.projectId, dependencyIds, {
        parentWorkItemId: current.parentWorkItemId,
        subtaskPhaseNumber
      })
    )
    const item: PlanningWorkItem = {
      ...current,
      milestoneId,
      iterationId,
      typeId,
      subprojectId,
      subtaskPhaseNumber,
      subtaskPhaseName,
      title:
        updates.title === undefined
          ? current.title
          : requiredText(updates.title, 'Work item title', 200),
      description:
        updates.description === undefined
          ? current.description
          : optionalText(updates.description, 'Work item description', 8000),
      ...this.columnPlace(
        current.projectId,
        updates.status === undefined
          ? current.status
          : enumValue(updates.status, WORK_ITEM_STATUSES, 'work item status'),
        // A new status without a column is that status's own column.
        updates.columnId !== undefined
          ? updates.columnId
          : updates.status === undefined || updates.status === current.status
            ? (current.columnId ?? null)
            : null
      ),
      priority:
        updates.priority === undefined
          ? current.priority
          : enumValue(updates.priority, PRIORITIES, 'work item priority'),
      labels:
        updates.labels === undefined ? current.labels : textList(updates.labels, 'Labels', 20, 80),
      acceptanceCriteria:
        updates.acceptanceCriteria === undefined
          ? current.acceptanceCriteria
          : textList(updates.acceptanceCriteria, 'Acceptance criteria', 30, 500),
      dependencyIds,
      dependencyLinks,
      targetDate:
        updates.targetDate === undefined ? current.targetDate : targetDate(updates.targetDate),
      startDate:
        updates.startDate === undefined
          ? current.startDate
          : calendarDate(updates.startDate, 'Start date'),
      showFrom:
        updates.showFrom === undefined
          ? (current.showFrom ?? null)
          : calendarDate(updates.showFrom, 'Show from date'),
      someday: flag(updates.someday, 'Someday') ?? Boolean(current.someday),
      inTriage: flag(updates.inTriage, 'In triage') ?? Boolean(current.inTriage),
      capturedBy: current.capturedBy ?? null,
      impact:
        updates.impact === undefined ? (current.impact ?? null) : score(updates.impact, 'impact'),
      effort:
        updates.effort === undefined ? (current.effort ?? null) : score(updates.effort, 'effort'),
      assigneeId:
        updates.assigneeId === undefined
          ? current.assigneeId
          : this.assigneeId(updates.assigneeId, current.projectId),
      estimate: updates.estimate === undefined ? current.estimate : estimate(updates.estimate),
      autoQueue: updates.autoQueue === undefined ? current.autoQueue : Boolean(updates.autoQueue),
      planFirst: planFirstChoice(updates.planFirst) ?? current.planFirst ?? 'default',
      blockedReason:
        updates.blockedReason === undefined
          ? (current.blockedReason ?? '')
          : optionalText(updates.blockedReason, 'Blocked reason', 200),
      updatedAt: Date.now()
    }
    // A reason says why a task is blocked, so it goes when the task leaves Blocked.
    if (item.status !== 'blocked') item.blockedReason = ''
    // Parking a task in Someday is one of triage's decisions (N4.3a).
    if (item.someday && !current.someday) item.inTriage = false
    const fieldValues = this.fields.validate(current.projectId, updates.fieldValues)
    if (fieldValues.size > 0) {
      const merged = { ...(current.fieldValues ?? {}) }
      // A value written here is the person's (N8.4), even one Ostler AI filled.
      const fills = { ...(current.fieldFills ?? {}) }
      for (const [fieldId, value] of fieldValues)
        if (value === null) {
          delete merged[fieldId]
          delete fills[fieldId]
        } else {
          merged[fieldId] = value
          fills[fieldId] = { filledBy: 'person', sourceHash: null }
        }
      item.fieldValues = merged
      item.fieldFills = fills
    }
    onField('dueDate', () => validateDateRange(item.startDate, item.targetDate))
    // Ticks belong to texts: a tick whose text left the list goes with it.
    item.checkedCriteria = item.acceptanceCriteria.filter((text) => wasChecked.has(text))
    // So do an item's date and person (N2.2), and a rename carries them.
    const detailMoves = [...renamed].filter(
      ([from, to]) =>
        from !== to &&
        current.acceptanceCriteria.includes(from) &&
        item.acceptanceCriteria.includes(to)
    )
    const movedDetails = new Map(
      (current.checklistDetails ?? []).map((detail) => {
        const text = renamed.get(detail.text) ?? detail.text
        return [text, { ...detail, text }]
      })
    )
    item.checklistDetails = detailsInOrder(item.acceptanceCriteria, movedDetails)
    // A task waiting for someone's sign-off is not finished yet (D9); local edits only.
    if (item.status === 'done' && current.status !== 'done')
      this.requireNoWaitingSignOff('task', item.id)
    let resolvedBlockers: string[] = []
    const update = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE planning_work_items
           SET milestone_id = ?, title = ?, description = ?, status = ?, priority = ?, labels = ?,
               acceptance_criteria = ?, target_date = ?, start_date = ?, assignee_id = ?, estimate = ?,
               auto_queue = ?, subtask_phase_number = ?, subtask_phase_name = ?, updated_at = ?,
               iteration_id = ?, show_from = ?, someday = ?, type_id = ?, plan_first = ?,
               impact = ?, effort = ?, column_id = ?, subproject_id = ?, blocked_reason = ?
           WHERE id = ?`
        )
        .run(
          item.milestoneId,
          item.title,
          item.description,
          item.status,
          item.priority,
          JSON.stringify(item.labels),
          JSON.stringify(item.acceptanceCriteria),
          item.targetDate,
          item.startDate,
          item.assigneeId,
          item.estimate,
          item.autoQueue ? 1 : 0,
          item.subtaskPhaseNumber,
          item.subtaskPhaseName,
          item.updatedAt,
          item.iterationId,
          item.showFrom ?? null,
          item.someday ? 1 : 0,
          item.typeId ?? null,
          item.planFirst ?? 'default',
          item.impact ?? null,
          item.effort ?? null,
          item.columnId ?? null,
          item.subprojectId ?? null,
          item.blockedReason ?? '',
          item.id
        )
      if (Boolean(current.inTriage) !== Boolean(item.inTriage))
        this.setTriageMark(current, Boolean(item.inTriage), who, item.updatedAt)
      this.replaceDependencies(item.id, dependencyLinksOf(item))
      this.fields.write(item.projectId, item.id, fieldValues)
      if (updates.acceptanceCriteria !== undefined) {
        this.renameChecks(item, current, renamed)
        this.checklistDetails.rename(item.id, detailMoves)
        this.deleteChecksNotIn(item.id, item.acceptanceCriteria)
        this.checklistDetails.deleteNotIn(item.id, item.acceptanceCriteria)
      }
      this.activity.recordUpdate(current, item, who, item.updatedAt)
      if (item.description !== current.description)
        this.descriptionVersions.keep(
          item,
          current.description,
          who,
          item.updatedAt,
          options.newDescriptionVersion
        )
      // Only a real move is history: agent status sync runs often.
      if (item.status !== current.status) {
        this.activity.recordStatus(item.id, current.status, item.status, who, item.updatedAt)
        this.startMilestoneIfPlanned(item)
      }
      this.reminders.syncTask(item, item.updatedAt)
      this.search.indexEntity('task', item.id)
      // Reaching Done makes a recurring task's next occurrence, in this same
      // transaction but in its own savepoint: if that fails, the status
      // change still stands and nothing half-made is left.
      if (item.status === 'done' && current.status !== 'done') {
        // A task that is done is no longer blocked.
        resolvedBlockers = resolveBlockersOfDoneTask(this.db, item.id, who.kind, item.updatedAt)
        try {
          const next = this.db.transaction(() => this.repeatTask(item, who))()
          if (next) item.repeatedAs = next.id
        } catch (error) {
          console.error(`Could not repeat task ${item.id}:`, error)
          item.repeatError = `The task is done, but its next occurrence couldn't be created: ${
            error instanceof Error ? error.message : String(error)
          }`
        }
      }
      // Rules (D45), last, in this transaction: a rule that fails undoes all of it.
      if (!this.rulesOn(who)) return null
      const changes: RuleChange[] = []
      const statusChanged = item.status !== current.status
      // A move between columns of one status is a move for rules too (MOP-26).
      const columnChanged = (item.columnId ?? null) !== (current.columnId ?? null)
      const assigneeChanged = item.assigneeId !== current.assigneeId
      const checklistCompleted = checklistComplete(item) && !checklistComplete(current)
      if (statusChanged || columnChanged || assigneeChanged || checklistCompleted)
        changes.push({
          task: item,
          ...(statusChanged || columnChanged
            ? { statusFrom: current.status, columnFrom: current.columnId ?? null }
            : {}),
          assigneeChanged,
          checklistCompleted
        })
      if (statusChanged) changes.push(...this.subtasksDoneChange(item))
      return this.rules.afterChange(changes)
    })
    const ruleRun = update()
    const result: PlanningWorkItem = ruleRun
      ? {
          ...this.requireWorkItem(item.id),
          ...(item.repeatedAs ? { repeatedAs: item.repeatedAs } : {}),
          ...(item.repeatError ? { repeatError: item.repeatError } : {}),
          ruleRun
        }
      : item
    // Assigned to Me by Me on this PC: Me follows it (prompt 15). Not when an agent or a rule did it.
    if (item.assigneeId && item.assigneeId !== current.assigneeId) {
      if (item.assigneeId === this.people.getMe()?.id) this.autoFollow(item.projectId, item.id, who)
    }
    this.changed(item.projectId)
    for (const blockerId of resolvedBlockers)
      this.blockersChanged(item.projectId, { kind: 'resolved', blockerId, workItemId: item.id })
    if (this.workItemChangedListener) {
      try {
        this.workItemChangedListener(result)
      } catch {
        // The edit itself has landed; a listener failing must not undo it.
      }
    }
    return result
  }

  /**
   * A milestone is under way once any of its work is. Nothing else ever moved
   * a milestone off `planned`, so one whose every item had shipped still read
   * as not started. Only ever forward and only from `planned`: completing a
   * milestone stays a human decision, which the readiness verdict informs.
   */
  private startMilestoneIfPlanned(item: PlanningWorkItem): void {
    startMilestoneIfPlanned(this.db, item.milestoneId, item.status, item.updatedAt)
  }

  private workItemChangedListener: ((item: PlanningWorkItem) => void) | null = null

  /**
   * Called after every work-item edit, from whichever surface made it. This is
   * the one write path, so it is where copies of the item's content (a queued
   * task's text) are kept in step with it.
   */
  setWorkItemChangedListener(listener: ((item: PlanningWorkItem) => void) | null): void {
    this.workItemChangedListener = listener
  }

  /** Permanent: the task's history and comments go with it. */
  deleteWorkItem(workItemId: string, actor: PlanningActor): void {
    const current = this.requireWorkItem(workItemId)
    this.requireProject(current.projectId)
    this.activity.requireActor(actor)
    if (current.linkedHarnessTaskId) {
      throw new Refusal('Linked agent work cannot be deleted; cancel its execution handoff first')
    }
    this.db.transaction(() => {
      this.search.removeEntity('task', workItemId)
      this.deleteSignOffs('task', [workItemId])
      this.db.prepare('DELETE FROM planning_work_items WHERE id = ?').run(workItemId)
    })()
    this.changed(current.projectId)
  }

  /**
   * Archive/bin moves. Callers decide whether linked agent work allows the
   * move (see workItemDeletionBlocker). An archived item keeps its link to the
   * finished agent task, so its report and history stay reachable; the bin, like
   * a permanent delete, refuses an item that is still linked. `updated_at` is
   * left alone so a restored item keeps its place.
   */
  archiveWorkItem(workItemId: string, actor: PlanningActor, now = Date.now()): PlanningWorkItem {
    const current = this.requireWorkItem(workItemId)
    this.requireProject(current.projectId)
    const who = this.activity.requireActor(actor)
    if (current.deletedAt) throw new Refusal(t('errors:planningService.restoreItemRecycleBin'))
    this.db.transaction(() => {
      this.db
        .prepare('UPDATE planning_work_items SET archived_at = ? WHERE id = ?')
        .run(now, workItemId)
      if (!current.archivedAt)
        this.activity.recordChange(current, 'archived', undefined, undefined, who, now)
      this.reminders.syncTask(this.requireWorkItem(workItemId), now)
    })()
    this.changed(current.projectId)
    return this.requireWorkItem(workItemId)
  }

  /**
   * Refuses tasks that cannot be closed as won't do, or a reason that is too
   * long, without changing anything (N1.2). Returns the tasks.
   */
  checkWontDo(workItemIds: string[], reason: string): PlanningWorkItem[] {
    if (reason.trim().length > MAX_RESOLUTION_REASON_LENGTH)
      throw new Refusal(
        t('errors:planningService.wontDoReasonTooLong', { max: MAX_RESOLUTION_REASON_LENGTH })
      )
    const items = workItemIds.map((id) => this.requireWorkItem(id))
    for (const item of items) {
      this.requireProject(item.projectId)
      refuseWontDo(item)
    }
    return items
  }

  /**
   * Closes open tasks as won't do (N1.2, N8), all in one transaction: each
   * keeps its status, gets the resolution and reason, is archived, and records
   * one "won't do" entry. A repeating task skips this occurrence: its next one
   * is made exactly as reaching Done makes it. Rules see no status change, so
   * none run. Callers decide whether agent work allows it (`closeAsWontDo` in
   * planning-deletion.ts, the one rule); this refuses a task that is done,
   * already won't do, archived or in the recycle bin.
   */
  closeWorkItemsAsWontDo(
    workItemIds: string[],
    reason: string,
    actor: PlanningActor,
    now = Date.now()
  ): { workItems: PlanningWorkItem[]; repeatedAs: Map<string, string> } {
    const who = this.activity.requireActor(actor)
    const items = this.checkWontDo(workItemIds, reason)
    const text = reason.trim()
    const repeatedAs = new Map<string, string>()
    this.db.transaction(() => {
      const update = this.db.prepare(
        "UPDATE planning_work_items SET resolution = 'wont-do', resolution_reason = ?, archived_at = ? WHERE id = ?"
      )
      for (const item of items) {
        update.run(text, now, item.id)
        // Won't do and Duplicate of are triage decisions too (N4.3a).
        if (item.inTriage) this.setTriageMark(item, false, who, now)
        this.activity.recordChange(item, 'wontDo', undefined, text, who, now)
        this.reminders.syncTask(this.requireWorkItem(item.id), now)
        this.search.indexEntity('task', item.id)
        const next = this.repeatTask(item, who)
        if (next) repeatedAs.set(item.id, next.id)
      }
    })()
    for (const projectId of new Set(items.map((item) => item.projectId))) this.changed(projectId)
    return { workItems: items.map((item) => this.requireWorkItem(item.id)), repeatedAs }
  }

  /**
   * Move to project (N4.3a): makes a task in To triage again in another
   * project (title, description, checklist, priority, due date, assignee;
   * labels by name where that project has them) and puts the original in the
   * recycle bin, in one transaction. The new task follows that project's
   * Triage new captures setting: it waits in its To triage when the setting
   * is on, and is an ordinary Backlog task there when it is off. The app
   * and the automation API both move through here.
   */
  moveTriagedWorkItem(
    workItemId: string,
    toProjectId: string,
    actor: PlanningActor
  ): PlanningWorkItem {
    const source = this.requireWorkItem(workItemId)
    this.requireProject(source.projectId)
    this.requireProject(toProjectId)
    this.activity.requireActor(actor)
    if (!source.inTriage || source.deletedAt || source.archivedAt)
      throw new Refusal('Only a task in To triage can be moved to another project')
    if (toProjectId === source.projectId) throw new Refusal('The task is already in that project')
    const known = new Set(this.listProjectLabels(toProjectId).map((label) => label.name))
    const move = this.db.transaction((): PlanningWorkItem => {
      const created = this.createWorkItem(
        toProjectId,
        {
          title: source.title,
          description: source.description,
          acceptanceCriteria: source.acceptanceCriteria,
          priority: source.priority,
          targetDate: source.targetDate,
          assigneeId: source.assigneeId,
          labels: source.labels.filter((label) => known.has(label))
        },
        actor,
        'human',
        null,
        this.triageOn(toProjectId) ? { triage: source.capturedBy ?? 'quick-add' } : {}
      )
      this.moveWorkItemToBin(source.id, actor)
      return created
    })
    return move()
  }

  /**
   * The one place a task's triage mark changes (N4.3a): every decision
   * (Accept, Someday, Won't do, Duplicate of) clears it here, and their undo
   * sets it again. Inside the caller's transaction; records one entry.
   */
  private setTriageMark(
    item: PlanningWorkItem,
    inTriage: boolean,
    who: PlanningActor,
    at: number
  ): void {
    this.db
      .prepare('UPDATE planning_work_items SET in_triage = ? WHERE id = ?')
      .run(inTriage ? 1 : 0, item.id)
    this.activity.recordChange(item, 'triage', !inTriage, inTriage, who, at)
  }

  /**
   * Back to the Board. A won't-do task (N1.2) is reopened: its resolution and
   * reason are cleared, and it returns with the status it had. Reopen, undo
   * and the automation API's unarchive all come here.
   */
  unarchiveWorkItem(workItemId: string, actor: PlanningActor): PlanningWorkItem {
    const current = this.requireWorkItem(workItemId)
    this.requireProject(current.projectId)
    const who = this.activity.requireActor(actor)
    this.db.transaction(() => {
      this.db
        .prepare(
          "UPDATE planning_work_items SET archived_at = NULL, resolution = NULL, resolution_reason = '' WHERE id = ?"
        )
        .run(workItemId)
      const at = Date.now()
      if (current.resolution)
        this.activity.recordChange(current, 'reopened', current.resolution, undefined, who, at)
      else if (current.archivedAt)
        this.activity.recordChange(current, 'unarchived', undefined, undefined, who, at)
      if (current.resolution) this.search.indexEntity('task', workItemId)
      this.reminders.syncTask(this.requireWorkItem(workItemId), Date.now())
    })()
    this.changed(current.projectId)
    return this.requireWorkItem(workItemId)
  }

  moveWorkItemToBin(workItemId: string, actor: PlanningActor, now = Date.now()): PlanningWorkItem {
    const current = this.requireWorkItem(workItemId)
    this.requireProject(current.projectId)
    const who = this.activity.requireActor(actor)
    if (current.linkedHarnessTaskId) {
      throw new Refusal('Linked agent work cannot be deleted; cancel its execution handoff first')
    }
    this.db.transaction(() => {
      this.db
        .prepare('UPDATE planning_work_items SET deleted_at = COALESCE(deleted_at, ?) WHERE id = ?')
        .run(now, workItemId)
      if (!current.deletedAt)
        this.activity.recordChange(current, 'deleted', undefined, undefined, who, now)
      this.reminders.syncTask(this.requireWorkItem(workItemId), now)
    })()
    this.changed(current.projectId)
    return this.requireWorkItem(workItemId)
  }

  /** Back to wherever it was before deletion: the Board, or the archive if it had been archived. */
  restoreWorkItem(workItemId: string, actor: PlanningActor): PlanningWorkItem {
    const current = this.requireWorkItem(workItemId)
    this.requireProject(current.projectId)
    const who = this.activity.requireActor(actor)
    if (!current.deletedAt) return current
    this.db.transaction(() => {
      this.db
        .prepare('UPDATE planning_work_items SET deleted_at = NULL WHERE id = ?')
        .run(workItemId)
      this.activity.recordChange(current, 'restored', undefined, undefined, who, Date.now())
      this.reminders.syncTask(this.requireWorkItem(workItemId), Date.now())
    })()
    this.changed(current.projectId)
    return this.requireWorkItem(workItemId)
  }

  /**
   * Whether this PC only views the project: its own person is a Viewer of its
   * share (D9). Background work skips such a project rather than trip the guard.
   */
  isViewerProject(projectId: string): boolean {
    // A Contributor cannot create the tasks background work would make (D5), so is skipped too.
    const role = myRoleOf(this.db, projectId)
    return role === 'viewer' || role === 'contributor'
  }

  /** Permanently deletes binned items older than the retention period. Returns how many went. */
  purgeRecycleBin(projectId: string, now = Date.now()): number {
    this.requireProject(projectId)
    const cutoff = now - RECYCLE_BIN_RETENTION_DAYS * 24 * 60 * 60 * 1000
    return this.db.transaction(() => {
      const expired = this.db
        .prepare(
          'SELECT id FROM planning_work_items WHERE project_id = ? AND deleted_at IS NOT NULL AND deleted_at <= ?'
        )
        .all(projectId, cutoff) as { id: string }[]
      for (const { id } of expired) this.search.removeEntity('task', id)
      this.deleteSignOffs(
        'task',
        expired.map((row) => row.id)
      )
      return this.db
        .prepare(
          'DELETE FROM planning_work_items WHERE project_id = ? AND deleted_at IS NOT NULL AND deleted_at <= ?'
        )
        .run(projectId, cutoff).changes
    })()
  }

  /** The narrow, four-column write path used by ACCEPT_TASK_STATUS_REVIEW. */
  updateVerification(
    workItemId: string,
    updates: UpdatePlanningVerificationInput,
    actor: PlanningActor
  ): PlanningWorkItem {
    const current = this.requireWorkItem(workItemId)
    this.requireProject(current.projectId)
    const who = this.activity.requireActor(actor)
    const verificationStatus = enumValue(
      updates.verificationStatus,
      ['unverified', 'pending', 'passed', 'failed', 'needs-rework'] as PlanningVerificationStatus[],
      'verification status'
    )
    const verifiedBy = enumValue(
      updates.verifiedBy,
      ['human', 'ai-review'] as PlanningVerifiedBy[],
      'verified by'
    )
    const verificationNotes = optionalText(updates.verificationNotes, 'Verification notes', 4000)
    const verifiedAt = Date.now()
    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE planning_work_items
           SET verification_status = ?, verified_by = ?, verified_at = ?, verification_notes = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(verificationStatus, verifiedBy, verifiedAt, verificationNotes, verifiedAt, current.id)
      if (verificationStatus !== current.verificationStatus)
        this.activity.recordChange(
          current,
          'verification',
          current.verificationStatus,
          verificationStatus,
          who,
          verifiedAt
        )
    })()
    return {
      ...current,
      verificationStatus,
      verifiedBy,
      verifiedAt,
      verificationNotes,
      updatedAt: verifiedAt
    }
  }

  listBlockersForWorkItem(workItemId: string): PlanningBlocker[] {
    const item = this.requireWorkItem(workItemId)
    this.requireProject(item.projectId)
    const rows = this.db
      .prepare('SELECT * FROM planning_blockers WHERE work_item_id = ? ORDER BY reported_at ASC')
      .all(workItemId) as BlockerRow[]
    return rows.map((row) => toBlocker(row))
  }

  listOpenBlockers(projectId: string): PlanningBlockerWithWorkItem[] {
    this.requireProject(projectId)
    const rows = this.db
      .prepare(
        `SELECT blocker.*, item.title as work_item_title, item.task_code as work_item_code
         FROM planning_blockers blocker
         JOIN planning_work_items item ON item.id = blocker.work_item_id
         WHERE item.project_id = ? AND blocker.status = 'open' AND item.status <> 'done'
         ORDER BY blocker.reported_at ASC`
      )
      .all(projectId) as (BlockerRow & { work_item_title: string; work_item_code: string })[]
    return rows.map((row) => ({
      ...toBlocker(row),
      workItemTitle: row.work_item_title,
      workItemCode: row.work_item_code
    }))
  }

  reportBlocker(
    workItemId: string,
    description: string,
    reportedBy: PlanningBlockerReportedBy,
    resolutionOptions: string[] = []
  ): PlanningBlocker {
    const item = this.requireWorkItem(workItemId)
    this.requireProject(item.projectId)
    const blocker: PlanningBlocker = {
      id: uuidv4(),
      workItemId,
      description: requiredText(description, 'Blocker description', 2000),
      reportedBy: enumValue(
        reportedBy,
        ['agent', 'human', 'ai-review'] as PlanningBlockerReportedBy[],
        'blocker reporter'
      ),
      reportedAt: Date.now(),
      status: 'open',
      resolutionOptions: textList(resolutionOptions, 'Resolution options', 10, 300),
      resolutionChoice: null,
      resolutionNote: '',
      resolvedAt: null,
      resolvedBy: null
    }
    this.db
      .prepare(
        `INSERT INTO planning_blockers
          (id, work_item_id, description, reported_by, reported_at, status, resolution_options, resolution_choice, resolution_note, resolved_at, resolved_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        blocker.id,
        blocker.workItemId,
        blocker.description,
        blocker.reportedBy,
        blocker.reportedAt,
        blocker.status,
        JSON.stringify(blocker.resolutionOptions),
        blocker.resolutionChoice,
        blocker.resolutionNote,
        blocker.resolvedAt,
        blocker.resolvedBy
      )
    this.blockersChanged(item.projectId, {
      kind: 'reported',
      blockerId: blocker.id,
      workItemId: blocker.workItemId
    })
    return blocker
  }

  resolveBlocker(
    blockerId: string,
    choice: string,
    note: string,
    resolvedBy: string
  ): PlanningBlocker {
    const row = this.db.prepare('SELECT * FROM planning_blockers WHERE id = ?').get(blockerId) as
      BlockerRow | undefined
    if (!row) throw new Refusal(t('errors:planningService.blockerWasNotFound'))
    const current = toBlocker(row)
    if (current.status === 'resolved')
      throw new Refusal(t('errors:planningService.blockerAlreadyResolved'))
    const resolvedAt = Date.now()
    const resolutionChoice = requiredText(choice, 'Resolution choice', 300)
    const resolutionNote = optionalText(note, 'Resolution note', 2000)
    this.db
      .prepare(
        `UPDATE planning_blockers
         SET status = 'resolved', resolution_choice = ?, resolution_note = ?, resolved_at = ?, resolved_by = ?
         WHERE id = ?`
      )
      .run(resolutionChoice, resolutionNote, resolvedAt, resolvedBy.trim().slice(0, 200), blockerId)
    this.blockersChanged(this.requireWorkItem(current.workItemId).projectId, {
      kind: 'resolved',
      blockerId,
      workItemId: current.workItemId
    })
    return {
      ...current,
      status: 'resolved',
      resolutionChoice,
      resolutionNote,
      resolvedAt,
      resolvedBy: resolvedBy.trim().slice(0, 200)
    }
  }

  /**
   * The Step 4 "Done" action of the guided Agent Plan & Split workflow.
   * A sibling to `createAIApprovedWorkItems`, not a modification of it — that
   * method's 1-8 cap and flat shape stay untouched for the existing flows.
   *
   * Hard caps are enforced here regardless of what the caller claims: at most
   * 8 phases, 12 top-level tasks per phase, 5 subtasks per node per level, 60
   * total nodes. Creation is idempotent per draft (`actor.draftId`): a second
   * call for the same draft returns the items the first one created rather
   * than creating them again.
   */
  createAgentPlanTasks(
    projectId: string,
    milestoneId: string | null,
    phases: { code: string; name: string; tasks: AIPlanTaskNode[] }[],
    actor: PlanningActor,
    planRules: string[] = []
  ): PlanningWorkItem[] {
    return this.workflows.createAgentPlanTasks(projectId, milestoneId, phases, actor, planRules)
  }

  /**
   * The live tasks an AI draft created. Approving a draft twice (a retried
   * request, a second click) finds them here instead of adding them again;
   * the draft id is on each task's "created" history, not on a label anyone
   * sees.
   */
  listWorkItemsFromDraft(projectId: string, draftId: string): PlanningWorkItem[] {
    const ids = new Set(this.activity.workItemIdsCreatedFromDraft(projectId, draftId))
    return ids.size ? this.listWorkItems(projectId).filter((item) => ids.has(item.id)) : []
  }
  listDecisions(projectId: string): PlanningDecision[] {
    this.requireProject(projectId)
    const rows = this.db
      .prepare(
        'SELECT * FROM planning_decisions WHERE project_id = ? ORDER BY date DESC, updated_at DESC'
      )
      .all(projectId) as DecisionRow[]
    return rows.map((row) => toDecision(row))
  }

  getDecision(decisionId: string): PlanningDecision {
    const decision = this.requireDecision(decisionId)
    this.requireProject(decision.projectId)
    return decision
  }

  createDecision(
    projectId: string,
    input: CreatePlanningDecisionInput,
    origin: PlanningDecisionOrigin = 'human'
  ): PlanningDecision {
    this.requireProject(projectId)
    const now = Date.now()
    const linkedWorkItemIds = uniqueIds(input.linkedWorkItemIds)
    this.validateLinkedWorkItems(projectId, linkedWorkItemIds)
    const today = todayIsoDate()
    const decision: PlanningDecision = {
      id: uuidv4(),
      projectId,
      title: requiredText(input.title, 'Decision title', 200),
      context: optionalText(input.context, 'Decision context', 8000),
      decision: requiredText(input.decision, 'Decision summary', 8000),
      alternativesConsidered: optionalText(
        input.alternativesConsidered,
        'Alternatives considered',
        8000
      ),
      consequences: optionalText(input.consequences, 'Consequences', 8000),
      date: targetDate(input.date) ?? today,
      linkedWorkItemIds,
      origin,
      createdAt: now,
      updatedAt: now
    }
    return this.withIndex('decision', () => {
      this.db
        .prepare(
          `INSERT INTO planning_decisions
          (id, project_id, title, context, decision, alternatives_considered, consequences, date, linked_work_item_ids, origin, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          decision.id,
          decision.projectId,
          decision.title,
          decision.context,
          decision.decision,
          decision.alternativesConsidered,
          decision.consequences,
          decision.date,
          JSON.stringify(decision.linkedWorkItemIds),
          decision.origin,
          decision.createdAt,
          decision.updatedAt
        )
      return decision
    })
  }

  updateDecision(decisionId: string, updates: UpdatePlanningDecisionInput): PlanningDecision {
    const current = this.requireDecision(decisionId)
    this.requireProject(current.projectId)
    const linkedWorkItemIds =
      updates.linkedWorkItemIds === undefined
        ? current.linkedWorkItemIds
        : uniqueIds(updates.linkedWorkItemIds)
    this.validateLinkedWorkItems(current.projectId, linkedWorkItemIds)
    const decision: PlanningDecision = {
      ...current,
      title:
        updates.title === undefined
          ? current.title
          : requiredText(updates.title, 'Decision title', 200),
      context:
        updates.context === undefined
          ? current.context
          : optionalText(updates.context, 'Decision context', 8000),
      decision:
        updates.decision === undefined
          ? current.decision
          : requiredText(updates.decision, 'Decision summary', 8000),
      alternativesConsidered:
        updates.alternativesConsidered === undefined
          ? current.alternativesConsidered
          : optionalText(updates.alternativesConsidered, 'Alternatives considered', 8000),
      consequences:
        updates.consequences === undefined
          ? current.consequences
          : optionalText(updates.consequences, 'Consequences', 8000),
      date: updates.date === undefined ? current.date : (targetDate(updates.date) ?? current.date),
      linkedWorkItemIds,
      updatedAt: Date.now()
    }
    return this.withIndex('decision', () => {
      this.db
        .prepare(
          `UPDATE planning_decisions
         SET title = ?, context = ?, decision = ?, alternatives_considered = ?, consequences = ?, date = ?, linked_work_item_ids = ?, updated_at = ?
         WHERE id = ?`
        )
        .run(
          decision.title,
          decision.context,
          decision.decision,
          decision.alternativesConsidered,
          decision.consequences,
          decision.date,
          JSON.stringify(decision.linkedWorkItemIds),
          decision.updatedAt,
          decision.id
        )
      return decision
    })
  }

  deleteDecision(decisionId: string): void {
    const current = this.requireDecision(decisionId)
    this.requireProject(current.projectId)
    this.db.transaction(() => {
      this.search.removeEntity('decision', decisionId)
      this.deleteSignOffs('decision', [decisionId])
      this.db.prepare('DELETE FROM planning_decisions WHERE id = ?').run(decisionId)
    })()
  }

  getWipLimits(projectId: string): PlanningWipLimits {
    this.requireProject(projectId)
    const rows = this.db
      .prepare('SELECT status, limit_value FROM planning_wip_limits WHERE project_id = ?')
      .all(projectId) as { status: PlanningWorkItemStatus; limit_value: number }[]
    const limits: PlanningWipLimits = {}
    for (const row of rows) limits[row.status] = row.limit_value
    return limits
  }

  setWipLimit(
    projectId: string,
    status: PlanningWorkItemStatus,
    limit: number | null
  ): PlanningWipLimits {
    this.requireProject(projectId)
    if (!WORK_ITEM_STATUSES.includes(status)) throw new Refusal('Invalid work item status')
    if (limit === null) {
      this.db
        .prepare('DELETE FROM planning_wip_limits WHERE project_id = ? AND status = ?')
        .run(projectId, status)
    } else {
      if (!Number.isInteger(limit) || limit < 1 || limit > 9999) {
        throw new Refusal(t('errors:planningService.wipLimitMustWhole'))
      }
      this.db
        .prepare(
          `INSERT INTO planning_wip_limits (project_id, status, limit_value, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(project_id, status) DO UPDATE SET limit_value = excluded.limit_value, updated_at = excluded.updated_at`
        )
        .run(projectId, status, limit, Date.now())
    }
    return this.getWipLimits(projectId)
  }

  /**
   * Ticks or unticks one checklist item (D21). The text must be one of the
   * task's acceptance criteria. Only the tick changes: never the task's
   * status, so unticking an item on finished work leaves it in Done.
   */
  setChecklistItemChecked(
    workItemId: string,
    criterionText: string,
    checked: boolean,
    actor: PlanningActor
  ): PlanningWorkItem {
    const current = this.requireWorkItem(workItemId)
    this.requireProject(current.projectId)
    const who = this.activity.requireActor(actor)
    if (typeof checked !== 'boolean') throw new Refusal('checked must be true or false')
    if (typeof criterionText !== 'string' || !current.acceptanceCriteria.includes(criterionText)) {
      throw new Refusal(t('errors:planningService.itemNotTasksChecklist'))
    }
    if (current.checkedCriteria.includes(criterionText) === checked) return current
    const now = Date.now()
    const ruleRun = this.db.transaction(() => {
      writeChecklistCheck(this.db, current, criterionText, checked, now)
      this.activity.recordChange(
        current,
        'checklistTick',
        undefined,
        { text: criterionText, checked },
        who,
        now
      )
      // The last tick completes the checklist: rules (D45), in this transaction.
      const after = this.requireWorkItem(workItemId)
      if (!checked || !this.rulesOn(who) || !checklistComplete(after)) return null
      return this.rules.afterChange([{ task: after, checklistCompleted: true }])
    })()
    // Every tick, so Home and every other window (a sticky task, N5.8b) follow it.
    this.changed(current.projectId)
    const item = this.requireWorkItem(workItemId)
    return ruleRun ? { ...item, ruleRun } : item
  }

  /**
   * Renames one checklist item (N2.5) through the normal update, so activity,
   * search and rules see it, and carries its tick, due date and person (N2.2)
   * to the new text, in one transaction.
   */
  renameChecklistItem(
    workItemId: string,
    from: string,
    to: string,
    actor: PlanningActor
  ): PlanningWorkItem {
    const current = this.requireWorkItem(workItemId)
    if (typeof from !== 'string' || !current.acceptanceCriteria.includes(from))
      throw new Refusal(t('errors:planningService.itemNotTasksChecklist'))
    if (typeof to !== 'string') throw new Refusal('The new text must be text')
    const next = to.trim()
    if (next !== from && current.acceptanceCriteria.includes(next))
      throw new Refusal('The checklist already has an item with that text')
    return this.updateWorkItem(
      workItemId,
      {
        acceptanceCriteria: current.acceptanceCriteria.map((text) => (text === from ? next : text))
      },
      actor,
      { renamedCriteria: new Map([[from, next]]) }
    )
  }

  /**
   * Sets or clears one checklist item's due date and person (N2.2, N17). A
   * field left out keeps its value; null clears it. Only the item's details
   * change: never its tick, text or the task's fields.
   */
  setChecklistItemDetails(
    workItemId: string,
    criterionText: string,
    input: PlanningChecklistDetailInput,
    actor: PlanningActor
  ): PlanningWorkItem {
    const current = this.requireWorkItem(workItemId)
    this.requireProject(current.projectId)
    this.activity.requireActor(actor)
    if (typeof criterionText !== 'string' || !current.acceptanceCriteria.includes(criterionText)) {
      throw new Refusal(t('errors:planningService.itemNotTasksChecklist'))
    }
    if (!input || typeof input !== 'object')
      throw new Refusal('Checklist details must be an object')
    const before = (current.checklistDetails ?? []).find((detail) => detail.text === criterionText)
    const dueDate =
      input.dueDate === undefined
        ? (before?.dueDate ?? null)
        : calendarDate(input.dueDate, 'Checklist item due date')
    const assigneeId =
      input.assigneeId === undefined
        ? (before?.assigneeId ?? null)
        : this.assigneeId(input.assigneeId, current.projectId)
    if (dueDate === (before?.dueDate ?? null) && assigneeId === (before?.assigneeId ?? null))
      return current
    this.checklistDetails.set(workItemId, current.projectId, criterionText, dueDate, assigneeId)
    this.changed(current.projectId)
    return this.requireWorkItem(workItemId)
  }

  /** One task's links besides waits-on (N2.4), read from its end. */
  listWorkItemLinks(workItemId: string): PlanningTaskLink[] {
    const item = this.requireWorkItem(workItemId)
    this.requireProject(item.projectId)
    return this.taskLinks.forWorkItem(workItemId)
  }

  /**
   * What links to an item (N4.4a): the texts in its project whose links point
   * at it. The item must be in a known project; an id Ostler has never seen
   * (or one gone for good) has nothing linking to it worth showing.
   */
  listLinkedFrom(kind: unknown, id: unknown, inProject?: string): LinkedFromEntry[] {
    if (!isLinkTargetKind(kind)) throw new Refusal('Unknown kind of item')
    if (typeof id !== 'string' || !isEntityIdLike(id)) throw new Refusal('Item not found')
    const row = this.db.prepare(ITEM_PROJECT[kind]).get(id) as { project_id: string } | undefined
    // A caller that speaks for one project (the automation API) sees only its items.
    if (!row || (inProject !== undefined && row.project_id !== inProject))
      throw new Refusal('Item not found')
    this.requireProject(row.project_id)
    return this.search.links.linkedFrom(kind, id)
  }

  /** What links to each of a project's items of one kind (N4.4a), in one query. */
  linkedFromInProject(projectId: string, kind: LinkTargetKind): Map<string, LinkedFromEntry[]> {
    this.requireProject(projectId)
    return this.search.links.linkedFromInProject(projectId, kind)
  }

  /**
   * The current titles of the items links point at (N4.4a), in one call per
   * rendered text. Links to items in projects Ostler does not know read as
   * deleted; refs that are not well formed are dropped.
   */
  /**
   * The tasks a project's text names by ID (BRI-26): its prefix and a number,
   * in any case. IDs of other projects and numbers no task has are left out.
   */
  resolveTaskKeys(projectId: unknown, keys: unknown): Array<{ key: string; id: string }> {
    if (typeof projectId !== 'string' || !Array.isArray(keys)) return []
    const prefix = this.getTaskPrefix(projectId)
    if (!prefix) return []
    const found: Array<{ key: string; id: string }> = []
    for (const key of keys.slice(0, 200)) {
      const parsed = parseTaskKey(key)
      if (!parsed || parsed.prefix !== prefix.toUpperCase()) continue
      const row = this.db
        .prepare('SELECT id FROM planning_work_items WHERE project_id = ? AND number = ?')
        .get(projectId, parsed.number) as { id: string } | undefined
      if (row) found.push({ key: key as string, id: row.id })
    }
    return found
  }

  resolveItemLinks(refs: unknown): ItemLinkInfo[] {
    if (!Array.isArray(refs)) throw new Refusal('Links must be a list')
    const clean = refs.filter(
      (ref): ref is ItemLinkRef =>
        typeof ref === 'object' &&
        ref !== null &&
        isLinkTargetKind((ref as ItemLinkRef).kind) &&
        typeof (ref as ItemLinkRef).projectId === 'string' &&
        typeof (ref as ItemLinkRef).id === 'string'
    )
    return this.search.links.resolve(clean, this.getProjectIds())
  }

  /**
   * Points the links in a new project's texts at its own items (N4.4a): the
   * project file's import, once every record is written. Only the URLs change,
   * never the words; the search and link indexes are kept with them.
   */
  rewriteItemLinks(projectId: string, maps: ItemLinkIdMaps): void {
    const scheme = BRAND.urlScheme
    // Any link, ours or one written before the rename: rewriteItemLinks tells them apart.
    const like = '%://%'
    const rewrite = (text: string) => rewriteItemLinks(text, scheme, maps)
    this.db.transaction(() => {
      const tasks = this.db
        .prepare(
          'SELECT id, description FROM planning_work_items WHERE project_id = ? AND description LIKE ?'
        )
        .all(projectId, like) as { id: string; description: string }[]
      for (const task of tasks) {
        const next = rewrite(task.description)
        if (next === task.description) continue
        this.db
          .prepare('UPDATE planning_work_items SET description = ? WHERE id = ?')
          .run(next, task.id)
        this.search.indexEntity('task', task.id)
      }
      const comments = this.db
        .prepare('SELECT id, body FROM planning_comments WHERE project_id = ? AND body LIKE ?')
        .all(projectId, like) as { id: string; body: string }[]
      for (const comment of comments) {
        const next = rewrite(comment.body)
        if (next === comment.body) continue
        this.db.prepare('UPDATE planning_comments SET body = ? WHERE id = ?').run(next, comment.id)
        this.search.indexEntity('comment', comment.id)
      }
      const decisions = this.db
        .prepare(
          `SELECT id, context, decision, alternatives_considered, consequences
           FROM planning_decisions WHERE project_id = ?`
        )
        .all(projectId) as {
        id: string
        context: string
        decision: string
        alternatives_considered: string
        consequences: string
      }[]
      for (const row of decisions) {
        const next = {
          context: rewrite(row.context),
          decision: rewrite(row.decision),
          alternatives: rewrite(row.alternatives_considered),
          consequences: rewrite(row.consequences)
        }
        if (
          next.context === row.context &&
          next.decision === row.decision &&
          next.alternatives === row.alternatives_considered &&
          next.consequences === row.consequences
        )
          continue
        this.db
          .prepare(
            `UPDATE planning_decisions
             SET context = ?, decision = ?, alternatives_considered = ?, consequences = ?
             WHERE id = ?`
          )
          .run(next.context, next.decision, next.alternatives, next.consequences, row.id)
        this.search.indexEntity('decision', row.id)
      }
      const library = this.db
        .prepare(
          'SELECT id, summary, body, revision FROM library_items WHERE project_id = ? AND (summary LIKE ? OR body LIKE ?)'
        )
        .all(projectId, like, like) as {
        id: string
        summary: string
        body: string
        revision: number
      }[]
      for (const item of library) {
        const summary = rewrite(item.summary)
        const body = rewrite(item.body)
        if (summary === item.summary && body === item.body) continue
        this.db
          .prepare('UPDATE library_items SET summary = ?, body = ? WHERE id = ?')
          .run(summary, body, item.id)
        // The item's first revision is the text it was imported with.
        this.db
          .prepare(
            'UPDATE library_item_revisions SET summary = ?, body = ? WHERE item_id = ? AND revision = ?'
          )
          .run(summary, body, item.id, item.revision)
        this.search.links.reindex('library', item.id)
      }
    })()
  }

  /** A task's earlier descriptions (N2.6), newest first, with their text. */
  listDescriptionVersions(workItemId: string): PlanningDescriptionVersion[] {
    const item = this.requireWorkItem(workItemId)
    this.requireProject(item.projectId)
    return this.descriptionVersions.forWorkItem(workItemId)
  }

  /**
   * Makes a version's text the description again (N2.6), through
   * `updateWorkItem` like any change, so activity, rules, search and undo see
   * it. The text it replaces becomes a version of its own, even mid-sitting.
   */
  restoreDescriptionVersion(
    workItemId: string,
    versionId: unknown,
    actor: PlanningActor
  ): PlanningWorkItem {
    const item = this.requireWorkItem(workItemId)
    this.requireProject(item.projectId)
    const version =
      typeof versionId === 'number' && Number.isInteger(versionId)
        ? this.descriptionVersions.get(versionId)
        : null
    if (!version || version.workItemId !== workItemId)
      throw new Error('Description version not found for this task')
    return this.updateWorkItem(workItemId, { description: version.text }, actor, {
      newDescriptionVersion: true
    })
  }

  /** Every link in a project, as stored (the project file). */
  listProjectLinks(projectId: string): TaskLinkRow[] {
    this.requireProject(projectId)
    return this.taskLinks.forProject(projectId)
  }

  /**
   * Refuses a link that cannot be made (N2.4): an unknown kind, a task linked
   * to itself, a task of another project or in the recycle bin, and a pair
   * that already has a link of this kind, whichever way round. Mark as
   * duplicate runs this before it closes anything.
   */
  checkWorkItemLink(
    fromWorkItemId: string,
    toWorkItemId: unknown,
    kind: unknown
  ): { from: PlanningWorkItem; to: PlanningWorkItem; kind: PlanningLinkKind } {
    if (!isLinkKind(kind)) throw new Refusal(t('errors:planningService.linkKindInvalid'))
    if (typeof toWorkItemId !== 'string' || !toWorkItemId)
      throw new Refusal('toWorkItemId must be a task id')
    const from = this.requireWorkItem(fromWorkItemId)
    this.requireProject(from.projectId)
    if (toWorkItemId === from.id) throw new Refusal(t('errors:planningService.linkToItself'))
    const to = this.requireWorkItem(toWorkItemId)
    if (to.projectId !== from.projectId)
      throw new Refusal(t('errors:planningService.linkOtherProject'))
    if (from.deletedAt || to.deletedAt)
      throw new Refusal(t('errors:planningService.restoreItemRecycleBin'))
    if (this.taskLinks.exists(kind, from.id, to.id))
      throw new Refusal(t('errors:planningService.linkAlreadyExists'))
    return { from, to, kind }
  }

  /**
   * Links two tasks of one project (N2.4, N19), with an activity entry on
   * each. The link points from this task: "duplicates" from the duplicate to
   * its original, "copied-from" from the copy. Nothing about dates, conflicts
   * or agents changes: only waits-on schedules.
   */
  addWorkItemLink(
    fromWorkItemId: string,
    toWorkItemId: unknown,
    kind: unknown,
    actor: PlanningActor
  ): PlanningTaskLink {
    const who = this.activity.requireActor(actor)
    const checked = this.checkWorkItemLink(fromWorkItemId, toWorkItemId, kind)
    const link: TaskLinkRow = {
      id: uuidv4(),
      projectId: checked.from.projectId,
      fromWorkItemId: checked.from.id,
      toWorkItemId: checked.to.id,
      kind: checked.kind,
      createdAt: Date.now()
    }
    this.db.transaction(() => {
      this.taskLinks.insert(link)
      this.recordLinkActivity('linked', link, checked.from, checked.to, who)
    })()
    this.changed(link.projectId)
    return this.taskLinks.forWorkItem(checked.from.id).find((entry) => entry.id === link.id)!
  }

  /** Removes a link from either of its tasks (N2.4), with an activity entry on each. */
  removeWorkItemLink(workItemId: string, linkId: unknown, actor: PlanningActor): void {
    const who = this.activity.requireActor(actor)
    const item = this.requireWorkItem(workItemId)
    this.requireProject(item.projectId)
    const link = typeof linkId === 'string' ? this.taskLinks.get(linkId) : null
    if (!link || (link.fromWorkItemId !== item.id && link.toWorkItemId !== item.id))
      throw new Refusal(t('errors:planningService.linkNotFound'))
    const from = this.requireWorkItem(link.fromWorkItemId)
    const to = this.requireWorkItem(link.toWorkItemId)
    this.db.transaction(() => {
      this.taskLinks.delete(link.id)
      this.recordLinkActivity('unlinked', link, from, to, who)
    })()
    this.changed(link.projectId)
  }

  /** One entry on each end, worded from that end: "Duplicate of", "Duplicated by"… */
  private recordLinkActivity(
    field: 'linked' | 'unlinked',
    link: TaskLinkRow,
    from: PlanningWorkItem,
    to: PlanningWorkItem,
    who: PlanningActor
  ): void {
    const at = Date.now()
    for (const [item, other, fromThisTask] of [
      [from, to, true],
      [to, from, false]
    ] as const) {
      const entry = { role: linkRole(link.kind, fromThisTask), id: other.id, title: other.title }
      // Added: the link is the "to" value; removed: the "from" value.
      if (field === 'linked') this.activity.recordChange(item, field, undefined, entry, who, at)
      else this.activity.recordChange(item, field, entry, undefined, who, at)
    }
  }

  /**
   * Copy task (N2.4): a new task in Backlog, at the end, with the same title
   * marked "(copy)", description, checklist (unticked), labels, priority,
   * estimate, person, dates, milestone, iteration and custom field values,
   * and a "copied from" link
   * back. Comments, activity, attachments and agent links stay behind. It is
   * a create like any other, so rules and repeats see it as one.
   */
  copyWorkItem(workItemId: string, actor: PlanningActor): CopyWorkItemResult {
    const source = this.requireWorkItem(workItemId)
    this.requireProject(source.projectId)
    this.activity.requireActor(actor)
    if (source.deletedAt) throw new Refusal(t('errors:planningService.restoreItemRecycleBin'))
    // The one copying path, shared with a new round's copies (N5.7a).
    const copy = this.createWorkItem(
      source.projectId,
      taskCopyInput(source, {
        title: copyTitle(source.title),
        milestoneId: source.milestoneId,
        iterationId: source.iterationId ?? null
      }),
      actor
    )
    const link = this.addWorkItemLink(copy.id, source.id, 'copied-from', actor)
    return { workItem: copy, link }
  }

  /** Moves the ticks of renamed checklist items to their new text. */
  private renameChecks(
    item: PlanningWorkItem,
    current: PlanningWorkItem,
    renamed: ReadonlyMap<string, string>
  ): void {
    if (renamed.size === 0) return
    const move = this.db.prepare(
      `UPDATE OR IGNORE planning_checklist_checks SET criterion_text = ?
       WHERE work_item_id = ? AND criterion_text = ?`
    )
    // Two passes through a placeholder, so a swap of two texts cannot collide.
    const moves = [...renamed].filter(
      ([from, to]) =>
        from !== to &&
        current.checkedCriteria.includes(from) &&
        item.acceptanceCriteria.includes(to)
    )
    // A placeholder no item can hold: items are trimmed, never start with NUL.
    const hold = (index: number) => `\u0000rename:${index}`
    moves.forEach(([from], index) => move.run(hold(index), item.id, from))
    moves.forEach(([, to], index) => move.run(to, item.id, hold(index)))
  }

  private deleteChecksNotIn(workItemId: string, criteria: string[]): void {
    const keep = new Set(criteria)
    const rows = this.db
      .prepare('SELECT criterion_text FROM planning_checklist_checks WHERE work_item_id = ?')
      .all(workItemId) as Pick<ChecklistCheckRow, 'criterion_text'>[]
    const remove = this.db.prepare(
      'DELETE FROM planning_checklist_checks WHERE work_item_id = ? AND criterion_text = ?'
    )
    for (const row of rows) {
      if (!keep.has(row.criterion_text)) remove.run(workItemId, row.criterion_text)
    }
  }

  private checksForProject(projectId: string): Map<string, string[]> {
    const rows = this.db
      .prepare(
        'SELECT work_item_id, criterion_text FROM planning_checklist_checks WHERE project_id = ?'
      )
      .all(projectId) as ChecklistCheckRow[]
    const checks = new Map<string, string[]>()
    for (const row of rows) {
      checks.set(row.work_item_id, [...(checks.get(row.work_item_id) ?? []), row.criterion_text])
    }
    return checks
  }

  // ─── Custom fields (R2.2, D32) ───────────────────────────────────────────

  /** The project's custom fields, in their order. */
  listFields(projectId: string): PlanningFieldDefinition[] {
    this.requireProject(projectId)
    return this.fields.list(projectId)
  }

  getField(projectId: string, fieldId: string): PlanningFieldDefinition {
    this.requireProject(projectId)
    return this.fields.getForProject(projectId, fieldId)
  }

  createField(projectId: string, input: CreatePlanningFieldInput): PlanningFieldDefinition {
    this.requireProject(projectId)
    const field = this.fields.create(projectId, input)
    this.changed(projectId)
    return field
  }

  /** Renames a field or changes its options; a removed option comes off every task. */
  updateField(
    projectId: string,
    fieldId: string,
    input: UpdatePlanningFieldInput
  ): PlanningFieldDefinition {
    this.requireProject(projectId)
    this.fields.getForProject(projectId, fieldId)
    const field = this.fields.update(fieldId, input ?? {})
    this.changed(projectId)
    return field
  }

  reorderFields(projectId: string, fieldIds: string[]): PlanningFieldDefinition[] {
    this.requireProject(projectId)
    const fields = this.fields.reorder(projectId, fieldIds)
    this.changed(projectId)
    return fields
  }

  /** Deletes a field with its values; the result is what `restoreField` puts back. */
  deleteField(projectId: string, fieldId: string): PlanningFieldDeletion {
    this.requireProject(projectId)
    const field = this.fields.getForProject(projectId, fieldId)
    const deletion = this.db.transaction(() => {
      const taken = this.fields.delete(field.id)
      if (field.type === 'text')
        for (const { workItemId } of taken.values) this.search.indexEntity('task', workItemId)
      // Task types (N2.7b) that showed it stop naming it; Undo names it again.
      const typeIds = this.taskTypes.removeField(projectId, field.id)
      return typeIds.length > 0 ? { ...taken, typeIds } : taken
    })()
    this.changed(projectId)
    return deletion
  }

  /**
   * Saves Ostler AI's suggested values for an AI field (N8.4): only when the
   * person clicked Fill with AI. One transaction and one undo for the batch.
   */
  applyAiFieldFills(
    projectId: string,
    fieldId: string,
    fills: AiFieldFillInput[],
    options: { replacePersonValues?: boolean } = {}
  ): AiFieldFillResult {
    this.requireProject(projectId)
    return this.aiFills.apply(projectId, fieldId, fills, options)
  }

  /** Undoes `applyAiFieldFills`: the values, and who filled them, as they were. */
  restoreAiFieldFills(projectId: string, undo: AiFieldFillUndo): string[] {
    this.requireProject(projectId)
    return this.aiFills.restore(projectId, undo)
  }

  /**
   * Marks values a project file or template brought as filled by Ostler AI
   * (N8.4). Only values the task has are marked.
   */
  markFieldFills(workItemId: string, fills: PlanningFieldFills): void {
    this.fields.markFilled(workItemId, fills)
  }

  /** Undoes `deleteField`: the field and every value it had, on tasks that still exist. */
  restoreField(projectId: string, deletion: PlanningFieldDeletion): PlanningFieldDefinition {
    this.requireProject(projectId)
    const field = this.db.transaction(() => {
      const restored = this.fields.restore(projectId, deletion)
      this.taskTypes.restoreField(projectId, restored.id, deletion?.typeIds)
      if (restored.type === 'text')
        for (const { workItemId } of deletion.values ?? [])
          if (typeof workItemId === 'string') this.search.indexEntity('task', workItemId)
      return restored
    })()
    this.changed(projectId)
    return field
  }

  /**
   * Every label used on the project's live and archived tasks, with its
   * colour: the stored one, or a stable default from the palette. Sorted by
   * name.
   */
  listProjectLabels(projectId: string): PlanningLabel[] {
    this.requireProject(projectId)
    const counts = new Map<string, number>()
    for (const item of this.listKeptWorkItems(projectId)) {
      for (const label of item.labels) counts.set(label, (counts.get(label) ?? 0) + 1)
    }
    const colors = this.labelColors(projectId)
    return [...counts.entries()]
      .map(([name, taskCount]) => ({
        name,
        color: colors.get(name) ?? paletteColorFor(name),
        hasColor: colors.has(name),
        taskCount
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  setLabelColor(projectId: string, name: string, color: string): PlanningLabel {
    this.requireProject(projectId)
    const label = this.labelName(name)
    if (!isHexColor(color)) throw new Refusal(t('errors:planningService.colourMustLookLike'))
    this.db
      .prepare(
        `INSERT INTO planning_labels (project_id, name, color) VALUES (?, ?, ?)
         ON CONFLICT (project_id, name) DO UPDATE SET color = excluded.color`
      )
      .run(projectId, label, color.toLowerCase())
    return this.requireLabel(projectId, label)
  }

  /**
   * Renames a label on every task in the project, in one transaction. A task
   * that already had the new name keeps one copy; the colour moves with the
   * name unless the new name has one of its own.
   */
  renameLabel(projectId: string, from: string, to: string, actor: PlanningActor): PlanningLabel {
    this.requireProject(projectId)
    const who = this.activity.requireActor(actor)
    const oldName = this.labelName(from)
    const newName = this.labelName(to)
    const items = this.itemsWithLabel(projectId, oldName)
    if (items.length === 0)
      throw new Refusal(t('errors:planningService.noTaskHasLabel', { oldName }))
    if (oldName === newName) return this.requireLabel(projectId, newName)
    this.db.transaction(() => {
      for (const item of items) {
        const labels = [
          ...new Set(item.labels.map((label) => (label === oldName ? newName : label)))
        ]
        this.writeLabels(item, labels, who)
      }
      const colors = this.labelColors(projectId)
      const color = colors.get(oldName)
      if (color && !colors.has(newName)) {
        this.db
          .prepare('INSERT INTO planning_labels (project_id, name, color) VALUES (?, ?, ?)')
          .run(projectId, newName, color)
      }
      this.db
        .prepare('DELETE FROM planning_labels WHERE project_id = ? AND name = ?')
        .run(projectId, oldName)
    })()
    return this.requireLabel(projectId, newName)
  }

  /**
   * Removes a label from every task in the project, in one transaction, and
   * returns what it took so `restoreLabel` can undo it.
   */
  deleteLabel(projectId: string, name: string, actor: PlanningActor): PlanningLabelDeletion {
    this.requireProject(projectId)
    const who = this.activity.requireActor(actor)
    const label = this.labelName(name)
    const items = this.itemsWithLabel(projectId, label)
    const color = this.labelColors(projectId).get(label) ?? null
    this.db.transaction(() => {
      for (const item of items) {
        this.writeLabels(
          item,
          item.labels.filter((existing) => existing !== label),
          who
        )
      }
      this.db
        .prepare('DELETE FROM planning_labels WHERE project_id = ? AND name = ?')
        .run(projectId, label)
    })()
    return { name: label, color, workItemIds: items.map((item) => item.id) }
  }

  /** Undoes `deleteLabel`: the label goes back on those tasks that still exist, with its colour. */
  restoreLabel(
    projectId: string,
    deletion: PlanningLabelDeletion,
    actor: PlanningActor
  ): PlanningLabel[] {
    this.requireProject(projectId)
    const who = this.activity.requireActor(actor)
    const label = this.labelName(deletion?.name)
    const ids = Array.isArray(deletion.workItemIds) ? deletion.workItemIds : []
    this.db.transaction(() => {
      for (const id of ids) {
        const row = this.db
          .prepare('SELECT labels FROM planning_work_items WHERE id = ? AND project_id = ?')
          .get(id, projectId) as { labels: string } | undefined
        if (!row) continue
        const labels = jsonStringList(row.labels)
        if (!labels.includes(label) && labels.length < 20)
          this.writeLabels({ id, projectId, labels }, [...labels, label], who)
      }
      if (deletion.color && isHexColor(deletion.color)) {
        this.db
          .prepare(
            `INSERT INTO planning_labels (project_id, name, color) VALUES (?, ?, ?)
             ON CONFLICT (project_id, name) DO UPDATE SET color = excluded.color`
          )
          .run(projectId, label, deletion.color)
      }
    })()
    return this.listProjectLabels(projectId)
  }

  /** Every task in the project carrying `label`, the recycle bin included. */
  private itemsWithLabel(projectId: string, label: string): PlanningWorkItem[] {
    return this.selectWorkItems(projectId, '1 = 1').filter((item) => item.labels.includes(label))
  }

  /**
   * Labels only; `updated_at` stays, so a rename does not reorder the Board.
   * Each task still records its label change, with who made it.
   */
  private writeLabels(
    item: Pick<PlanningWorkItem, 'id' | 'projectId' | 'labels'>,
    labels: string[],
    actor: PlanningActor
  ): void {
    this.db
      .prepare('UPDATE planning_work_items SET labels = ? WHERE id = ?')
      .run(JSON.stringify(labels), item.id)
    this.search.indexEntity('task', item.id)
    this.activity.recordChange(item, 'labels', item.labels, labels, actor, Date.now())
  }

  private labelColors(projectId: string): Map<string, string> {
    const rows = this.db
      .prepare('SELECT name, color FROM planning_labels WHERE project_id = ?')
      .all(projectId) as { name: string; color: string }[]
    return new Map(rows.map((row) => [row.name, row.color]))
  }

  private requireLabel(projectId: string, name: string): PlanningLabel {
    const found = this.listProjectLabels(projectId).find((label) => label.name === name)
    if (found) return found
    // A colour may be set before any task uses the label.
    const color = this.labelColors(projectId).get(name)
    return { name, color: color ?? paletteColorFor(name), hasColor: Boolean(color), taskCount: 0 }
  }

  private labelName(value: unknown): string {
    return requiredText(value, 'Label', 80)
  }

  /** Runs a multi-record planning workflow atomically on this service's connection. */
  // ─── Repeat and reminders (P5.6) ──────────────────────────────────────────

  getRecurrence(workItemId: string): PlanningRecurrence | null {
    const item = this.getWorkItem(workItemId)
    const row = this.db
      .prepare('SELECT * FROM planning_recurrences WHERE work_item_id = ?')
      .get(item.id) as RecurrenceRow | undefined
    return row ? toRecurrence(row) : null
  }

  /** Sets or (with null) removes a task's repeat. */
  setRecurrence(
    workItemId: string,
    input: PlanningRecurrenceInput | null,
    actor: PlanningActor
  ): PlanningRecurrence | null {
    const item = this.getWorkItem(workItemId)
    const who = this.activity.requireActor(actor)
    const before = this.getRecurrence(workItemId)
    const settings = input === null ? null : this.recurrenceFromInput(input, before, item.projectId)
    // Go to agents (N9.7): left out, it stays as it was.
    const given = input?.goToAgents
    if (given !== undefined && typeof given !== 'boolean')
      throw new Refusal('goToAgents must be true or false')
    const goToAgents = given ?? before?.goToAgents ?? false
    const sameRepeat =
      before !== null &&
      settings !== null &&
      JSON.stringify([before.rule, before.endsOn, before.remaining]) ===
        JSON.stringify([settings.rule, settings.endsOn, settings.remaining])
    const beforeTurns = before?.rotation ?? null
    const afterTurns = settings?.rotation ?? null
    this.db.transaction(() => {
      const at = Date.now()
      if (settings) this.writeRecurrence(item, settings, goToAgents)
      else this.db.prepare('DELETE FROM planning_recurrences WHERE work_item_id = ?').run(item.id)
      if ((before || settings) && !sameRepeat)
        this.activity.recordChange(
          item,
          'repeat',
          before?.rule ?? null,
          settings?.rule ?? null,
          who,
          at
        )
      if (JSON.stringify(beforeTurns) !== JSON.stringify(afterTurns))
        this.activity.recordChange(item, 'takeTurns', beforeTurns, afterTurns, who, at)
    })()
    this.changed(item.projectId)
    return this.getRecurrence(workItemId)
  }

  /**
   * A repeat as a caller sent it, checked (N2.3): every person in the rotation
   * exists and can be given work in the task's project. With no nextIndex,
   * the person who was next stays next.
   */
  private recurrenceFromInput(
    input: PlanningRecurrenceInput,
    before: PlanningRecurrence | null,
    projectId: string
  ): RecurrenceSettings {
    const { nextIndex, ...rest } = input
    const settings = normalizeRecurrence(
      nextIndex === undefined ? { ...rest, nextIndex: null } : input
    )
    // An archived person may stay in (or arrive with a project file): they
    // are passed over until unarchived. The drawer never offers one as new.
    for (const personId of settings.rotation ?? []) {
      if (!this.people.get(personId)) throw new Error(`Person ${personId} not found`)
      if (!this.canBeGivenWork(personId, projectId)) {
        throw new Refusal(t('errors:planningService.personFromOtherProject'))
      }
    }
    if (nextIndex === undefined)
      settings.nextIndex = rotationIndexAfterEdit(
        before?.rotation ?? null,
        before?.nextIndex ?? 0,
        settings.rotation
      )
    return settings
  }

  private writeRecurrence(
    item: Pick<PlanningWorkItem, 'id' | 'projectId'>,
    settings: RecurrenceSettings,
    goToAgents: boolean
  ): void {
    this.db
      .prepare(
        `INSERT INTO planning_recurrences
           (work_item_id, project_id, rule, ends_on, remaining, rotation, next_index, go_to_agents)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(work_item_id) DO UPDATE SET
           rule = excluded.rule, ends_on = excluded.ends_on, remaining = excluded.remaining,
           rotation = excluded.rotation, next_index = excluded.next_index,
           go_to_agents = excluded.go_to_agents`
      )
      .run(
        item.id,
        item.projectId,
        JSON.stringify(settings.rule),
        settings.endsOn,
        settings.remaining,
        settings.rotation ? JSON.stringify(settings.rotation) : null,
        settings.rotation ? settings.nextIndex : 0,
        goToAgents ? 1 : 0
      )
  }

  /**
   * A recurring task just reached Done: make its next occurrence, once. Runs
   * inside `updateWorkItem`'s transaction. `recurred_to_id` on the done task
   * is the guard, so Done, Ready, Done does not make a second one.
   *
   * Copied: title, description, priority, labels, assignee, estimate, the
   * checklist (unticked) and the milestone unless it is complete. Not
   * copied: dependencies, agent links, subtasks, comments, attachments.
   *
   * A repeat that takes turns (N2.3) gives the occurrence to the next person
   * in its rotation who is not archived instead, and moves the turn on; if
   * everyone in it is archived, the done task's assignee is kept and the
   * activity says why. Won't do comes here too, so a skip moves the turn on.
   */
  private repeatTask(done: PlanningWorkItem, actor: PlanningActor): PlanningWorkItem | null {
    const row = this.db
      .prepare('SELECT recurred_to_id FROM planning_work_items WHERE id = ?')
      .get(done.id) as { recurred_to_id: string | null }
    if (row.recurred_to_id) return null
    const recurrence = this.db
      .prepare('SELECT * FROM planning_recurrences WHERE work_item_id = ?')
      .get(done.id) as RecurrenceRow | undefined
    if (!recurrence) return null
    const settings = toRecurrence(recurrence)
    const today = todayIsoDate()
    const dueDate = nextOccurrenceDate(settings, done.targetDate, today)
    if (!dueDate) {
      // The repeat has run its course.
      this.db.prepare('DELETE FROM planning_recurrences WHERE work_item_id = ?').run(done.id)
      return null
    }
    const shift = isoDaysBetween(done.targetDate ?? today, dueDate)
    const milestone = done.milestoneId
      ? (this.db
          .prepare('SELECT status FROM planning_milestones WHERE id = ?')
          .get(done.milestoneId) as { status: PlanningMilestoneStatus } | undefined)
      : undefined
    const turn = nextInRotation(settings.rotation, settings.nextIndex, (personId) => {
      const person = this.people.get(personId)
      return !person || person.archivedAt !== null
    })
    const next = this.createWorkItem(
      done.projectId,
      {
        title: done.title,
        description: done.description,
        priority: done.priority,
        labels: done.labels,
        acceptanceCriteria: done.acceptanceCriteria,
        assigneeId: turn ? turn.personId : done.assigneeId,
        estimate: done.estimate,
        fieldValues: done.fieldValues,
        milestoneId: milestone && milestone.status !== 'complete' ? done.milestoneId : null,
        targetDate: dueDate,
        startDate: done.startDate ? shiftIsoDate(done.startDate, shift) : null,
        showFrom: done.showFrom ? shiftIsoDate(done.showFrom, shift) : null,
        // A repeat copies the task's plan-first choice (N9.7).
        planFirst: done.planFirst ?? 'default',
        status: 'backlog'
      },
      actor,
      done.origin
    )
    const advanced = advanceRecurrence(settings)
    if (turn) advanced.nextIndex = turn.nextIndex
    // Go to agents moves with the rule; the new occurrence has not been queued by it yet.
    this.writeRecurrence(next, advanced, settings.goToAgents)
    this.db.prepare('DELETE FROM planning_recurrences WHERE work_item_id = ?').run(done.id)
    this.db
      .prepare('UPDATE planning_work_items SET recurred_to_id = ? WHERE id = ?')
      .run(next.id, done.id)
    const link = {
      id: next.id,
      title: next.title,
      dueDate,
      ...(settings.rotation && !turn ? { turnsKept: 'everyoneArchived' } : {})
    }
    const at = Date.now()
    this.activity.recordChange(done, 'repeated', { id: done.id }, link, actor, at)
    this.activity.recordChange(next, 'repeated', { id: done.id }, link, actor, at)
    return next
  }

  /**
   * Scheduled agent tasks (N9.7): open occurrences whose repeat goes to
   * agents, whose start date (or due date, without one) is `today` or
   * earlier, and whose schedule has not acted on them yet. A repeat has one
   * open occurrence at a time, so scheduled work never piles up.
   */
  dueScheduledOccurrences(projectIds: string[], today: string): PlanningWorkItem[] {
    if (projectIds.length === 0) return []
    const rows = this.db
      .prepare(
        `SELECT item.id FROM planning_recurrences recurrence
         JOIN planning_work_items item ON item.id = recurrence.work_item_id
         WHERE recurrence.go_to_agents = 1 AND item.scheduled_queue IS NULL
           AND item.status != 'done' AND item.archived_at IS NULL AND item.deleted_at IS NULL
           AND COALESCE(item.start_date, item.target_date) <= ?
           AND item.project_id IN (${projectIds.map(() => '?').join(', ')})
         ORDER BY COALESCE(item.start_date, item.target_date), item.created_at`
      )
      .all(today, ...projectIds) as { id: string }[]
    return rows.map((row) => this.getWorkItem(row.id))
  }

  /**
   * Records, once, what an occurrence's schedule did (N9.7). False when it
   * was already recorded: the caller then does nothing, so no occurrence is
   * queued or noted twice.
   */
  recordScheduledQueue(
    workItemId: string,
    outcome: PlanningScheduledQueueOutcome,
    at: number,
    note: string | null = null
  ): boolean {
    const item = this.getWorkItem(workItemId)
    const changes = this.db
      .prepare(
        `UPDATE planning_work_items
         SET scheduled_queue = ?, scheduled_queue_at = ?, scheduled_queue_note = ?
         WHERE id = ? AND scheduled_queue IS NULL`
      )
      .run(outcome, at, note, item.id).changes
    if (changes > 0) this.changed(item.projectId)
    return changes > 0
  }

  /**
   * Queue it now on an occurrence its schedule could not queue: what was
   * recorded is replaced. False when nothing was recorded or it was queued,
   * so a queued occurrence is never queued again this way.
   */
  replaceScheduledQueue(
    workItemId: string,
    outcome: PlanningScheduledQueueOutcome,
    at: number,
    note: string | null = null
  ): boolean {
    const item = this.getWorkItem(workItemId)
    const changes = this.db
      .prepare(
        `UPDATE planning_work_items
         SET scheduled_queue = ?, scheduled_queue_at = ?, scheduled_queue_note = ?
         WHERE id = ? AND scheduled_queue IS NOT NULL AND scheduled_queue != 'queued'`
      )
      .run(outcome, at, note, item.id).changes
    if (changes > 0) this.changed(item.projectId)
    return changes > 0
  }

  /** A task's reminders still to come, then any that keeps reminding now (N1.7). */
  listReminders(workItemId: string): PlanningReminder[] {
    return this.reminders.pendingForTask(this.getWorkItem(workItemId).id)
  }

  /** "Remind me…" at a chosen instant (ms); it may keep reminding (N1.7). */
  addReminder(
    workItemId: string,
    remindAt: number,
    options: PlanningReminderOptions = {}
  ): PlanningReminder {
    const item = this.getWorkItem(workItemId)
    const reminder = this.reminders.addCustom(item, remindAt, Date.now(), options)
    this.changed(item.projectId)
    return reminder
  }

  /** Stop reminding (N1.7): the reminder stays in the Inbox and does not come back. */
  stopReminder(workItemId: string, reminderId: string): PlanningReminder {
    const item = this.getWorkItem(workItemId)
    const reminder = this.reminders.get(reminderId)
    if (!reminder || reminder.workItemId !== item.id)
      throw new Refusal(t('errors:planningService.reminderNotFound'))
    if (!reminder.keepReminding)
      throw new Refusal(t('errors:planningReminders.doesNotKeepReminding'))
    const stopped = this.reminders.stop(reminderId, Date.now())
    this.changed(item.projectId)
    return stopped
  }

  deleteReminder(workItemId: string, reminderId: string): void {
    const item = this.getWorkItem(workItemId)
    const reminder = this.reminders.get(reminderId)
    if (!reminder || reminder.workItemId !== item.id)
      throw new Refusal(t('errors:planningService.reminderNotFound'))
    this.reminders.delete(reminderId)
    this.changed(item.projectId)
  }

  /**
   * Plans every open task's due reminders again: after the reminder setting
   * or time changes, or the time zone does (a reminder time is wall-clock).
   */
  replanDueReminders(now = Date.now()): void {
    const projectIds = this.getProjectIds()
    if (projectIds.length === 0) return
    const ids = this.db
      .prepare(
        `SELECT id FROM planning_work_items
         WHERE project_id IN (${projectIds.map(() => '?').join(', ')})
           AND archived_at IS NULL AND deleted_at IS NULL AND status <> 'done'`
      )
      .all(...projectIds) as { id: string }[]
    this.db.transaction(() => {
      for (const { id } of ids) this.reminders.syncTask(this.requireWorkItem(id), now)
    })()
  }

  runInTransaction<T>(operation: () => T): T {
    return this.db.transaction(operation)()
  }

  /**
   * Runs `operation` in one transaction with `projectId` known to planning
   * although it has no config entry yet: a project created from a package
   * writes its records first and its config entry last (P5.8).
   */
  createRecordsForNewProject<T>(projectId: string, operation: () => T): T {
    this.pendingProjectIds.add(projectId)
    try {
      return this.db.transaction(operation)()
    } finally {
      this.pendingProjectIds.delete(projectId)
    }
  }

  /** Persistence primitive used by the cross-store harness handoff workflow. */
  compareAndSetHarnessTaskId(
    workItemId: string,
    expected: string | null,
    next: string | null
  ): PlanningWorkItem {
    const updatedAt = Date.now()
    const statement =
      expected === null
        ? 'UPDATE planning_work_items SET linked_harness_task_id = ?, updated_at = ? WHERE id = ? AND linked_harness_task_id IS NULL'
        : 'UPDATE planning_work_items SET linked_harness_task_id = ?, updated_at = ? WHERE id = ? AND linked_harness_task_id = ?'
    const parameters =
      expected === null ? [next, updatedAt, workItemId] : [next, updatedAt, workItemId, expected]
    this.db.prepare(statement).run(...parameters)
    return this.getWorkItem(workItemId)
  }

  /** Persistence primitive for the hierarchy created by an approved agent plan. */
  setAgentPlanParent(workItemId: string, parentWorkItemId: string): void {
    this.db
      .prepare(
        'UPDATE planning_work_items SET parent_work_item_id = ?, subtask_phase_number = 1 WHERE id = ?'
      )
      .run(parentWorkItemId, workItemId)
  }
  private requireDecision(id: string): PlanningDecision {
    const row = this.db.prepare('SELECT * FROM planning_decisions WHERE id = ?').get(id) as
      DecisionRow | undefined
    if (!row) throw new Refusal('Planning decision not found')
    return toDecision(row)
  }

  private requireGoal(id: string): PlanningGoal {
    const row = this.db.prepare('SELECT * FROM planning_goals WHERE id = ?').get(id) as
      GoalRow | undefined
    if (!row) throw new Refusal('Planning goal not found')
    return toGoal(row)
  }

  private requireMilestone(id: string): PlanningMilestone {
    const row = this.db.prepare('SELECT * FROM planning_milestones WHERE id = ?').get(id) as
      MilestoneRow | undefined
    if (!row) throw new Refusal('Planning milestone not found')
    return toMilestone(row)
  }

  /** The project's next task number (N9.8a), without taking it. */
  nextTaskNumber(projectId: string): number {
    const row = this.db
      .prepare('SELECT next_number FROM project_task_counters WHERE project_id = ?')
      .get(projectId) as { next_number: number } | undefined
    const max = this.db
      .prepare('SELECT MAX(number) AS max FROM planning_work_items WHERE project_id = ?')
      .get(projectId) as { max: number | null }
    return Math.max(row?.next_number ?? 1, (max.max ?? 0) + 1)
  }

  /**
   * The task with this number in the project (N9.8a), in the bin or not, or
   * null. An ID is looked up here; the task's id stays its key everywhere.
   */
  findWorkItemByNumber(projectId: string, number: number): PlanningWorkItem | null {
    if (!Number.isSafeInteger(number) || number < 1) return null
    const row = this.db
      .prepare('SELECT id FROM planning_work_items WHERE project_id = ? AND number = ?')
      .get(projectId, number) as { id: string } | undefined
    return row ? this.requireWorkItem(row.id) : null
  }

  private requireWorkItem(id: string): PlanningWorkItem {
    const row = this.db.prepare('SELECT * FROM planning_work_items WHERE id = ?').get(id) as
      WorkItemRow | undefined
    if (!row) throw new Refusal('Planning work item not found')
    const dependencies = (
      this.db
        .prepare(
          'SELECT depends_on_id, type, lag_days FROM planning_dependencies WHERE work_item_id = ? ORDER BY rowid'
        )
        .all(id) as Omit<DependencyRow, 'work_item_id'>[]
    ).map(dependencyLinkFromRow)
    const checks = this.db
      .prepare('SELECT criterion_text FROM planning_checklist_checks WHERE work_item_id = ?')
      .all(id) as Pick<ChecklistCheckRow, 'criterion_text'>[]
    const recurring = Boolean(
      this.db.prepare('SELECT 1 FROM planning_recurrences WHERE work_item_id = ?').get(id)
    )
    return {
      ...this.toWorkItem(
        row,
        dependencies,
        checks.map((check) => check.criterion_text),
        recurring
      ),
      checklistDetails: detailsInOrder(
        jsonStringList(row.acceptance_criteria),
        this.checklistDetails.forWorkItem(id)
      ),
      fieldValues: this.fields.valuesForWorkItem(row.project_id, id),
      fieldFills: this.fields.fillsForWorkItem(id),
      ...withGithubLinks(this.githubLinks.listForWorkItem(id))
    }
  }

  private requireGoalForProject(id: string, projectId: string): void {
    if (this.requireGoal(id).projectId !== projectId) {
      throw new Refusal('Planning goal belongs to another project')
    }
  }

  private requireMilestoneForProject(id: string, projectId: string): void {
    if (this.requireMilestone(id).projectId !== projectId) {
      throw new Refusal('Planning milestone belongs to another project')
    }
  }

  private requireWorkItemForProject(id: string, projectId: string): void {
    if (this.requireWorkItem(id).projectId !== projectId) {
      throw new Refusal('Planning work item belongs to another project')
    }
  }

  private requireProject(projectId: string): void {
    if (!this.getProjectIds().includes(projectId)) throw new Refusal('Project not found')
  }

  /** 0 for null, 1 for a top-level item, 2 for its child, 3 for its grandchild. */
  private depthOf(workItemId: string | null): number {
    let depth = 0
    let currentId = workItemId
    const seen = new Set<string>()
    while (currentId) {
      if (seen.has(currentId)) break
      seen.add(currentId)
      depth++
      const row = this.db
        .prepare('SELECT parent_work_item_id FROM planning_work_items WHERE id = ?')
        .get(currentId) as { parent_work_item_id: string | null } | undefined
      currentId = row?.parent_work_item_id ?? null
    }
    return depth
  }

  /**
   * Resolves and validates the (parentWorkItemId, subtaskPhaseNumber,
   * subtaskPhaseName) triple for a create or update: enforces the 3-level
   * nesting cap and that every sibling sharing a phase number under the same
   * parent shares one canonical phase name (the first one set wins).
   */
  private validateSubtaskPlacement(
    itemId: string,
    projectId: string,
    parentWorkItemId: string | null,
    subtaskPhaseNumberInput: number | null | undefined,
    subtaskPhaseNameInput: string | undefined
  ): { subtaskPhaseNumber: number | null; subtaskPhaseName: string } {
    if (!parentWorkItemId) return { subtaskPhaseNumber: null, subtaskPhaseName: '' }
    if (parentWorkItemId === itemId) throw new Refusal('A work item cannot be its own parent')
    const parent = this.requireWorkItem(parentWorkItemId)
    if (parent.projectId !== projectId) {
      throw new Refusal('Parent work item belongs to another project')
    }
    if (this.depthOf(parentWorkItemId) >= 3) {
      throw new Refusal(t('errors:planningService.subtasksMayOnlyNest'))
    }
    const number = subtaskPhaseNumberInput ?? 1
    if (!Number.isInteger(number) || number < 1 || number > 20) {
      throw new Refusal(t('errors:planningService.subtaskPhaseNumberMust'))
    }
    const name = optionalText(subtaskPhaseNameInput, 'Subtask phase name', 160)
    const sibling = this.db
      .prepare(
        `SELECT subtask_phase_name FROM planning_work_items
         WHERE parent_work_item_id = ? AND subtask_phase_number = ? AND id != ?
         LIMIT 1`
      )
      .get(parentWorkItemId, number, itemId) as { subtask_phase_name: string } | undefined
    if (!sibling) return { subtaskPhaseNumber: number, subtaskPhaseName: name }
    if (name && name !== sibling.subtask_phase_name) {
      throw new Refusal(
        sibling.subtask_phase_name
          ? t('errors:planningService.phaseUnderParentAlready', {
              number,
              subtask_phase_name: sibling.subtask_phase_name
            })
          : t('errors:planningService.phaseUnderParentHas', { number })
      )
    }
    return { subtaskPhaseNumber: number, subtaskPhaseName: sibling.subtask_phase_name }
  }

  /**
   * A subtask (parentWorkItemId set) may only depend on siblings in its own
   * (parentWorkItemId, subtaskPhaseNumber) phase — never on its own parent, and
   * never on an arbitrary project-wide task. This keeps the dependency picker a
   * short, locally-scoped list instead of a project-wide matrix. Top-level items
   * are unrestricted, matching prior behavior.
   */
  private validateDependencies(
    itemId: string,
    projectId: string,
    dependencyIds: string[],
    scope?: { parentWorkItemId: string | null; subtaskPhaseNumber: number | null }
  ): void {
    if (dependencyIds.includes(itemId))
      throw new Refusal(t('errors:planningService.workItemCannotDepend'))
    // Nothing to check without dependencies; skipping the project read keeps
    // creating thousands of tasks in one import linear.
    if (dependencyIds.length === 0) return
    const items = this.listKeptWorkItems(projectId)
    const itemIds = new Set(items.map((item) => item.id))
    for (const dependencyId of dependencyIds) {
      if (!itemIds.has(dependencyId)) {
        const other = this.db
          .prepare('SELECT project_id FROM planning_work_items WHERE id = ?')
          .get(dependencyId) as { project_id: string } | undefined
        if (other) throw new Refusal('Planning dependencies cannot cross projects')
        throw new Refusal('Planning dependency not found')
      }
    }

    if (scope?.parentWorkItemId) {
      // Depending on your own parent is a trap, not a relationship: a parent is
      // never dispatched directly (it has children), so it can never reach
      // done, so the subtask waits forever. Siblings only.
      if (dependencyIds.includes(scope.parentWorkItemId)) {
        throw new Refusal(
          'A subtask cannot depend on its own parent task; the parent only finishes once its subtasks do'
        )
      }
      const allowed = new Set<string>()
      for (const item of items) {
        if (
          item.parentWorkItemId === scope.parentWorkItemId &&
          item.subtaskPhaseNumber === scope.subtaskPhaseNumber
        ) {
          allowed.add(item.id)
        }
      }
      if (dependencyIds.some((dependencyId) => !allowed.has(dependencyId))) {
        throw new Refusal(t('errors:planningService.subtaskCanOnlyDepend'))
      }
    }

    const graph = new Map(items.map((item) => [item.id, item.dependencyIds]))
    graph.set(itemId, dependencyIds)
    const reachesItem = (current: string, seen: Set<string>): boolean => {
      if (current === itemId) return true
      if (seen.has(current)) return false
      seen.add(current)
      return (graph.get(current) ?? []).some((next) => reachesItem(next, seen))
    }
    if (dependencyIds.some((dependencyId) => reachesItem(dependencyId, new Set()))) {
      throw new Refusal(t('errors:planningService.planningDependenciesCannotContain'))
    }
  }

  /** Writes a task's waits-on links; a bare id is finish to start, 0 days. */
  private replaceDependencies(
    itemId: string,
    links: ReadonlyArray<string | PlanningDependencyLink>
  ): void {
    this.db.prepare('DELETE FROM planning_dependencies WHERE work_item_id = ?').run(itemId)
    const insert = this.db.prepare(
      'INSERT INTO planning_dependencies (work_item_id, depends_on_id, type, lag_days) VALUES (?, ?, ?, ?)'
    )
    for (const link of links) {
      const { id, type, lagDays } =
        typeof link === 'string' ? normalisedDependencyLink({ id: link }) : link
      insert.run(itemId, id, type, lagDays)
    }
  }

  private dependenciesForProject(projectId: string): Map<string, PlanningDependencyLink[]> {
    const rows = this.db
      .prepare(
        `SELECT dependency.work_item_id, dependency.depends_on_id, dependency.type, dependency.lag_days
         FROM planning_dependencies dependency
         JOIN planning_work_items item ON item.id = dependency.work_item_id
         WHERE item.project_id = ?
         ORDER BY dependency.rowid`
      )
      .all(projectId) as DependencyRow[]
    const result = new Map<string, PlanningDependencyLink[]>()
    for (const row of rows) {
      const current = result.get(row.work_item_id) ?? []
      current.push(dependencyLinkFromRow(row))
      result.set(row.work_item_id, current)
    }
    return result
  }

  /**
   * Waits-on links from a create or update (N7.2a). `links`, when given, is
   * the whole list, each with an optional type and lag; otherwise `ids` is,
   * and an id already linked in `previous` keeps its type and lag while a new
   * one is finish to start, 0 days. Neither given is no links.
   */
  private dependencyLinksInput(
    links: unknown,
    ids: unknown,
    previous: readonly PlanningDependencyLink[]
  ): { dependencyIds: string[]; dependencyLinks: PlanningDependencyLink[] } {
    if (links === undefined) {
      const kept = new Map(previous.map((link) => [link.id, link]))
      const dependencyLinks = uniqueIds(ids).map(
        (id) => kept.get(id) ?? normalisedDependencyLink({ id })
      )
      return { dependencyIds: dependencyLinks.map((link) => link.id), dependencyLinks }
    }
    if (!Array.isArray(links))
      throw new Refusal(`Dependency links must be an array, not ${typeof links}`)
    const dependencyLinks: PlanningDependencyLink[] = []
    for (const link of links) {
      if (!link || typeof link !== 'object' || Array.isArray(link))
        throw new Refusal('Each dependency link must be an object with an id')
      const { id, type, lagDays } = link as Record<string, unknown>
      if (type !== undefined && !isDependencyType(type))
        throw new Refusal(`Dependency type must be one of ${PLANNING_DEPENDENCY_TYPES.join(', ')}`)
      if (lagDays !== undefined && !isDependencyLag(lagDays))
        throw new Refusal(
          `Dependency lag must be a whole number of days from -${MAX_DEPENDENCY_LAG_DAYS} to ${MAX_DEPENDENCY_LAG_DAYS}`
        )
      const [checked] = uniqueIds([id])
      if (dependencyLinks.some((other) => other.id === checked)) continue
      dependencyLinks.push(normalisedDependencyLink({ id: checked, type, lagDays }))
    }
    // The same checks and limit as a list of ids.
    const dependencyIds = uniqueIds(dependencyLinks.map((link) => link.id))
    return { dependencyIds, dependencyLinks }
  }

  private writeMeasure(goalId: string, measure: GoalMeasure | null): void {
    this.db
      .prepare(
        `UPDATE planning_goals
         SET measure_unit = ?, measure_start_value = ?, measure_target_value = ?,
             measure_start_date = ?, measure_target_date = ?, measure_direction = ?
         WHERE id = ?`
      )
      .run(
        measure?.unit ?? null,
        measure?.startValue ?? null,
        measure?.targetValue ?? null,
        measure?.startDate ?? null,
        measure?.targetDate ?? null,
        measure?.direction ?? null,
        goalId
      )
  }

  private validateLinkedWorkItems(projectId: string, workItemIds: string[]): void {
    if (workItemIds.length === 0) return
    const items = this.listKeptWorkItems(projectId)
    const itemIds = new Set(items.map((item) => item.id))
    for (const workItemId of workItemIds) {
      if (!itemIds.has(workItemId)) {
        const other = this.db
          .prepare('SELECT project_id FROM planning_work_items WHERE id = ?')
          .get(workItemId) as { project_id: string } | undefined
        if (other) throw new Refusal('Planning decisions cannot link work items across projects')
        throw new Refusal('Linked planning work item not found')
      }
    }
  }

  /**
   * A task's status and custom column (MOP-26): a column of the project's
   * own sets the status to the one it counts as; none (or null) is the
   * status's own column.
   */
  private columnPlace(
    projectId: string,
    status: PlanningWorkItemStatus,
    columnId: string | null
  ): { status: PlanningWorkItemStatus; columnId: string | null } {
    if (columnId === null) return { status, columnId: null }
    if (typeof columnId !== 'string') throw new Refusal('columnId must be a column id or null')
    const column = customColumns(this.columns.read(projectId)).find(
      (candidate) => candidate.id === columnId
    )
    if (!column) throw new Refusal(t('errors:planningService.columnNotFound'))
    return { status: column.countsAs, columnId: column.id }
  }

  private toWorkItem(
    row: WorkItemRow,
    dependencyLinks: PlanningDependencyLink[],
    checkedTexts: string[],
    recurring = false
  ): PlanningWorkItem {
    const acceptanceCriteria = jsonStringList(row.acceptance_criteria)
    const checked = new Set(checkedTexts)
    return {
      id: row.id,
      projectId: row.project_id,
      milestoneId: row.milestone_id,
      title: row.title,
      description: row.description,
      status: row.status,
      columnId: row.column_id ?? null,
      priority: row.priority,
      labels: jsonStringList(row.labels),
      acceptanceCriteria,
      dependencyIds: dependencyLinks.map((link) => link.id),
      dependencyLinks,
      targetDate: row.target_date,
      startDate: row.start_date ?? null,
      assigneeId: row.assignee_id ?? null,
      estimate: row.estimate ?? null,
      // In list order, and only texts still on the list.
      checkedCriteria: acceptanceCriteria.filter((text) => checked.has(text)),
      origin: row.origin,
      linkedHarnessTaskId: row.linked_harness_task_id,
      autoQueue: Boolean(row.auto_queue),
      planFirst: row.plan_first ?? 'default',
      blockedReason: row.blocked_reason ?? '',
      ...(row.scheduled_queue && row.scheduled_queue_at
        ? {
            scheduledQueue: {
              outcome: row.scheduled_queue,
              at: row.scheduled_queue_at,
              ...(row.scheduled_queue_note ? { note: row.scheduled_queue_note } : {})
            }
          }
        : {}),
      number: row.number ?? null,
      key: taskKey(this.getTaskPrefix(row.project_id), row.number),
      parentWorkItemId: row.parent_work_item_id,
      taskCode: row.task_code,
      phaseCode: row.phase_code,
      phaseName: row.phase_name,
      subtaskPhaseNumber: row.subtask_phase_number,
      subtaskPhaseName: row.subtask_phase_name,
      verificationStatus: row.verification_status,
      verifiedBy: row.verified_by,
      verifiedAt: row.verified_at,
      verificationNotes: row.verification_notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      archivedAt: row.archived_at ?? null,
      deletedAt: row.deleted_at ?? null,
      recurring,
      importBatchId: row.import_batch_id ?? null,
      orderKey: row.order_key ?? '',
      iterationId: row.iteration_id ?? null,
      typeId: row.type_id ?? null,
      subprojectId: row.subproject_id ?? null,
      resolution: row.resolution ?? null,
      resolutionReason: row.resolution_reason ?? '',
      showFrom: row.show_from ?? null,
      someday: Boolean(row.someday),
      impact: row.impact ?? null,
      effort: row.effort ?? null,
      inTriage: Boolean(row.in_triage),
      capturedBy: row.captured_by ?? null,
      ...(row.round_source_id ? { roundSourceId: row.round_source_id } : {})
    }
  }

  /** Whether a person exists and can be given work in a project: the address book, or its own. */
  private canBeGivenWork(personId: string, projectId: string): boolean {
    const person = this.people.get(personId)
    return person !== null && (person.projectId === null || person.projectId === projectId)
  }

  /**
   * An assignee must be a person who exists (archived people keep their
   * tasks), from the address book or the task's own project's people.
   */
  private assigneeId(value: unknown, projectId: string): string | null {
    if (value === undefined || value === null || value === '') return null
    const person = typeof value === 'string' ? this.people.get(value) : null
    if (!person) throw new Refusal(t('errors:planningService.personDoesNotExist'))
    if (person.projectId !== null && person.projectId !== projectId) {
      throw new Refusal(t('errors:planningService.personFromOtherProject'))
    }
    return person.id
  }
}

/** A task's GitHub links as a work item carries them: only when it has some. */
function withGithubLinks(links: GithubLink[]): { githubLinks?: GithubLink[] } {
  return links.length > 0 ? { githubLinks: links } : {}
}

/** Every checklist item ticked, and there is at least one: what "checklist complete" means. */
function checklistComplete(item: PlanningWorkItem): boolean {
  return (
    item.acceptanceCriteria.length > 0 &&
    item.acceptanceCriteria.every((text) => item.checkedCriteria.includes(text))
  )
}

/** Refuses a task that cannot be closed as won't do (N1.2). */
function refuseWontDo(item: PlanningWorkItem): void {
  if (item.deletedAt) throw new Refusal(t('errors:planningService.restoreItemRecycleBin'))
  if (item.resolution === 'wont-do') throw new Refusal(t('errors:planningService.wontDoAlready'))
  if (item.status === 'done') throw new Refusal(t('errors:planningService.wontDoDone'))
  if (item.archivedAt) throw new Refusal(t('errors:planningService.wontDoArchived'))
}

/** A copy's title (N2.4): "Title (copy)", the original shortened to fit the 200 characters. */
function copyTitle(title: string): string {
  const marked = t('tasks:taskLinks.copySuffix', { title })
  if (marked.length <= 200) return marked
  const room = 200 - (marked.length - title.length) - 1
  return t('tasks:taskLinks.copySuffix', { title: `${title.slice(0, Math.max(0, room))}…` })
}

function isLinkTargetKind(value: unknown): value is LinkTargetKind {
  return typeof value === 'string' && (LINK_TARGET_KINDS as readonly string[]).includes(value)
}

/** Ids are UUIDs in the app, but test and imported data may use any short plain id. */
function isEntityIdLike(value: string): boolean {
  return /^[A-Za-z0-9-]{1,64}$/.test(value)
}

/** Which project an item is in, by kind (N4.4a). */
const ITEM_PROJECT: Record<LinkTargetKind, string> = {
  task: 'SELECT project_id FROM planning_work_items WHERE id = ?',
  milestone: 'SELECT project_id FROM planning_milestones WHERE id = ?',
  decision: 'SELECT project_id FROM planning_decisions WHERE id = ?',
  library: 'SELECT project_id FROM library_items WHERE id = ?'
}
