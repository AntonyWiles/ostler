/**
 * "Is this Bob?" (docs/plans/people-and-devices/overview.md, D12, section 3).
 *
 * A member's Me person can have the same name as a person this PC added before
 * the member joined (the owner assigned work to "Bob" first). Two Bobs would
 * show in the project, so each PC asks once whether they are the same person.
 * **Yes** merges the added person into the member's person: every shared row
 * that names the added one is rewritten to name the member's, and the added
 * person is archived when nothing names it any more. The rewrites are ordinary
 * captured changes, so every other PC follows them. **No** is kept, so the
 * question is never asked again for that pair.
 */
import type Database from 'better-sqlite3'
import { quote, tableShape } from '../change-history/table-shape'
import { PERSON_COLUMN, rowPersonIds } from './records'
import { SYNCED_TABLES } from './synced-tables'

/** Refused: the project is not shared here, or the pair is not a current candidate. */
export class PersonLinkError extends Error {
  constructor(readonly reason: 'not-shared' | 'not-a-candidate') {
    super(`Person link refused: ${reason}`)
    this.name = 'PersonLinkError'
  }
}

export interface PersonLinkCandidate {
  /** The member's person key (public, not secret). */
  personKey: string
  memberName: string
  candidatePersonId: string
  candidateName: string
}

/** A candidate with the member's person id, which a Yes merges into. */
interface Lookalike extends PersonLinkCandidate {
  memberPersonId: string
}

interface MemberMeRow {
  person_key: string
  person_id: string | null
  me: string
}

/** Names compare with spaces trimmed and collapsed, and without case. */
export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** The people this PC could merge with the members of a shared project, not yet answered. */
export function unlinkedLookalikes(
  db: Database.Database,
  projectId: string
): PersonLinkCandidate[] {
  return lookalikes(db, projectId).map(
    ({ personKey, memberName, candidatePersonId, candidateName }) => ({
      personKey,
      memberName,
      candidatePersonId,
      candidateName
    })
  )
}

function lookalikes(db: Database.Database, projectId: string): Lookalike[] {
  const share = db
    .prepare('SELECT share_id FROM sync_shares WHERE project_id = @projectId')
    .get({ projectId }) as { share_id: string } | undefined
  if (!share) return []

  const members = db
    .prepare(
      `SELECT COALESCE(person_public_key, public_key) AS person_key, person_id, me
       FROM sync_members WHERE share_id = @shareId AND removed_at IS NULL AND me IS NOT NULL
       ORDER BY joined_at`
    )
    .all({ shareId: share.share_id }) as MemberMeRow[]
  const memberPersonIds = new Set(
    (
      db
        .prepare(
          'SELECT DISTINCT person_id FROM sync_members WHERE share_id = @shareId AND person_id IS NOT NULL'
        )
        .all({ shareId: share.share_id }) as { person_id: string }[]
    ).map((row) => row.person_id)
  )
  const answered = new Set(
    (
      db
        .prepare(
          `SELECT person_public_key, candidate_person_id FROM sync_person_link_answers
           WHERE share_id = @shareId`
        )
        .all({ shareId: share.share_id }) as {
        person_public_key: string
        candidate_person_id: string
      }[]
    ).map((row) => `${row.person_public_key}\u0000${row.candidate_person_id}`)
  )
  const named = [...rowPersonIds(db, projectId)]
  const readPerson = db.prepare('SELECT id, name, is_me, archived_at FROM people WHERE id = @id')

  // The candidates are the named people, read once.
  const candidates = named
    .map(
      (id) =>
        readPerson.get({ id }) as
          { id: string; name: string; is_me: number; archived_at: number | null } | undefined
    )
    .filter(
      (person): person is { id: string; name: string; is_me: number; archived_at: number | null } =>
        person !== undefined && person.is_me === 0 && person.archived_at === null
    )

  const found: Lookalike[] = []
  const seen = new Set<string>()
  for (const member of members) {
    const me = parseMe(member.me)
    if (!me || !member.person_key) continue
    if (seen.has(`${member.person_key}\u0000${me.personId}`)) continue
    seen.add(`${member.person_key}\u0000${me.personId}`)
    for (const candidate of candidates) {
      if (candidate.id === me.personId || memberPersonIds.has(candidate.id)) continue
      if (answered.has(`${member.person_key}\u0000${candidate.id}`)) continue
      if (normalizeName(candidate.name) !== normalizeName(me.name)) continue
      found.push({
        personKey: member.person_key,
        memberName: me.name,
        memberPersonId: me.personId,
        candidatePersonId: candidate.id,
        candidateName: candidate.name
      })
    }
  }
  return found
}

/**
 * Records the owner's answer to one candidate. Yes merges the candidate into
 * the member's person, in one transaction; No only remembers the answer.
 * Refuses a pair that is not a current candidate, so an answer cannot merge
 * anything the owner was not asked about.
 */
export function answerPersonLink(
  db: Database.Database,
  projectId: string,
  personKey: string,
  candidatePersonId: string,
  answer: 'yes' | 'no'
): void {
  const share = db
    .prepare('SELECT share_id FROM sync_shares WHERE project_id = @projectId')
    .get({ projectId }) as { share_id: string } | undefined
  if (!share) throw new PersonLinkError('not-shared')
  const match = lookalikes(db, projectId).find(
    (candidate) =>
      candidate.personKey === personKey && candidate.candidatePersonId === candidatePersonId
  )
  if (!match) throw new PersonLinkError('not-a-candidate')
  const shareId = share.share_id
  db.transaction(() => {
    if (answer === 'yes') mergePersonInto(db, projectId, candidatePersonId, match.memberPersonId)
    db.prepare(
      `INSERT INTO sync_person_link_answers (share_id, person_public_key, candidate_person_id, answer, answered_at)
       VALUES (@shareId, @personKey, @candidatePersonId, @answer, @now)`
    ).run({ shareId, personKey, candidatePersonId, answer, now: Date.now() })
  })()
}

/**
 * Rewrites every shared row that names `fromPersonId` in `projectId` to name
 * `toPersonId`, then archives `fromPersonId` if no synced row names it any more.
 * Runs outside `withSyncApplying`, so the rewrites are captured and sent.
 */
export function mergePersonInto(
  db: Database.Database,
  projectId: string,
  fromPersonId: string,
  toPersonId: string
): void {
  db.transaction(() => {
    for (const [table, entry] of Object.entries(SYNCED_TABLES)) {
      const shape = tableShape(db, table)
      if (!shape) continue
      const scope =
        'column' in entry.project
          ? `${quote(entry.project.column)} = @projectId`
          : `${quote(entry.project.via.column)} IN (SELECT id FROM ${quote(entry.project.via.table)} WHERE project_id = @projectId)`
      for (const column of shape.columns.filter((name) => PERSON_COLUMN.test(name))) {
        db.prepare(
          `UPDATE ${quote(table)} SET ${quote(column)} = @toPersonId
           WHERE ${quote(column)} = @fromPersonId AND ${scope}`
        ).run({ projectId, fromPersonId, toPersonId })
      }
    }
    if (!namesAnywhere(db, fromPersonId)) {
      db.prepare(
        `UPDATE people SET archived_at = @now, updated_at = @now
         WHERE id = @id AND is_me = 0 AND archived_at IS NULL`
      ).run({ id: fromPersonId, now: Date.now() })
    }
  })()
}

/** Whether any synced row in any project still names this person. */
function namesAnywhere(db: Database.Database, personId: string): boolean {
  for (const table of Object.keys(SYNCED_TABLES)) {
    const shape = tableShape(db, table)
    if (!shape) continue
    for (const column of shape.columns.filter((name) => PERSON_COLUMN.test(name))) {
      const row = db
        .prepare(`SELECT 1 FROM ${quote(table)} WHERE ${quote(column)} = @personId LIMIT 1`)
        .get({ personId })
      if (row) return true
    }
  }
  return false
}

function parseMe(text: string): { personId: string; name: string } | null {
  try {
    const me = JSON.parse(text) as Record<string, unknown>
    return typeof me.personId === 'string' && typeof me.name === 'string'
      ? { personId: me.personId, name: me.name }
      : null
  } catch {
    return null
  }
}
