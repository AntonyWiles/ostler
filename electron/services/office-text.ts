import path from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import {
  LIBRARY_MAX_UNZIPPED_BYTES,
  LIBRARY_MAX_XML_DEPTH,
  LIBRARY_MAX_ZIP_ENTRIES,
  LIBRARY_SECTION_BREAK,
  type LibraryTextSections
} from '@shared/ostler-api'
import { localName, readXml, type XmlHandler } from './xml-text-reader'

/**
 * Text from Word, PowerPoint and Excel files for Library search (N4.5).
 *
 * The file is unzipped with fflate and only the XML parts that hold text are
 * inflated: never macros, embedded objects, media or external links. Every
 * limit is checked against the zip's own directory before anything is
 * inflated, and fflate never writes past the size a part declares, so a
 * hostile file cannot make it allocate more than `LIBRARY_MAX_UNZIPPED_BYTES`.
 */

export type OfficeKind = 'docx' | 'pptx' | 'xlsx'

export const OFFICE_MIME: Record<OfficeKind, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
}

export function officeKind(extension: string): OfficeKind | null {
  return extension === 'docx' || extension === 'pptx' || extension === 'xlsx' ? extension : null
}

export interface ExtractedText {
  text: string
  sections?: LibraryTextSections
}

/** Any reason a file's text could not be read. The message is for logs only. */
export class OfficeTextError extends Error {}

export interface OfficeReadOptions {
  /** Stop collecting text after this many characters. */
  maxChars: number
  /** Awaited between parts, so a large file never holds the main process for long. */
  pause?: () => Promise<void>
}

const nextTick = () => new Promise<void>((resolve) => setImmediate(resolve))

export async function readOfficeText(
  bytes: Uint8Array,
  kind: OfficeKind,
  options: OfficeReadOptions
): Promise<ExtractedText> {
  try {
    return await readParts(bytes, kind, options)
  } catch (error) {
    if (error instanceof OfficeTextError) throw error
    throw new OfficeTextError(`Could not read the ${kind} file: ${(error as Error).message}`)
  }
}

async function readParts(
  bytes: Uint8Array,
  kind: OfficeKind,
  options: OfficeReadOptions
): Promise<ExtractedText> {
  const pause = options.pause ?? nextTick
  const files = unzipParts(bytes, kind)
  const part = async (name: string): Promise<string | null> => {
    await pause()
    const data = files.get(name)
    return data ? strFromU8(data) : null
  }
  const text = new TextCollector(options.maxChars)
  switch (kind) {
    case 'docx':
      await readDocx(files, part, text)
      return { text: text.value() }
    case 'pptx': {
      const sections = await readPptx(part, text)
      return { text: text.value(), sections }
    }
    case 'xlsx': {
      const sections = await readXlsx(part, text)
      return { text: text.value(), sections }
    }
  }
}

// ─── Unzipping ──────────────────────────────────────────────────────────────

const WANTED: Record<OfficeKind, RegExp> = {
  docx: /^word\/(document|footnotes|endnotes|header\d*|footer\d*)\.xml$/,
  pptx: /^ppt\/(presentation\.xml|_rels\/presentation\.xml\.rels|slides\/slide\d+\.xml|slides\/_rels\/slide\d+\.xml\.rels|notesSlides\/notesSlide\d+\.xml)$/,
  xlsx: /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/
}

function unzipParts(bytes: Uint8Array, kind: OfficeKind): Map<string, Uint8Array> {
  // A password-protected Office file is not a zip at all (it is an OLE file).
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new OfficeTextError('Not a zip file')
  }
  let entries = 0
  let unzipped = 0
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes, {
      filter: (file) => {
        entries += 1
        if (entries > LIBRARY_MAX_ZIP_ENTRIES) throw new OfficeTextError('Too many zip entries')
        if (!WANTED[kind].test(file.name)) return false
        if (file.compression !== 0 && file.compression !== 8) return false
        unzipped += file.originalSize
        if (unzipped > LIBRARY_MAX_UNZIPPED_BYTES) throw new OfficeTextError('Unzips too large')
        return true
      }
    })
  } catch (error) {
    if (error instanceof OfficeTextError) throw error
    throw new OfficeTextError(`Could not unzip: ${(error as Error).message}`)
  }
  return new Map(Object.entries(files))
}

// ─── Text ───────────────────────────────────────────────────────────────────

class TextCollector {
  private parts: string[] = []
  private length = 0
  constructor(private readonly max: number) {}
  get full(): boolean {
    return this.length >= this.max
  }
  add(text: string): void {
    if (this.full || !text) return
    this.parts.push(text)
    this.length += text.length
  }
  /** Starts the next page, slide or sheet. Always added, so sections still count. */
  section(): void {
    this.parts.push(LIBRARY_SECTION_BREAK)
    this.length += 1
  }
  value(): string {
    return this.parts
      .join('')
      .replace(/ +\t/g, '\t')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .slice(0, this.max)
  }
}

function walk(xml: string, handler: XmlHandler): void {
  readXml(xml, handler, LIBRARY_MAX_XML_DEPTH)
}

/**
 * The text of Word and PowerPoint XML: runs of `t`, with paragraph, line,
 * tab, table cell and row breaks. Deleted text and field codes are other
 * elements, so they are never read.
 */
function paragraphText(xml: string, text: TextCollector): void {
  let inText = 0
  let inCell = 0
  walk(xml, {
    open(name) {
      const local = localName(name)
      if (local === 't') inText += 1
      else if (local === 'tc') inCell += 1
      else if (local === 'tab') text.add('\t')
      else if (local === 'br' || local === 'cr') text.add('\n')
    },
    close(name) {
      const local = localName(name)
      if (local === 't') inText -= 1
      // A cell's paragraphs stay on its row's line.
      else if (local === 'p') text.add(inCell > 0 ? ' ' : '\n')
      else if (local === 'tc') {
        inCell -= 1
        text.add('\t')
      } else if (local === 'tr') text.add('\n')
    },
    text(value) {
      if (inText > 0) text.add(value)
    }
  })
}

async function readDocx(
  files: Map<string, Uint8Array>,
  part: (name: string) => Promise<string | null>,
  text: TextCollector
): Promise<void> {
  const body = await part('word/document.xml')
  if (body === null) throw new OfficeTextError('No document part')
  paragraphText(body, text)
  const byNumber = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true })
  const extra = [
    'word/footnotes.xml',
    'word/endnotes.xml',
    ...[...files.keys()].filter((name) => /^word\/header\d*\.xml$/.test(name)).sort(byNumber),
    ...[...files.keys()].filter((name) => /^word\/footer\d*\.xml$/.test(name)).sort(byNumber)
  ]
  for (const name of extra) {
    if (text.full) break
    const xml = await part(name)
    if (xml !== null) {
      text.add('\n')
      paragraphText(xml, text)
    }
  }
}

/** A relationships part: id → the target's full name inside the zip. */
function relationships(
  xml: string | null,
  base: string
): Map<string, { target: string; type: string }> {
  const map = new Map<string, { target: string; type: string }>()
  if (xml === null) return map
  walk(xml, {
    open(name, attributes) {
      if (localName(name) !== 'Relationship' || !attributes.Id || !attributes.Target) return
      if (attributes.TargetMode === 'External') return
      const target = attributes.Target.startsWith('/')
        ? attributes.Target.slice(1)
        : path.posix.normalize(path.posix.join(base, attributes.Target))
      map.set(attributes.Id, { target, type: attributes.Type ?? '' })
    }
  })
  return map
}

/** The `r:id` of each child of `listName` named `itemName`, in order. */
function listedIds(xml: string, listName: string, itemName: string): Array<Record<string, string>> {
  const items: Array<Record<string, string>> = []
  let inList = 0
  walk(xml, {
    open(name, attributes) {
      const local = localName(name)
      if (local === listName) inList += 1
      else if (inList > 0 && local === itemName) items.push(attributes)
    },
    close(name) {
      if (localName(name) === listName) inList -= 1
    }
  })
  return items
}

function relationshipId(attributes: Record<string, string>): string | undefined {
  const key = Object.keys(attributes).find((name) => localName(name) === 'id' && name !== 'id')
  return key ? attributes[key] : undefined
}

async function readPptx(
  part: (name: string) => Promise<string | null>,
  text: TextCollector
): Promise<LibraryTextSections> {
  const presentation = await part('ppt/presentation.xml')
  if (presentation === null) throw new OfficeTextError('No presentation part')
  const rels = relationships(await part('ppt/_rels/presentation.xml.rels'), 'ppt')
  const slides = listedIds(presentation, 'sldIdLst', 'sldId')
    .map((attributes) => rels.get(relationshipId(attributes) ?? '')?.target)
    .filter((target): target is string => Boolean(target))
  for (let index = 0; index < slides.length; index += 1) {
    if (index > 0) text.section()
    if (text.full) continue
    const slide = slides[index]
    const xml = await part(slide)
    if (xml === null) continue
    paragraphText(xml, text)
    const slideRels = relationships(
      await part(
        path.posix.join(path.posix.dirname(slide), '_rels', `${path.posix.basename(slide)}.rels`)
      ),
      path.posix.dirname(slide)
    )
    const notes = [...slideRels.values()].find((rel) => rel.type.endsWith('/notesSlide'))
    const notesXml = notes ? await part(notes.target) : null
    if (notesXml !== null) {
      text.add('\n')
      paragraphText(notesXml, text)
    }
  }
  return { kind: 'slide' }
}

async function readXlsx(
  part: (name: string) => Promise<string | null>,
  text: TextCollector
): Promise<LibraryTextSections> {
  const workbook = await part('xl/workbook.xml')
  if (workbook === null) throw new OfficeTextError('No workbook part')
  const rels = relationships(await part('xl/_rels/workbook.xml.rels'), 'xl')
  const sheets = listedIds(workbook, 'sheets', 'sheet').flatMap((attributes) => {
    const target = rels.get(relationshipId(attributes) ?? '')?.target
    return target ? [{ name: attributes.name ?? '', target }] : []
  })
  const shared = sharedStrings(await part('xl/sharedStrings.xml'))
  const labels: string[] = []
  for (let index = 0; index < sheets.length; index += 1) {
    if (index > 0) text.section()
    labels.push(sheets[index].name)
    if (text.full) continue
    const xml = await part(sheets[index].target)
    if (xml !== null) sheetText(xml, shared, text)
  }
  return { kind: 'sheet', labels }
}

/** Each shared string's text; phonetic runs (`rPh`) are left out. */
function sharedStrings(xml: string | null): string[] {
  const strings: string[] = []
  if (xml === null) return strings
  let current: string[] | null = null
  let inText = 0
  let inPhonetic = 0
  walk(xml, {
    open(name) {
      const local = localName(name)
      if (local === 'si') current = []
      else if (local === 'rPh') inPhonetic += 1
      else if (local === 't') inText += 1
    },
    close(name) {
      const local = localName(name)
      if (local === 'si') {
        strings.push((current ?? []).join(''))
        current = null
      } else if (local === 'rPh') inPhonetic -= 1
      else if (local === 't') inText -= 1
    },
    text(value) {
      if (current && inText > 0 && inPhonetic === 0) current.push(value)
    }
  })
  return strings
}

/**
 * A sheet's cells as text, a row to a line and a tab between cells. Numbers,
 * dates included, are shown as stored: a date is a number with a format, and
 * guessing which numbers are dates would be wrong as often as right.
 */
function sheetText(xml: string, shared: string[], text: TextCollector): void {
  let cellType = ''
  let value: string[] = []
  let inValue = 0
  let inInline = 0
  let inPhonetic = 0
  let row: string[] = []
  walk(xml, {
    open(name, attributes) {
      const local = localName(name)
      if (local === 'row') row = []
      else if (local === 'c') {
        cellType = attributes.t ?? 'n'
        value = []
      } else if (local === 'v') inValue += 1
      else if (local === 'is') inInline += 1
      else if (local === 'rPh') inPhonetic += 1
      else if (local === 't' && inInline > 0) inValue += 1
    },
    close(name) {
      const local = localName(name)
      if (local === 'v') inValue -= 1
      else if (local === 'is') inInline -= 1
      else if (local === 'rPh') inPhonetic -= 1
      else if (local === 't' && inInline > 0) inValue -= 1
      else if (local === 'c') {
        const raw = value.join('')
        let cell = raw
        if (cellType === 's') cell = shared[Number(raw)] ?? ''
        else if (cellType === 'b') cell = raw === '1' ? 'TRUE' : 'FALSE'
        if (cell.trim()) row.push(cell.replace(/\s+/g, ' ').trim())
      } else if (local === 'row') {
        if (row.length > 0) text.add(`${row.join('\t')}\n`)
      }
    },
    text(chunk) {
      if (inValue > 0 && inPhonetic === 0) value.push(chunk)
    }
  })
}
