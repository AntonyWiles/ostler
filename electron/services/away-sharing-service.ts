import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import type { SharedAwaySpan, SharedAwayQuery } from '@shared/ostler-api'
import { todayIsoDate } from '@shared/dates'
import { attachSyncCapture } from './sync/capture'

export interface AwaySharingDependencies {
  /** The ids of the projects whose shared away days Workload may read. */
  projectIds(): string[]
  /** Today, `YYYY-MM-DD`; the computer's local date by default. */
  today?(): string
}

/**
 * Shared away days (team-leaders plan, D6). A person chooses, per shared project, to show the
 * people in it only the dates they are away: never the day-off name, and never bank holidays.
 * `away_sharing` (personal, so the choice follows the person) lists the projects; `shared_away`
 * (synced) holds, for each, one row per future day off of Me's. A row's id is made from the
 * day-off id and the project id, so two PCs of one person write the same row and the merge is
 * harmless. `reconcile` is idempotent: it makes the rows match the days off and the choice.
 */
export class AwaySharingService {
  private readonly db: Database.Database

  constructor(
    dbPath: string,
    private readonly deps: AwaySharingDependencies
  ) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    attachSyncCapture(this.db)
  }

  close(): void {
    this.db.close()
  }

  isShared(projectId: string): boolean {
    return (
      this.db.prepare('SELECT 1 FROM away_sharing WHERE project_id = ?').get(projectId) !==
      undefined
    )
  }

  setShared(projectId: string, on: boolean): void {
    if (typeof projectId !== 'string' || !projectId) throw new Error('Project id is required')
    if (on) {
      this.db
        .prepare('INSERT OR IGNORE INTO away_sharing (project_id, shared_at) VALUES (?, ?)')
        .run(projectId, Date.now())
    } else {
      this.db.prepare('DELETE FROM away_sharing WHERE project_id = ?').run(projectId)
    }
    this.reconcile()
  }

  /**
   * Makes `shared_away` hold exactly Me's days off that have not ended, for each project shared
   * with, and none for any other project.
   */
  reconcile(): void {
    const me = this.db.prepare('SELECT id FROM people WHERE is_me = 1').get() as
      { id: string } | undefined
    if (!me) return
    const today = this.deps.today?.() ?? todayIsoDate()
    this.db.transaction(() => {
      const projects = new Set(
        (
          this.db.prepare('SELECT project_id FROM away_sharing').all() as { project_id: string }[]
        ).map((row) => row.project_id)
      )
      const days = this.db
        .prepare(
          'SELECT id, first_date, last_date FROM days_off WHERE person_id = ? AND last_date >= ?'
        )
        .all(me.id, today) as { id: string; first_date: string; last_date: string }[]
      const existing = this.db
        .prepare(
          'SELECT id, project_id, first_date, last_date FROM shared_away WHERE person_id = ?'
        )
        .all(me.id) as { id: string; project_id: string; first_date: string; last_date: string }[]
      const wanted = new Map<string, { projectId: string; firstDate: string; lastDate: string }>()
      for (const projectId of projects) {
        for (const day of days) {
          wanted.set(awayId(day.id, projectId), {
            projectId,
            firstDate: day.first_date,
            lastDate: day.last_date
          })
        }
      }
      const remove = this.db.prepare('DELETE FROM shared_away WHERE id = ?')
      const have = new Map(existing.map((row) => [row.id, row]))
      for (const row of existing) if (!wanted.has(row.id)) remove.run(row.id)
      const insert = this.db.prepare(
        `INSERT INTO shared_away (id, project_id, person_id, first_date, last_date, updated_at)
         VALUES (@id, @projectId, @personId, @firstDate, @lastDate, @now)`
      )
      const update = this.db.prepare(
        'UPDATE shared_away SET first_date = @firstDate, last_date = @lastDate, updated_at = @now WHERE id = @id'
      )
      const now = Date.now()
      for (const [id, row] of wanted) {
        const current = have.get(id)
        if (!current) insert.run({ id, personId: me.id, now, ...row })
        else if (current.first_date !== row.firstDate || current.last_date !== row.lastDate)
          update.run({ id, now, firstDate: row.firstDate, lastDate: row.lastDate })
      }
    })()
  }

  /** Other people's shared away days that touch the range, across the given projects. */
  listOthers(query: SharedAwayQuery): SharedAwaySpan[] {
    const projectIds = this.deps.projectIds()
    if (projectIds.length === 0) return []
    const me = this.db.prepare('SELECT id FROM people WHERE is_me = 1').get() as
      { id: string } | undefined
    const marks = projectIds.map(() => '?').join(',')
    const rows = this.db
      .prepare(
        `SELECT DISTINCT person_id, first_date, last_date FROM shared_away
         WHERE project_id IN (${marks}) AND person_id IS NOT ? AND last_date >= ? AND first_date <= ?
         ORDER BY first_date, last_date, person_id`
      )
      .all(...projectIds, me?.id ?? null, query.from, query.through) as {
      person_id: string
      first_date: string
      last_date: string
    }[]
    return rows.map((row) => ({
      personId: row.person_id,
      firstDate: row.first_date,
      lastDate: row.last_date
    }))
  }
}

/** The id of a day off's row for one project: the same on every PC of the person, as a UUID. */
export function awayId(dayOffId: string, projectId: string): string {
  const hex = createHash('sha256')
    .update(`ostler-shared-away:${dayOffId}:${projectId}`)
    .digest('hex')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `8${hex.slice(13, 16)}`,
    ((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16) + hex.slice(18, 20),
    hex.slice(20, 32)
  ].join('-')
}
