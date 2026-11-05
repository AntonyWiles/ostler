/**
 * What another app shared to Ostler (text, a link, pictures or files) and how it becomes a new
 * task or new Library items in the project the person picks. The share screen keeps each shared
 * file in its item's folder first (`keepPickedFile`); everything after that is here.
 *
 * Plain functions over anything shaped like a database, so this file imports no React Native code.
 */
import type { LibraryItem } from '@shared/ostler-api'
import { addTask, setTaskDescription, type EditDb } from './edits'
import { addLibraryFile, addLibraryLink, addLibraryNote, type LibraryFileInput } from './library'
import type { QueryDb } from './queries'
import { attachFileToTask } from './task-attachments'

/** A shared file, still where the sharing app left it. */
export interface SharedFile {
  uri: string
  name: string
  mimeType: string | null
}

/** What was shared, tidied: its words, the first web address in them, a title and the files. */
export interface SharePayload {
  /** The shared words, without a leading or trailing space; empty for files only. */
  text: string
  /** The shared web address (http or https), or null. */
  url: string | null
  /** A title the sharing app gave (a page's title, a subject), or empty. */
  subject: string
  files: SharedFile[]
}

/** The shape the share-intent module hands over (`expo-share-intent`'s `ShareIntent`). */
export interface RawShare {
  text?: string | null
  webUrl?: string | null
  meta?: { title?: string | null } | null
  files?: { path: string; fileName?: string | null; mimeType?: string | null }[] | null
}

const MAX_TASK_TITLE = 200
const MAX_DESCRIPTION = 8000
const WEB_ADDRESS = /\bhttps?:\/\/[^\s<>"]+/i

/** Tidies a share. Null when nothing usable came (no words, no address, no file). */
export function sharePayload(raw: RawShare): SharePayload | null {
  const text = (raw.text ?? '').trim()
  const found = WEB_ADDRESS.exec(text)?.[0].replace(/[.,;:!?)\]]+$/, '') ?? null
  const url = raw.webUrl?.trim() || found
  const files = (raw.files ?? [])
    .filter((file) => typeof file.path === 'string' && file.path !== '')
    .map((file) => ({
      uri: file.path,
      name: file.fileName?.trim() || file.path.split(/[\\/]/).pop() || 'file',
      mimeType: file.mimeType?.trim() || null
    }))
  if (!text && !url && files.length === 0) return null
  return { text, url: url || null, subject: raw.meta?.title?.trim() ?? '', files }
}

/** The words with the shared address taken out, for a title or a link's note. */
function wordsBesideUrl(share: SharePayload): string {
  if (share.url === null) return share.text
  return share.text
    .split(share.url)
    .join(' ')
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/[ \t]+/g, ' ')
        .replace(/\s[.,;:!?]+(?=\s|$)/g, '')
        .trim()
    )
    .join('\n')
    .trim()
}

function firstLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ''
  )
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

/**
 * The title a new task or item starts with: the sharing app's subject, else the first line of
 * the words (without the address), else the first file's name without its ending, else the
 * address's site. Empty when there is none.
 */
export function shareTitle(share: SharePayload): string {
  const fromFile = share.files[0]?.name.replace(/\.[a-z0-9]{1,10}$/i, '').trim() ?? ''
  let site = ''
  if (share.url !== null) {
    try {
      site = new URL(share.url).hostname.replace(/^www\./, '')
    } catch {
      site = share.url
    }
  }
  const title = share.subject || firstLine(wordsBesideUrl(share)) || fromFile || site
  return clip(title, MAX_TASK_TITLE)
}

/** A new task's description: the shared words, with the address added when they leave it out. */
export function shareDescription(share: SharePayload): string {
  const parts = [share.text]
  if (share.url !== null && !share.text.includes(share.url)) parts.push(share.url)
  return clip(parts.filter(Boolean).join('\n\n'), MAX_DESCRIPTION)
}

/** A shared file the phone has stored for the project, ready for the Library. */
export type KeptShareFile = LibraryFileInput & { kind: 'image' | 'document' }

/**
 * Makes a new task in the project from a share: the title given, the shared words as its
 * description, and each kept file added to the Library and attached. All or nothing. Returns the
 * task's id.
 */
export function shareAsTask(
  db: EditDb & QueryDb,
  projectId: string,
  share: SharePayload,
  title: string,
  kept: KeptShareFile[]
): string {
  return db.transaction(() => {
    const taskId = addTask(db, projectId, title)
    const description = shareDescription(share)
    if (description) setTaskDescription(db, taskId, description)
    for (const file of kept) attachFileToTask(db, taskId, file)
    return taskId
  })()
}

/**
 * Adds a share to the project's Library, with the tags chosen: the address as a link (the other
 * words as its note), or the words as a note, and each kept file as a picture or document. A
 * single file with no words takes the title given. All or nothing. Returns the new items.
 */
export function shareToLibrary(
  db: QueryDb,
  projectId: string,
  share: SharePayload,
  input: { title: string; tags: string[] },
  kept: KeptShareFile[]
): LibraryItem[] {
  const title = input.title.trim()
  return (db as unknown as EditDb).transaction(() => {
    const items: LibraryItem[] = []
    if (share.url !== null) {
      items.push(
        addLibraryLink(db, projectId, {
          title,
          url: share.url,
          body: wordsBesideUrl(share),
          tags: input.tags
        })
      )
    } else if (share.text) {
      items.push(
        addLibraryNote(db, projectId, {
          title: title || shareTitle(share),
          body: share.text,
          tags: input.tags
        })
      )
    }
    const nameFiles = items.length === 0 && kept.length === 1
    for (const file of kept) {
      items.push(
        addLibraryFile(db, projectId, {
          ...file,
          title: nameFiles ? title : undefined,
          tags: input.tags
        })
      )
    }
    return items
  })()
}

/** The project a share goes to first: the one used last, while it is still on the phone. */
export function defaultShareProject(
  projectIds: readonly string[],
  lastUsed: string | null
): string | null {
  if (lastUsed !== null && projectIds.includes(lastUsed)) return lastUsed
  return projectIds[0] ?? null
}
