import { PDFParse } from 'pdf-parse'
import { LIBRARY_MAX_EXTRACTED_CHARS, LIBRARY_SECTION_BREAK } from '@shared/ostler-api'
import { officeKind, readOfficeText, type ExtractedText, type OfficeKind } from './office-text'

/**
 * The one rule for reading a Library file's text (N4.5), used on import and
 * by the background pass alike. Pages, slides and sheets are separated by
 * `LIBRARY_SECTION_BREAK` (see `library-text-location.ts`).
 */

/** How a document's text is read; null when it has none Ostler can read. */
export type TextSource = 'pdf' | 'utf8' | OfficeKind

const UTF8_EXTENSIONS = new Set(['md', 'markdown', 'txt'])

export function textSourceFor(extension: string, isPdf: boolean): TextSource | null {
  if (isPdf) return 'pdf'
  if (UTF8_EXTENSIONS.has(extension)) return 'utf8'
  return officeKind(extension)
}

export interface FileText extends ExtractedText {
  pageCount?: number
}

/** Reads a file's text, cut at `LIBRARY_MAX_EXTRACTED_CHARS`. Throws when it cannot. */
export async function readFileText(buffer: Buffer, source: TextSource): Promise<FileText> {
  if (source === 'utf8') {
    return { text: buffer.toString('utf8').slice(0, LIBRARY_MAX_EXTRACTED_CHARS) }
  }
  if (source === 'pdf') {
    const parser = new PDFParse({ data: new Uint8Array(buffer) })
    try {
      const result = await parser.getText()
      const text = result.pages
        .map((page) => page.text.split(LIBRARY_SECTION_BREAK).join(' '))
        .join(LIBRARY_SECTION_BREAK)
        .slice(0, LIBRARY_MAX_EXTRACTED_CHARS)
      return { text, sections: { kind: 'page' }, pageCount: result.total }
    } finally {
      await parser.destroy()
    }
  }
  return readOfficeText(
    new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
    source,
    {
      maxChars: LIBRARY_MAX_EXTRACTED_CHARS
    }
  )
}
