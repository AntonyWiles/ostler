/**
 * A project's Library on the phone, to read and add to: briefs, guides, notes, links, whiteboards' outlines
 * and the names of documents and pictures, through the desktop's own `LibraryRepository`. Files
 * the phone added (photos, picked files, voice memos) are kept on the phone too; others stay on
 * the PC and the phone shows what they are.
 *
 * Plain functions over anything shaped like a database, so this file imports no React Native code.
 */
import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import {
  DEFAULT_AI_ACCESS,
  LIBRARY_MAX_FILE_BYTES,
  type LibraryItem,
  type LibraryItemKind
} from '@shared/ostler-api'
import { Refusal } from '@shared/refusal'
import { LibraryRepository } from '../../../electron/services/database/library-repository'
import {
  cleanLibraryTags,
  cleanTitle,
  cleanUrl,
  MAX_TITLE_CHARS
} from '../../../electron/services/library-title'
import { guarded } from './edits'
import type { QueryDb } from './queries'

function repository(db: QueryDb): LibraryRepository {
  return new LibraryRepository(db as unknown as Database.Database)
}

/** The order kinds are listed in: what people read first. */
const KIND_ORDER: readonly LibraryItemKind[] = [
  'brief',
  'guide',
  'note',
  'whiteboard',
  'link',
  'document',
  'image'
]

/**
 * The project's Library items not archived: the primary brief first, then by kind, then the most
 * recently changed. `words` narrows them to items whose title, summary, text or
 * address has every word, and `tag` to items carrying that label.
 */
export function libraryItems(
  db: QueryDb,
  projectId: string,
  words = '',
  tag: string | null = null
): LibraryItem[] {
  const wanted = words.toLowerCase().split(/\s+/).filter(Boolean)
  return repository(db)
    .listItems(projectId, tag === null ? {} : { tag }, null)
    .filter((item) => {
      if (wanted.length === 0) return true
      const text =
        `${item.title}\n${item.summary}\n${item.body}\n${item.url ?? ''}\n${item.tags.join(' ')}`.toLowerCase()
      return wanted.every((word) => text.includes(word))
    })
    .sort(
      (a, b) =>
        Number(b.isPrimaryBrief) - Number(a.isPrimaryBrief) ||
        KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)
    )
}

/** One item, or null when it is not on the phone. */
export function libraryItem(db: QueryDb, itemId: string): LibraryItem | null {
  return repository(db).getItem(itemId)
}

const MAX_BODY_CHARS = 200_000

/** A file picked or photographed on the phone, already stored under `itemId` and hashed. */
export interface LibraryFileInput {
  itemId: string
  fileName: string
  mimeType: string
  sizeBytes: number
  sha256: string
}

const SHA256 = /^[0-9a-f]{64}$/

const RASTER_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp'
}

/**
 * What a file is, by its first bytes as the PC's `classifyFile` decides: PNG, JPEG, GIF and WebP
 * are pictures, a PDF is a document, anything else a document of the type the picker reported.
 * `extension` names the stored copy (`original.<extension>`).
 */
export function classifyLibraryFile(
  head: Uint8Array,
  fileName: string,
  pickedMime: string | null
): { kind: 'image' | 'document'; extension: string; mimeType: string } {
  const text = String.fromCharCode(...head.subarray(0, 12))
  const raster =
    head[0] === 0x89 && text.slice(1, 4) === 'PNG'
      ? 'png'
      : head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff
        ? 'jpg'
        : /^GIF8[79]a/.test(text)
          ? 'gif'
          : text.startsWith('RIFF') && text.slice(8, 12) === 'WEBP'
            ? 'webp'
            : null
  if (raster) return { kind: 'image', extension: raster, mimeType: RASTER_MIME[raster] }
  if (text.startsWith('%PDF-'))
    return { kind: 'document', extension: 'pdf', mimeType: 'application/pdf' }
  const match = /\.([a-z0-9]{1,10})$/i.exec(fileName)
  return {
    kind: 'document',
    extension: match ? match[1].toLowerCase() : 'bin',
    mimeType:
      pickedMime && /^[\w.+-]+\/[\w.+-]+$/.test(pickedMime)
        ? pickedMime
        : 'application/octet-stream'
  }
}

/** A picked file's name, safe to store and show, as the PC cleans one. */
export function cleanFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? ''
  const clean = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f<>:"|?*]/g, '_')
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '')
    .slice(0, 180)
  return clean || 'file'
}

/**
 * Writes one new item into a project's Library, as the PC's `createItem` and file import do: its
 * first revision is stored and its text indexed for search. Returns the new item.
 */
function insertLibraryItem(
  db: QueryDb,
  projectId: string,
  fields: Pick<LibraryItem, 'kind' | 'title' | 'body' | 'url' | 'file'> & { id?: string },
  tags: string[]
): LibraryItem {
  if (fields.body.length > MAX_BODY_CHARS)
    throw new Refusal(`Body is longer than ${MAX_BODY_CHARS} characters`)
  const now = new Date().toISOString()
  const item: LibraryItem = {
    id: fields.id ?? uuidv4(),
    projectId,
    kind: fields.kind,
    title: cleanTitle(fields.title),
    summary: '',
    body: fields.body,
    url: fields.url,
    file: fields.file,
    aiAccess: DEFAULT_AI_ACCESS[fields.kind],
    isPrimaryBrief: false,
    tags: cleanLibraryTags(tags),
    revision: 1,
    createdAt: now,
    updatedAt: now,
    archivedAt: null
  }
  const library = repository(db)
  guarded(() =>
    (db as unknown as Database.Database).transaction(() => {
      library.insertItem(item)
      library.insertRevision(item)
      library.indexItem({
        itemId: item.id,
        projectId,
        title: item.title,
        summary: '',
        body: item.url ? `${item.url}\n${item.body}` : item.body,
        tags: item.tags,
        extractedText: ''
      })
    })()
  )
  return item
}

/** Writes a note into a project's Library. Returns the new item. */
export function addLibraryNote(
  db: QueryDb,
  projectId: string,
  input: { title: string; body: string; tags?: string[] }
): LibraryItem {
  return insertLibraryItem(
    db,
    projectId,
    { kind: 'note', title: input.title, body: input.body, url: null, file: null },
    input.tags ?? []
  )
}

/**
 * Writes a link into a project's Library: http and https only, as on the PC. The title is the
 * address's site when left empty. Returns the new item.
 */
export function addLibraryLink(
  db: QueryDb,
  projectId: string,
  input: { title: string; url: string; body?: string; tags?: string[] }
): LibraryItem {
  let url: string
  try {
    url = cleanUrl(input.url)
  } catch (failure) {
    throw new Refusal(failure instanceof Error ? failure.message : String(failure))
  }
  const title = input.title.trim() || new URL(url).hostname || url
  return insertLibraryItem(
    db,
    projectId,
    { kind: 'link', title, body: input.body ?? '', url, file: null },
    input.tags ?? []
  )
}

/**
 * Writes a file the phone stored (`library/<projectId>/<itemId>/original.<ext>`) into a project's
 * Library as a picture or a document. Sync sends the file itself (`pushLibraryFiles`), as it does
 * a voice memo's recording. Returns the new item.
 */
export function addLibraryFile(
  db: QueryDb,
  projectId: string,
  input: LibraryFileInput & {
    kind: 'image' | 'document'
    title?: string
    /** The item's text, e.g. a voice memo's transcript. */
    body?: string
    tags?: string[]
  }
): LibraryItem {
  if (!SHA256.test(input.sha256) || input.sizeBytes <= 0)
    throw new Refusal('This file is empty or could not be read')
  if (input.sizeBytes > LIBRARY_MAX_FILE_BYTES)
    throw new Refusal(`Files are limited to ${LIBRARY_MAX_FILE_BYTES / 1024 / 1024} MB`)
  const fileName = cleanFileName(input.fileName)
  const title = input.title?.trim() || fileName.replace(/\.[a-z0-9]{1,10}$/i, '').trim() || fileName
  return insertLibraryItem(
    db,
    projectId,
    {
      id: input.itemId,
      kind: input.kind,
      title: title.slice(0, MAX_TITLE_CHARS),
      body: input.body?.trim() ?? '',
      url: null,
      file: {
        fileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        sha256: input.sha256,
        hasThumbnail: false,
        hasVisionCopy: false
      }
    },
    input.tags ?? []
  )
}

/** The tags the project's Library items not archived carry, by name: what the list filters by. */
export function libraryTags(db: QueryDb, projectId: string): string[] {
  const names = new Set(
    repository(db)
      .listItems(projectId, {}, null)
      .flatMap((item) => item.tags)
  )
  return [...names].sort((a, b) => a.localeCompare(b))
}

/**
 * Replaces an item's tags, which are the project's labels, as the PC's `updateItem` does for
 * `tags`: cleaned by the same rule, no new revision, `updatedAt` moved on and search reindexed.
 * Syncs like any other change to the item's row.
 */
export function setLibraryItemTags(db: QueryDb, itemId: string, tags: string[]): LibraryItem {
  const library = repository(db)
  const item = library.getItem(itemId)
  if (item === null) throw new Refusal('This Library item is not on this phone')
  const next: LibraryItem = {
    ...item,
    tags: cleanLibraryTags(tags),
    updatedAt: new Date().toISOString()
  }
  guarded(() =>
    (db as unknown as Database.Database).transaction(() => {
      library.saveItem(next)
      library.setTags(next.id, next.tags)
    })()
  )
  return next
}
