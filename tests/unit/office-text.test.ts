import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import {
  LIBRARY_MAX_UNZIPPED_BYTES,
  LIBRARY_MAX_ZIP_ENTRIES,
  LIBRARY_SECTION_BREAK
} from '../../src/shared/ostler-api'
import { OfficeTextError, readOfficeText } from '../../electron/services/office-text'
import { readFileText } from '../../electron/services/library-file-text'
import { firstMatchOffset, locationAt } from '../../electron/services/library-text-location'
import { docx, pdf, pptx, xlsx, zip } from '../helpers/office-files'

const read = (bytes: Uint8Array, kind: 'docx' | 'pptx' | 'xlsx', maxChars = 120_000) =>
  readOfficeText(bytes, kind, { maxChars })

const sections = (text: string) => text.split(LIBRARY_SECTION_BREAK).map((part) => part.trim())

describe('reading Word files', () => {
  it('reads paragraphs, tables, headers, footers and footnotes, never deleted text', async () => {
    const { text, sections: marks } = await read(
      docx({
        paragraphs: ['The venue holds 240 people.', 'Doors open at 7 &amp; close at 11.'],
        table: [
          ['Item', 'Cost'],
          ['Hall', '900']
        ],
        header: 'Event brief',
        footer: 'Page footer',
        footnote: 'Capacity from the venue site.'
      }),
      'docx'
    )
    expect(marks).toBeUndefined()
    expect(text).toContain('The venue holds 240 people.\nDoors open at 7 & close at 11.')
    expect(text).toContain('Item\tCost')
    expect(text).toContain('Hall\t900')
    expect(text.indexOf('venue holds')).toBeLessThan(text.indexOf('Capacity from'))
    expect(text).toContain('Event brief')
    expect(text).toContain('Page footer')
    expect(text).not.toContain('deleted words')
  })

  it('stops at the extracted text limit', async () => {
    const { text } = await read(
      docx({ paragraphs: ['a'.repeat(500), 'b'.repeat(500)] }),
      'docx',
      600
    )
    expect(text.length).toBeLessThanOrEqual(600)
  })
})

describe('reading PowerPoint files', () => {
  it('reads each slide and its notes in presentation order, one section per slide', async () => {
    const { text, sections: marks } = await read(
      pptx([
        { text: ['Welcome', 'Agenda'], notes: 'Say hello first' },
        { text: ['Budget'] },
        { text: ['Venue capacity 240'], notes: 'Check fire rules' }
      ]),
      'pptx'
    )
    expect(marks).toEqual({ kind: 'slide' })
    expect(sections(text)).toEqual([
      'Welcome\nAgenda\n\nSay hello first',
      'Budget',
      'Venue capacity 240\n\nCheck fire rules'
    ])
  })
})

describe('reading Excel files', () => {
  it('reads sheets row by row with shared and inline strings, numbers as stored', async () => {
    const { text, sections: marks } = await read(
      xlsx([
        {
          name: 'Budget',
          rows: [
            ['Item', 'Cost', 'Paid'],
            ['Hall', 900.5, true],
            [{ inline: 'Catering' }, 1200, false]
          ]
        },
        { name: 'Dates', rows: [['Launch', { date: 46000 }]] }
      ]),
      'xlsx'
    )
    expect(marks).toEqual({ kind: 'sheet', labels: ['Budget', 'Dates'] })
    expect(sections(text)).toEqual([
      'Item\tCost\tPaid\nHall\t900.5\tTRUE\nCatering\t1200\tFALSE',
      'Launch\t46000'
    ])
    expect(text).not.toContain('phonetic')
  })
})

describe('hostile and broken files', () => {
  const fails = (bytes: Uint8Array, kind: 'docx' | 'pptx' | 'xlsx' = 'docx') =>
    expect(read(bytes, kind)).rejects.toBeInstanceOf(OfficeTextError)

  it('refuses a zip whose parts unzip to more than the limit, before inflating', async () => {
    const bytes = docx({ paragraphs: ['small'] })
    // Claim the document part unzips to more than the limit in the central directory.
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    for (let at = 0; at < bytes.length - 4; at += 1) {
      if (view.getUint32(at, true) === 0x02014b50) {
        const nameLength = view.getUint16(at + 28, true)
        const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength))
        if (name === 'word/document.xml')
          view.setUint32(at + 24, LIBRARY_MAX_UNZIPPED_BYTES + 1, true)
      }
    }
    await fails(bytes)
  })

  it('reads a part that unzips to more than it claims only up to its claim', async () => {
    const bytes = zipSync({
      'word/document.xml': strToU8(
        `<w:document><w:body>${'<w:p/>'.repeat(200_000)}</w:body></w:document>`
      )
    })
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    for (let at = 0; at < bytes.length - 4; at += 1) {
      if (view.getUint32(at, true) === 0x02014b50) view.setUint32(at + 24, 64, true)
    }
    // The first 64 bytes are not well-formed XML: refused, and nothing larger was allocated.
    await fails(bytes)
  })

  it('refuses a zip with too many entries', async () => {
    const parts: Record<string, string> = { 'word/document.xml': '<w:document/>' }
    for (let index = 0; index <= LIBRARY_MAX_ZIP_ENTRIES; index += 1) parts[`x/${index}`] = ''
    await fails(zip(parts))
  })

  it('refuses deeply nested XML', async () => {
    await fails(zip({ 'word/document.xml': `${'<a>'.repeat(1000)}text${'</a>'.repeat(1000)}` }))
  })

  it('refuses XML with a document type, so no entity is ever expanded', async () => {
    await fails(
      zip({
        'word/document.xml':
          '<!DOCTYPE lol [<!ENTITY a "aaaa">]><w:document><w:t>&a;</w:t></w:document>'
      })
    )
  })

  it('refuses a file missing its main part', async () => {
    await fails(zip({ 'word/styles.xml': '<w:styles/>' }))
    await fails(zip({ 'ppt/slides/slide1.xml': '<p:sld/>' }), 'pptx')
    await fails(zip({ 'xl/sharedStrings.xml': '<sst/>' }), 'xlsx')
  })

  it('refuses a password-protected file, which is not a zip', async () => {
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0])
    await fails(ole)
  })

  it('refuses a truncated zip', async () => {
    await fails(docx({ paragraphs: ['cut short'] }).subarray(0, 40))
  })
})

describe('pages, slides and sheets', () => {
  it('keeps a page break between PDF pages and finds the page of a match', async () => {
    const result = await readFileText(
      pdf(['Welcome to the plan', 'Venue holds 240', 'Thanks']),
      'pdf'
    )
    expect(result.pageCount).toBe(3)
    expect(result.sections).toEqual({ kind: 'page' })
    expect(sections(result.text)).toEqual(['Welcome to the plan', 'Venue holds 240', 'Thanks'])
    const offset = firstMatchOffset(result.text, ['VENUE'])
    expect(locationAt(result.text, result.sections!, offset)).toEqual({ kind: 'page', label: '2' })
  })

  it('names the slide and the sheet a match is on', () => {
    const slides = ['Intro', 'Budget', 'Venue'].join(LIBRARY_SECTION_BREAK)
    expect(locationAt(slides, { kind: 'slide' }, firstMatchOffset(slides, ['venue']))).toEqual({
      kind: 'slide',
      label: '3'
    })
    const sheets = ['Item\tCost', 'Launch'].join(LIBRARY_SECTION_BREAK)
    expect(
      locationAt(
        sheets,
        { kind: 'sheet', labels: ['Budget', 'Dates'] },
        firstMatchOffset(sheets, ['cost'])
      )
    ).toEqual({ kind: 'sheet', label: 'Budget' })
    expect(firstMatchOffset(sheets, ['nowhere'])).toBe(-1)
    expect(locationAt(sheets, { kind: 'sheet', labels: [] }, 0)).toBeNull()
  })
})
