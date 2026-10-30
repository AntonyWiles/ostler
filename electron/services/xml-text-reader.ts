/**
 * A small XML reader for the parts of Office files (N4.5): just enough to walk
 * elements and text. It never resolves anything outside the text it is given:
 * a DOCTYPE is refused outright (no entity definitions, no external
 * entities), only the five XML entities and character references are
 * decoded, and nesting deeper than `maxDepth` is refused.
 */

export interface XmlHandler {
  open?(name: string, attributes: Record<string, string>): void
  close?(name: string): void
  text?(text: string): void
}

export class XmlReadError extends Error {}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'"
}

export function decodeXmlEntities(value: string): string {
  if (!value.includes('&')) return value
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1))
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
    }
    return NAMED_ENTITIES[body] ?? whole
  })
}

const ATTRIBUTE = /([^\s=/]+)\s*=\s*("([^"]*)"|'([^']*)')/g

function readAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  ATTRIBUTE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = ATTRIBUTE.exec(source)) !== null) {
    attributes[match[1]] = decodeXmlEntities(match[3] ?? match[4] ?? '')
  }
  return attributes
}

/** Walks `xml`, calling `handler` for each element and run of text. Throws `XmlReadError`. */
export function readXml(xml: string, handler: XmlHandler, maxDepth: number): void {
  let at = 0
  let depth = 0
  const length = xml.length
  while (at < length) {
    const lt = xml.indexOf('<', at)
    const textEnd = lt === -1 ? length : lt
    if (textEnd > at && depth > 0) handler.text?.(decodeXmlEntities(xml.slice(at, textEnd)))
    if (lt === -1) break
    if (xml.startsWith('<?', lt)) {
      at = endOf(xml, '?>', lt)
    } else if (xml.startsWith('<!--', lt)) {
      at = endOf(xml, '-->', lt)
    } else if (xml.startsWith('<![CDATA[', lt)) {
      const end = endOf(xml, ']]>', lt)
      if (depth > 0) handler.text?.(xml.slice(lt + 9, end - 3))
      at = end
    } else if (xml.startsWith('<!', lt)) {
      throw new XmlReadError('XML with a document type is not read')
    } else if (xml[lt + 1] === '/') {
      const end = endOf(xml, '>', lt)
      depth -= 1
      if (depth < 0) throw new XmlReadError('Unbalanced XML')
      handler.close?.(xml.slice(lt + 2, end - 1).trim())
      at = end
    } else {
      const end = endOf(xml, '>', lt)
      const selfClosing = xml[end - 2] === '/'
      const inner = xml.slice(lt + 1, selfClosing ? end - 2 : end - 1)
      const space = inner.search(/\s/)
      const name = space === -1 ? inner : inner.slice(0, space)
      if (!name) throw new XmlReadError('Malformed XML')
      depth += 1
      if (depth > maxDepth) throw new XmlReadError('XML is nested too deeply')
      handler.open?.(name, space === -1 ? {} : readAttributes(inner.slice(space)))
      if (selfClosing) {
        depth -= 1
        handler.close?.(name)
      }
      at = end
    }
  }
  if (depth !== 0) throw new XmlReadError('Unbalanced XML')
}

function endOf(xml: string, marker: string, from: number): number {
  const index = xml.indexOf(marker, from + 1)
  if (index === -1) throw new XmlReadError('Malformed XML')
  return index + marker.length
}

/** The part after a namespace prefix: `w:t` → `t`. */
export function localName(name: string): string {
  const colon = name.indexOf(':')
  return colon === -1 ? name : name.slice(colon + 1)
}
