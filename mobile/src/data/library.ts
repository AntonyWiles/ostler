/**
 * A project's Library on the phone, to read: briefs, guides, notes, links, whiteboards' outlines
 * and the names of documents and pictures, through the desktop's own `LibraryRepository`. Files
 * themselves stay on the PC; the phone shows what they are.
 *
 * Plain functions over anything shaped like a database, so this file imports no React Native code.
 */
import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { DEFAULT_AI_ACCESS, type LibraryItem, type LibraryItemKind } from '@shared/ostler-api'
import { Refusal } from '@shared/refusal'
import { LibraryRepository } from '../../../electron/services/database/library-repository'
import { cleanTitle } from '../../../electron/services/library-title'
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
 * recently changed. `words` narrows them to items whose title, summary or text has every word.
 */
export function libraryItems(db: QueryDb, projectId: string, words = ''): LibraryItem[] {
  const wanted = words.toLowerCase().split(/\s+/).filter(Boolean)
  return repository(db)
    .listItems(projectId, {}, null)
    .filter((item) => {
      if (wanted.length === 0) return true
      const text =
        `${item.title}\n${item.summary}\n${item.body}\n${item.tags.join(' ')}`.toLowerCase()
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

/**
 * Writes a note into a project's Library, as the PC's `createItem` does for one: its first
 * revision is stored and the links in its text indexed. Returns the new item.
 */
export function addLibraryNote(
  db: QueryDb,
  projectId: string,
  input: { title: string; body: string }
): LibraryItem {
  if (input.body.length > MAX_BODY_CHARS)
    throw new Refusal(`Body is longer than ${MAX_BODY_CHARS} characters`)
  const now = new Date().toISOString()
  const item: LibraryItem = {
    id: uuidv4(),
    projectId,
    kind: 'note',
    title: cleanTitle(input.title),
    summary: '',
    body: input.body,
    url: null,
    file: null,
    aiAccess: DEFAULT_AI_ACCESS.note,
    isPrimaryBrief: false,
    tags: [],
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
        body: item.body,
        tags: [],
        extractedText: ''
      })
    })()
  )
  return item
}
