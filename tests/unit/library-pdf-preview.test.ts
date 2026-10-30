import fs from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LibraryService } from '../../electron/services/library-service'
import { createMigratedDatabase } from '../helpers/database'
import { docx, pdf } from '../helpers/office-files'
import { useTempDir } from '../helpers/temp-dir'

/** The Library's preview of a PDF: its pages, drawn as pictures on first ask. */

const PROJECT = 'b2c09364-5133-4ddf-9131-2b30cd9fa0d9'
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47])

const tempDir = useTempDir('ostler-pdf-preview-')
let library: LibraryService

beforeEach(async () => {
  library = new LibraryService(await createMigratedDatabase(tempDir()), tempDir())
})

afterEach(() => {
  library.close()
})

const importFile = async (fileName: string, bytes: Uint8Array) =>
  (await library.importFiles(PROJECT, [{ fileName, mimeType: '', bytes }]))[0].item

describe('PDF page previews', () => {
  it('draws a page as a PNG once, and keeps it', async () => {
    const item = await importFile('quote.pdf', pdf(['Page one', 'Page two']))
    const [first, again] = await Promise.all([
      library.pdfPagePreview(PROJECT, item.id, 2),
      library.pdfPagePreview(PROJECT, item.id, 2)
    ])
    expect(first?.mimeType).toBe('image/png')
    expect(again?.path).toBe(first?.path)
    expect(fs.readFileSync(first!.path).subarray(0, 4)).toEqual(PNG_SIGNATURE)

    const mtime = fs.statSync(first!.path).mtimeMs
    await library.pdfPagePreview(PROJECT, item.id, 2)
    expect(fs.statSync(first!.path).mtimeMs).toBe(mtime)
  })

  it('has nothing past the last page, nor for a file that is not a PDF', async () => {
    const quote = await importFile('quote.pdf', pdf(['Only page']))
    expect(await library.pdfPagePreview(PROJECT, quote.id, 2)).toBeNull()
    expect(await library.pdfPagePreview(PROJECT, quote.id, 0)).toBeNull()

    const brief = await importFile('brief.docx', docx({ paragraphs: ['Hello'] }))
    expect(await library.pdfPagePreview(PROJECT, brief.id, 1)).toBeNull()
  })
})
