/**
 * Files and Library items attached to a task on the phone, as the PC's
 * `GET/POST/DELETE /work-items/:id/attachments` keep them: each attachment is a Library item of the
 * task's project, linked in `library_work_item_attachments`. A photo or document added here
 * becomes a new Library item first (`addLibraryFile`); sync sends the file itself as it does a
 * voice memo's recording. Voice memos are attachments too, but the task screen lists them apart.
 *
 * Plain functions over anything shaped like a database, so this file imports no React Native code.
 */
import type Database from 'better-sqlite3'
import {
  LIBRARY_MAX_TASK_ATTACHMENTS,
  type LibraryItem,
  type LibraryItemKind
} from '@shared/ostler-api'
import { isAudioMime } from '@shared/audio-files'
import { t } from '@shared/i18n/index'
import { Refusal } from '@shared/refusal'
import { LibraryRepository } from '../../../electron/services/database/library-repository'
import { guarded, requireTask, type EditDb } from './edits'
import { addLibraryFile, type LibraryFileInput } from './library'
import type { QueryDb } from './queries'

/** One attachment, as the task screen lists it. */
export interface TaskAttachment {
  itemId: string
  projectId: string
  kind: LibraryItemKind
  title: string
  /** The file's name and type, for a picture or document; null for a note, link or brief. */
  fileName: string | null
  mimeType: string | null
  url: string | null
}

function repository(db: EditDb): LibraryRepository {
  return new LibraryRepository(db as unknown as Database.Database)
}

/** The task's attachments not archived, oldest first, leaving out voice memos (listed apart). */
export function taskAttachments(db: EditDb, taskId: string): TaskAttachment[] {
  const rows = db
    .prepare(
      `SELECT i.id, i.project_id, i.kind, i.title, i.url, i.file_json
       FROM library_work_item_attachments a
       JOIN library_items i ON i.id = a.library_item_id
       WHERE a.work_item_id = ? AND i.archived_at IS NULL
       ORDER BY a.created_at ASC, i.id ASC`
    )
    .all(taskId) as {
    id: string
    project_id: string
    kind: LibraryItemKind
    title: string
    url: string | null
    file_json: string | null
  }[]
  const list: TaskAttachment[] = []
  for (const row of rows) {
    const file = parseFile(row.file_json)
    const mimeType = typeof file?.mimeType === 'string' ? file.mimeType : null
    if (mimeType !== null && isAudioMime(mimeType)) continue
    list.push({
      itemId: row.id,
      projectId: row.project_id,
      kind: row.kind,
      title: row.title,
      fileName: typeof file?.fileName === 'string' ? file.fileName : null,
      mimeType,
      url: row.url
    })
  }
  return list
}

/** An item's file details, or null for an item with no file (or details that do not parse). */
function parseFile(json: string | null): { fileName?: unknown; mimeType?: unknown } | null {
  if (!json) return null
  try {
    return JSON.parse(json) as { fileName?: unknown; mimeType?: unknown }
  } catch {
    return null
  }
}

/** Refuses when the task already carries the most attachments it may have. */
function assertRoom(db: EditDb, taskId: string): void {
  if (repository(db).countAttachments(taskId) >= LIBRARY_MAX_TASK_ATTACHMENTS) {
    throw new Refusal(t('errors:libraryService.workItemCanCarry', { LIBRARY_MAX_TASK_ATTACHMENTS }))
  }
}

/** Links a Library item of the task's project to the task, as a person attaching it. */
export function attachLibraryItem(db: EditDb, taskId: string, itemId: string): void {
  guarded(() => {
    const task = requireTask(db, taskId)
    const library = repository(db)
    const item = library.getItem(itemId)
    if (item === null || item.projectId !== task.project_id || item.archivedAt !== null) {
      throw new Refusal(t('errors:libraryService.onlyLiveLibraryItems'))
    }
    if (!library.hasAttachment(itemId, taskId)) assertRoom(db, taskId)
    library.upsertAttachment(task.project_id, item.id, taskId, 'human', item.revision)
  })
}

/**
 * Adds a file the phone stored for the task's project (`keepPickedFile`) to the Library and
 * attaches it to the task, in one transaction. Refused, writing nothing, when the task is full.
 */
export function attachFileToTask(
  db: EditDb & QueryDb,
  taskId: string,
  file: LibraryFileInput & { kind: 'image' | 'document'; title?: string }
): LibraryItem {
  const task = guarded(() => requireTask(db, taskId))
  assertRoom(db, taskId)
  return db.transaction(() => {
    const item = addLibraryFile(db, task.project_id, file)
    attachLibraryItem(db, taskId, item.id)
    return item
  })()
}

/** Takes an item off the task. The item stays in the project's Library. */
export function detachTaskAttachment(db: EditDb, taskId: string, itemId: string): void {
  guarded(() => {
    requireTask(db, taskId)
    repository(db).deleteAttachment(itemId, taskId)
  })
}
