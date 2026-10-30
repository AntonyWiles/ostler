import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LibraryService } from '../../electron/services/library-service'
import { SearchService } from '../../electron/services/search-service'
import { createMigratedDatabase } from '../helpers/database'
import { docx } from '../helpers/office-files'
import { useTempDir } from '../helpers/temp-dir'

/** S8: a Library file received from another PC is stored, read and searchable here. */

const PROJECT = 'b2c09364-5133-4ddf-9131-2b30cd9fa0d9'

const tempDir = useTempDir('ostler-synced-original-')
let library: LibraryService
let db: Database.Database
let search: SearchService

beforeEach(async () => {
  const databasePath = await createMigratedDatabase(tempDir())
  library = new LibraryService(databasePath, tempDir())
  db = new Database(databasePath)
  search = new SearchService(db, () => [PROJECT])
})

afterEach(() => {
  db.close()
  library.close()
})

describe('Library files received through a shared folder', () => {
  it('stores a received original, reads its text and indexes it for search', async () => {
    const bytes = docx({ paragraphs: ['The marquee arrives on Friday.'] })
    const [{ item }] = await library.importFiles(PROJECT, [
      { fileName: 'brief.docx', mimeType: '', bytes }
    ])
    const original = library.syncedOriginal(PROJECT, item.id)
    expect(original?.equals(Buffer.from(bytes))).toBe(true)

    // As on a PC that has the row from sync but not the file yet.
    fs.rmSync(path.join(tempDir(), 'library', PROJECT, item.id), { recursive: true, force: true })
    db.prepare('DELETE FROM search_index WHERE entity_id = ?').run(item.id)
    expect(library.syncedOriginal(PROJECT, item.id)).toBeNull()

    await library.receiveSyncedOriginal(PROJECT, item.id, original!)
    expect(library.syncedOriginal(PROJECT, item.id)?.equals(original!)).toBe(true)
    expect(fs.existsSync(path.join(tempDir(), 'library', PROJECT, item.id, 'extracted.txt'))).toBe(
      true
    )
    expect(search.search('marquee', { types: ['library'] })[0]?.id).toBe(item.id)
  })

  it('refuses bytes that are not the item file', async () => {
    const [{ item }] = await library.importFiles(PROJECT, [
      { fileName: 'brief.docx', mimeType: '', bytes: docx({ paragraphs: ['Hello'] }) }
    ])
    await expect(
      library.receiveSyncedOriginal(PROJECT, item.id, Buffer.from('something else'))
    ).rejects.toThrow(/does not match/)
  })
})
