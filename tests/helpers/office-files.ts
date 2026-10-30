import { strToU8, zipSync, type Zippable } from 'fflate'

/**
 * Small Word, PowerPoint and Excel files and PDFs made in the test (N4.5),
 * so no binary fixture lives in the repository.
 */

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
const P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
const S = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
const RELS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"'
const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'

export function zip(parts: Record<string, string | Uint8Array>): Uint8Array {
  const files: Zippable = {}
  for (const [name, value] of Object.entries(parts)) {
    files[name] = typeof value === 'string' ? strToU8(value) : value
  }
  return zipSync(files)
}

const paragraph = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`

export function docx(options: {
  paragraphs: string[]
  table?: string[][]
  header?: string
  footer?: string
  footnote?: string
}): Uint8Array {
  const table = options.table
    ? `<w:tbl>${options.table
        .map(
          (row) => `<w:tr>${row.map((cell) => `<w:tc>${paragraph(cell)}</w:tc>`).join('')}</w:tr>`
        )
        .join('')}</w:tbl>`
    : ''
  const parts: Record<string, string> = {
    '[Content_Types].xml': `${DECL}<Types/>`,
    'word/document.xml': `${DECL}<w:document ${W}><w:body>${options.paragraphs
      .map(paragraph)
      .join(
        ''
      )}${table}<w:p><w:r><w:delText>deleted words</w:delText></w:r></w:p></w:body></w:document>`
  }
  if (options.header)
    parts['word/header1.xml'] = `${DECL}<w:hdr ${W}>${paragraph(options.header)}</w:hdr>`
  if (options.footer)
    parts['word/footer1.xml'] = `${DECL}<w:ftr ${W}>${paragraph(options.footer)}</w:ftr>`
  if (options.footnote) {
    parts['word/footnotes.xml'] =
      `${DECL}<w:footnotes ${W}><w:footnote w:id="1">${paragraph(options.footnote)}</w:footnote></w:footnotes>`
  }
  return zip(parts)
}

/** Slides given in presentation order; the files are numbered in reverse, so order comes from the list. */
export function pptx(slides: { text: string[]; notes?: string }[]): Uint8Array {
  const parts: Record<string, string> = {}
  const count = slides.length
  const ids: string[] = []
  const rels: string[] = []
  slides.forEach((slide, index) => {
    const file = count - index
    ids.push(`<p:sldId id="${256 + index}" r:id="rId${index + 10}"/>`)
    rels.push(
      `<Relationship Id="rId${index + 10}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${file}.xml"/>`
    )
    parts[`ppt/slides/slide${file}.xml`] =
      `${DECL}<p:sld ${P} ${A}><p:cSld><p:spTree><p:sp><p:txBody>${slide.text
        .map((line) => `<a:p><a:r><a:t>${line}</a:t></a:r></a:p>`)
        .join('')}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
    if (slide.notes) {
      parts[`ppt/slides/_rels/slide${file}.xml.rels`] =
        `${DECL}<Relationships ${RELS}><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide${file}.xml"/></Relationships>`
      parts[`ppt/notesSlides/notesSlide${file}.xml`] =
        `${DECL}<p:notes ${P} ${A}><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${slide.notes}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`
    }
  })
  parts['ppt/presentation.xml'] =
    `${DECL}<p:presentation ${P} ${R}><p:sldIdLst>${ids.join('')}</p:sldIdLst></p:presentation>`
  parts['ppt/_rels/presentation.xml.rels'] =
    `${DECL}<Relationships ${RELS}>${rels.join('')}</Relationships>`
  return zip(parts)
}

type Cell = string | number | boolean | { inline: string } | { date: number }

export function xlsx(sheets: { name: string; rows: Cell[][] }[]): Uint8Array {
  const shared: string[] = []
  const parts: Record<string, string> = {}
  const sheetList: string[] = []
  const rels: string[] = []
  sheets.forEach((sheet, index) => {
    sheetList.push(`<sheet name="${sheet.name}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
    rels.push(
      `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
    )
    const rows = sheet.rows
      .map(
        (row, r) =>
          `<row r="${r + 1}">${row
            .map((cell) => {
              if (typeof cell === 'string') {
                shared.push(cell)
                return `<c t="s"><v>${shared.length - 1}</v></c>`
              }
              if (typeof cell === 'number') return `<c><v>${cell}</v></c>`
              if (typeof cell === 'boolean') return `<c t="b"><v>${cell ? 1 : 0}</v></c>`
              if ('inline' in cell) return `<c t="inlineStr"><is><t>${cell.inline}</t></is></c>`
              return `<c s="1"><v>${cell.date}</v></c>`
            })
            .join('')}</row>`
      )
      .join('')
    parts[`xl/worksheets/sheet${index + 1}.xml`] =
      `${DECL}<worksheet ${S}><sheetData>${rows}</sheetData></worksheet>`
  })
  parts['xl/workbook.xml'] =
    `${DECL}<workbook ${S} ${R}><sheets>${sheetList.join('')}</sheets></workbook>`
  parts['xl/_rels/workbook.xml.rels'] =
    `${DECL}<Relationships ${RELS}>${rels.join('')}</Relationships>`
  parts['xl/sharedStrings.xml'] = `${DECL}<sst ${S} count="${shared.length}">${shared
    .map((text) => `<si><t>${text}</t><rPh><t>phonetic</t></rPh></si>`)
    .join('')}</sst>`
  return zip(parts)
}

/** A PDF with one page per entry of `pages`, each a line of text in Helvetica. */
export function pdf(pages: string[]): Buffer {
  const objects: string[] = []
  const pageIds = pages.map((_, index) => 4 + index * 2)
  objects[1] = '<</Type/Catalog/Pages 2 0 R>>'
  objects[2] = `<</Type/Pages/Kids[${pageIds.map((id) => `${id} 0 R`).join(' ')}]/Count ${pages.length}>>`
  objects[3] = '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>'
  pages.forEach((text, index) => {
    const id = pageIds[index]
    const stream = `BT /F1 12 Tf 20 200 Td (${text}) Tj ET`
    objects[id] =
      `<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 300]/Resources<</Font<</F1 3 0 R>>>>/Contents ${id + 1} 0 R>>`
    objects[id + 1] = `<</Length ${stream.length}>>stream\n${stream}\nendstream`
  })
  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = body.length
    body += `${id} 0 obj${objects[id]}endobj\n`
  }
  const xref = body.length
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`
  for (let id = 1; id < objects.length; id += 1) {
    body += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`
  }
  body += `trailer<</Size ${objects.length}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}
