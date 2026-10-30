import fs from 'node:fs'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LIBRARY_TEXT_READER_VERSION } from '../../src/shared/ostler-api'
import { LibraryService } from '../../electron/services/library-service'
import { SearchService } from '../../electron/services/search-service'
import { createMigratedDatabase } from '../helpers/database'
import { docx, pdf, pptx, xlsx } from '../helpers/office-files'
import { useTempDir } from '../helpers/temp-dir'

/**
 * N4.5: Word, PowerPoint and Excel files are read for search on import and,
 * for files imported earlier, once by the background pass; results say the
 * page, slide or sheet.
 */

const PROJECT = 'b2c09364-5133-4ddf-9131-2b30cd9fa0d9'

const tempDir = useTempDir('ostler-file-search-')
let databasePath: string
let library: LibraryService
let db: Database.Database
let search: SearchService

beforeEach(async () => {
  databasePath = await createMigratedDatabase(tempDir())
  library = new LibraryService(databasePath, tempDir())
  db = new Database(databasePath)
  search = new SearchService(db, () => [PROJECT])
})

afterEach(() => {
  db.close()
  library.close()
})

const importFile = async (fileName: string, bytes: Uint8Array) =>
  (await library.importFiles(PROJECT, [{ fileName, mimeType: '', bytes }]))[0].item

const find = (query: string) => search.search(query, { types: ['library'] })

describe('search inside files', () => {
  it('finds words in a Word file with the passage marked', async () => {
    const item = await importFile(
      'brief.docx',
      docx({ paragraphs: ['Notes for the evening.', 'The venue capacity is 240 people seated.'] })
    )
    expect(item.file?.textReader).toBe(LIBRARY_TEXT_READER_VERSION)
    expect(item.file?.mimeType).toContain('wordprocessingml')
    const [result] = find('capacity')
    expect(result.id).toBe(item.id)
    expect(result.location).toBeUndefined()
    expect(result.snippet.filter((part) => part.match).map((part) => part.text)).toEqual([
      'capacity'
    ])
  })

  it('says the slide of a match in a deck and the sheet of a match in a workbook', async () => {
    await importFile('deck.pptx', pptx([{ text: ['Welcome'] }, { text: ['Catering options'] }]))
    await importFile(
      'budget.xlsx',
      xlsx([
        { name: 'Summary', rows: [['Total', 5000]] },
        { name: 'Budget', rows: [['Marquee hire', 1800]] }
      ])
    )
    expect(find('catering')[0].location).toEqual({ kind: 'slide', label: '2' })
    const [sheet] = find('marquee')
    expect(sheet.location).toEqual({ kind: 'sheet', label: 'Budget' })
    expect(sheet.snippet.some((part) => part.match && /marquee/i.test(part.text))).toBe(true)
  })

  it('says the page of a match in a PDF', async () => {
    const item = await importFile('plan.pdf', pdf(['Opening words', 'Parking behind the hall']))
    expect(item.file?.pageCount).toBe(2)
    expect(find('parking')[0].location).toEqual({ kind: 'page', label: '2' })
  })

  it('keeps a file it cannot read, with no text, and says so', async () => {
    const item = await importFile('locked.docx', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3]))
    expect(item.file?.textUnreadable).toBe(true)
    expect(item.file?.extractedChars).toBe(0)
    expect(library.getItem(PROJECT, item.id).file?.textUnreadable).toBe(true)
    // Nothing else broke: the next file is read as normal.
    await importFile('next.docx', docx({ paragraphs: ['Afterwards fine'] }))
    expect(find('afterwards')).toHaveLength(1)
  })
})

describe('files imported before the reader', () => {
  /** Makes an item look as it did before N4.5: no reader version, no text. */
  function makeOld(itemId: string): void {
    const row = db.prepare('SELECT file_json FROM library_items WHERE id = ?').get(itemId) as {
      file_json: string
    }
    const file = JSON.parse(row.file_json)
    delete file.textReader
    delete file.textSections
    file.mimeType = 'application/octet-stream'
    db.prepare('UPDATE library_items SET file_json = ? WHERE id = ?').run(
      JSON.stringify(file),
      itemId
    )
    db.prepare("UPDATE library_search SET extracted_text = '' WHERE item_id = ?").run(itemId)
  }

  it('lists them, reads each once, and updates only its own row', async () => {
    const deck = await importFile('deck.pptx', pptx([{ text: ['One'] }, { text: ['Fireworks'] }]))
    const notes = await importFile('notes.txt', new TextEncoder().encode('plain text'))
    const other = await importFile('other.docx', docx({ paragraphs: ['Untouched'] }))
    makeOld(deck.id)
    expect(find('fireworks')).toHaveLength(0)
    expect(library.listUnreadDocuments()).toEqual([{ projectId: PROJECT, itemId: deck.id }])

    const before = library.getItem(PROJECT, deck.id)
    const otherBefore = db.prepare('SELECT * FROM library_items WHERE id = ?').get(other.id)
    expect(await library.readStoredText(PROJECT, deck.id)).toBe(true)

    const after = library.getItem(PROJECT, deck.id)
    expect(after.revision).toBe(before.revision)
    expect(after.updatedAt).toBe(before.updatedAt)
    expect(after.file?.textReader).toBe(LIBRARY_TEXT_READER_VERSION)
    expect(after.file?.mimeType).toContain('presentationml')
    expect(find('fireworks')[0].location).toEqual({ kind: 'slide', label: '2' })
    expect(db.prepare('SELECT * FROM library_items WHERE id = ?').get(other.id)).toEqual(
      otherBefore
    )
    expect(library.listUnreadDocuments()).toEqual([])
    expect(notes.file?.textReader).toBe(LIBRARY_TEXT_READER_VERSION)
  })

  it('marks a file whose original is missing as reached, so it is not tried again', async () => {
    const doc = await importFile('gone.docx', docx({ paragraphs: ['x'] }))
    makeOld(doc.id)
    fs.rmSync(library.originalFilePath(PROJECT, doc.id))
    expect(await library.readStoredText(PROJECT, doc.id)).toBe(true)
    expect(library.listUnreadDocuments()).toEqual([])
  })
})
