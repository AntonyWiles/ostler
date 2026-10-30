import Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import {
  MAX_TEAM_NAME,
  type CreateTeamInput,
  type Team,
  type UpdateTeamInput
} from '@shared/ostler-api'
import { isHexColor, paletteColorFor } from '@shared/project-colors'
import { attachChangeRecorder } from './change-history/recorder'

interface TeamRow {
  id: string
  name: string
  color: string
  lead_person_id: string | null
  position: number
  archived_at: number | null
}

/**
 * Teams (team-leaders plan, D1): named groups of people from the address book. A team is the
 * leader's own organiser: it grants nothing, so no permission check reads it. Every surface
 * (IPC, the automation API) goes through here, so the rules are the same everywhere: a name is
 * required, a colour comes from the project palette unless chosen, and only people in the
 * address book (Me included) can be members or lead, because a project's own people stay with
 * their project and would not exist on the person's other devices. Deleting a person takes
 * them out of every team and clears a team they led (foreign keys).
 */
export class TeamService {
  private readonly db: Database.Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    attachChangeRecorder(this.db)
  }

  close(): void {
    this.db.close()
  }

  list(options: { includeArchived?: boolean } = {}): Team[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, color, lead_person_id, position, archived_at FROM teams
         ${options.includeArchived ? '' : 'WHERE archived_at IS NULL'}
         ORDER BY position, created_at, id`
      )
      .all() as TeamRow[]
    const members = this.db
      .prepare('SELECT team_id, person_id FROM team_members ORDER BY rowid')
      .all() as { team_id: string; person_id: string }[]
    const byTeam = new Map<string, string[]>()
    for (const member of members) {
      byTeam.set(member.team_id, [...(byTeam.get(member.team_id) ?? []), member.person_id])
    }
    return rows.map((row) => toTeam(row, byTeam.get(row.id) ?? []))
  }

  get(id: string): Team {
    const team = this.list({ includeArchived: true }).find((entry) => entry.id === id)
    if (!team) throw new Error('Team not found')
    return team
  }

  create(input: CreateTeamInput): Team {
    const id = uuidv4()
    const now = Date.now()
    const name = this.name(input?.name)
    const color = input?.color === undefined ? paletteColorFor(id) : this.color(input.color)
    const leadPersonId = this.person(input?.leadPersonId ?? null)
    const memberIds = this.members(input?.memberIds ?? [])
    const position =
      (this.db.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM teams').get() as { p: number })
        .p + 1
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO teams (id, name, color, lead_person_id, position, created_at, updated_at, archived_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`
        )
        .run(id, name, color, leadPersonId, position, now, now)
      this.writeMembers(id, memberIds)
    })()
    return this.get(id)
  }

  update(id: string, updates: UpdateTeamInput): Team {
    this.require(id)
    const sets: string[] = []
    const values: unknown[] = []
    if (updates?.name !== undefined) {
      sets.push('name = ?')
      values.push(this.name(updates.name))
    }
    if (updates?.color !== undefined) {
      sets.push('color = ?')
      values.push(this.color(updates.color))
    }
    if (updates?.leadPersonId !== undefined) {
      sets.push('lead_person_id = ?')
      values.push(this.person(updates.leadPersonId))
    }
    if (sets.length > 0) {
      this.db
        .prepare(`UPDATE teams SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`)
        .run(...values, Date.now(), id)
    }
    return this.get(id)
  }

  /** Makes exactly these people the team's members. */
  setMembers(id: string, personIds: string[]): Team {
    this.require(id)
    const memberIds = this.members(personIds)
    this.db.transaction(() => {
      this.writeMembers(id, memberIds)
      this.db.prepare('UPDATE teams SET updated_at = ? WHERE id = ?').run(Date.now(), id)
    })()
    return this.get(id)
  }

  archive(id: string): Team {
    this.require(id)
    const now = Date.now()
    this.db
      .prepare(
        'UPDATE teams SET archived_at = COALESCE(archived_at, ?), updated_at = ? WHERE id = ?'
      )
      .run(now, now, id)
    return this.get(id)
  }

  restore(id: string): Team {
    this.require(id)
    this.db
      .prepare('UPDATE teams SET archived_at = NULL, updated_at = ? WHERE id = ?')
      .run(Date.now(), id)
    return this.get(id)
  }

  delete(id: string): void {
    this.require(id)
    this.db.prepare('DELETE FROM teams WHERE id = ?').run(id)
  }

  /** Changes only the rows that differ, so a save that changes nothing records nothing. */
  private writeMembers(teamId: string, personIds: string[]): void {
    const current = (
      this.db.prepare('SELECT person_id FROM team_members WHERE team_id = ?').all(teamId) as {
        person_id: string
      }[]
    ).map((row) => row.person_id)
    const wanted = new Set(personIds)
    for (const personId of current) {
      if (!wanted.has(personId))
        this.db
          .prepare('DELETE FROM team_members WHERE team_id = ? AND person_id = ?')
          .run(teamId, personId)
    }
    const have = new Set(current)
    for (const personId of personIds) {
      if (!have.has(personId))
        this.db
          .prepare('INSERT INTO team_members (team_id, person_id) VALUES (?, ?)')
          .run(teamId, personId)
    }
  }

  private require(id: string): void {
    if (
      typeof id !== 'string' ||
      this.db.prepare('SELECT 1 FROM teams WHERE id = ?').get(id) === undefined
    )
      throw new Error('Team not found')
  }

  private name(value: unknown): string {
    const name = typeof value === 'string' ? value.trim() : ''
    if (!name) throw new Error('Team name is required')
    if (name.length > MAX_TEAM_NAME)
      throw new Error(`Team name must be at most ${MAX_TEAM_NAME} characters`)
    return name
  }

  private color(value: unknown): string {
    if (typeof value !== 'string' || !isHexColor(value))
      throw new Error('Team colour must be a #rrggbb colour')
    return value
  }

  /** A person who is in the address book, or null. */
  private person(value: unknown): string | null {
    if (value === null) return null
    if (typeof value !== 'string' || !this.inAddressBook(value))
      throw new Error('Person not found in the address book')
    return value
  }

  private members(value: unknown): string[] {
    if (!Array.isArray(value)) throw new Error('Members must be a list of people')
    const ids: string[] = []
    for (const personId of value) {
      if (typeof personId !== 'string' || !this.inAddressBook(personId))
        throw new Error('Person not found in the address book')
      if (!ids.includes(personId)) ids.push(personId)
    }
    return ids
  }

  private inAddressBook(id: string): boolean {
    const row = this.db.prepare('SELECT project_id FROM people WHERE id = ?').get(id) as
      { project_id: string | null } | undefined
    return row !== undefined && row.project_id === null
  }
}

function toTeam(row: TeamRow, memberIds: string[]): Team {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    leadPersonId: row.lead_person_id,
    memberIds,
    position: row.position,
    archivedAt: row.archived_at
  }
}
