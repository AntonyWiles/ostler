// ─── Comments and activity (P5.2) ───────────────────────────────────────────

/** Who made a change. `unknown` is only ever read back: status rows from before P5.2. */
export type ActorKind = 'human' | 'agent' | 'ostler-ai' | 'automation' | 'system' | 'rule'
export const ACTOR_KINDS: readonly ActorKind[] = [
  'human',
  'agent',
  'ostler-ai',
  'automation',
  'system',
  'rule'
]

/**
 * What every write to a task declares (P5.2). `personId` names the human
 * (Me, for the desktop app). `draftId` is the AI draft an approved task came
 * from; it is stored in the change's metadata.
 */
export interface PlanningActor {
  kind: ActorKind
  personId?: string
  draftId?: string
  /** The template a record was created from (P5.8); stored in the change's metadata. */
  template?: string
  /** The playbook Run playbook made it from (N9.6b); stored in its "created" change's metadata. */
  playbook?: string
  /** For `rule`: the rule's name (R6.2), shown as "by rule <name>". */
  ruleName?: string
}

/** The fields `planning_field_changes.field` records. Status lives in its own history. */
export type PlanningChangeField =
  | 'created'
  | 'title'
  | 'description'
  | 'priority'
  | 'assignee'
  | 'startDate'
  | 'dueDate'
  | 'showFrom'
  | 'someday'
  /** In To triage (N4.3a): false when a decision took it out, true when undo put it back. */
  | 'triage'
  | 'estimate'
  /** An idea's scores (N1.1b); the values are 1 to 5 or null. */
  | 'impact'
  | 'effort'
  | 'milestone'
  | 'iteration'
  /** Its task type (N2.7a); the values are type ids or null. */
  | 'type'
  | 'labels'
  | 'dependencies'
  /** One waits-on link's type or lag changed (N7.2a); the values are `{ id, type, lagDays }`. */
  | 'dependencyLink'
  | 'checklist'
  | 'checklistTick'
  | 'verification'
  | 'archived'
  | 'unarchived'
  | 'wontDo'
  | 'reopened'
  | 'deleted'
  | 'restored'
  | 'repeat'
  | 'repeated'
  /** A repeat's take-turns list changed (N2.3); the values are person id lists or null. */
  | 'takeTurns'
  /** A link to another task added or removed (N2.4); the value is `{ role, id, title }`. */
  | 'linked'
  | 'unlinked'
  /** Copied into a new round of its milestone (N5.7a); the value is `{ id, name }`. */
  | 'round'
  /** Ostler AI filled an AI field (N8.4), when the person asked; the value is `{ fieldId, name }`. */
  | 'aiFilled'
  /** Its task number moved because another PC gave the same number to another task (shared-folder sync). */
  | 'number'
  /** Another PC's edit replaced a description written here; the text written here is kept in its history. */
  | 'descriptionReplaced'

/** Who wrote a comment. Nothing writes `agent` yet: agents cannot comment (P5.2). */
export type CommentAuthorKind = 'human' | 'agent' | 'ostler-ai' | 'automation' | 'rule'

export interface PlanningComment {
  id: string
  projectId: string
  workItemId: string
  authorKind: CommentAuthorKind
  authorPersonId: string | null
  /** Markdown, rendered sanitized. */
  body: string
  createdAt: number
  updatedAt: number
  deletedAt: number | null
  /** When it was pinned to the top of the task's feed; null or absent when it is not. */
  pinnedAt?: number | null
  /** The rule that added it (R6.2), or absent. */
  ruleName?: string | null
}

/** The longest comment, in characters. */
export const MAX_COMMENT_LENGTH = 10_000

/**
 * `status-update` (N5.5) is a project's status update and `goal-check-in`
 * (N5.6a) a goal's check-in: project feed only, with no task.
 */
export type ActivityEntryKind =
  'comment' | 'status' | 'change' | 'agent' | 'status-update' | 'goal-check-in'
export type ActivityFilter = 'all' | 'comments' | 'changes'

/** Who an activity entry is by, already named for display. */
export interface ActivityActor {
  kind: ActorKind | 'unknown'
  personId: string | null
  /** "Alex", "Built-in agent", "Automation API"… */
  name: string
  /** For a change a rule made (R6.2): the rule's name. */
  ruleName?: string
}

/** One line in a task's or project's history, whatever it came from. */
export interface ActivityEntry {
  /** Unique and stable; also the paging cursor (`before`). */
  id: string
  kind: ActivityEntryKind
  projectId: string
  workItemId: string
  workItemTitle: string
  at: number
  actor: ActivityActor
  /** One plain-language sentence: "Alex changed the due date from 3 Oct to 10 Oct". */
  summary: string
  /** Present for `comment` entries. */
  comment?: PlanningComment
  /** Present for `change` entries. */
  field?: PlanningChangeField
  /**
   * For a `created` entry: what the task came from, when one action made
   * many (R1.4). Recent activity shows such entries as one group.
   */
  source?: ActivitySource
}

/** What one action that created many tasks was, read from what the rows already record. */
export type ActivitySource =
  | { kind: 'template'; name: string }
  | { kind: 'suggestion'; draftId: string }
  | { kind: 'import'; batchId: string; fileName: string }

export interface ActivityQuery {
  /** A page's `nextBefore`: only entries older than the last one it returned. */
  before?: string
  /** 1–100; 25 when left out. */
  limit?: number
  /** Task activity only; the project feed is always `all`. */
  filter?: ActivityFilter
}

export interface ActivityPage {
  entries: ActivityEntry[]
  /** Pass as `before` for the next page; null when there is no more. */
  nextBefore: string | null
}

export const DEFAULT_ACTIVITY_LIMIT = 25
export const MAX_ACTIVITY_LIMIT = 100
