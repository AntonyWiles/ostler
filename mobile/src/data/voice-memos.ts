/**
 * Voice memos on a task: a recording kept in the project's Library as a sound file, attached to
 * the task, with its transcript (when there is one) as the item's body and a comment on the task
 * that links to it. The recording itself travels to the other devices as a Library file
 * (`pushLibraryFiles`, library-files.ts); the rows travel like any other edit.
 *
 * Plain functions over anything shaped like a database, so this file imports no React Native code
 * and the desktop's Vitest can run it against better-sqlite3.
 */
import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import {
  DEFAULT_AI_ACCESS,
  LIBRARY_MAX_TASK_ATTACHMENTS,
  type LibraryItem
} from '@shared/ostler-api'
import { MAX_COMMENT_LENGTH } from '@shared/ostler-api/activity-types'
import { formatAudioDuration, isAudioMime } from '@shared/audio-files'
import { itemLinkUrl } from '@shared/item-links'
import { BRAND } from '@shared/brand'
import { LibraryRepository } from '../../../electron/services/database/library-repository'
import { addLibraryFile } from './library'
import type { QueryDb } from './queries'
import { cleanTitle } from '../../../electron/services/library-title'
import {
  addTaskComment,
  EditRefused,
  guarded,
  requireTask,
  type EditDb,
  type EditOptions
} from './edits'

const SHA256 = /^[0-9a-f]{64}$/

/** A recording saved on the phone, ready to become a voice memo. */
export interface VoiceMemoInput {
  /** The new Library item's id: the recording is already stored under it on the phone. */
  itemId: string
  title: string
  /** e.g. `voice-memo-2026-11-05-1402.wav` */
  fileName: string
  mimeType: string
  sizeBytes: number
  sha256: string
  durationMs: number
  /** What was said, when the memo was transcribed; empty otherwise. */
  transcript: string
}

/** A voice memo attached to a task, as the task screen lists it. */
export interface VoiceMemo {
  itemId: string
  projectId: string
  title: string
  fileName: string
  mimeType: string
  sizeBytes: number
  transcript: string
  createdAt: string
}

function repository(db: EditDb): LibraryRepository {
  return new LibraryRepository(db as unknown as Database.Database)
}

/** A new id for a voice memo's Library item, so its recording can be stored under it first. */
export function newVoiceMemoId(): string {
  return uuidv4()
}

/** The comment that tells the task's people about a memo: its link, its length and its transcript. */
export function voiceMemoComment(
  projectId: string,
  memo: Pick<VoiceMemoInput, 'itemId' | 'title' | 'durationMs' | 'transcript'>
): string {
  const url = itemLinkUrl({ kind: 'library', projectId, id: memo.itemId }, BRAND.urlScheme)
  const head = `🎙 [${memo.title.replace(/[[\]]/g, '')}](${url}) · ${formatAudioDuration(memo.durationMs)}`
  const transcript = memo.transcript.trim()
  if (!transcript) return head
  const room = MAX_COMMENT_LENGTH - head.length - 3
  const quoted =
    transcript.length > room ? `${transcript.slice(0, room - 1).trimEnd()}…` : transcript
  return `${head}\n\n${quoted}`
}

/**
 * Adds a voice memo to a task: the Library item (a document holding a sound file, with the
 * transcript as its body), its attachment to the task, and a comment linking to it, in one
 * transaction. The attachment is skipped when the task already has the most attachments it may
 * have; the comment still links the memo. Returns the item.
 */
export function addVoiceMemo(
  db: EditDb,
  taskId: string,
  input: VoiceMemoInput,
  options: EditOptions = {}
): LibraryItem {
  return guarded(() => {
    const task = requireTask(db, taskId)
    if (!isAudioMime(input.mimeType) || !SHA256.test(input.sha256) || input.sizeBytes <= 0) {
      throw new EditRefused('bad-recording')
    }
    const at = new Date(options.now ?? Date.now()).toISOString()
    const transcript = input.transcript.trim()
    const item: LibraryItem = {
      id: input.itemId,
      projectId: task.project_id,
      kind: 'document',
      title: cleanTitle(input.title) || input.fileName,
      summary: '',
      body: transcript,
      url: null,
      file: {
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        sha256: input.sha256,
        hasThumbnail: false,
        hasVisionCopy: false
      },
      aiAccess: DEFAULT_AI_ACCESS.document,
      isPrimaryBrief: false,
      tags: [],
      revision: 1,
      createdAt: at,
      updatedAt: at,
      archivedAt: null
    }
    const library = repository(db)
    db.transaction(() => {
      library.insertItem(item)
      library.insertRevision(item)
      if (library.countAttachments(taskId) < LIBRARY_MAX_TASK_ATTACHMENTS) {
        library.upsertAttachment(task.project_id, item.id, taskId, 'human', item.revision)
      }
      addTaskComment(
        db,
        taskId,
        voiceMemoComment(task.project_id, { ...input, title: item.title, transcript }),
        options
      )
    })()
    return item
  })
}

/**
 * Adds a voice memo to a project's Library on its own, attached to no task: a document holding
 * the sound file, with the transcript (when there is one) as its body and the tags chosen while
 * saving. Sync sends the recording as it does any file the phone added. Returns the item.
 */
export function addLibraryVoiceMemo(
  db: QueryDb,
  projectId: string,
  input: VoiceMemoInput & { tags?: string[] }
): LibraryItem {
  return guarded(() => {
    if (!isAudioMime(input.mimeType)) throw new EditRefused('bad-recording')
    return addLibraryFile(db, projectId, {
      itemId: input.itemId,
      kind: 'document',
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      sha256: input.sha256,
      title: cleanTitle(input.title) || input.fileName,
      body: input.transcript,
      tags: input.tags ?? []
    })
  })
}

/** The voice memos attached to a task, oldest first. */
export function taskVoiceMemos(db: EditDb, taskId: string): VoiceMemo[] {
  const rows = db
    .prepare(
      `SELECT i.id, i.project_id, i.title, i.body, i.file_json, i.created_at
       FROM library_work_item_attachments a
       JOIN library_items i ON i.id = a.library_item_id
       WHERE a.work_item_id = ? AND i.archived_at IS NULL AND i.file_json IS NOT NULL
       ORDER BY i.created_at ASC, i.id ASC`
    )
    .all(taskId) as {
    id: string
    project_id: string
    title: string
    body: string
    file_json: string
    created_at: string
  }[]
  const memos: VoiceMemo[] = []
  for (const row of rows) {
    let file: { fileName?: unknown; mimeType?: unknown; sizeBytes?: unknown }
    try {
      file = JSON.parse(row.file_json) as typeof file
    } catch {
      continue
    }
    if (typeof file.mimeType !== 'string' || !isAudioMime(file.mimeType)) continue
    memos.push({
      itemId: row.id,
      projectId: row.project_id,
      title: row.title,
      fileName: typeof file.fileName === 'string' ? file.fileName : row.title,
      mimeType: file.mimeType,
      sizeBytes: typeof file.sizeBytes === 'number' ? file.sizeBytes : 0,
      transcript: row.body,
      createdAt: row.created_at
    })
  }
  return memos
}
