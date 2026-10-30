/**
 * What a shared project sends besides its rows (docs/plans/integrations/shared-folder-sync.md, S10c):
 *
 * - **People** its tasks and their records name (decision 3). People belong to
 *   no project, so their rows are not captured; instead each named person is
 *   written as `people/<person id>/<stamp>.ostlerperson` whenever their name,
 *   initials, colour or archive state differs from what was last sent or
 *   received. Who is Me is never sent.
 * - **The project's own settings** (name, colour, notes, tags, task prefix;
 *   never its folder), which live in the config store, as
 *   `project/<stamp>.ostlerproject` whenever they change.
 *
 * Every file is a sealed envelope (envelope.ts), written once. The newest stamp
 * wins; `sync_records` keeps the newest seen and a hash of its content.
 */
import { createHash } from './platform'
import type Database from 'better-sqlite3'
import { compareStamps } from '@shared/sync/clock'
import { quote, tableShape } from '../change-history/table-shape'
import { localStamp, observeRemoteStamp, withSyncApplying } from './capture'
import {
  openEnvelope,
  sealEnvelope,
  type EnvelopeKind,
  type SyncFileRefusal,
  type SealKeys,
  type KeySource
} from './envelope'
import { SyncTransportError } from './transport-paths'
import type { SyncTransport } from './folder-transport'
import { isSnapshotProject, type SnapshotProject } from './snapshot-file'
import { roleOf } from './roles'
import { senderOf } from './sync-runner'
import { SYNCED_TABLES } from './synced-tables'

export interface SharedPerson {
  name: string
  initials: string
  color: string
  archivedAt: number | null
}

export interface RecordProblem {
  path: string
  reason: SyncFileRefusal | 'unreadable' | 'mismatch' | 'not-allowed'
}

export interface RecordsResult {
  people: number
  project: SnapshotProject | null
  problems: RecordProblem[]
}

/** Person columns in the synced tables: every one that names a person. */
export const PERSON_COLUMN = /^(assignee_id|.*person_id)$/
const STAMP = '\\d{15}-\\d{6}-\\S+'
const PERSON_FILE = new RegExp(`^people/([A-Za-z0-9-]+)/(${STAMP})\\.ostlerperson$`)
const PROJECT_FILE = new RegExp(`^project/(${STAMP})\\.ostlerproject$`)

class RecordFileError extends Error {
  constructor(readonly reason: SyncFileRefusal) {
    super(`Sync record refused: ${reason}`)
  }
}

const RECORD_FILE: EnvelopeKind = {
  magic: Buffer.from('OSTLERRC', 'ascii'),
  version: 1,
  maxBytes: 1024 * 1024,
  refuse: (reason) => {
    throw new RecordFileError(reason)
  }
}

interface ShareRow {
  share_id: string
  member_id: string
  device_id: string
  kind: string
  my_role: string
}

/** Writes every named person and the project's settings that changed since they were last sent. */
export async function pushRecords(
  db: Database.Database,
  transport: SyncTransport,
  projectId: string,
  keys: SealKeys,
  project: SnapshotProject | null
): Promise<number> {
  const share = shareOf(db, projectId)
  let written = 0
  for (const person of namedPeople(db, projectId)) {
    const { id, ...content } = person
    if (
      await writeRecord(db, transport, share, keys, 'person', id, content, (stamp) => {
        return `people/${id}/${stamp}.ostlerperson`
      })
    ) {
      written++
    }
  }
  // A Viewer can't change the project's settings (D1): its PC sends none, and the others would refuse them.
  if (
    project &&
    mayChangeSettings(share) &&
    (await writeRecord(db, transport, share, keys, 'project', projectId, project, (stamp) => {
      return `project/${stamp}.ostlerproject`
    }))
  ) {
    written++
  }
  return written
}

/**
 * Reads the newest file of every person and of the project's settings. People
 * are written here at once; the project's settings are returned for the caller
 * to put in the config store, or null when nothing newer arrived.
 */
export async function pullRecords(
  db: Database.Database,
  transport: SyncTransport,
  projectId: string,
  keys: { projectKey: KeySource }
): Promise<RecordsResult> {
  const share = shareOf(db, projectId)
  const result: RecordsResult = { people: 0, project: null, problems: [] }

  const newest = new Map<string, { stamp: string; path: string }>()
  for (const relativePath of await transport.list('people')) {
    const match = PERSON_FILE.exec(relativePath)
    if (!match) continue
    const current = newest.get(match[1])
    if (!current || match[2] > current.stamp)
      newest.set(match[1], { stamp: match[2], path: relativePath })
  }
  for (const [personId, file] of newest) {
    if (!isNewer(db, share, 'person', personId, file.stamp)) continue
    const content = await readRecord(db, transport, share, keys, file.path, result.problems)
    if (!content || content.recordId !== personId || !isPerson(content.payload)) continue
    // Remembered either way: a file the person's row already beats is not read again.
    if (writePerson(db, projectId, personId, content.payload, file.stamp)) result.people++
    remember(db, share, 'person', personId, file.stamp, hashOf(content.payload))
  }

  // The newest settings from someone who may change them (an Owner or an Editor, D1). A newer
  // file from a Viewer is left out and reported, and the one before it counts.
  const projectFiles = (await transport.list('project'))
    .map((relativePath) => ({ path: relativePath, stamp: PROJECT_FILE.exec(relativePath)?.[1] }))
    .filter((file): file is { path: string; stamp: string } => file.stamp !== undefined)
    .filter((file) => isNewer(db, share, 'project', projectId, file.stamp))
    .sort((a, b) => (a.stamp < b.stamp ? 1 : -1))
  let refusedNewest = false
  for (const [index, file] of projectFiles.entries()) {
    const content = await readRecord(db, transport, share, keys, file.path, result.problems)
    if (!content || content.recordId !== projectId || !isProject(content.payload)) continue
    if (!writerMayChangeSettings(db, share, content.memberId)) {
      result.problems.push({ path: file.path, reason: 'not-allowed' })
      if (index === 0) refusedNewest = true
      continue
    }
    remember(db, share, 'project', projectId, file.stamp, hashOf(content.payload))
    result.project = content.payload
    break
  }
  // Said once: the refused file counts as seen, with what this PC holds now, so the next pull
  // doesn't report it again.
  if (refusedNewest) {
    const held = db
      .prepare(
        "SELECT hash FROM sync_records WHERE share_id = @shareId AND kind = 'project' AND record_id = @projectId"
      )
      .get({ shareId: share.share_id, projectId }) as { hash: string } | undefined
    const hash = result.project ? hashOf(result.project) : (held?.hash ?? '')
    remember(db, share, 'project', projectId, projectFiles[0].stamp, hash)
  }
  return result
}

/** Whether this PC may change the project's shared settings: anyone in a personal share, else an Owner or Editor (a Contributor is treated as a Viewer here, D5). */
function mayChangeSettings(share: ShareRow): boolean {
  return (
    share.kind === 'personal' || (share.my_role !== 'viewer' && share.my_role !== 'contributor')
  )
}

/** Whether the member who wrote a settings file may change them, as this PC knows their role now. */
function writerMayChangeSettings(
  db: Database.Database,
  share: ShareRow,
  memberId: string
): boolean {
  if (share.kind === 'personal') return true
  const sender = senderOf(db, share.share_id, memberId)
  const role = sender === null ? null : roleOf(db, share.share_id, sender.personKey)
  return role !== null && role !== 'viewer' && role !== 'contributor'
}

/** The ids of the people the project's shared rows name (tasks, milestones and so on). */
export function rowPersonIds(db: Database.Database, projectId: string): Set<string> {
  const ids = new Set<string>()
  for (const [table, entry] of Object.entries(SYNCED_TABLES)) {
    if (!('column' in entry.project)) continue
    const shape = tableShape(db, table)
    if (!shape) continue
    for (const column of shape.columns.filter((name) => PERSON_COLUMN.test(name))) {
      const rows = db
        .prepare(
          `SELECT DISTINCT ${quote(column)} AS id FROM ${quote(table)}
           WHERE ${quote(entry.project.column)} = @projectId AND ${quote(column)} IS NOT NULL`
        )
        .all({ projectId }) as { id: unknown }[]
      for (const row of rows) if (typeof row.id === 'string') ids.add(row.id)
    }
  }
  return ids
}

/**
 * The people the project's shared rows name, plus each member's own person
 * (their Me card, D12), with what is shared of each.
 */
function namedPeople(db: Database.Database, projectId: string): (SharedPerson & { id: string })[] {
  const ids = rowPersonIds(db, projectId)
  // A member's person from their Me card. One made here for a member with no Me card
  // (sharing.ts) is made the same on every PC, so it goes out only once work names it.
  const members = db
    .prepare(
      `SELECT DISTINCT person_id AS id FROM sync_members
       WHERE share_id = @shareId AND person_id IS NOT NULL AND me IS NOT NULL`
    )
    .all({ shareId: shareOf(db, projectId).share_id }) as { id: string }[]
  for (const member of members) ids.add(member.id)
  // A person merged away ("Is this Bob?", D12) is named by nothing now, but is still sent once
  // more, so the other PCs archive it too.
  const merged = db
    .prepare(
      `SELECT candidate_person_id AS id FROM sync_person_link_answers
       WHERE share_id = @shareId AND answer = 'yes'`
    )
    .all({ shareId: shareOf(db, projectId).share_id }) as { id: string }[]
  for (const person of merged) ids.add(person.id)
  if (ids.size === 0) return []
  const read = db.prepare(
    'SELECT id, name, initials, color, archived_at FROM people WHERE id = @id'
  )
  const people: (SharedPerson & { id: string })[] = []
  for (const id of [...ids].sort()) {
    const row = read.get({ id }) as
      | { id: string; name: string; initials: string; color: string; archived_at: number | null }
      | undefined
    if (row) {
      people.push({
        id: row.id,
        name: row.name,
        initials: row.initials,
        color: row.color,
        archivedAt: row.archived_at
      })
    }
  }
  return people
}

async function writeRecord(
  db: Database.Database,
  transport: SyncTransport,
  share: ShareRow,
  keys: SealKeys,
  kind: 'person' | 'project',
  recordId: string,
  payload: unknown,
  pathFor: (stamp: string) => string
): Promise<boolean> {
  const hash = hashOf(payload)
  const known = db
    .prepare(
      'SELECT hash FROM sync_records WHERE share_id = @shareId AND kind = @kind AND record_id = @recordId'
    )
    .get({ shareId: share.share_id, kind, recordId }) as { hash: string } | undefined
  if (known?.hash === hash) return false
  const stamp = localStamp(share.device_id)
  const bytes = sealEnvelope(
    RECORD_FILE,
    { formatVersion: 1, shareId: share.share_id, memberId: share.member_id, kind, recordId, stamp },
    payload,
    keys
  )
  try {
    await transport.writeOnce(pathFor(stamp), bytes)
  } catch (error) {
    if (!(error instanceof SyncTransportError && error.reason === 'exists')) throw error
  }
  remember(db, share, kind, recordId, stamp, hash)
  return true
}

async function readRecord(
  db: Database.Database,
  transport: SyncTransport,
  share: ShareRow,
  keys: { projectKey: KeySource },
  path: string,
  problems: RecordProblem[]
): Promise<{ recordId: string; memberId: string; payload: unknown } | null> {
  const memberKey = db.prepare(
    'SELECT public_key, removed_at FROM sync_members WHERE share_id = @shareId AND member_id = @memberId'
  )
  let removedWriter = false
  try {
    const { header, payload } = openEnvelope(
      RECORD_FILE,
      await transport.read(path),
      {
        projectKey: keys.projectKey,
        publicKeyFor: (memberId) => {
          const member = memberKey.get({ shareId: share.share_id, memberId }) as
            { public_key: string; removed_at: number | null } | undefined
          // A removed member's people and settings are no longer taken.
          removedWriter = member?.removed_at != null
          return member && !removedWriter ? member.public_key : null
        }
      },
      parseHeader
    )
    if (header.shareId !== share.share_id || !path.includes(header.stamp)) {
      problems.push({ path, reason: 'mismatch' })
      return null
    }
    observeRemoteStamp(header.stamp)
    return { recordId: header.recordId, memberId: header.memberId, payload }
  } catch (error) {
    if (!removedWriter) {
      problems.push({
        path,
        reason: error instanceof RecordFileError ? error.reason : 'unreadable'
      })
    }
    return null
  }
}

/** The columns a person file carries; each keeps its own field stamp, as in the merge. */
const PERSON_FIELDS = ['name', 'initials', 'color', 'archived_at'] as const

/**
 * Adds or updates a person from another PC. Never makes them Me. The same newest-stamp rule as
 * the personal share's merge (apply.ts) applies: a person file updates a row that exists only when
 * its stamp is newer than every field stamp of that row, and a row deleted later stays deleted.
 * Its writes are not captured again, and they stamp the fields so a later change from either
 * path compares correctly. Returns whether the row was written.
 */
function writePerson(
  db: Database.Database,
  projectId: string,
  id: string,
  person: SharedPerson,
  stamp: string
): boolean {
  const key = JSON.stringify([id])
  const stored = db
    .prepare(
      `SELECT column_name, stamp FROM sync_field_stamps WHERE table_name = 'people' AND row_key = @key`
    )
    .all({ key }) as { column_name: string; stamp: string }[]
  const tombstone = stored.find((row) => row.column_name === '*')?.stamp
  if (tombstone !== undefined && compareStamps(stamp, tombstone) <= 0) return false
  const fields = stored.filter((row) => row.column_name !== '*').map((row) => row.stamp)
  const exists = db.prepare('SELECT 1 FROM people WHERE id = @id').get({ id }) !== undefined
  if (exists && fields.some((fieldStamp) => compareStamps(stamp, fieldStamp) <= 0)) return false

  const now = Date.now()
  withSyncApplying(() => {
    db.prepare(
      `INSERT INTO people (id, name, initials, color, is_me, archived_at, created_at, updated_at)
       VALUES (@id, @name, @initials, @color, 0, @archivedAt, @now, @now)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, initials = excluded.initials,
         color = excluded.color, archived_at = excluded.archived_at, updated_at = excluded.updated_at`
    ).run({ id, ...person, now })
    const stampField = db.prepare(
      `INSERT OR REPLACE INTO sync_field_stamps (table_name, row_key, column_name, stamp, project_id)
       VALUES ('people', @key, @column, @stamp, @projectId)`
    )
    for (const column of PERSON_FIELDS) stampField.run({ key, column, stamp, projectId })
  })
  return true
}

function isNewer(
  db: Database.Database,
  share: ShareRow,
  kind: 'person' | 'project',
  recordId: string,
  stamp: string
): boolean {
  const known = db
    .prepare(
      'SELECT stamp FROM sync_records WHERE share_id = @shareId AND kind = @kind AND record_id = @recordId'
    )
    .get({ shareId: share.share_id, kind, recordId }) as { stamp: string } | undefined
  return !known || stamp > known.stamp
}

function remember(
  db: Database.Database,
  share: ShareRow,
  kind: 'person' | 'project',
  recordId: string,
  stamp: string,
  hash: string
): void {
  db.prepare(
    `INSERT INTO sync_records (share_id, kind, record_id, stamp, hash)
     VALUES (@shareId, @kind, @recordId, @stamp, @hash)
     ON CONFLICT(share_id, kind, record_id) DO UPDATE SET stamp = excluded.stamp, hash = excluded.hash`
  ).run({ shareId: share.share_id, kind, recordId, stamp, hash })
}

function hashOf(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

function isPerson(value: unknown): value is SharedPerson {
  if (typeof value !== 'object' || value === null) return false
  const { name, initials, color, archivedAt } = value as Record<string, unknown>
  return (
    typeof name === 'string' &&
    name.trim().length > 0 &&
    typeof initials === 'string' &&
    typeof color === 'string' &&
    (archivedAt === null || typeof archivedAt === 'number')
  )
}

/** Project settings, as a snapshot carries them, with a name. */
function isProject(value: unknown): value is SnapshotProject {
  return isSnapshotProject(value) && value.name.trim().length > 0
}

function parseHeader(header: Record<string, unknown>): {
  shareId: string
  memberId: string
  recordId: string
  stamp: string
} {
  if (
    header.formatVersion !== 1 ||
    typeof header.shareId !== 'string' ||
    typeof header.memberId !== 'string' ||
    typeof header.recordId !== 'string' ||
    typeof header.stamp !== 'string'
  ) {
    throw new RecordFileError('not-a-change-file')
  }
  return {
    shareId: header.shareId,
    memberId: header.memberId,
    recordId: header.recordId,
    stamp: header.stamp
  }
}

function shareOf(db: Database.Database, projectId: string): ShareRow {
  const share = db
    .prepare(
      'SELECT share_id, member_id, device_id, kind, my_role FROM sync_shares WHERE project_id = @projectId'
    )
    .get({ projectId }) as ShareRow | undefined
  if (!share) throw new Error('Project is not shared')
  return share
}
