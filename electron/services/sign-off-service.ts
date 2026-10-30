import Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import type {
  RequestSignOffInput,
  SignOff,
  SignOffItem,
  SignOffKind,
  SignOffState
} from '@shared/ostler-api'
import { t } from '@shared/i18n'
import { Refusal } from '@shared/refusal'
import { capabilitiesOf } from '@shared/share-roles'
import { attachChangeRecorder } from './change-history/recorder'
import { myRoleOf } from './sync/roles'

interface SignOffRow {
  id: string
  project_id: string
  item_kind: SignOffKind
  item_id: string
  approver_person_id: string
  requested_by_person_id: string | null
  state: SignOffState
  note: string
  requested_at: number
  answered_at: number | null
  updated_at: number
}

const MAX_NOTE = 2000

export interface SignOffDependencies {
  /** The projects that are on in this app; sign-offs of others are not listed. */
  projectIds: () => string[]
  /** Takes a finished task out of Done (a task sent back). */
  reopenTask?: (taskId: string) => void
  /** Clears a milestone's completion (a milestone sent back). */
  reopenMilestone?: (milestoneId: string) => void
  now?: () => number
}

/**
 * Sign-offs (team-leaders plan, D9): human approval of a task, decision or milestone. Only the
 * named approver answers one, whatever their role in the project; the check runs here on the
 * answering PC, in the database guard on a Viewer's or Contributor's PC, and again on every
 * receiving PC (sync-runner.ts). Answering grants no other edit: sending an item back moves it
 * out of Done only when Me may edit it anyway.
 */
export class SignOffService {
  private readonly db: Database.Database
  private readonly now: () => number

  constructor(
    dbPath: string,
    private readonly deps: SignOffDependencies
  ) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    attachChangeRecorder(this.db)
    this.now = deps.now ?? Date.now
  }

  close(): void {
    this.db.close()
  }

  forItem(item: SignOffItem): SignOff[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM planning_sign_offs WHERE item_kind = ? AND item_id = ?
           ORDER BY requested_at DESC, id`
        )
        .all(item.kind, item.id) as SignOffRow[]
    ).map(toSignOff)
  }

  forProject(projectId: string): SignOff[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM planning_sign_offs WHERE project_id = ? ORDER BY requested_at DESC, id`
        )
        .all(projectId) as SignOffRow[]
    ).map(toSignOff)
  }

  /** What is waiting for this person, across the projects that are on. */
  waitingFor(personId: string): SignOff[] {
    const projects = new Set(this.deps.projectIds())
    return (
      this.db
        .prepare(
          `SELECT * FROM planning_sign_offs WHERE approver_person_id = ? AND state = 'waiting'
           ORDER BY requested_at DESC, id`
        )
        .all(personId) as SignOffRow[]
    )
      .filter((row) => projects.has(row.project_id))
      .map(toSignOff)
  }

  waitingForMe(): SignOff[] {
    const me = this.meId()
    return me ? this.waitingFor(me) : []
  }

  request(input: RequestSignOffInput): SignOff {
    const { item, approverPersonId } = input
    const found = this.findItem(item)
    const me = this.meId()
    const role = myRoleOf(this.db, found.projectId)
    const can = capabilitiesOf(role)
    if (!can.requestSignOff) throw new Refusal(t('errors:sharing.readOnly'))
    // A Contributor may ask only for sign-off of a task assigned to them (D5).
    if (role === 'contributor' && !(item.kind === 'task' && me && found.assigneeId === me))
      throw new Refusal(t('errors:sharing.contributorOnly'))
    const approver = this.db
      .prepare('SELECT 1 FROM people WHERE id = ?')
      .get(typeof approverPersonId === 'string' ? approverPersonId : '')
    if (!approver) throw new Refusal(t('errors:signOffs.approverMissing'))
    const open = this.db
      .prepare(
        `SELECT 1 FROM planning_sign_offs
         WHERE item_kind = ? AND item_id = ? AND approver_person_id = ? AND state = 'waiting'`
      )
      .get(item.kind, item.id, approverPersonId)
    if (open) throw new Refusal(t('errors:signOffs.alreadyAsked'))
    const at = this.now()
    const id = uuidv4()
    this.db
      .prepare(
        `INSERT INTO planning_sign_offs
           (id, project_id, item_kind, item_id, approver_person_id, requested_by_person_id,
            state, note, requested_at, answered_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'waiting', '', ?, NULL, ?)`
      )
      .run(id, found.projectId, item.kind, item.id, approverPersonId, me, at, at)
    return this.require(id)
  }

  approve(id: string): SignOff {
    return this.answer(id, 'approved', '')
  }

  sendBack(id: string, note: string): SignOff {
    const text = typeof note === 'string' ? note.trim() : ''
    if (text.length > MAX_NOTE) throw new Refusal(t('errors:signOffs.noteTooLong'))
    const answered = this.answer(id, 'changes', text)
    this.reopen(answered)
    return answered
  }

  /** Withdraws a request that is still waiting: the person who asked, or an Owner. */
  cancel(id: string): void {
    const row = this.requireRow(id)
    if (row.state !== 'waiting') throw new Refusal(t('errors:signOffs.alreadyAnswered'))
    const me = this.meId()
    const role = myRoleOf(this.db, row.project_id)
    const asker = me !== null && row.requested_by_person_id === me
    if (!asker && (role ?? 'owner') !== 'owner')
      throw new Refusal(t('errors:signOffs.notYoursToCancel'))
    this.db.prepare('DELETE FROM planning_sign_offs WHERE id = ?').run(id)
  }

  private answer(id: string, state: 'approved' | 'changes', note: string): SignOff {
    const row = this.requireRow(id)
    const me = this.meId()
    // The approver check is the whole rule: a Viewer or Contributor may answer, no one else may.
    if (me === null || row.approver_person_id !== me)
      throw new Refusal(t('errors:signOffs.notYours'))
    if (!capabilitiesOf(myRoleOf(this.db, row.project_id)).answerSignOffs)
      throw new Refusal(t('errors:sharing.readOnly'))
    if (row.state !== 'waiting') throw new Refusal(t('errors:signOffs.alreadyAnswered'))
    const at = this.now()
    this.db
      .prepare(
        'UPDATE planning_sign_offs SET state = ?, note = ?, answered_at = ?, updated_at = ? WHERE id = ?'
      )
      .run(state, note, at, at, id)
    return this.require(id)
  }

  /** A task sent back leaves Done and a milestone leaves Complete, when Me may edit them anyway. */
  private reopen(signOff: SignOff): void {
    const can = capabilitiesOf(myRoleOf(this.db, signOff.projectId))
    try {
      if (signOff.itemKind === 'task') {
        const task = this.db
          .prepare('SELECT status, assignee_id FROM planning_work_items WHERE id = ?')
          .get(signOff.itemId) as { status: string; assignee_id: string | null } | undefined
        const mine = task?.assignee_id != null && task.assignee_id === this.meId()
        if (task?.status === 'done' && (can.editAnyTask || (can.editOwnTasks && mine)))
          this.deps.reopenTask?.(signOff.itemId)
      } else if (signOff.itemKind === 'milestone') {
        const milestone = this.db
          .prepare('SELECT status FROM planning_milestones WHERE id = ?')
          .get(signOff.itemId) as { status: string } | undefined
        if (milestone?.status === 'complete' && can.editAnyTask)
          this.deps.reopenMilestone?.(signOff.itemId)
      }
    } catch (error) {
      // The answer stands; the item stays as it was.
      console.error('Could not reopen a sent-back item:', error)
    }
  }

  private findItem(item: SignOffItem): { projectId: string; assigneeId: string | null } {
    const table =
      item.kind === 'task'
        ? 'planning_work_items'
        : item.kind === 'milestone'
          ? 'planning_milestones'
          : item.kind === 'decision'
            ? 'planning_decisions'
            : null
    if (!table || typeof item.id !== 'string') throw new Refusal(t('errors:signOffs.itemNotFound'))
    const row = this.db
      .prepare(
        `SELECT project_id${item.kind === 'task' ? ', assignee_id' : ''} FROM ${table} WHERE id = ?`
      )
      .get(item.id) as { project_id: string; assignee_id?: string | null } | undefined
    if (!row) throw new Refusal(t('errors:signOffs.itemNotFound'))
    return { projectId: row.project_id, assigneeId: row.assignee_id ?? null }
  }

  private meId(): string | null {
    const row = this.db.prepare('SELECT id FROM people WHERE is_me = 1').get() as
      { id: string } | undefined
    return row?.id ?? null
  }

  private requireRow(id: string): SignOffRow {
    const row = this.db.prepare('SELECT * FROM planning_sign_offs WHERE id = ?').get(id) as
      SignOffRow | undefined
    if (!row) throw new Refusal(t('errors:signOffs.notFound'))
    return row
  }

  private require(id: string): SignOff {
    return toSignOff(this.requireRow(id))
  }
}

function toSignOff(row: SignOffRow): SignOff {
  return {
    id: row.id,
    projectId: row.project_id,
    itemKind: row.item_kind,
    itemId: row.item_id,
    approverPersonId: row.approver_person_id,
    requestedByPersonId: row.requested_by_person_id,
    state: row.state,
    note: row.note,
    requestedAt: row.requested_at,
    answeredAt: row.answered_at,
    updatedAt: row.updated_at
  }
}
