/**
 * A project's status updates on the phone (on track, at risk, off track, with a note): the
 * desktop's own `StatusUpdateService` over the phone's database, so an update posted here is the
 * same row the PC writes, by this phone's person (Me). `status_updates` syncs per project.
 *
 * Plain functions over anything shaped like a database, so this file imports no React Native code.
 */
import type Database from 'better-sqlite3'
import { actorDisplayName } from '@shared/actor-name'
import type { StatusUpdate, StatusUpdateHealth } from '@shared/status-updates'
import { MAX_STATUS_UPDATE_NOTE } from '@shared/status-updates'
import { StatusUpdateService } from '../../../electron/services/status-update-service'
import { EditRefused, guarded, type EditDb } from './edits'
import { projects, type QueryDb } from './queries'

export { MAX_STATUS_UPDATE_NOTE }

function service(db: EditDb & QueryDb): StatusUpdateService {
  const raw = db as unknown as Database.Database
  return new StatusUpdateService(
    raw,
    () => projects(db).map((project) => project.id),
    (kind, personId) => {
      const person =
        personId === null
          ? undefined
          : (db.prepare('SELECT name FROM people WHERE id = ?').get(personId) as
              { name: string } | undefined)
      return { kind, personId, name: actorDisplayName(kind, person?.name ?? null) }
    }
  )
}

function meId(db: QueryDb): string | null {
  const row = db.prepare('SELECT id FROM people WHERE is_me = 1').get() as
    { id: string } | undefined
  return row?.id ?? null
}

/** A project's updates, the newest first. */
export function statusUpdates(db: EditDb & QueryDb, projectId: string): StatusUpdate[] {
  try {
    return service(db).list(projectId)
  } catch {
    // A project with no tasks or milestones yet is not on the phone's list: it has no updates.
    return []
  }
}

/** Posts an update as this phone's person. Returns its id. */
export function postStatusUpdate(
  db: EditDb & QueryDb,
  projectId: string,
  health: StatusUpdateHealth,
  note: string
): string {
  if (note.trim().length > MAX_STATUS_UPDATE_NOTE) throw new EditRefused('note-too-long')
  return guarded(
    () =>
      service(db).post(
        projectId,
        { health, note },
        { kind: 'human', personId: meId(db) ?? undefined }
      ).id
  )
}

/** Deletes an update (softly, as on the PC); `restoreStatusUpdate` undoes it. */
export function deleteStatusUpdate(db: EditDb & QueryDb, updateId: string): void {
  guarded(() => void service(db).delete(updateId))
}

export function restoreStatusUpdate(db: EditDb & QueryDb, updateId: string): void {
  guarded(() => void service(db).restore(updateId))
}

/** Each project's latest update, by project id, for the Projects list. */
export function latestStatusUpdates(db: QueryDb): Record<string, StatusUpdate> {
  try {
    const all = projects(db).map((project) => project.id)
    return service(db as EditDb & QueryDb).latestFor(all)
  } catch {
    return {}
  }
}
