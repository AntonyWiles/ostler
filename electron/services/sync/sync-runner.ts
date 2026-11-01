/**
 * Moves one shared project's changes through its folder (docs/plans/integrations/shared-folder-sync.md,
 * "Push" and "Pull"). Push writes this PC's waiting outbox rows as one signed,
 * encrypted change file under `changes/<this device>/`, then empties the rows it
 * wrote. Pull reads every other device's change files in sequence order, applies
 * them with `applyChanges`, and records how far each device has been applied.
 *
 * Every file has one writer and is never edited, so a file that is missing or
 * still half-synced just waits for the next pull. Push only writes into this
 * PC's own device folder, and pull never reads it.
 */
import type Database from 'better-sqlite3'
import { applyChanges, type ArrivedBlocker } from './apply'
import {
  ChangeFileError,
  decodeChangeFile,
  encodeChangeFile,
  type ChangeBatch,
  type SyncChange
} from './change-file'
import { SyncTransportError } from './transport-paths'
import type { SyncTransport } from './folder-transport'
import { type SealKeys, type KeySource } from './envelope'
import { roleAtSequence } from './roles'
import { PERSONAL_TABLES } from './synced-tables'
import { openSecret } from './platform'

export interface PushResult {
  /** Changes written; 0 when the outbox was empty. */
  written: number
  /** The sequence of the file written, or null when nothing was written. */
  sequence: number | null
}

export interface PullProblem {
  deviceId: string
  sequence: number
  reason: string
}

/** A task another PC assigned to this PC's Me (D11): the notice's facts. */
export interface AssignedToMe {
  projectId: string
  taskId: string
  byPersonId: string | null
}

/** A comment another PC wrote that mentions this PC's Me (prompt 14): the notice's facts. */
export interface MentionedMe {
  projectId: string
  taskId: string
  commentId: string
  byPersonId: string | null
}

/** A sign-off asked of this PC's Me, or answered for Me, that another PC wrote (prompt 17). */
export interface SignOffArrived {
  projectId: string
  signOffId: string
  itemKind: 'task' | 'decision' | 'milestone'
  itemId: string
  state: 'waiting' | 'approved' | 'changes'
  byPersonId: string | null
}

/** A task another person changed or commented on in a pull (prompt 15): once per task. */
export interface ChangedTaskByOther {
  projectId: string
  taskId: string
  byPersonId: string | null
}

export interface PullResult {
  files: number
  applied: number
  skipped: number
  pending: number
  /** Tasks another PC assigned to this PC's Me in this pull. */
  assignedToMe: AssignedToMe[]
  /** Comments another PC wrote in this pull that mention this PC's Me. */
  mentionedMe: MentionedMe[]
  /** Sign-offs asked of this PC's Me in this pull (still waiting). */
  signOffRequestsForMe: SignOffArrived[]
  /** Sign-offs Me asked for that were answered in this pull. */
  signOffAnswersForMe: SignOffArrived[]
  /** Tasks other people changed or commented on in this pull, once each. */
  changedTasks: ChangedTaskByOther[]
  /** Files that could not be read yet; that device is retried from this file next time. */
  problems: PullProblem[]
  /** A blocker or a task's status changed in this pull (`ApplyResult.dispatchInputs`). */
  dispatchInputs: boolean
  /** Blockers reported or resolved on another device in this pull. */
  blockers: ArrivedBlocker[]
}

/** Most outbox rows written in one change file. */
const PUSH_LIMIT = 5000
/** Tries at a new sequence number when another file already holds it. */
const MAX_WRITE_TRIES = 5
const FILE_PATTERN = /^(\d{6,})\.ostlerchanges$/

interface ShareRow {
  share_id: string
  member_id: string
  device_id: string
  kind: 'project' | 'personal'
}

interface OutboxRow {
  id: number
  table_name: string
  row_key: string
  op: 'upsert' | 'delete'
  columns: string
  stamp: string
  actor_kind: string
  actor_person_id: string | null
}

interface ChangeFile {
  deviceId: string
  sequence: number
  path: string
}

export async function pushChanges(
  db: Database.Database,
  transport: SyncTransport,
  projectId: string,
  keys: SealKeys
): Promise<PushResult> {
  const share = shareOf(db, projectId)
  const rows = db
    .prepare(
      `SELECT id, table_name, row_key, op, columns, stamp, actor_kind, actor_person_id
       FROM sync_outbox WHERE project_id = @projectId ORDER BY id LIMIT @limit`
    )
    .all({ projectId, limit: PUSH_LIMIT }) as OutboxRow[]
  if (rows.length === 0) return { written: 0, sequence: null }

  const changes = rows.map(toChange)
  const folder = `changes/${share.device_id}`
  let sequence = (await highestSequence(transport, folder)) + 1
  for (let tries = 1; ; tries++) {
    const batch: ChangeBatch = {
      formatVersion: 1,
      shareId: share.share_id,
      deviceId: share.device_id,
      memberId: share.member_id,
      sequence,
      changes
    }
    const bytes = encodeChangeFile(batch, keys)
    try {
      await transport.writeOnce(`${folder}/${fileName(sequence)}`, bytes)
      break
    } catch (error) {
      if (
        !(error instanceof SyncTransportError) ||
        error.reason !== 'exists' ||
        tries >= MAX_WRITE_TRIES
      ) {
        throw error
      }
      sequence += 1
    }
  }

  // Only now that the file is written: the rows it holds leave the outbox.
  const highestId = rows[rows.length - 1].id
  db.prepare('DELETE FROM sync_outbox WHERE project_id = @projectId AND id <= @highestId').run({
    projectId,
    highestId
  })
  db.prepare('UPDATE sync_shares SET last_synced_at = @now WHERE project_id = @projectId').run({
    now: Date.now(),
    projectId
  })
  return { written: rows.length, sequence }
}

export async function pullChanges(
  db: Database.Database,
  transport: SyncTransport,
  projectId: string,
  keys: { projectKey: KeySource }
): Promise<PullResult> {
  const share = shareOf(db, projectId)
  const result: PullResult = {
    files: 0,
    applied: 0,
    skipped: 0,
    pending: 0,
    assignedToMe: [],
    mentionedMe: [],
    signOffRequestsForMe: [],
    signOffAnswersForMe: [],
    changedTasks: [],
    problems: [],
    dispatchInputs: false,
    blockers: []
  }
  // This PC's Me, read once per pull: the assignments that concern it are the ones it reports.
  const me = db.prepare('SELECT id FROM people WHERE is_me = 1').get() as { id: string } | undefined
  const lastApplied = db.prepare(
    'SELECT last_sequence FROM sync_applied WHERE share_id = @shareId AND device_id = @deviceId'
  )
  const memberKey = db.prepare(
    'SELECT public_key FROM sync_members WHERE share_id = @shareId AND member_id = @memberId'
  )
  const cutoffs = removedCutoffs(db, share.share_id)
  const recordApplied = db.prepare(
    `INSERT INTO sync_applied (share_id, device_id, last_sequence) VALUES (@shareId, @deviceId, @sequence)
     ON CONFLICT(share_id, device_id) DO UPDATE SET last_sequence = excluded.last_sequence`
  )

  const devices = changeFilesByDevice(await transport.list('changes'))
  for (const deviceId of [...devices.keys()].sort()) {
    if (deviceId === share.device_id) continue
    const stored = lastApplied.get({ shareId: share.share_id, deviceId }) as
      { last_sequence: number } | undefined
    let last = stored?.last_sequence ?? 0
    const files = (devices.get(deviceId) ?? [])
      .filter((file) => file.sequence > last)
      .sort((a, b) => a.sequence - b.sequence)

    for (const file of files) {
      // A file before this one has not arrived yet: wait for the next pull.
      if (file.sequence !== last + 1) break

      let bytes: Buffer
      try {
        bytes = await transport.read(file.path)
      } catch {
        result.problems.push({ deviceId, sequence: file.sequence, reason: 'unreadable' })
        break
      }

      let batch: ChangeBatch
      try {
        batch = decodeChangeFile(bytes, {
          projectKey: keys.projectKey,
          publicKeyFor: (memberId) =>
            (
              memberKey.get({ shareId: share.share_id, memberId }) as
                { public_key: string } | undefined
            )?.public_key ?? null
        })
      } catch (error) {
        if (error instanceof ChangeFileError) {
          result.problems.push({ deviceId, sequence: file.sequence, reason: error.reason })
          break
        }
        throw error
      }
      if (
        batch.shareId !== share.share_id ||
        batch.deviceId !== deviceId ||
        batch.sequence !== file.sequence
      ) {
        result.problems.push({ deviceId, sequence: file.sequence, reason: 'mismatch' })
        break
      }

      // A removed member's files count only as far as the PC that removed them had applied them.
      const cutoff = cutoffs.get(batch.memberId)
      if (cutoff && file.sequence > (cutoff[deviceId] ?? 0)) {
        recordApplied.run({ shareId: share.share_id, deviceId, sequence: file.sequence })
        last = file.sequence
        continue
      }

      // What a file may change depends on its sender's role when it was written (D1, D7).
      // Owners and Editors change anything; a Contributor their own comments and work (D5); a Viewer only its own comments.
      // The personal share has no roles: every device in it is one person's (D13).
      const sender = senderOf(db, share.share_id, batch.memberId)
      const role =
        share.kind === 'personal'
          ? 'owner'
          : sender
            ? roleAtSequence(db, share.share_id, sender.personKey, deviceId, file.sequence)
            : 'viewer'
      const senderId = sender?.personId ?? null
      // Shared away days are written only by the person they belong to, whatever the role.
      // A sign-off is answered only by its approver, whatever the role (D9), so a Viewer or
      // Contributor may send that and nothing else of it; a Contributor may also ask for one.
      const byRole =
        role === 'owner' || role === 'editor'
          ? batch.changes
          : role === 'contributor'
            ? batch.changes.filter(
                (change) =>
                  isOwnComment(db, change, senderId) ||
                  isContributorChange(db, change, senderId) ||
                  isSignOffAnswer(db, change, senderId) ||
                  change.table === 'shared_away'
              )
            : batch.changes.filter(
                (change) =>
                  isOwnComment(db, change, senderId) ||
                  isSignOffAnswer(db, change, senderId) ||
                  change.table === 'shared_away'
              )
      const allowed = byRole.filter(
        (change) =>
          (change.table !== 'shared_away' || isOwnAway(db, change, senderId, batch.changes)) &&
          isAllowedSignOffChange(db, change, senderId, batch.changes)
      )
      if (allowed.length < batch.changes.length) {
        result.skipped += batch.changes.length - allowed.length
        result.problems.push({ deviceId, sequence: file.sequence, reason: 'not-allowed' })
      }
      const counts = applyChanges(db, share.share_id, allowed)
      result.applied += counts.applied
      result.skipped += counts.skipped
      result.pending = counts.pending
      if (counts.dispatchInputs) result.dispatchInputs = true
      result.blockers.push(...counts.blockers)
      for (const task of counts.assigned) {
        // Not when Me made it, on another of this person's devices: no one else assigned it.
        if (me && task.to === me.id && task.from !== me.id && task.byPersonId !== me.id) {
          result.assignedToMe.push({
            projectId: task.projectId,
            taskId: task.taskId,
            byPersonId: task.byPersonId
          })
        }
      }
      for (const comment of counts.mentioned) {
        // Not when Me wrote it, on another of this person's devices.
        if (me && comment.personIds.includes(me.id) && comment.byPersonId !== me.id) {
          result.mentionedMe.push({
            projectId: comment.projectId,
            taskId: comment.taskId,
            commentId: comment.commentId,
            byPersonId: comment.byPersonId
          })
        }
      }
      for (const so of counts.signOffs) {
        // Not Me's own doing, from another of this person's devices.
        if (!me || so.byPersonId === me.id) continue
        const event: SignOffArrived = {
          projectId: so.projectId,
          signOffId: so.signOffId,
          itemKind: so.itemKind,
          itemId: so.itemId,
          state: so.state,
          byPersonId: so.byPersonId ?? so.requestedByPersonId
        }
        if (so.state === 'waiting' && so.approverPersonId === me.id) {
          result.signOffRequestsForMe.push(event)
        } else if (so.state !== 'waiting' && so.requestedByPersonId === me.id) {
          result.signOffAnswersForMe.push({ ...event, byPersonId: so.approverPersonId })
        }
      }
      for (const change of counts.changed) {
        // Not Me's own change from another of this person's devices; one entry per task.
        if (me && change.byPersonId === me.id) continue
        if (result.changedTasks.some((seen) => seen.taskId === change.taskId)) continue
        result.changedTasks.push({
          projectId: change.projectId,
          taskId: change.taskId,
          byPersonId: change.byPersonId
        })
      }
      // Applying twice after a crash is harmless (the merge is by stamp), so no shared transaction.
      recordApplied.run({ shareId: share.share_id, deviceId, sequence: file.sequence })
      last = file.sequence
      result.files += 1
    }
  }

  if (result.files > 0) {
    db.prepare('UPDATE sync_shares SET last_synced_at = @now WHERE project_id = @projectId').run({
      now: Date.now(),
      projectId
    })
  }
  return result
}

/** The person a member's device belongs to, and that person's Me (null when this PC does not know it). */
export function senderOf(
  db: Database.Database,
  shareId: string,
  memberId: string
): { personKey: string; personId: string | null } | null {
  const row = db
    .prepare(
      `SELECT COALESCE(person_public_key, public_key) AS person_key, person_id FROM sync_members
       WHERE share_id = @shareId AND member_id = @memberId`
    )
    .get({ shareId, memberId }) as { person_key: string; person_id: string | null } | undefined
  return row ? { personKey: row.person_key, personId: row.person_id } : null
}

/**
 * Whether a change is to a comment the sender wrote (D1): the comment's author
 * is the sender's person now, and after the change too. A new comment must name
 * the sender as its author; a change or delete must touch one already theirs.
 */
function isOwnComment(db: Database.Database, change: SyncChange, personId: string | null): boolean {
  if (change.table !== 'planning_comments' || personId === null) return false
  const id = commentId(change.rowKey)
  if (id === null) return false
  const stored = db
    .prepare('SELECT author_person_id FROM planning_comments WHERE id = @id')
    .get({ id }) as { author_person_id: string | null } | undefined
  if (stored && stored.author_person_id !== personId) return false
  if (change.op === 'delete') return stored !== undefined
  const author = change.columns.author_person_id
  if (author !== undefined && author !== personId) return false
  return stored !== undefined || author === personId
}

/**
 * Whether a change to `shared_away` is to a row of the sender's own (D6): the stored row, if
 * any, is theirs, and so is the incoming one. Applies to every role, Owners included.
 */
function isOwnAway(
  db: Database.Database,
  change: SyncChange,
  personId: string | null,
  batch: SyncChange[]
): boolean {
  if (personId === null) return false
  const id = commentId(change.rowKey)
  if (id === null) return false
  // A row inserted earlier in this same batch is not stored yet, so it counts as stored here.
  const inserted = batch
    .slice(0, batch.indexOf(change))
    .find((earlier) => earlier.op === 'upsert' && earlier.rowKey === change.rowKey)
  const stored =
    (db.prepare('SELECT person_id FROM shared_away WHERE id = @id').get({ id }) as
      { person_id: string } | undefined) ??
    (typeof inserted?.columns.person_id === 'string'
      ? { person_id: inserted.columns.person_id }
      : undefined)
  if (stored && stored.person_id !== personId) return false
  if (change.op === 'delete') return stored !== undefined
  const owner = change.columns.person_id
  if (owner !== undefined && owner !== personId) return false
  return stored !== undefined || owner === personId
}

const SIGN_OFF_ANSWER_COLUMNS = new Set(['state', 'note', 'answered_at', 'updated_at'])

interface StoredSignOff {
  approver_person_id: string
  requested_by_person_id: string | null
  state: string
  note: string
  answered_at: number | null
}

function storedSignOff(db: Database.Database, rowKey: string): StoredSignOff | undefined {
  const id = commentId(rowKey)
  if (id === null) return undefined
  return db
    .prepare(
      `SELECT approver_person_id, requested_by_person_id, state, note, answered_at
       FROM planning_sign_offs WHERE id = @id`
    )
    .get({ id }) as StoredSignOff | undefined
}

/**
 * Whether a change is a Viewer's or Contributor's answer to a sign-off addressed to them
 * (D9): an update of a stored row whose approver is the sender, touching only the answer
 * (`state`, `note`, `answered_at`, `updated_at`).
 */
function isSignOffAnswer(
  db: Database.Database,
  change: SyncChange,
  personId: string | null
): boolean {
  if (change.table !== 'planning_sign_offs' || personId === null || change.op !== 'upsert')
    return false
  const stored = storedSignOff(db, change.rowKey)
  if (!stored || stored.approver_person_id !== personId) return false
  return Object.keys(change.columns).every((column) => SIGN_OFF_ANSWER_COLUMNS.has(column))
}

/**
 * The rule for every role, Owners included (D9): a change that answers a sign-off (sets
 * `state` away from `waiting`, or changes `note` or `answered_at`) is kept only when the
 * sender is the row's approver, the stored one or, for a new row, the incoming one. `batch`
 * is the whole file, for a row asked and answered in it.
 */
function isAllowedSignOffChange(
  db: Database.Database,
  change: SyncChange,
  personId: string | null,
  batch: readonly SyncChange[]
): boolean {
  if (change.table !== 'planning_sign_offs' || change.op !== 'upsert') return true
  const stored = storedSignOff(db, change.rowKey)
  const { columns } = change
  const answers = stored
    ? (columns.state !== undefined && columns.state !== 'waiting') ||
      (columns.note !== undefined && columns.note !== stored.note) ||
      (columns.answered_at !== undefined && columns.answered_at !== stored.answered_at)
    : (columns.state !== undefined && columns.state !== 'waiting') ||
      (columns.note !== undefined && columns.note !== '') ||
      (columns.answered_at !== undefined && columns.answered_at !== null)
  if (!answers) return true
  if (personId === null) return false
  let approver: unknown = stored?.approver_person_id ?? columns.approver_person_id
  if (approver === undefined) {
    const asked = batch.find(
      (earlier) =>
        earlier.table === 'planning_sign_offs' &&
        earlier.rowKey === change.rowKey &&
        earlier.columns.approver_person_id !== undefined
    )
    approver = asked?.columns.approver_person_id
  }
  return approver === personId
}

/** The id of the person a stored task is assigned to, or null (no such task, or nobody). */
function storedAssignee(db: Database.Database, workItemId: unknown): string | null {
  if (typeof workItemId !== 'string') return null
  const row = db
    .prepare('SELECT assignee_id FROM planning_work_items WHERE id = @id')
    .get({ id: workItemId }) as { assignee_id: string | null } | undefined
  return row?.assignee_id ?? null
}

/**
 * Whether a change is one a Contributor may make (D5): an update to a task assigned to
 * them that keeps it theirs; a check, time block or blocker of such a task; or a time entry
 * of their own. Judged on the stored row and on the incoming columns, both.
 */
function isContributorChange(
  db: Database.Database,
  change: SyncChange,
  personId: string | null
): boolean {
  if (personId === null) return false
  let key: unknown
  try {
    key = JSON.parse(change.rowKey)
  } catch {
    return false
  }
  if (!Array.isArray(key) || typeof key[0] !== 'string') return false
  const { columns, op } = change
  switch (change.table) {
    case 'planning_work_items': {
      if (op !== 'upsert' || storedAssignee(db, key[0]) !== personId) return false
      return columns.assignee_id === undefined || columns.assignee_id === personId
    }
    case 'planning_checklist_checks': {
      if (columns.work_item_id !== undefined && columns.work_item_id !== key[0]) return false
      return storedAssignee(db, key[0]) === personId
    }
    case 'planning_time_blocks':
    case 'planning_blockers': {
      const stored = db
        .prepare(`SELECT work_item_id FROM ${change.table} WHERE id = @id`)
        .get({ id: key[0] }) as { work_item_id: string } | undefined
      const items = [stored?.work_item_id, columns.work_item_id].filter((id) => id !== undefined)
      return items.length > 0 && items.every((id) => storedAssignee(db, id) === personId)
    }
    case 'planning_time_entries': {
      const stored = db
        .prepare('SELECT person_id FROM planning_time_entries WHERE id = @id')
        .get({ id: key[0] }) as { person_id: string | null } | undefined
      if (stored && stored.person_id !== personId) return false
      if (op === 'delete') return stored !== undefined
      if (columns.person_id !== undefined && columns.person_id !== personId) return false
      return stored !== undefined || columns.person_id === personId
    }
    case 'planning_sign_offs': {
      // A request for sign-off on a task assigned to them, or taking their own waiting one back.
      const stored = storedSignOff(db, change.rowKey)
      if (op === 'delete')
        return (
          stored !== undefined &&
          stored.requested_by_person_id === personId &&
          stored.state === 'waiting'
        )
      if (stored) return false
      return (
        columns.state === 'waiting' &&
        columns.item_kind === 'task' &&
        columns.requested_by_person_id === personId &&
        storedAssignee(db, columns.item_id) === personId
      )
    }
    default:
      return false
  }
}

/** The comment id a row key names (`["<id>"]`), or null when it names none. */
function commentId(rowKey: string): string | null {
  try {
    const key = JSON.parse(rowKey) as unknown
    return Array.isArray(key) && typeof key[0] === 'string' ? key[0] : null
  } catch {
    return null
  }
}

/** Removed members of the share, each with how far its devices' files still count. */
function removedCutoffs(
  db: Database.Database,
  shareId: string
): Map<string, Record<string, number>> {
  const removed = new Map<string, Record<string, number>>()
  for (const row of db
    .prepare(
      'SELECT member_id, removed_cutoffs FROM sync_members WHERE share_id = @shareId AND removed_at IS NOT NULL'
    )
    .all({ shareId }) as { member_id: string; removed_cutoffs: string | null }[]) {
    let cutoffs: Record<string, number> = {}
    try {
      cutoffs = (JSON.parse(row.removed_cutoffs ?? '{}') as Record<string, number>) ?? {}
    } catch {
      cutoffs = {}
    }
    removed.set(row.member_id, cutoffs)
  }
  return removed
}

function shareOf(db: Database.Database, projectId: string): ShareRow {
  const share = db
    .prepare(
      'SELECT share_id, member_id, device_id, kind FROM sync_shares WHERE project_id = @projectId'
    )
    .get({ projectId }) as ShareRow | undefined
  if (!share) throw new Error('Project is not shared')
  return share
}

function toChange(row: OutboxRow): SyncChange {
  const actor: SyncChange['actor'] = { kind: row.actor_kind }
  if (row.actor_person_id !== null) actor.personId = row.actor_person_id
  const columns = JSON.parse(row.columns) as Record<string, unknown>
  // A personal secret waits sealed in the outbox and travels opened, inside the encrypted file (D19).
  // Never logged; one this PC cannot open travels as null.
  for (const column of PERSONAL_TABLES[row.table_name]?.sealed ?? []) {
    const value = columns[column]
    if (typeof value !== 'string' || value === '') continue
    try {
      columns[column] = openSecret(value)
    } catch {
      columns[column] = null
    }
  }
  return {
    table: row.table_name,
    rowKey: row.row_key,
    op: row.op,
    columns,
    stamp: row.stamp,
    actor
  }
}

/** The sequence in a file name such as `000001.ostlerchanges`, or null when the name is not a change file. */
function sequenceOf(name: string): number | null {
  const match = FILE_PATTERN.exec(name)
  return match ? Number(match[1]) : null
}

function fileName(sequence: number): string {
  return `${String(sequence).padStart(6, '0')}.ostlerchanges`
}

/** The highest sequence already in a device's folder; 0 when there are none. */
async function highestSequence(transport: SyncTransport, folder: string): Promise<number> {
  let highest = 0
  for (const relativePath of await transport.list(folder)) {
    const sequence = sequenceOf(relativePath.slice(relativePath.lastIndexOf('/') + 1))
    if (sequence !== null && sequence > highest) highest = sequence
  }
  return highest
}

/** The change files in `changes/<device>/<name>` paths, grouped by device. Other paths are ignored. */
function changeFilesByDevice(relativePaths: string[]): Map<string, ChangeFile[]> {
  const devices = new Map<string, ChangeFile[]>()
  for (const relativePath of relativePaths) {
    const segments = relativePath.split('/')
    if (segments.length !== 3 || segments[0] !== 'changes') continue
    const sequence = sequenceOf(segments[2])
    if (sequence === null) continue
    const deviceId = segments[1]
    const files = devices.get(deviceId) ?? []
    files.push({ deviceId, sequence, path: relativePath })
    devices.set(deviceId, files)
  }
  return devices
}
