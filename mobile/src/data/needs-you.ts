/**
 * What waits on this phone's person, across every project: open blockers to decide, tasks in
 * review, blocked tasks, sign-offs asked of them and To triage counts, each with the task's latest
 * comment so the ask is readable without opening the task. Outside agents (the automation API)
 * leave a task Blocked or In review with a comment saying what they need; Ostler's own agents
 * report a blocker with options.
 *
 * And the answers: resolve a blocker (`PlanningService.resolveBlocker`), approve or send back a
 * task in review, unblock a task with a reply. Each writes the rows the desktop writes for the same
 * change, through `edits.ts`.
 *
 * Plain functions over anything shaped like a database, so this file imports no React Native code.
 */
import type { PlanningWorkItemStatus } from '@shared/ostler-api'
import { actorDisplayName } from '@shared/actor-name'
import type { ActorKind } from '@shared/ostler-api/activity-types'
import { capabilitiesOf } from '@shared/share-roles'
import {
  addTaskComment,
  deleteTaskComment,
  EditRefused,
  guarded,
  requireTask,
  setTaskStatus,
  type EditDb,
  type EditOptions
} from './edits'
import { signOffs, type SignOffSummary } from './plan'
import { shareRole, type QueryDb } from './queries'

/**
 * Words in an ask that suggest it can only be done at the PC: a key in `.env`, an API key or
 * token, signing in somewhere, a command to run, a local path, or one of the app's panels. A hint
 * shown on the card, never a rule: the answer buttons stay.
 */
export const ON_YOUR_PC_HINTS: readonly RegExp[] = [
  /\.env\b/i,
  /\bapi[ _-]?keys?\b/i,
  /\b(access |auth |bearer )?tokens?\b/i,
  /\bsign(ing|ed)?[ -]?in\b/i,
  /\blog(ging|ged)?[ -]?in\b/i,
  /\bnpm (run|install|i)\b/i,
  /\bnpx\b/i,
  /(^|[\s`'"(])[a-z]:[\\/]/i,
  /(^|[\s`'"(])~?\/(users|home)\//i,
  /\bpanel\b/i,
  /\bsearch console\b/i
]

/** Whether any of the texts reads like an ask that needs the PC. */
export function looksLikePcAsk(...texts: (string | null | undefined)[]): boolean {
  return texts.some((text) => !!text && ON_YOUR_PC_HINTS.some((hint) => hint.test(text)))
}

export type NeedsYouKind = 'decide' | 'review' | 'blocked' | 'waiting' | 'sign-off'

/** The card group an item shows in, in the screen's order. */
export type NeedsYouGroup = 'decide' | 'review' | 'blocked' | 'pc' | 'waiting'

export const NEEDS_YOU_GROUPS: readonly NeedsYouGroup[] = [
  'decide',
  'review',
  'blocked',
  'pc',
  'waiting'
]

export interface NeedsYouComment {
  id: string
  body: string
  author: string
  byPerson: boolean
  createdAt: number
}

export interface NeedsYouBlocker {
  id: string
  description: string
  /** Empty: the blocker is answered with "resolved", as on the PC. */
  options: string[]
  reportedBy: string
}

export interface NeedsYouItem {
  /** Unique across kinds: `blocker:<id>`, `task:<id>` or `sign-off:<id>`. */
  key: string
  kind: NeedsYouKind
  projectId: string
  /** The task, or the sign-off's task; null for a milestone's or decision's sign-off. */
  taskId: string | null
  title: string
  status: PlanningWorkItemStatus | null
  /** When the ask was made: the blocker, the latest comment or the move to this status. */
  askedAt: number
  latestComment: NeedsYouComment | null
  /** Open tasks this task waits on. */
  waitsOn: number
  /** The ask reads like it needs the PC (`ON_YOUR_PC_HINTS`). */
  onPc: boolean
  /** Whether this phone's person may change the task (role, or a Contributor's own task). */
  canAct: boolean
  blocker?: NeedsYouBlocker
  signOff?: SignOffSummary
}

export interface NeedsYou {
  items: NeedsYouItem[]
  /** Tasks waiting in each project's To triage. */
  triage: { projectId: string; count: number }[]
  /** Items that want an answer: everything but "waiting on other tasks". */
  count: number
}

/** The group a card shows in. */
export function needsYouGroup(item: NeedsYouItem): NeedsYouGroup {
  if (item.kind === 'decide') return 'decide'
  if (item.kind === 'waiting') return 'waiting'
  if (item.onPc) return 'pc'
  if (item.kind === 'blocked') return 'blocked'
  return 'review'
}

interface TaskInfoRow {
  id: string
  project_id: string
  title: string
  status: PlanningWorkItemStatus
  assignee_id: string | null
  updated_at: number
  status_since: number | null
  waits_on: number
}

const OPEN_TASK = `item.deleted_at IS NULL AND item.archived_at IS NULL
  AND item.resolution IS NULL AND item.in_triage = 0`

/** The SELECT for a task's fields, its time in this status and its open waits-on count. */
const TASK_INFO = `SELECT item.id, item.project_id, item.title, item.status, item.assignee_id,
    item.updated_at,
    (SELECT MAX(h.at) FROM planning_status_history h
      WHERE h.work_item_id = item.id AND h.to_status = item.status) AS status_since,
    (SELECT COUNT(*) FROM planning_dependencies d
      JOIN planning_work_items other ON other.id = d.depends_on_id
      WHERE d.work_item_id = item.id AND other.deleted_at IS NULL AND other.resolution IS NULL
        AND other.status <> 'done') AS waits_on
  FROM planning_work_items item`

function latestComment(db: QueryDb, taskId: string): NeedsYouComment | null {
  const row = db
    .prepare(
      `SELECT c.id, c.body, c.created_at, c.author_kind, c.rule_name, p.name AS author_name
       FROM planning_comments c LEFT JOIN people p ON p.id = c.author_person_id
       WHERE c.work_item_id = ? AND c.deleted_at IS NULL
       ORDER BY c.created_at DESC, c.id DESC LIMIT 1`
    )
    .get(taskId) as
    | {
        id: string
        body: string
        created_at: number
        author_kind: ActorKind
        rule_name: string | null
        author_name: string | null
      }
    | undefined
  if (!row) return null
  return {
    id: row.id,
    body: row.body,
    author: actorDisplayName(row.author_kind, row.author_name, row.rule_name),
    byPerson: row.author_kind === 'human' && !row.rule_name,
    createdAt: row.created_at
  }
}

function meId(db: QueryDb): string | null {
  const row = db.prepare('SELECT id FROM people WHERE is_me = 1').get() as
    { id: string } | undefined
  return row?.id ?? null
}

function textList(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === 'string') : []
  } catch {
    return []
  }
}

/**
 * Everything waiting on this phone's person, the newest ask first. A task with an open blocker
 * shows as that blocker only. A blocked task with open waits-on and nothing said since it was
 * blocked is "waiting on other tasks", not an ask.
 */
export function needsYou(db: QueryDb, today: string): NeedsYou {
  void today
  const me = meId(db)
  const roles = new Map<string, ReturnType<typeof capabilitiesOf>>()
  const capabilities = (projectId: string): ReturnType<typeof capabilitiesOf> => {
    let found = roles.get(projectId)
    if (!found) {
      found = capabilitiesOf(shareRole(db, projectId))
      roles.set(projectId, found)
    }
    return found
  }
  const canAct = (task: TaskInfoRow): boolean => {
    const can = capabilities(task.project_id)
    return can.editAnyTask || (can.editOwnTasks && me !== null && task.assignee_id === me)
  }

  const items: NeedsYouItem[] = []
  const withBlocker = new Set<string>()
  const blockers = db
    .prepare(
      `SELECT b.id, b.work_item_id, b.description, b.reported_by, b.reported_at,
              b.resolution_options
       FROM planning_blockers b JOIN planning_work_items item ON item.id = b.work_item_id
       WHERE b.status = 'open' AND item.status <> 'done' AND ${OPEN_TASK}`
    )
    .all() as {
    id: string
    work_item_id: string
    description: string
    reported_by: string
    reported_at: number
    resolution_options: string
  }[]
  const taskInfo = db.prepare(`${TASK_INFO} WHERE item.id = ?`)
  for (const blocker of blockers) {
    const task = taskInfo.get(blocker.work_item_id) as TaskInfoRow | undefined
    if (!task) continue
    withBlocker.add(task.id)
    const comment = latestComment(db, task.id)
    items.push({
      key: `blocker:${blocker.id}`,
      kind: 'decide',
      projectId: task.project_id,
      taskId: task.id,
      title: task.title,
      status: task.status,
      askedAt: Math.max(blocker.reported_at, comment?.createdAt ?? 0),
      latestComment: comment,
      waitsOn: Number(task.waits_on),
      onPc: looksLikePcAsk(blocker.description, comment?.body),
      canAct: canAct(task),
      blocker: {
        id: blocker.id,
        description: blocker.description,
        options: textList(blocker.resolution_options),
        reportedBy: blocker.reported_by
      }
    })
  }

  const waiting = db
    .prepare(`${TASK_INFO} WHERE item.status IN ('review', 'blocked') AND ${OPEN_TASK}`)
    .all() as TaskInfoRow[]
  for (const task of waiting) {
    if (withBlocker.has(task.id)) continue
    const comment = latestComment(db, task.id)
    const since = task.status_since ?? task.updated_at
    const waitsOn = Number(task.waits_on)
    const saidSince = comment !== null && comment.createdAt >= since
    const kind: NeedsYouKind =
      task.status === 'review' ? 'review' : waitsOn > 0 && !saidSince ? 'waiting' : 'blocked'
    items.push({
      key: `task:${task.id}`,
      kind,
      projectId: task.project_id,
      taskId: task.id,
      title: task.title,
      status: task.status,
      askedAt: Math.max(since, comment?.createdAt ?? 0),
      latestComment: comment,
      waitsOn,
      onPc: kind !== 'waiting' && looksLikePcAsk(comment?.body),
      canAct: canAct(task)
    })
  }

  if (me !== null) {
    const projects = db
      .prepare(
        `SELECT DISTINCT project_id FROM planning_sign_offs
         WHERE state = 'waiting' AND approver_person_id = ?`
      )
      .all(me) as { project_id: string }[]
    for (const { project_id: projectId } of projects) {
      for (const signOff of signOffs(db, projectId)) {
        if (!signOff.canAnswer) continue
        const taskId = signOff.itemKind === 'task' ? signOff.itemId : null
        items.push({
          key: `sign-off:${signOff.id}`,
          kind: 'sign-off',
          projectId,
          taskId,
          title: signOff.itemTitle,
          status: null,
          askedAt: signOff.requestedAt,
          latestComment: taskId ? latestComment(db, taskId) : null,
          waitsOn: 0,
          onPc: false,
          canAct: true,
          signOff
        })
      }
    }
  }

  items.sort((a, b) => b.askedAt - a.askedAt || a.key.localeCompare(b.key))
  const triage = (
    db
      .prepare(
        `SELECT project_id, COUNT(*) AS n FROM planning_work_items item
         WHERE item.in_triage = 1 AND item.deleted_at IS NULL AND item.archived_at IS NULL
           AND item.resolution IS NULL
         GROUP BY project_id ORDER BY project_id`
      )
      .all() as { project_id: string; n: number }[]
  ).map((row) => ({ projectId: row.project_id, count: Number(row.n) }))
  return {
    items,
    triage,
    count: items.filter((item) => item.kind !== 'waiting').length
  }
}

/** For each project, how many tasks are blocked on its person and how many are in review. */
export function needsYouCounts(needs: NeedsYou): Map<string, { blocked: number; review: number }> {
  const result = new Map<string, { blocked: number; review: number }>()
  for (const item of needs.items) {
    if (item.kind === 'waiting' || item.kind === 'sign-off') continue
    const found = result.get(item.projectId) ?? { blocked: 0, review: 0 }
    if (item.kind === 'review') found.review += 1
    else found.blocked += 1
    result.set(item.projectId, found)
  }
  return result
}

const MAX_CHOICE = 300
const MAX_NOTE = 2000

/** A task's open blockers, the oldest first, for the task's own screen. */
export function openBlockers(db: QueryDb, taskId: string): NeedsYouBlocker[] {
  return (
    db
      .prepare(
        `SELECT id, description, reported_by, resolution_options FROM planning_blockers
         WHERE work_item_id = ? AND status = 'open' ORDER BY reported_at ASC`
      )
      .all(taskId) as {
      id: string
      description: string
      reported_by: string
      resolution_options: string
    }[]
  ).map((row) => ({
    id: row.id,
    description: row.description,
    options: textList(row.resolution_options),
    reportedBy: row.reported_by
  }))
}

/**
 * Resolves a blocker with one of its options, or "resolved" when it has none
 * (`PlanningService.resolveBlocker`, as the PC's IPC calls it: resolved by "human").
 */
export function resolveTaskBlocker(
  db: EditDb,
  blockerId: string,
  choice: string,
  note = '',
  options: EditOptions = {}
): void {
  guarded(() => {
    const row = db
      .prepare('SELECT work_item_id, status FROM planning_blockers WHERE id = ?')
      .get(blockerId) as { work_item_id: string; status: string } | undefined
    if (!row) throw new EditRefused('not-found')
    if (row.status === 'resolved') throw new EditRefused('already-resolved')
    requireTask(db, row.work_item_id)
    if (typeof choice !== 'string' || !choice.trim()) throw new EditRefused('choice-required')
    if (choice.trim().length > MAX_CHOICE) throw new EditRefused('choice-too-long')
    if (typeof note !== 'string') throw new EditRefused('note-too-long')
    if (note.trim().length > MAX_NOTE) throw new EditRefused('note-too-long')
    db.prepare(
      `UPDATE planning_blockers
       SET status = 'resolved', resolution_choice = ?, resolution_note = ?, resolved_at = ?, resolved_by = ?
       WHERE id = ?`
    ).run(choice.trim(), note.trim(), options.now ?? Date.now(), 'human', blockerId)
  })
}

/** What an answer to a task changed, so it can be undone. */
export interface TaskAnswer {
  taskId: string
  previousStatus: PlanningWorkItemStatus
  status: PlanningWorkItemStatus
  commentId: string | null
}

function answerTask(
  db: EditDb,
  taskId: string,
  from: PlanningWorkItemStatus,
  to: PlanningWorkItemStatus,
  note: string | undefined,
  options: EditOptions
): TaskAnswer {
  const current = guarded(() => requireTask(db, taskId))
  if (current.status !== from) throw new EditRefused('not-waiting')
  if (note !== undefined && typeof note !== 'string') throw new EditRefused('comment-required')
  // The status goes first: a refused Done (a repeating task) leaves no comment behind.
  setTaskStatus(db, taskId, to, options)
  const commentId = note?.trim() ? addTaskComment(db, taskId, note, options) : null
  return { taskId, previousStatus: from, status: to, commentId }
}

/** Approves a task in review: Done, with the note as a comment when there is one. */
export function approveReview(
  db: EditDb,
  taskId: string,
  note?: string,
  options: EditOptions = {}
): TaskAnswer {
  return answerTask(db, taskId, 'review', 'done', note, options)
}

/** Whether the task was ever In progress (its status history says so). */
function everStarted(db: EditDb, taskId: string): boolean {
  return !!db
    .prepare(
      "SELECT 1 FROM planning_status_history WHERE work_item_id = ? AND to_status = 'active' LIMIT 1"
    )
    .get(taskId)
}

/**
 * Sends a task in review back with a note: In progress again, or Ready when it never started.
 * The note is required, as it is what the worker reads next.
 */
export function sendBackTask(
  db: EditDb,
  taskId: string,
  note: string,
  options: EditOptions = {}
): TaskAnswer {
  if (typeof note !== 'string' || !note.trim()) throw new EditRefused('comment-required')
  const to = everStarted(db, taskId) ? 'active' : 'ready'
  return answerTask(db, taskId, 'review', to, note, options)
}

/** Answers a blocked task: the reply as a comment, and the task moves on. */
export function unblockTask(
  db: EditDb,
  taskId: string,
  reply: string,
  to: 'ready' | 'backlog' | 'active',
  options: EditOptions = {}
): TaskAnswer {
  if (typeof reply !== 'string' || !reply.trim()) throw new EditRefused('comment-required')
  return answerTask(db, taskId, 'blocked', to, reply, options)
}

/** Replies on a task without moving it. */
export function replyOnTask(
  db: EditDb,
  taskId: string,
  reply: string,
  options: EditOptions = {}
): string {
  return addTaskComment(db, taskId, reply, options)
}

/** Undoes an answer: the status goes back and the comment is deleted (softly, as on the PC). */
export function undoTaskAnswer(db: EditDb, answer: TaskAnswer, options: EditOptions = {}): void {
  const current = guarded(() => requireTask(db, answer.taskId))
  if (current.status === answer.status) {
    setTaskStatus(db, answer.taskId, answer.previousStatus, options)
  }
  if (answer.commentId) deleteTaskComment(db, answer.commentId, options)
}
