import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { LibraryItem } from '../../src/shared/ostler-api'
import type { QueryDb } from '../../mobile/src/data/queries'
import { useTempDir } from '../helpers/temp-dir'

const { LibraryRepository } = await import('../../electron/services/database/library-repository')
const { createMigratedDatabase } = await import('../helpers/database')
const library = await import('../../mobile/src/data/library')
const { LibraryService } = await import('../../electron/services/library-service')

// The phone reads a project's Library through the desktop's LibraryRepository.

const PROJECT = '00000000-0000-4000-8000-000000000001'

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
  let dbPath: string

  beforeEach(async () => {
    dbPath = await createMigratedDatabase(tempDir())
    db = new Database(dbPath)
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

  it('writes a note as the PC does: the item, its first revision and its links', () => {
    const phoneNote = library.addLibraryNote(phone(), PROJECT, {
      title: '  Boiler ',
      body: 'Ask about [the sink](ostler://task/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-0000000000aa).'
    })
    db.close()
    const service = new LibraryService(dbPath, tempDir())
    const pcNote = service.createItem(PROJECT, {
      kind: 'note',
      title: 'Boiler',
      body: 'Ask about [the sink](ostler://task/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-0000000000aa).'
    })
    service.close()
    db = new Database(dbPath)
    const strip = ({ id: _id, createdAt: _c, updatedAt: _u, ...rest }: LibraryItem) => rest
    expect(strip(phoneNote)).toEqual(strip(pcNote))
    const revisions = db
      .prepare('SELECT COUNT(*) AS n FROM library_item_revisions WHERE item_id = ?')
      .get(phoneNote.id) as { n: number }
    expect(revisions.n).toBe(1)
    const links = (id: string) =>
      db.prepare('SELECT COUNT(*) AS n FROM item_links WHERE source_id = ?').get(id) as {
        n: number
      }
    expect(links(phoneNote.id)).toEqual({ n: 1 })
    expect(links(pcNote.id)).toEqual({ n: 1 })
    expect(library.libraryItem(phone(), phoneNote.id)?.title).toBe('Boiler')
  })

  it('refuses a note with no title', () => {
    expect(() => library.addLibraryNote(phone(), PROJECT, { title: ' ', body: 'x' })).toThrow()
  })

  it('tags an item with project labels, filters by them and offers them on tasks', async () => {
    const { projectLabels } = await import('../../mobile/src/data/queries')
    const tagged = library.setLibraryItemTags(phone(), 'n1', [' boiler ', 'site', 'site'])
    expect(tagged.tags).toEqual(['boiler', 'site'])
    expect(tagged.revision).toBe(1)
    expect(library.libraryTags(phone(), PROJECT)).toEqual(['boiler', 'site'])
    expect(library.libraryItems(phone(), PROJECT, '', 'boiler').map((entry) => entry.id)).toEqual([
      'n1'
    ])
    expect(library.libraryItems(phone(), PROJECT, 'boiler').map((entry) => entry.id)).toEqual([
      'n1'
    ])
    // A label made in the Library is offered on the project's tasks.
    expect(projectLabels(phone(), PROJECT)).toEqual(['boiler', 'site'])
    expect(() =>
      library.setLibraryItemTags(
        phone(),
        'n1',
        Array.from({ length: 21 }, (_, n) => `t${n}`)
      )
    ).toThrow()
  })
})
