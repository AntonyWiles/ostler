import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { LibraryItem } from '../../src/shared/ostler-api'
import type { QueryDb } from '../../mobile/src/data/queries'
import { useTempDir } from '../helpers/temp-dir'

const { LibraryRepository } = await import('../../electron/services/database/library-repository')
const { createMigratedDatabase } = await import('../helpers/database')
const library = await import('../../mobile/src/data/library')

// The phone reads a project's Library through the desktop's LibraryRepository.

const PROJECT = 'p1'

function item(
  id: string,
  kind: LibraryItem['kind'],
  title: string,
  extra: Partial<LibraryItem> = {}
): LibraryItem {
  return {
    id,
    projectId: PROJECT,
    kind,
    title,
    summary: '',
    body: '',
    url: null,
    file: null,
    aiAccess: 'always',
    isPrimaryBrief: false,
    tags: [],
    revision: 1,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    archivedAt: null,
    ...extra
  }
}

describe('the Library on the phone', () => {
  const tempDir = useTempDir('ostler-mobile-library-')
  let db: Database.Database

  beforeEach(async () => {
    db = new Database(await createMigratedDatabase(tempDir()))
    const repository = new LibraryRepository(db)
    repository.insertItem(item('n1', 'note', 'Site visit', { body: 'The **boiler** is old.' }))
    repository.insertItem(item('b1', 'brief', 'Kitchen brief', { isPrimaryBrief: true }))
    repository.insertItem(item('l1', 'link', 'Tile shop', { url: 'https://example.com/tiles' }))
    repository.insertItem(
      item('a1', 'note', 'Old idea', { archivedAt: '2026-10-02T09:00:00.000Z' })
    )
  })

  afterEach(() => db.close())

  const phone = () => db as unknown as QueryDb

  it('lists items not archived, the primary brief first, then by kind', () => {
    expect(library.libraryItems(phone(), PROJECT).map((entry) => entry.id)).toEqual([
      'b1',
      'n1',
      'l1'
    ])
  })

  it('finds items by every word, in their text too', () => {
    expect(library.libraryItems(phone(), PROJECT, 'BOILER').map((entry) => entry.id)).toEqual([
      'n1'
    ])
    expect(library.libraryItems(phone(), PROJECT, 'boiler tiles')).toEqual([])
  })

  it('reads one item, or null', () => {
    expect(library.libraryItem(phone(), 'l1')?.url).toBe('https://example.com/tiles')
    expect(library.libraryItem(phone(), 'missing')).toBeNull()
  })
})
