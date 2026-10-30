import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import type { ActivityActor, ActorKind, PlanningActor } from '@shared/ostler-api'
import {
  parseStatusUpdateInput,
  type StatusUpdate,
  type StatusUpdateAuthorKind,
  type StatusUpdateHealth
} from '@shared/status-updates'
import { Refusal } from '@shared/refusal'

interface StatusUpdateRow {
  id: string
  project_id: string
  health: StatusUpdateHealth
  note: string
  author_kind: StatusUpdateAuthorKind
  author_person_id: string | null
  posted_at: number
  edited_at: number | null
  deleted_at: number | null
}

/** A status update as stored, for undo and the project file: no display names. */
export type StoredStatusUpdate = Omit<StatusUpdate, 'authorName'>

/**
 * Status updates (N5.5, N40). The desktop app and the automation API both
 * write through here, so the activity feed (which reads this table), Home,
 * the Inbox's reminder and the project file all see the same updates. A
 * person posts as `human` (Me); the automation API as `automation`.
 */
export class StatusUpdateService {
  constructor(
    private readonly db: Database.Database,
    private readonly getProjectIds: () => string[],
    private readonly nameActor: (kind: ActorKind, personId: string | null) => ActivityActor,
    private readonly changed: (projectId: string) => void = () => {},
    private readonly now: () => number = Date.now,
    /** After a post, from any surface: the project tells its team (integrations phase 4). */
    private readonly posted: (update: StatusUpdate) => void = () => {}
  ) {}

  /** Every live update of a project, newest first: the diary. */
  list(projectId: string): StatusUpdate[] {
    this.requireProject(projectId)
    const rows = this.db
      .prepare(
        `SELECT * FROM status_updates WHERE project_id = ? AND deleted_at IS NULL
         ORDER BY posted_at DESC, rowid DESC`
      )
      .all(projectId) as StatusUpdateRow[]
    return rows.map((row) => this.toUpdate(row))
  }

  /** A project's latest update, or null. */
  latest(projectId: string): StatusUpdate | null {
    return this.latestFor([projectId])[projectId] ?? null
  }

  /** The latest update of each project that has one, in one query (Home's cards). */
  latestFor(projectIds: string[]): Record<string, StatusUpdate> {
    const known = new Set(this.getProjectIds())
    const ids = projectIds.filter((id) => known.has(id))
    if (ids.length === 0) return {}
    const rows = this.db
      .prepare(
        `SELECT * FROM status_updates update_row
         WHERE deleted_at IS NULL AND project_id IN (SELECT value FROM json_each(?))
           AND id = (SELECT id FROM status_updates other
                     WHERE other.project_id = update_row.project_id AND other.deleted_at IS NULL
                     ORDER BY other.posted_at DESC, other.rowid DESC LIMIT 1)`
      )
      .all(JSON.stringify(ids)) as StatusUpdateRow[]
    return Object.fromEntries(rows.map((row) => [row.project_id, this.toUpdate(row)]))
  }

  /** When each project last had an update posted, for the reminder (live updates only). */
  latestPostedAt(projectIds: string[]): Map<string, number> {
    if (projectIds.length === 0) return new Map()
    const rows = this.db
      .prepare(
        `SELECT project_id, MAX(posted_at) AS at FROM status_updates
         WHERE deleted_at IS NULL AND project_id IN (SELECT value FROM json_each(?))
         GROUP BY project_id`
      )
      .all(JSON.stringify(projectIds)) as { project_id: string; at: number }[]
    return new Map(rows.map((row) => [row.project_id, row.at]))
  }

  get(updateId: unknown): StatusUpdate {
    return this.toUpdate(this.row(updateId))
  }

  /** Posts an update. The note is trimmed and at most 2,000 characters. */
  post(projectId: string, input: unknown, actor: PlanningActor): StatusUpdate {
    this.requireProject(projectId)
    const { health, note } = this.parse(input)
    const author = authorOf(actor)
    const id = uuidv4()
    this.db
      .prepare(
        `INSERT INTO status_updates
           (id, project_id, health, note, author_kind, author_person_id, posted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, projectId, health, note, author.kind, author.personId, this.now())
    this.changed(projectId)
    const update = this.get(id)
    try {
      this.posted(update)
    } catch (error) {
      console.error('Status update listener failed:', error)
    }
    return update
  }

  /** Changes an update's health and note; it keeps its author and time. */
  edit(updateId: unknown, input: unknown): { before: StatusUpdate; after: StatusUpdate } {
    const row = this.row(updateId)
    const { health, note } = this.parse(input)
    const before = this.toUpdate(row)
    this.db
      .prepare('UPDATE status_updates SET health = ?, note = ?, edited_at = ? WHERE id = ?')
      .run(health, note, this.now(), row.id)
    this.changed(row.project_id)
    return { before, after: this.get(row.id) }
  }

  /** Deletes an update; `restore` brings it back (Undo). */
  delete(updateId: unknown): StatusUpdate {
    const row = this.row(updateId)
    this.db.prepare('UPDATE status_updates SET deleted_at = ? WHERE id = ?').run(this.now(), row.id)
    this.changed(row.project_id)
    return this.toUpdate(row)
  }

  restore(updateId: unknown): StatusUpdate {
    const row = this.row(updateId, true)
    this.db.prepare('UPDATE status_updates SET deleted_at = NULL WHERE id = ?').run(row.id)
    this.changed(row.project_id)
    return this.get(row.id)
  }

  /** Puts an edit back as it was (Undo of an edit). */
  revert(updateId: unknown, before: unknown): StatusUpdate {
    const row = this.row(updateId)
    const previous = (before && typeof before === 'object' ? before : {}) as Record<string, unknown>
    const { health, note } = this.parse(previous)
    const editedAt = typeof previous.editedAt === 'number' ? previous.editedAt : null
    this.db
      .prepare('UPDATE status_updates SET health = ?, note = ?, edited_at = ? WHERE id = ?')
      .run(health, note, editedAt, row.id)
    this.changed(row.project_id)
    return this.get(row.id)
  }

  /** A project's live updates as stored, oldest first, for the project file. */
  stored(projectId: string): StoredStatusUpdate[] {
    return this.list(projectId)
      .reverse()
      .map(({ authorName: _name, ...rest }) => rest)
  }

  /** Writes updates from a project file into a new project, keeping their times. */
  importUpdates(
    projectId: string,
    updates: Array<{
      health: StatusUpdateHealth
      note: string
      authorKind: StatusUpdateAuthorKind
      authorPersonId: string | null
      postedAt: number
      editedAt: number | null
    }>
  ): void {
    const insert = this.db.prepare(
      `INSERT INTO status_updates
         (id, project_id, health, note, author_kind, author_person_id, posted_at, edited_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const update of updates) {
      insert.run(
        uuidv4(),
        projectId,
        update.health,
        update.note,
        update.authorKind,
        update.authorPersonId,
        update.postedAt,
        update.editedAt
      )
    }
  }

  private parse(input: unknown) {
    try {
      return parseStatusUpdateInput(input)
    } catch (error) {
      throw new Refusal(error instanceof Error ? error.message : String(error))
    }
  }

  private requireProject(projectId: unknown): string {
    if (typeof projectId !== 'string' || !this.getProjectIds().includes(projectId)) {
      throw new Refusal('Project not found')
    }
    return projectId
  }

  private row(updateId: unknown, deleted = false): StatusUpdateRow {
    if (typeof updateId !== 'string') throw new Refusal('Status update not found')
    const row = this.db.prepare('SELECT * FROM status_updates WHERE id = ?').get(updateId) as
      StatusUpdateRow | undefined
    if (
      !row ||
      (deleted ? row.deleted_at === null : row.deleted_at !== null) ||
      !this.getProjectIds().includes(row.project_id)
    ) {
      throw new Refusal('Status update not found')
    }
    return row
  }

  private toUpdate(row: StatusUpdateRow): StatusUpdate {
    return {
      id: row.id,
      projectId: row.project_id,
      health: row.health,
      note: row.note,
      authorKind: row.author_kind,
      authorPersonId: row.author_person_id,
      authorName: this.nameActor(row.author_kind, row.author_person_id).name,
      postedAt: row.posted_at,
      editedAt: row.edited_at
    }
  }
}

/** Updates are posted by a person or the automation API; any other actor is refused. */
function authorOf(actor: PlanningActor): { kind: StatusUpdateAuthorKind; personId: string | null } {
  if (actor.kind === 'human') return { kind: 'human', personId: actor.personId ?? null }
  if (actor.kind === 'automation') return { kind: 'automation', personId: null }
  throw new Refusal('Only a person or the automation API posts status updates')
}
