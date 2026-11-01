/**
 * A project's Library on the phone, to read: briefs, guides, notes, links, whiteboards' outlines
 * and the names of documents and pictures, through the desktop's own `LibraryRepository`. Files
 * themselves stay on the PC; the phone shows what they are.
 *
 * Plain functions over anything shaped like a database, so this file imports no React Native code.
 */
import type Database from 'better-sqlite3'
import type { LibraryItem, LibraryItemKind } from '@shared/ostler-api'
import { LibraryRepository } from '../../../electron/services/database/library-repository'
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
