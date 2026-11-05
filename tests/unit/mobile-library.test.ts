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

  it('writes a note with tags, found by them', () => {
    const note = library.addLibraryNote(phone(), PROJECT, {
      title: 'Snagging',
      body: 'Door sticks.',
      tags: ['kitchen', ' kitchen ', 'urgent']
    })
    expect(note.tags).toEqual(['kitchen', 'urgent'])
    expect(library.libraryItems(phone(), PROJECT, '', 'urgent').map((i) => i.id)).toEqual([note.id])
    expect(library.libraryItems(phone(), PROJECT, 'urgent').map((i) => i.id)).toEqual([note.id])
  })

  it('writes a link as the PC does, titled by its site when left empty', () => {
    const phoneLink = library.addLibraryLink(phone(), PROJECT, {
      title: '',
      url: ' https://example.com/taps ',
      tags: ['bathroom']
    })
    db.close()
    const service = new LibraryService(dbPath, tempDir())
    const pcLink = service.createItem(PROJECT, {
      kind: 'link',
      title: 'example.com',
      url: 'https://example.com/taps',
      body: '',
      tags: ['bathroom']
    })
    service.close()
    db = new Database(dbPath)
    const strip = ({ id: _id, createdAt: _c, updatedAt: _u, ...rest }: LibraryItem) => rest
    expect(strip(phoneLink)).toEqual(strip(pcLink))
    expect(library.libraryItems(phone(), PROJECT, 'taps').map((i) => i.id)).toContain(phoneLink.id)
  })

  it('refuses a link that is not http or https', () => {
    for (const url of ['', 'not a link', 'javascript:alert(1)']) {
      expect(() => library.addLibraryLink(phone(), PROJECT, { title: 'x', url })).toThrow()
    }
  })

  it('writes a picked file or photo as a document or picture with its file details', () => {
    const photo = library.addLibraryFile(phone(), PROJECT, {
      itemId: '00000000-0000-4000-8000-0000000000f1',
      kind: 'image',
      fileName: 'IMG_0001.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 2048,
      sha256: 'a'.repeat(64),
      title: '',
      tags: ['site']
    })
    expect(photo).toMatchObject({
      id: '00000000-0000-4000-8000-0000000000f1',
      kind: 'image',
      title: 'IMG_0001',
      tags: ['site'],
      file: { fileName: 'IMG_0001.jpg', mimeType: 'image/jpeg', sizeBytes: 2048 }
    })
    const revisions = db
      .prepare('SELECT COUNT(*) AS n FROM library_item_revisions WHERE item_id = ?')
      .get(photo.id) as { n: number }
    expect(revisions.n).toBe(1)
    const bad = {
      itemId: 'x',
      kind: 'document' as const,
      fileName: 'a.txt',
      mimeType: 'text/plain'
    }
    expect(() =>
      library.addLibraryFile(phone(), PROJECT, { ...bad, sizeBytes: 0, sha256: 'a'.repeat(64) })
    ).toThrow()
    expect(() =>
      library.addLibraryFile(phone(), PROJECT, { ...bad, sizeBytes: 5, sha256: 'nope' })
    ).toThrow()
  })

  it('tells pictures and PDFs by their bytes, as the PC does', () => {
    const bytes = (...values: number[]) => new Uint8Array(values)
    const ascii = (text: string) => new Uint8Array([...text].map((c) => c.charCodeAt(0)))
    expect(library.classifyLibraryFile(bytes(0xff, 0xd8, 0xff, 0xe0), 'a.heic', null)).toEqual({
      kind: 'image',
      extension: 'jpg',
      mimeType: 'image/jpeg'
    })
    expect(
      library.classifyLibraryFile(bytes(0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10), 'x', null).mimeType
    ).toBe('image/png')
    expect(library.classifyLibraryFile(ascii('RIFF0000WEBP'), 'p', null).extension).toBe('webp')
    expect(library.classifyLibraryFile(ascii('%PDF-1.7'), 'plan', null)).toEqual({
      kind: 'document',
      extension: 'pdf',
      mimeType: 'application/pdf'
    })
    expect(library.classifyLibraryFile(ascii('hello'), 'Notes.TXT', 'text/plain')).toEqual({
      kind: 'document',
      extension: 'txt',
      mimeType: 'text/plain'
    })
    expect(library.classifyLibraryFile(ascii('x'), 'blob', 'nonsense').mimeType).toBe(
      'application/octet-stream'
    )
    expect(library.cleanFileName('../dir/a:b?.txt')).toBe('a_b_.txt')
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
