import type { ContactPhone, TaskContactRole } from './contacts'
import type { CostState } from './money'
import type { GoalMeasureDirection } from './goal-measures'
import type { LibraryAiAccess } from './ostler-api/library-types'
import type { EstimateUnit } from './ostler-api/people-types'
import type { PlanningFieldType } from './ostler-api/field-types'
import type {
  PlanningDependencyType,
  PlanningGoalStatus,
  PlanningIterationStatus,
  PlanningLinkKind,
  PlanningMilestoneStatus,
  PlanningPriority,
  PlanningResolution,
  PlanningSubprojectStatus,
  PlanningWorkItemStatus
} from './ostler-api/planning-types'
import type {
  PlanningRuleAction,
  PlanningRuleCondition,
  PlanningRuleTrigger
} from './ostler-api/rule-types'
import type { SavedViewType } from './ostler-api/search-types'
import type { TaskTemplateBody } from './ostler-api/task-template-types'
import type { TimeEntrySource } from './ostler-api/time-types'
import type { ProjectIcon } from './project-icons'
import type { RecurrenceRule } from './recurrence'
import type { PackageDate } from './relative-dates'
import type { StatusUpdateHealth } from './status-updates'
import type { TaskFilter } from './task-filter'
import type { WhiteboardObjectInput } from './whiteboard/model'

/**
 * The project package's format (see project-package.ts, which parses it): the shapes a package
 * file holds once `validateProjectPackage` has filled in every optional field.
 */

export const PROJECT_PACKAGE_FORMAT = 'ostler-project-package'

/** The icons a template may show (the renderer maps each to its glyph). */
export const TEMPLATE_ICONS = [
  'file',
  'code',
  'globe',
  'megaphone',
  'calendar',
  'pen',
  'rocket',
  'home',
  'book',
  'sparkles'
] as const
export type TemplateIcon = (typeof TEMPLATE_ICONS)[number]

export interface PackageRecurrence {
  rule: RecurrenceRule
  endsOn: PackageDate | null
  remaining: number | null
  /** Take turns (N2.3): people by ref, in order; left out when it does not. */
  rotationRefs?: string[]
  /** Whose turn is next, an index into `rotationRefs`; left out with it. */
  nextIndex?: number
  /** Go to agents when it comes round (N9.7); left out when it does not. */
  goToAgents?: true
}

export interface PackagePerson {
  ref: string
  name: string
  initials: string
  color: string | null
}

export interface PackageLabel {
  name: string
  color: string
}

export interface PackageGoal {
  ref: string
  title: string
  outcome: string
  status: PlanningGoalStatus
  /** Its measure (N5.6a); dates relative in a template. Left out when it has none. */
  measure?: PackageGoalMeasure
  /** Its check-ins, oldest first; left out when none, and always from templates. */
  checkIns?: PackageCheckIn[]
}

export interface PackageGoalMeasure {
  unit: string
  startValue: number
  targetValue: number
  startDate: PackageDate
  targetDate: PackageDate
  direction: GoalMeasureDirection
}

export interface PackageCheckIn {
  /** `YYYY-MM-DD`, never relative. */
  date: string
  value: number
  note: string
  /** When it was recorded, ISO 8601. */
  recordedAt: string
}

export interface PackageMilestone {
  ref: string
  goalRef: string | null
  name: string
  outcome: string
  targetDate: PackageDate | null
  successCriteria: string[]
  status: PlanningMilestoneStatus
  /**
   * Its round schedule (N5.7a): the rule, a round's length in days, the next
   * round's start (relative in a template) and on or off. Left out when none.
   */
  repeat?: PackageMilestoneRepeat
  /** The day this round started (N5.7a); left out when it is no round. */
  roundStart?: PackageDate
  /** The round it was made from, by ref (N5.7a); never in a template. */
  previousRoundRef?: string
  /** The workstream it belongs to, by ref; left out when none. */
  subprojectRef?: string
}

/** A workstream (a sub-project). Its lead and members are people, by ref. */
export interface PackageSubproject {
  ref: string
  name: string
  description: string
  color: string
  icon?: ProjectIcon
  leadRef: string | null
  memberRefs: string[]
  status: PlanningSubprojectStatus
}

export interface PackageMilestoneRepeat {
  rule: RecurrenceRule
  lengthDays: number
  nextStart: PackageDate
  on: boolean
}

/**
 * An iteration (R6.1, D44). Its summary travels without the iteration its
 * unfinished tasks went to; a template's iterations are planned, with none.
 */
export interface PackageIteration {
  ref: string
  name: string
  startDate: PackageDate
  endDate: PackageDate
  goal: string
  status: PlanningIterationStatus
  summary: PackageIterationSummary | null
}

/**
 * A rule (R6.2, D45). Where the app keeps ids, the file keeps refs: a
 * person's, milestone's or field's ref, and a choice field's option refs.
 */
export interface PackageRule {
  name: string
  enabled: boolean
  trigger: PlanningRuleTrigger
  conditions: PlanningRuleCondition[]
  actions: PlanningRuleAction[]
}

/**
 * A task type (N2.7a, N22). Tasks name it by `ref`; an icon this build does
 * not know reads as the default one, and a project has at most 20.
 */
export interface PackageTaskType {
  ref: string
  name: string
  icon: string
  color: string
  /**
   * The fields its tasks show (N2.7b), by field ref. Left out for every
   * field, as a file from before N2.7b reads.
   */
  fieldRefs?: string[]
  /** The name of the file's task template new tasks of this type start from; left out for none. */
  templateName?: string
}

export interface PackageIterationSummary {
  doneCount: number
  doneEstimate: number
  carriedCount: number
  carriedEstimate: number
  carryOver: 'next' | 'none'
}

/**
 * A custom field (R2.2). A Choice's or Choices' value names its options by
 * `ref`; a Date's value is a package date, relative in a template.
 */
export interface PackageField {
  ref: string
  name: string
  type: PlanningFieldType
  options: { ref: string; name: string; color: string | null }[]
  /** An AI field's instruction (N8.4), Text and Choice only; left out for an ordinary field. */
  aiInstruction?: string
}

export type PackageFieldValue = string | number | boolean | string[]

export interface PackageChecklistItem {
  text: string
  checked: boolean
  /** The item's due date (N2.2); left out when it has none. */
  dueDate?: PackageDate
  /** The item's person, by ref (N2.2); left out when it has none. */
  assigneeRef?: string
}

export interface PackageTask {
  ref: string
  milestoneRef: string | null
  parentRef: string | null
  title: string
  description: string
  status: PlanningWorkItemStatus
  priority: PlanningPriority
  labels: string[]
  checklist: PackageChecklistItem[]
  assigneeRef: string | null
  startDate: PackageDate | null
  dueDate: PackageDate | null
  estimate: number | null
  dependsOnRefs: string[]
  /**
   * The type and lag of each link in `dependsOnRefs` that is not finish to
   * start with no lag (N7.2a); left out when there are none. A file without
   * it, or a link it does not list, is finish to start, 0 days.
   */
  dependsOnLinks?: PackageDependencyLink[]
  recurrence: PackageRecurrence | null
  /** Custom field values by field ref (R2.2); left out when the task has none. */
  fieldValues?: Record<string, PackageFieldValue>
  /**
   * The values Ostler AI filled (N8.4), by field ref, with the hash of the
   * task text each was filled from; left out when none. The rest are the
   * person's.
   */
  aiFills?: Record<string, { sourceHash: string }>
  /** The iteration it is in (R6.1); left out when none. */
  iterationRef?: string
  /** Its task type (N2.7a), by ref; left out when none. */
  typeRef?: string
  /** The workstream it belongs to, by ref; left out when none. */
  subprojectRef?: string
  /**
   * Closed as won't do (N1.2): the task is in the file, archived, with its
   * reason. Left out for an open task.
   */
  resolution?: PlanningResolution
  /** Why it was closed as won't do; left out when there is no reason. */
  resolutionReason?: string
  /** Hidden until this date (N1.1a); left out when none. */
  showFrom?: PackageDate
  /** In Someday (N1.1a); left out when not. */
  someday?: boolean
  /**
   * The project's own column it is in (MOP-26), by ref into `columns.custom`;
   * left out for its status's own column. One that names no column, or one
   * counting as another status, is ignored.
   */
  columnRef?: string
  /** An idea's impact score, 1 to 5 (N1.1b); left out when none. */
  impact?: number
  /** An idea's effort score, 1 to 5 (N1.1b); left out when none. */
  effort?: number
  /** The task of the earlier round it was copied from (N5.7a), by ref; never in a template. */
  roundSourceRef?: string
  /** Its number (N9.8a), unique in the file; never in a template. Left out when none. */
  number?: number
}

/**
 * A finished time entry (R2.3). Exports carry them; templates never do. A
 * timer still running when the project was exported is left out.
 */
export interface PackageTimeEntry {
  taskRef: string
  personRef: string | null
  /** The moment it started, ISO 8601 (`2026-10-14T08:30:00.000Z`). */
  startedAt: string
  durationSeconds: number
  note: string
  source: TimeEntrySource
  /** Whether it is charged for (N6.4); left out when not. */
  billable?: boolean
  /** The billing it was marked billed in (N6.4), by ref; left out when unbilled. */
  billingRef?: string
}

/** A project's hourly rate and default for new time (N6.4). Templates carry these. */
export interface PackageBillingSettings {
  /** Minor units of the budget's currency per hour, or null. */
  hourlyRate: number | null
  newTimeBillable: boolean
}

/** A billing (N6.4) with its totals as they were marked. Templates never carry these. */
export interface PackageBilling {
  ref: string
  /** Local days, `YYYY-MM-DD`, inclusive. */
  from: string
  to: string
  /** When it was marked, ISO 8601. */
  markedAt: string
  entryCount: number
  billableSeconds: number
  hourlyRate: number | null
  amount: number | null
  currency: string
}

/**
 * A task's GitHub issue or pull request (R4.4): its github.com URL, without
 * the cached title and state, which are fetched again when someone opens the
 * task. Exports carry them; templates never do.
 */
export interface PackageGithubLink {
  taskRef: string
  url: string
}

/**
 * A link between two tasks of the file besides waits-on (N2.4): from the
 * duplicate or copy to its original; either way for "relates".
 */
export interface PackageTaskLink {
  fromRef: string
  toRef: string
  kind: PlanningLinkKind
}

/**
 * A contact in the file (N6.5): only the contacts the file's tasks name
 * travel, never the whole list. Matched on import by email, or by name when
 * it has no email; the missing ones are created.
 */
export interface PackageContact {
  ref: string
  name: string
  organisation: string
  role: string
  phones: ContactPhone[]
  emails: string[]
  website: string
  address: string
  notes: string
}

/** A task's contact in the file, with its role (N6.5). */
export interface PackageTaskContact {
  taskRef: string
  contactRef: string
  role: TaskContactRole
}

export interface PackageDecision {
  title: string
  context: string
  decision: string
  alternatives: string
  consequences: string
  date: PackageDate | null
  taskRefs: string[]
}

export interface PackageComment {
  taskRef: string
  authorRef: string | null
  body: string
}

export type PackageLibraryKind =
  'brief' | 'guide' | 'note' | 'link' | 'document' | 'image' | 'whiteboard'

/**
 * The kinds that are text in the package itself; documents and images are files beside it, and a
 * whiteboard carries its objects (`PackageLibraryItem.whiteboard`).
 */
export const PACKAGE_TEXT_KINDS: readonly PackageLibraryKind[] = ['brief', 'guide', 'note', 'link']

export interface PackageLibraryItem {
  kind: PackageLibraryKind
  title: string
  summary: string
  body: string
  url: string | null
  aiAccess: LibraryAiAccess | null
  tags: string[]
  /**
   * A document's or image's file, relative to the package's folder:
   * `library/<name>` (P6.1's full export). Null for text kinds.
   */
  file: string | null
  /**
   * A whiteboard's objects (D21); left out for every other kind, so a file without whiteboards
   * still opens in builds from before them. A whiteboard's `body` is always ''.
   */
  whiteboard?: PackageWhiteboard
}

/**
 * A whiteboard in a project file (D21). Every image object has `imageItemId: null`: `pictures`
 * says which image entry of the same file's `library` each one shows. A template has none.
 */
export interface PackageWhiteboard {
  objects: WhiteboardObjectInput[]
  pictures: PackageWhiteboardPicture[]
}

export interface PackageWhiteboardPicture {
  objectId: string
  /** The index in the file's `library` of the image this object shows. */
  libraryIndex: number
}

/** What a template shows in the picker beside its name (`project.name`). */
export interface PackageTemplateInfo {
  description: string
  icon: TemplateIcon
}

/** Version 1, with every optional field filled in by `validateProjectPackage`. */
export interface ProjectPackage {
  format: typeof PROJECT_PACKAGE_FORMAT
  version: 1
  exportedAt: string | null
  app: { name: string; version: string } | null
  template: PackageTemplateInfo | null
  /** `icon` (N5.1) and `taskPrefix` (N9.8a, never in a template) are left out when none. */
  project: {
    name: string
    color: string | null
    estimateUnit: EstimateUnit
    icon?: ProjectIcon
    taskPrefix?: string
  }
  people: PackagePerson[]
  labels: PackageLabel[]
  /** Custom field definitions (R2.2); left out when the project has none. */
  fields?: PackageField[]
  goals: PackageGoal[]
  milestones: PackageMilestone[]
  /** Workstreams, in the project's order; left out when the project has none. */
  subprojects?: PackageSubproject[]
  /** Iterations (R6.1); left out when the project has none. */
  iterations?: PackageIteration[]
  /** Task types (N2.7a), in the project's order; left out when the project has none. */
  taskTypes?: PackageTaskType[]
  /** Rules (R6.2); left out when the project has none, and always from templates. */
  rules?: PackageRule[]
  tasks: PackageTask[]
  decisions: PackageDecision[]
  comments: PackageComment[]
  /** Time entries (R2.3); left out when the project has none, and always from templates. */
  timeEntries?: PackageTimeEntry[]
  /** GitHub links (R4.4); left out when the project has none, and always from templates. */
  githubLinks?: PackageGithubLink[]
  /**
   * Links between tasks (N2.4); left out when there are none, and always from
   * templates. Only links between tasks in the file travel.
   */
  taskLinks?: PackageTaskLink[]
  /** The Board's column names and hidden columns (R2.4); left out when standard. */
  columns?: PackageColumns
  library: PackageLibraryItem[]
  /** The project's own task templates (N2.1); left out when it has none. */
  taskTemplates?: PackageTaskTemplate[]
  /**
   * The ids the exported items had (N4.4a), so an import can point links in
   * texts at the new items. Left out when no text holds a link.
   */
  linkIds?: PackageLinkIds
  /**
   * The Overview's shortcuts (N5.2a), in order: they are the project's.
   * Sidebar pins are the person's and never travel. Left out when none.
   */
  pins?: PackagePin[]
  /**
   * Saved views of the Board, List, Calendar and Timeline, each type's in
   * order, and the view each type opens with. Left out when none.
   */
  views?: PackageView[]
  /**
   * Status updates (N5.5), oldest first: the project's diary travels with it.
   * Left out when there are none, and always from templates.
   */
  statusUpdates?: PackageStatusUpdate[]
  /** The budget and currency (N6.3a); left out when none was set. */
  budget?: PackageBudget
  /**
   * Costs (N6.3a), by date. A template carries only planned ones, dated
   * relative to the day it is used. Left out when there are none.
   */
  costs?: PackageCost[]
  /** The hourly rate and default (N6.4); left out when neither was set. */
  billingSettings?: PackageBillingSettings
  /** Billings (N6.4); left out when there are none, and always from templates. */
  billings?: PackageBilling[]
  /**
   * The contacts the file's tasks name (N6.5); left out when none, and
   * always from templates: contacts are personal data.
   */
  contacts?: PackageContact[]
  /** Which tasks name which contacts, with the role (N6.5); left out when none. */
  taskContacts?: PackageTaskContact[]
  /**
   * The shopping list (N6.3b), in order; left out when empty. A template
   * carries unbought items only, without suppliers.
   */
  shopping?: PackageShoppingItem[]
  /**
   * Baselines (N7.4), newest first; left out when none, and always from
   * templates. Entries name their task or milestone by ref.
   */
  baselines?: PackageBaseline[]
}

/** A baseline in the file: its name, when it was saved, and each item's dates then. */
export interface PackageBaseline {
  name: string
  /** When it was saved, an ISO timestamp. */
  savedAt: string
  entries: PackageBaselineEntry[]
}

/**
 * An item's dates in a baseline. `ref` is a task's or milestone's ref, or a
 * ref of its own for an item that is no longer in the file (the baseline is
 * history), which a new project reads as gone.
 */
export interface PackageBaselineEntry {
  kind: 'task' | 'milestone'
  ref: string
  start?: string | null
  due?: string | null
}

/** A shopping item in the file: its supplier and task by ref, when they travel too. */
export interface PackageShoppingItem {
  name: string
  quantity: number
  unit?: string
  /** The estimate for the whole line, in minor units. */
  estimate?: number | null
  /** The supplier, a ref into `contacts`. */
  supplierRef?: string | null
  taskRef?: string | null
  /** The paid cost buying it made, by its place in `costs`; left out while still to buy. */
  costIndex?: number
}

/** A project's budget in the file: minor units of its currency, or none. */
export interface PackageBudget {
  amount: number | null
  currency: string
}

/** A cost in the file: its task and milestone by ref, when they travel too. */
export interface PackageCost {
  date: PackageDate
  /** Whole minor units. */
  amount: number
  description: string
  category?: string
  taskRef?: string | null
  milestoneRef?: string | null
  state: CostState
}

/** A status update in the file: who posted it is a person by ref, or the automation API. */
export interface PackageStatusUpdate {
  health: StatusUpdateHealth
  note: string
  by: 'person' | 'automation'
  /** For `person`: the person, when people travel. */
  personRef?: string | null
  /** ISO date and time. */
  postedAt: string
  editedAt?: string | null
}

/** The pin kinds a project file carries: `view` is a saved view, by its place in `views`. */
export type PackagePinKind = 'task' | 'milestone' | 'decision' | 'library' | 'view' | 'project-view'

/**
 * An Overview shortcut in the file: an item by its place in the package's own
 * list (`tasks`, `milestones`, `decisions`, `library`, `views`), or a project view by id.
 */
export type PackagePin =
  | { kind: Exclude<PackagePinKind, 'project-view'>; index: number }
  | { kind: 'project-view'; viewId: string }

/**
 * A saved view of the project's Board, List, Calendar or Timeline: its filter,
 * search text and options (grouping, sort, columns shown…), as the app keeps
 * them. Ids in them travel as ref tokens, `#<kind>.<ref>` (see `VIEW_REF_KINDS`),
 * such as `#person.sam` or `field:#field.f1`; a custom field's option is
 * `#option.<field ref>/<option ref>`.
 */
export interface PackageView {
  /** Left out of a default view in a file, which needs none. */
  name: string
  viewType: SavedViewType
  /** The view this type opens with in the project, rather than a named view. One per type. */
  default?: true
  query?: string
  filter?: TaskFilter
  options?: Record<string, unknown>
}

/**
 * Links in texts travel as written, with the exporting project's ids. These
 * lists say which id each item had, in the order of the package's own lists
 * (`tasks`, `milestones`, `decisions`, `library`); an empty entry is an item
 * no link can name.
 */
export interface PackageLinkIds {
  projectId: string
  tasks: string[]
  milestones: string[]
  decisions: string[]
  library: string[]
}

/**
 * A project's own task template (N2.1): its body as the app keeps it, but with
 * no assignee or custom field values in it; those sit beside it by ref.
 */
export interface PackageTaskTemplate {
  name: string
  body: TaskTemplateBody
  assigneeRef: string | null
  /** By field ref, as a task's are; a Date's value is relative. Left out when none. */
  fieldValues?: Record<string, PackageFieldValue>
  /**
   * Checklist items' people (N2.2), by item text to person ref; the body's
   * item details carry only dates. Left out when none.
   */
  checklistAssigneeRefs?: Record<string, string>
  /** A playbook (N9.6b); its agent part is in the body. Left out for an ordinary template. */
  playbook?: true
}

/** A project's columns in the file (R2.4, D34): names by status id, and hidden statuses. */
export interface PackageColumns {
  names: Partial<Record<PlanningWorkItemStatus, string>>
  hidden: PlanningWorkItemStatus[]
  /** The project's own columns (MOP-26), in Board order; left out when none. */
  custom?: PackageCustomColumn[]
}

/** A column of the project's own (MOP-26): its name and the status it counts as. */
export interface PackageCustomColumn {
  ref: string
  name: string
  countsAs: PlanningWorkItemStatus
  hidden?: boolean
}

/** What the template picker shows: counts and the first few tasks. */
export interface ProjectPackageSummary {
  milestoneCount: number
  taskCount: number
  firstTasks: string[]
}

/** One waits-on link's type and lag in a project file (N7.2a). */
export interface PackageDependencyLink {
  ref: string
  type: PlanningDependencyType
  lagDays: number
}
