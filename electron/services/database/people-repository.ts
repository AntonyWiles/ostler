import type Database from 'better-sqlite3'
import type { Person } from '@shared/ostler-api'
import { initialsFromName } from '@shared/people'

interface PersonRow {
  id: string
  name: string
  initials: string
  color: string
  is_me: number
  archived_at: number | null
  weekly_capacity_hours: number | null
  working_days: number
  project_id: string | null
  created_at: number
  updated_at: number
}

/**
 * The `people` table: the address book (`project_id` null) and each project's own
 * people (D5, migration 78). Plain reads and
 * writes; the rules (names, initials, colours, the single Me) are
 * `PeopleService`'s. Stored initials are empty when they follow the name.
 */
export class PeopleRepository {
  constructor(private readonly db: Database.Database) {}

  list(includeArchived: boolean): Person[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM people ${includeArchived ? '' : 'WHERE archived_at IS NULL'}
         ORDER BY is_me DESC, name COLLATE NOCASE`
      )
      .all() as PersonRow[]
    return rows.map(toPerson)
  }

  get(id: string): Person | null {
    const row = this.db.prepare('SELECT * FROM people WHERE id = ?').get(id) as
      PersonRow | undefined
    return row ? toPerson(row) : null
  }

  /** The stored initials, '' when they follow the name. */
  storedInitials(id: string): string {
    const row = this.db.prepare('SELECT initials FROM people WHERE id = ?').get(id) as
      { initials: string } | undefined
    return row?.initials ?? ''
  }

  getMe(): Person | null {
    const row = this.db.prepare('SELECT * FROM people WHERE is_me = 1').get() as
      PersonRow | undefined
    return row ? toPerson(row) : null
  }

  insert(person: {
    id: string
    name: string
    initials: string
    color: string
    isMe: boolean
    weeklyCapacityHours: number | null
    workingDays: number[]
    projectId?: string | null
    at: number
  }): void {
    this.db
      .prepare(
        `INSERT INTO people (id, name, initials, color, is_me, archived_at, weekly_capacity_hours,
           working_days, project_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`
      )
      .run(
        person.id,
        person.name,
        person.initials,
        person.color,
        person.isMe ? 1 : 0,
        person.weeklyCapacityHours,
        workingDaysMask(person.workingDays),
        person.projectId ?? null,
        person.at,
        person.at
      )
  }
  update(
    id: string,
    fields: {
      name: string
      initials: string
      color: string
      weeklyCapacityHours: number | null
      workingDays: number[]
      at: number
    }
  ): void {
    this.db
      .prepare(
        `UPDATE people SET name = ?, initials = ?, color = ?, weekly_capacity_hours = ?,
           working_days = ?, updated_at = ? WHERE id = ?`
      )
      .run(
        fields.name,
        fields.initials,
        fields.color,
        fields.weeklyCapacityHours,
        workingDaysMask(fields.workingDays),
        fields.at,
        id
      )
  }

  setArchivedAt(id: string, archivedAt: number | null, at: number): void {
    this.db
      .prepare('UPDATE people SET archived_at = ?, updated_at = ? WHERE id = ?')
      .run(archivedAt, at, id)
  }

  /** Makes `id` the only Me, in one transaction. */
  setMe(id: string, at: number): void {
    this.db.transaction(() => {
      this.db.prepare('UPDATE people SET is_me = 0, updated_at = ? WHERE is_me = 1').run(at)
      this.db.prepare('UPDATE people SET is_me = 1, updated_at = ? WHERE id = ?').run(at, id)
    })()
  }

  /** How many tasks, live or archived, are assigned to this person. */
  assignmentCount(id: string): number {
    return (
      this.db
        .prepare(
          'SELECT COUNT(*) AS count FROM planning_work_items WHERE assignee_id = ? AND deleted_at IS NULL'
        )
        .get(id) as { count: number }
    ).count
  }
}

function toPerson(row: PersonRow): Person {
  return {
    id: row.id,
    name: row.name,
    initials: row.initials || initialsFromName(row.name),
    color: row.color,
    isMe: row.is_me === 1,
    archivedAt: row.archived_at,
    weeklyCapacityHours: row.weekly_capacity_hours,
    workingDays: workingDaysFromMask(row.working_days),
    projectId: row.project_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/** Stored as a bit mask: Monday is bit 0, Sunday bit 6. */
function workingDaysMask(days: number[]): number {
  return days.reduce((mask, day) => mask | (1 << (day - 1)), 0)
}

function workingDaysFromMask(mask: number): number[] {
  return [1, 2, 3, 4, 5, 6, 7].filter((day) => (mask & (1 << (day - 1))) !== 0)
}
