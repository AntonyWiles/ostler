import type Database from 'better-sqlite3'
import type { DayOff } from '@shared/ostler-api'

interface DayOffRow {
  id: string
  person_id: string | null
  first_date: string
  last_date: string
  name: string
  source_file: string | null
  created_at: number
  updated_at: number
}

function toDayOff(row: DayOffRow): DayOff {
  return {
    id: row.id,
    personId: row.person_id,
    firstDate: row.first_date,
    lastDate: row.last_date,
    name: row.name,
    sourceFile: row.source_file,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/**
 * The `days_off` table (N3.2; global, like people). Plain reads and writes;
 * the rules (names, dates, people, files) are `DaysOffService`'s.
 */
export class DaysOffRepository {
  constructor(private readonly db: Database.Database) {}

  /** Days off overlapping `from` to `to` (either end open), for everyone and, when given, one person. */
  list(query: { from?: string; to?: string; personId?: string }): DayOff[] {
    const where: string[] = []
    const params: unknown[] = []
    if (query.from) {
      where.push('last_date >= ?')
      params.push(query.from)
    }
    if (query.to) {
      where.push('first_date <= ?')
      params.push(query.to)
    }
    if (query.personId) {
      where.push('(person_id IS NULL OR person_id = ?)')
      params.push(query.personId)
    }
    const rows = this.db
      .prepare(
        `SELECT * FROM days_off ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY first_date, last_date, name COLLATE NOCASE, id`
      )
      .all(...params) as DayOffRow[]
    return rows.map(toDayOff)
  }

  get(id: string): DayOff | null {
    const row = this.db.prepare('SELECT * FROM days_off WHERE id = ?').get(id) as
      DayOffRow | undefined
    return row ? toDayOff(row) : null
  }

  insert(day: DayOff): void {
    this.db
      .prepare(
        `INSERT INTO days_off (id, person_id, first_date, last_date, name, source_file, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        day.id,
        day.personId,
        day.firstDate,
        day.lastDate,
        day.name,
        day.sourceFile,
        day.createdAt,
        day.updatedAt
      )
  }

  update(day: DayOff): void {
    this.db
      .prepare(
        `UPDATE days_off SET person_id = ?, first_date = ?, last_date = ?, name = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(day.personId, day.firstDate, day.lastDate, day.name, day.updatedAt, day.id)
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM days_off WHERE id = ?').run(id)
  }

  /**
   * The days off a file brought: one load of it (for everyone, `personId`
   * null, or for one person), or every load of it when `personId` is left out.
   */
  listFromFile(sourceFile: string, personId?: string | null): DayOff[] {
    const rows = (
      personId === undefined
        ? this.db
            .prepare('SELECT * FROM days_off WHERE source_file = ? ORDER BY first_date, id')
            .all(sourceFile)
        : this.db
            .prepare(
              'SELECT * FROM days_off WHERE source_file = ? AND person_id IS ? ORDER BY first_date, id'
            )
            .all(sourceFile, personId)
    ) as DayOffRow[]
    return rows.map(toDayOff)
  }

  /** Removes the days off a file brought: one load of it, or every load when `personId` is left out. */
  deleteFromFile(sourceFile: string, personId?: string | null): void {
    if (personId === undefined)
      this.db.prepare('DELETE FROM days_off WHERE source_file = ?').run(sourceFile)
    else
      this.db
        .prepare('DELETE FROM days_off WHERE source_file = ? AND person_id IS ?')
        .run(sourceFile, personId)
  }
}
