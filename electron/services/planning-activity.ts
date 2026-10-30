import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import type {
  ActivityActor,
  PlanningColumnSettings,
  ActivityEntry,
  ActivitySource,
  ActivityFilter,
  ActivityPage,
  ActivityQuery,
  ActorKind,
  CommentAuthorKind,
  PlanningActor,
  PlanningChangeField,
  PlanningComment,
  PlanningWorkItem,
  PlanningWorkItemStatus
} from '@shared/ostler-api'
import {
  ACTOR_KINDS,
  DEFAULT_ACTIVITY_LIMIT,
  MAX_ACTIVITY_LIMIT,
  MAX_COMMENT_LENGTH
} from '@shared/ostler-api'
import {
  summarizeActivity,
  type ActivityRecord,
  type AgentActivityAction
} from '@shared/activity-summary'
import { dependencyLinksOf } from '@shared/planning/dependency-links'
import { actorDisplayName } from '@shared/actor-name'
import { BRAND } from '@shared/brand'
import { continuesSitting, isTextSittingField } from '@shared/planning/sitting'
import type { PeopleRepository } from './database/people-repository'
import { t } from '@shared/i18n'
import type { StatusUpdateHealth } from '@shared/status-updates'
import { insertComment, insertFieldChange, insertStatusHistory } from '@shared/planning/task-writes'

/**
 * What the harness knows about a project's agent runs, so its events can be
 * pinned to the tasks they were for. Wired in `services.ts`; planning never
 * calls the harness itself.
 */
export interface HarnessActivityLinks {
  /** Harness task id → the planning work item it ran. */
  taskWorkItems: Map<string, string>
  /** Session id → whether it was the built-in agent, and the tasks it held. */
  sessions: Map<string, { builtIn: boolean; taskIds: string[] }>
}

export type HarnessActivityResolver = (projectId: string) => HarnessActivityLinks | null

interface CommentRow {
  id: string
  project_id: string
  work_item_id: string
  author_person_id: string | null
  author_kind: CommentAuthorKind
  body: string
  created_at: number
  updated_at: number
  deleted_at: number | null
  pinned_at?: number | null
  rule_name?: string | null
}

interface StatusRow {
  sequence: number
  work_item_id: string
  from_status: PlanningWorkItemStatus | null
  to_status: PlanningWorkItemStatus
  at: number
  actor_kind: ActorKind | null
  actor_person_id: string | null
  rule_name?: string | null
}

interface ChangeRow {
  id: number
  work_item_id: string
  field: PlanningChangeField
  from_value: string | null
  to_value: string | null
  actor_kind: ActorKind
  actor_person_id: string | null
  metadata: string | null
  at: number
}

interface HarnessEventRow {
  id: string
  timestamp: number
  event_type: string
  agent_session_id: string
  details: string
}

/** One source's candidate entry, before naming and wording. */
interface Candidate {
  key: string
  at: number
  workItemId: string
  actorKind: ActorKind | 'unknown'
  personId: string | null
  agentName?: string
  /** The rule that made it (R6.2). */
  ruleName?: string
  record: ActivityRecord
}

const COMMENT_AUTHOR_KINDS: readonly CommentAuthorKind[] = [
  'human',
  'ostler-ai',
  'automation',
  'rule'
]

/** The harness events the feed tells (P5.2); every other event type is noise here. */
const HARNESS_EVENT_TYPES = [
  'task_queued',
  'task_claimed',
  'question_asked',
  'question_answered',
  'task_report_submitted',
  'session_end'
]

/**
 * Which step of an agent run a harness event records, or null for one the
 * feed leaves out (a force-release, a failed or stopped session). The words
 * matched are the ones `electron/services/harness/` writes.
 */
export function classifyHarnessEvent(
  eventType: string,
  details: string
): AgentActivityAction | null {
  switch (eventType) {
    case 'task_queued':
      return 'queued'
    case 'task_claimed':
      return /^(claim task|claimed task|Auto-continued to task) /.test(details) ? 'started' : null
    case 'question_asked':
      return 'question-asked'
    case 'question_answered':
      return 'question-answered'
    case 'task_report_submitted':
      return 'report-submitted'
    case 'session_end':
      if (/^(Merged session|Accepted session) /.test(details)) return 'accepted'
      if (/^Discarded session /.test(details)) return 'discarded'
      if (/^Rejected session /.test(details)) return 'rejected'
      return null
    default:
      return null
  }
}

/** The harness task an event names in its details ("claim task ab12cd34"), if any. */
function namedTaskId(details: string): string | null {
  return /\btask ([A-Za-z0-9-]{1,64})\b/.exec(details)?.[1] ?? null
}

function parseJson(value: string | null): unknown {
  if (value === null) return null
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((item) => set.has(item))
}

/** Parses a `nextBefore` cursor: `<at>|<entry id>`. */
function parseCursor(value: unknown): { at: number; key: string } | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw new Error('before must be text')
  const bar = value.indexOf('|')
  const at = Number(value.slice(0, bar))
  if (bar < 1 || !Number.isSafeInteger(at)) throw new Error('before is not a valid cursor')
  return { at, key: value.slice(bar + 1) }
}

function newestFirst(a: { at: number; key: string }, b: { at: number; key: string }): number {
  if (a.at !== b.at) return b.at - a.at
  return a.key < b.key ? 1 : a.key > b.key ? -1 : 0
}

/**
 * Comments, field changes and the activity read model (P5.2). Owned by
 * `PlanningService`, on its connection, so a change is recorded in the same
 * transaction as the write it describes.
 */
export class PlanningActivity {
  private harnessResolver: HarnessActivityResolver | null = null

  constructor(
    private readonly db: Database.Database,
    private readonly people: PeopleRepository,
    /** A project's column settings (R2.4): status changes read in its words. */
    private readonly columnsFor: (projectId: string) => PlanningColumnSettings | null = () => null
  ) {}

  setHarnessResolver(resolver: HarnessActivityResolver | null): void {
    this.harnessResolver = resolver
  }

  // ─── Actors ───────────────────────────────────────────────────────────────

  /** Every write declares who made it; this refuses one that does not say. */
  requireActor(actor: PlanningActor): PlanningActor {
    if (!actor || typeof actor !== 'object' || !ACTOR_KINDS.includes(actor.kind)) {
      throw new Error('Every change must say who made it')
    }
    const personId = typeof actor.personId === 'string' && actor.personId ? actor.personId : null
    return {
      kind: actor.kind,
      ...(personId && this.people.get(personId) ? { personId } : {}),
      ...(typeof actor.draftId === 'string' && actor.draftId ? { draftId: actor.draftId } : {}),
      ...(typeof actor.template === 'string' && actor.template
        ? { template: actor.template.slice(0, 80) }
        : {}),
      ...(typeof actor.playbook === 'string' && actor.playbook
        ? { playbook: actor.playbook.slice(0, 80) }
        : {}),
      ...(actor.kind === 'rule' && typeof actor.ruleName === 'string'
        ? { ruleName: actor.ruleName.slice(0, 80) }
        : {})
    }
  }

  // ─── Field changes ────────────────────────────────────────────────────────

  /**
   * The tasks an AI draft created, from the draft id their "created" row
   * carries: how approving the same draft twice finds what it already added.
   */
  workItemIdsCreatedFromDraft(projectId: string, draftId: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT work_item_id FROM planning_field_changes
         WHERE project_id = ? AND field = 'created' AND json_extract(metadata, '$.draftId') = ?
         ORDER BY at, rowid`
      )
      .all(projectId, draftId) as { work_item_id: string }[]
    return rows.map((row) => row.work_item_id)
  }

  recordChange(
    item: Pick<PlanningWorkItem, 'id' | 'projectId'>,
    field: PlanningChangeField,
    from: unknown,
    to: unknown,
    actor: PlanningActor,
    at: number
  ): void {
    insertFieldChange(
      this.db,
      item,
      field,
      from,
      to,
      { kind: actor.kind, personId: actor.personId ?? null },
      actor.draftId
        ? JSON.stringify({ draftId: actor.draftId })
        : actor.template && field === 'created'
          ? JSON.stringify({ template: actor.template })
          : actor.playbook && field === 'created'
            ? JSON.stringify({ playbook: actor.playbook })
            : actor.ruleName
              ? JSON.stringify({ rule: actor.ruleName })
              : null,
      at
    )
  }

  /**
   * A text field edited again within the same sitting (`TEXT_SITTING_GAP_MS`)
   * by the same actor updates the row that sitting started, so typing a
   * description saves many times but reads as one history row. The row keeps
   * the value from before the sitting; only its "to" and time move on.
   */
  private recordEdit(
    item: Pick<PlanningWorkItem, 'id' | 'projectId'>,
    field: PlanningChangeField,
    from: unknown,
    to: unknown,
    actor: PlanningActor,
    at: number
  ): void {
    if (!isTextSittingField(field)) {
      this.recordChange(item, field, from, to, actor, at)
      return
    }
    const sitting = this.db
      .prepare(
        `SELECT id, at FROM planning_field_changes
         WHERE work_item_id = ? AND field = ? AND actor_kind = ? AND actor_person_id IS ?
         ORDER BY at DESC, id DESC LIMIT 1`
      )
      .get(item.id, field, actor.kind, actor.personId ?? null) as
      { id: number; at: number } | undefined
    if (sitting && continuesSitting(sitting.at, at)) {
      this.db
        .prepare('UPDATE planning_field_changes SET to_value = ?, at = ? WHERE id = ?')
        .run(to === undefined ? null : JSON.stringify(to), at, sitting.id)
      return
    }
    this.recordChange(item, field, from, to, actor, at)
  }

  /**
   * One row per field that differs between two versions of a task. Status is
   * left out: it has its own history. A description edit stores neither text.
   * Text edits in one sitting are one row (`recordEdit`).
   */
  recordUpdate(
    before: PlanningWorkItem,
    after: PlanningWorkItem,
    actor: PlanningActor,
    at: number
  ): void {
    const record = (field: PlanningChangeField, from: unknown, to: unknown) =>
      this.recordEdit(after, field, from, to, actor, at)
    if (before.title !== after.title) record('title', before.title, after.title)
    if (before.description !== after.description) record('description', undefined, undefined)
    if (before.priority !== after.priority) record('priority', before.priority, after.priority)
    if (before.assigneeId !== after.assigneeId)
      record('assignee', before.assigneeId, after.assigneeId)
    if (before.startDate !== after.startDate) record('startDate', before.startDate, after.startDate)
    if (before.targetDate !== after.targetDate)
      record('dueDate', before.targetDate, after.targetDate)
    if ((before.showFrom ?? null) !== (after.showFrom ?? null))
      record('showFrom', before.showFrom ?? null, after.showFrom ?? null)
    if (Boolean(before.someday) !== Boolean(after.someday))
      record('someday', Boolean(before.someday), Boolean(after.someday))
    if (before.estimate !== after.estimate) record('estimate', before.estimate, after.estimate)
    if ((before.impact ?? null) !== (after.impact ?? null))
      record('impact', before.impact ?? null, after.impact ?? null)
    if ((before.effort ?? null) !== (after.effort ?? null))
      record('effort', before.effort ?? null, after.effort ?? null)
    if (before.milestoneId !== after.milestoneId)
      record('milestone', before.milestoneId, after.milestoneId)
    if ((before.iterationId ?? null) !== (after.iterationId ?? null))
      record('iteration', before.iterationId ?? null, after.iterationId ?? null)
    if ((before.typeId ?? null) !== (after.typeId ?? null))
      record('type', before.typeId ?? null, after.typeId ?? null)
    if (!sameSet(before.labels, after.labels)) record('labels', before.labels, after.labels)
    if (!sameSet(before.dependencyIds, after.dependencyIds))
      record('dependencies', before.dependencyIds, after.dependencyIds)
    // A link kept but waiting another way: its type or lag, one row per link.
    const linksBefore = new Map(dependencyLinksOf(before).map((link) => [link.id, link]))
    for (const link of dependencyLinksOf(after)) {
      const was = linksBefore.get(link.id)
      if (was && (was.type !== link.type || was.lagDays !== link.lagDays))
        record('dependencyLink', was, link)
    }
    if (!sameSet(before.acceptanceCriteria, after.acceptanceCriteria))
      record('checklist', before.acceptanceCriteria, after.acceptanceCriteria)
  }

  recordStatus(
    workItemId: string,
    from: PlanningWorkItemStatus | null,
    to: PlanningWorkItemStatus,
    actor: PlanningActor,
    at: number
  ): void {
    insertStatusHistory(
      this.db,
      workItemId,
      from,
      to,
      { kind: actor.kind, personId: actor.personId ?? null },
      actor.ruleName ?? null,
      at
    )
  }

  // ─── Comments ─────────────────────────────────────────────────────────────

  listComments(workItemId: string): PlanningComment[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM planning_comments WHERE work_item_id = ? AND deleted_at IS NULL ORDER BY created_at, id'
      )
      .all(workItemId) as CommentRow[]
    return rows.map((row) => this.toComment(row))
  }

  getComment(commentId: string): PlanningComment {
    if (typeof commentId !== 'string' || !commentId) throw new Error('Comment not found')
    const row = this.db.prepare('SELECT * FROM planning_comments WHERE id = ?').get(commentId) as
      CommentRow | undefined
    if (!row) throw new Error('Comment not found')
    return this.toComment(row)
  }

  addComment(
    item: Pick<PlanningWorkItem, 'id' | 'projectId'>,
    body: unknown,
    actor: PlanningActor
  ): PlanningComment {
    const author = this.commentAuthor(actor)
    const now = Date.now()
    const comment: PlanningComment = {
      id: uuidv4(),
      projectId: item.projectId,
      workItemId: item.id,
      authorKind: author,
      authorPersonId: actor.personId ?? null,
      body: this.commentBody(body),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      ...(actor.ruleName ? { ruleName: actor.ruleName } : {})
    }
    insertComment(this.db, { ...comment, ruleName: comment.ruleName ?? null })
    return comment
  }

  updateComment(commentId: string, body: unknown, actor: PlanningActor): PlanningComment {
    this.commentAuthor(actor)
    const current = this.getComment(commentId)
    if (current.deletedAt) throw new Error(t('errors:planningActivity.commentWasDeleted'))
    const text = this.commentBody(body)
    if (text === current.body) return current
    const updatedAt = Math.max(Date.now(), current.createdAt + 1)
    this.db
      .prepare('UPDATE planning_comments SET body = ?, updated_at = ? WHERE id = ?')
      .run(text, updatedAt, commentId)
    return { ...current, body: text, updatedAt }
  }

  /** Soft delete: `restoreComment` is the undo. The row goes for good with its task. */
  deleteComment(commentId: string, actor: PlanningActor): PlanningComment {
    this.commentAuthor(actor)
    const current = this.getComment(commentId)
    if (current.deletedAt) return current
    const deletedAt = Date.now()
    this.db
      .prepare('UPDATE planning_comments SET deleted_at = ? WHERE id = ?')
      .run(deletedAt, commentId)
    return { ...current, deletedAt }
  }

  /** Pins a comment to the top of its task's feed, or takes the pin off. Not an edit. */
  pinComment(commentId: string, pinned: boolean, actor: PlanningActor): PlanningComment {
    this.commentAuthor(actor)
    const current = this.getComment(commentId)
    if (current.deletedAt) throw new Error(t('errors:planningActivity.commentWasDeleted'))
    const pinnedAt = pinned ? (current.pinnedAt ?? Date.now()) : null
    this.db
      .prepare('UPDATE planning_comments SET pinned_at = ? WHERE id = ?')
      .run(pinnedAt, commentId)
    return { ...current, pinnedAt }
  }

  restoreComment(commentId: string, actor: PlanningActor): PlanningComment {
    this.commentAuthor(actor)
    const current = this.getComment(commentId)
    this.db.prepare('UPDATE planning_comments SET deleted_at = NULL WHERE id = ?').run(commentId)
    return { ...current, deletedAt: null }
  }

  /** Comments per task for a project's cards, in one grouped query. */
  commentCounts(projectId: string): Record<string, number> {
    const rows = this.db
      .prepare(
        `SELECT work_item_id AS workItemId, COUNT(*) AS count FROM planning_comments
         WHERE project_id = ? AND deleted_at IS NULL GROUP BY work_item_id`
      )
      .all(projectId) as { workItemId: string; count: number }[]
    return Object.fromEntries(rows.map((row) => [row.workItemId, row.count]))
  }

  private commentAuthor(actor: PlanningActor): CommentAuthorKind {
    if (!COMMENT_AUTHOR_KINDS.includes(actor.kind as CommentAuthorKind)) {
      throw new Error('Only people and the automation API can write comments')
    }
    return actor.kind as CommentAuthorKind
  }

  private commentBody(value: unknown): string {
    if (typeof value !== 'string' || !value.trim())
      throw new Error(t('errors:planningActivity.writeSomethingFirst'))
    if (value.trim().length > MAX_COMMENT_LENGTH) {
      throw new Error(t('errors:planningActivity.commentCanMostCharacters', { MAX_COMMENT_LENGTH }))
    }
    return value.trim()
  }

  private toComment(row: CommentRow): PlanningComment {
    return {
      id: row.id,
      projectId: row.project_id,
      workItemId: row.work_item_id,
      authorKind: row.author_kind,
      authorPersonId: row.author_person_id,
      body: row.body,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
      ...(row.pinned_at ? { pinnedAt: row.pinned_at } : {}),
      ...(row.rule_name ? { ruleName: row.rule_name } : {})
    }
  }

  // ─── The read model ───────────────────────────────────────────────────────

  /**
   * Status history, field changes, comments and the task's agent-run events,
   * newest first. `workItemId` null is the whole project. Each source reads
   * at most one page past the cursor, so paging never loads a whole history.
   */
  list(projectId: string, workItemId: string | null, query: ActivityQuery = {}): ActivityPage {
    const limit = this.limit(query.limit)
    const cursor = parseCursor(query.before)
    const filter: ActivityFilter =
      workItemId && (query.filter === 'comments' || query.filter === 'changes')
        ? query.filter
        : 'all'
    const candidates: Candidate[] = []
    if (filter !== 'changes')
      candidates.push(...this.commentCandidates(projectId, workItemId, cursor, limit))
    if (filter !== 'comments') {
      candidates.push(...this.statusCandidates(projectId, workItemId, cursor, limit))
      candidates.push(...this.changeCandidates(projectId, workItemId, cursor, limit))
      candidates.push(...this.harnessCandidates(projectId, workItemId, cursor, limit))
      if (!workItemId) candidates.push(...this.statusUpdateCandidates(projectId, cursor, limit))
      if (!workItemId) candidates.push(...this.checkInCandidates(projectId, cursor, limit))
    }
    const page = candidates.sort(newestFirst).slice(0, limit)
    const titles = this.titles(
      page.flatMap((candidate) => (candidate.workItemId ? [candidate.workItemId] : []))
    )
    const imports = this.importBatches(
      page.flatMap((candidate) =>
        candidate.record.kind === 'change' && candidate.record.field === 'created'
          ? [candidate.workItemId]
          : []
      )
    )
    const entries = page.map((candidate) => this.toEntry(projectId, candidate, titles, imports))
    const last = page[page.length - 1]
    return {
      entries,
      nextBefore: page.length === limit && last ? `${last.at}|${last.key}` : null
    }
  }

  private limit(value: unknown): number {
    if (value === undefined || value === null) return DEFAULT_ACTIVITY_LIMIT
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
      throw new Error(`limit must be a whole number from 1 to ${MAX_ACTIVITY_LIMIT}`)
    }
    return Math.min(value, MAX_ACTIVITY_LIMIT)
  }

  /**
   * Reads one source newest first, `batch` rows at a time, keeping only
   * candidates strictly older than the cursor, until it has `limit` or the
   * source runs out. The SQL bound is `at <= cursor.at`; ties are settled here.
   */
  private collect<Row>(
    read: (beforeAt: number, offset: number, count: number) => Row[],
    accept: (row: Row) => Candidate[],
    cursor: { at: number; key: string } | null,
    limit: number
  ): Candidate[] {
    const beforeAt = cursor ? cursor.at : Number.MAX_SAFE_INTEGER
    const batch = limit + 10
    const out: Candidate[] = []
    for (let offset = 0; out.length < limit; offset += batch) {
      const rows = read(beforeAt, offset, batch)
      for (const row of rows) {
        for (const candidate of accept(row)) {
          if (!cursor || newestFirst(cursor, candidate) < 0) out.push(candidate)
        }
      }
      if (rows.length < batch) break
    }
    return out
  }

  private commentCandidates(
    projectId: string,
    workItemId: string | null,
    cursor: { at: number; key: string } | null,
    limit: number
  ): Candidate[] {
    const scope = workItemId ? 'work_item_id = ?' : 'project_id = ?'
    const statement = this.db.prepare(
      `SELECT * FROM planning_comments
       WHERE ${scope} AND deleted_at IS NULL AND created_at <= ?
       ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`
    )
    return this.collect(
      (beforeAt, offset, count) =>
        statement.all(workItemId ?? projectId, beforeAt, count, offset) as CommentRow[],
      (row) => [
        {
          key: `c:${row.id}`,
          at: row.created_at,
          workItemId: row.work_item_id,
          actorKind: row.author_kind,
          personId: row.author_person_id,
          ...(row.rule_name ? { ruleName: row.rule_name } : {}),
          record: { kind: 'comment', comment: this.toComment(row) }
        }
      ],
      cursor,
      limit
    )
  }

  private statusCandidates(
    projectId: string,
    workItemId: string | null,
    cursor: { at: number; key: string } | null,
    limit: number
  ): Candidate[] {
    // A task created since P5.2 has a `created` change, which tells its
    // creation better (it knows the AI draft); its first status row would
    // only say it twice.
    const createdElsewhere = `NOT (history.from_status IS NULL AND EXISTS (
      SELECT 1 FROM planning_field_changes change
      WHERE change.work_item_id = history.work_item_id AND change.field = 'created'))`
    const statement = this.db.prepare(
      workItemId
        ? `SELECT history.* FROM planning_status_history history
           WHERE history.work_item_id = ? AND history.at <= ? AND ${createdElsewhere}
           ORDER BY history.at DESC, history.sequence DESC LIMIT ? OFFSET ?`
        : `SELECT history.* FROM planning_status_history history
           JOIN planning_work_items item ON item.id = history.work_item_id
           WHERE item.project_id = ? AND history.at <= ? AND ${createdElsewhere}
           ORDER BY history.at DESC, history.sequence DESC LIMIT ? OFFSET ?`
    )
    return this.collect(
      (beforeAt, offset, count) =>
        statement.all(workItemId ?? projectId, beforeAt, count, offset) as StatusRow[],
      (row) => [
        {
          key: `s:${String(row.sequence).padStart(12, '0')}`,
          at: row.at,
          workItemId: row.work_item_id,
          actorKind: row.actor_kind ?? 'unknown',
          personId: row.actor_person_id,
          ...(row.rule_name ? { ruleName: row.rule_name } : {}),
          record: { kind: 'status', from: row.from_status, to: row.to_status }
        }
      ],
      cursor,
      limit
    )
  }

  private changeCandidates(
    projectId: string,
    workItemId: string | null,
    cursor: { at: number; key: string } | null,
    limit: number
  ): Candidate[] {
    const scope = workItemId ? 'work_item_id = ?' : 'project_id = ?'
    const statement = this.db.prepare(
      `SELECT * FROM planning_field_changes
       WHERE ${scope} AND at <= ?
       ORDER BY at DESC, id DESC LIMIT ? OFFSET ?`
    )
    return this.collect(
      (beforeAt, offset, count) =>
        statement.all(workItemId ?? projectId, beforeAt, count, offset) as ChangeRow[],
      (row) => {
        const metadata = parseJson(row.metadata) as {
          draftId?: string
          template?: string
          playbook?: string
          rule?: string
        } | null
        return [
          {
            key: `f:${String(row.id).padStart(12, '0')}`,
            at: row.at,
            workItemId: row.work_item_id,
            actorKind: row.actor_kind,
            personId: row.actor_person_id,
            ...(typeof metadata?.rule === 'string' ? { ruleName: metadata.rule } : {}),
            record: {
              kind: 'change',
              field: row.field,
              from: parseJson(row.from_value),
              to: parseJson(row.to_value),
              metadata
            }
          }
        ]
      },
      cursor,
      limit
    )
  }

  private harnessCandidates(
    projectId: string,
    workItemId: string | null,
    cursor: { at: number; key: string } | null,
    limit: number
  ): Candidate[] {
    const links = this.harnessResolver?.(projectId)
    if (!links) return []
    const liveItems = new Set(
      (
        this.db
          .prepare('SELECT id FROM planning_work_items WHERE project_id = ?')
          .all(projectId) as {
          id: string
        }[]
      ).map((row) => row.id)
    )
    const workItemsFor = (row: HarnessEventRow): string[] => {
      // Task events name their task; session and question events go by session.
      const taskId = row.event_type.startsWith('task_') ? namedTaskId(row.details) : null
      const taskIds = taskId ? [taskId] : (links.sessions.get(row.agent_session_id)?.taskIds ?? [])
      const ids = new Set(
        taskIds.flatMap((id) => {
          const linked = links.taskWorkItems.get(id)
          return linked && liveItems.has(linked) ? [linked] : []
        })
      )
      return workItemId ? (ids.has(workItemId) ? [workItemId] : []) : [...ids]
    }
    // For one task, only its own runs' sessions and task ids are read.
    let scope = ''
    const scopeParameters: string[] = []
    if (workItemId) {
      const taskIds = [...links.taskWorkItems]
        .filter(([, linked]) => linked === workItemId)
        .map(([taskId]) => taskId)
      if (taskIds.length === 0) return []
      const sessionIds = [...links.sessions]
        .filter(([, session]) => session.taskIds.some((id) => taskIds.includes(id)))
        .map(([sessionId]) => sessionId)
      scope = `AND (agent_session_id IN (SELECT value FROM json_each(?))
        OR EXISTS (SELECT 1 FROM json_each(?) task WHERE details LIKE '%task ' || task.value || '%'))`
      scopeParameters.push(JSON.stringify(sessionIds), JSON.stringify(taskIds))
    }
    const statement = this.db.prepare(
      `SELECT id, timestamp, event_type, agent_session_id, details FROM harness_events
       WHERE project_id = ? AND event_type IN (SELECT value FROM json_each(?)) AND timestamp <= ? ${scope}
       ORDER BY timestamp DESC, id DESC LIMIT ? OFFSET ?`
    )
    return this.collect(
      (beforeAt, offset, count) =>
        statement.all(
          projectId,
          JSON.stringify(HARNESS_EVENT_TYPES),
          beforeAt,
          ...scopeParameters,
          count,
          offset
        ) as HarnessEventRow[],
      (row) => {
        const action = classifyHarnessEvent(row.event_type, row.details)
        if (!action) return []
        const session = links.sessions.get(row.agent_session_id)
        return workItemsFor(row).map((id) => ({
          key: `h:${row.id}:${id}`,
          at: row.timestamp,
          workItemId: id,
          actorKind: action === 'queued' ? ('system' as const) : ('agent' as const),
          personId: null,
          agentName: session
            ? session.builtIn
              ? t('errors:planningActivity.builtAgent')
              : t('errors:planningActivity.connectedAgent')
            : undefined,
          record: { kind: 'agent' as const, action }
        }))
      },
      cursor,
      limit
    )
  }

  /** Status updates (N5.5) in the project feed, read from the updates themselves. */
  private statusUpdateCandidates(
    projectId: string,
    cursor: { at: number; key: string } | null,
    limit: number
  ): Candidate[] {
    const statement = this.db.prepare(
      `SELECT id, health, author_kind, author_person_id, posted_at FROM status_updates
       WHERE project_id = ? AND deleted_at IS NULL AND posted_at <= ?
       ORDER BY posted_at DESC, id DESC LIMIT ? OFFSET ?`
    )
    return this.collect(
      (beforeAt, offset, count) =>
        statement.all(projectId, beforeAt, count, offset) as {
          id: string
          health: StatusUpdateHealth
          author_kind: ActorKind
          author_person_id: string | null
          posted_at: number
        }[],
      (row) => [
        {
          key: `u:${row.id}`,
          at: row.posted_at,
          workItemId: '',
          actorKind: row.author_kind,
          personId: row.author_person_id,
          record: { kind: 'status-update', health: row.health }
        }
      ],
      cursor,
      limit
    )
  }

  /** Goals' check-ins (N5.6a) in the project feed, read from the check-ins themselves. */
  private checkInCandidates(
    projectId: string,
    cursor: { at: number; key: string } | null,
    limit: number
  ): Candidate[] {
    const statement = this.db.prepare(
      `SELECT c.goal_id, c.date, c.value, c.recorded_at, c.recorded_by_kind,
              c.recorded_by_person_id, g.title, g.measure_unit
       FROM goal_check_ins c JOIN planning_goals g ON g.id = c.goal_id
       WHERE c.project_id = ? AND c.recorded_at <= ?
       ORDER BY c.recorded_at DESC, c.goal_id DESC, c.date DESC LIMIT ? OFFSET ?`
    )
    return this.collect(
      (beforeAt, offset, count) =>
        statement.all(projectId, beforeAt, count, offset) as {
          goal_id: string
          date: string
          value: number
          recorded_at: number
          recorded_by_kind: ActorKind
          recorded_by_person_id: string | null
          title: string
          measure_unit: string | null
        }[],
      (row) => [
        {
          key: `g:${row.goal_id}:${row.date}`,
          at: row.recorded_at,
          workItemId: '',
          actorKind: row.recorded_by_kind,
          personId: row.recorded_by_person_id,
          record: {
            kind: 'goal-check-in',
            goalTitle: row.title,
            value: row.value,
            unit: row.measure_unit ?? ''
          }
        }
      ],
      cursor,
      limit
    )
  }

  private titles(workItemIds: string[]): Map<string, string> {
    if (workItemIds.length === 0) return new Map()
    const rows = this.db
      .prepare(
        'SELECT id, title FROM planning_work_items WHERE id IN (SELECT value FROM json_each(?))'
      )
      .all(JSON.stringify([...new Set(workItemIds)])) as { id: string; title: string }[]
    return new Map(rows.map((row) => [row.id, row.title]))
  }

  /** The import each task came in with, for its `created` entry's source. */
  private importBatches(workItemIds: string[]): Map<string, { batchId: string; fileName: string }> {
    if (workItemIds.length === 0) return new Map()
    const rows = this.db
      .prepare(
        `SELECT item.id, batch.id AS batch_id, batch.file_name FROM planning_work_items item
         JOIN import_batches batch ON batch.id = item.import_batch_id
         WHERE item.id IN (SELECT value FROM json_each(?))`
      )
      .all(JSON.stringify([...new Set(workItemIds)])) as {
      id: string
      batch_id: string
      file_name: string
    }[]
    return new Map(rows.map((row) => [row.id, { batchId: row.batch_id, fileName: row.file_name }]))
  }

  /** Who a stored actor was, named as the history names them (description versions, N2.6). */
  nameActor(kind: ActorKind, personId: string | null, ruleName: string | null): ActivityActor {
    return {
      kind,
      personId,
      name: actorDisplayName(kind, this.personName(personId), ruleName),
      ...(ruleName ? { ruleName } : {})
    }
  }

  private personName(personId: string | null): string | null {
    return personId ? (this.people.get(personId)?.name ?? null) : null
  }

  private toEntry(
    projectId: string,
    candidate: Candidate,
    titles: Map<string, string>,
    imports: Map<string, { batchId: string; fileName: string }> = new Map()
  ): ActivityEntry {
    const actor: ActivityActor = {
      kind: candidate.actorKind,
      personId: candidate.personId,
      name: actorDisplayName(
        candidate.actorKind,
        this.personName(candidate.personId),
        candidate.ruleName,
        candidate.agentName
      ),
      ...(candidate.ruleName ? { ruleName: candidate.ruleName } : {})
    }
    const said = summarizeActivity(candidate.record, {
      actorName: candidate.ruleName ? BRAND.name : actor.name,
      personName: (id) => this.people.get(id)?.name ?? 'someone',
      milestoneName: (id) =>
        (
          this.db.prepare('SELECT name FROM planning_milestones WHERE id = ?').get(id) as
            { name: string } | undefined
        )?.name ?? t('errors:planningActivity.deletedMilestone'),
      iterationName: (id) =>
        (
          this.db.prepare('SELECT name FROM planning_iterations WHERE id = ?').get(id) as
            { name: string } | undefined
        )?.name ?? t('errors:planningActivity.deletedIteration'),
      typeName: (id) =>
        (
          this.db.prepare('SELECT name FROM planning_task_types WHERE id = ?').get(id) as
            { name: string } | undefined
        )?.name ?? t('errors:planningActivity.deletedType'),
      workItemTitle: (id) =>
        titles.get(id) ?? this.titles([id]).get(id) ?? t('errors:planningActivity.deletedTask'),
      columns: this.columnsFor(projectId)
    })
    // What a rule did reads "… by rule “Escalate”" (R6.2).
    const summary = candidate.ruleName
      ? t('errors:planningActivity.byRule', { summary: said, name: candidate.ruleName })
      : said
    const record = candidate.record
    return {
      id: candidate.key,
      kind: record.kind,
      projectId,
      workItemId: candidate.workItemId,
      workItemTitle: titles.get(candidate.workItemId) ?? '',
      at: candidate.at,
      actor,
      summary,
      ...(record.kind === 'comment' ? { comment: record.comment } : {}),
      ...(record.kind === 'change' ? { field: record.field } : {}),
      ...(record.kind === 'change' && record.field === 'created'
        ? sourceOf(record.metadata, imports.get(candidate.workItemId))
        : {})
    }
  }
}

/** What a `created` entry's task came from: a template, an AI draft or an import. */
function sourceOf(
  metadata: { draftId?: string; template?: string } | null,
  batch: { batchId: string; fileName: string } | undefined
): { source?: ActivitySource } {
  if (metadata?.draftId) return { source: { kind: 'suggestion', draftId: metadata.draftId } }
  if (metadata?.template) return { source: { kind: 'template', name: metadata.template } }
  if (batch) return { source: { kind: 'import', ...batch } }
  return {}
}
