/**
 * Just enough XML to read WebDAV answers (CalDAV, CardDAV): elements,
 * attributes, text, CDATA and the five entities plus numeric ones. Namespace
 * prefixes are dropped, so `d:href` and `D:href` are both `href`; DAV answers
 * never use one local name for two things. No DTDs, no external entities:
 * anything like them is skipped as text, never fetched.
 */

export interface XmlElement {
  name: string
  attributes: Record<string, string>
  children: XmlElement[]
  text: string
}

export class XmlError extends Error {}

export function parseXml(source: string): XmlElement {
  const root: XmlElement = { name: '#root', attributes: {}, children: [], text: '' }
  const stack: XmlElement[] = [root]
  let i = 0
  const top = () => stack[stack.length - 1]
  while (i < source.length) {
    const lt = source.indexOf('<', i)
    if (lt === -1) {
      top().text += decode(source.slice(i))
      break
    }
    if (lt > i) top().text += decode(source.slice(i, lt))
    if (source.startsWith('<![CDATA[', lt)) {
      const end = source.indexOf(']]>', lt + 9)
      if (end === -1) throw new XmlError('Unclosed CDATA')
      top().text += source.slice(lt + 9, end)
      i = end + 3
      continue
    }
    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt + 4)
      if (end === -1) throw new XmlError('Unclosed comment')
      i = end + 3
      continue
    }
    if (source.startsWith('<?', lt) || source.startsWith('<!', lt)) {
      const end = source.indexOf('>', lt)
      if (end === -1) throw new XmlError('Unclosed declaration')
      i = end + 1
      continue
    }
    const gt = findTagEnd(source, lt)
    const inner = source.slice(lt + 1, gt)
    i = gt + 1
    if (inner.startsWith('/')) {
      const name = localName(inner.slice(1).trim())
      // Close up to the matching element; tolerate a stray close.
      for (let depth = stack.length - 1; depth > 0; depth--) {
        if (stack[depth].name === name) {
          stack.length = depth
          break
        }
      }
      continue
    }
    const selfClosing = inner.endsWith('/')
    const body = selfClosing ? inner.slice(0, -1) : inner
    const match = /^\s*([^\s/>]+)/.exec(body)
    if (!match) throw new XmlError('Bad tag')
    const element: XmlElement = {
      name: localName(match[1]),
      attributes: readAttributes(body.slice(match[0].length)),
      children: [],
      text: ''
    }
    top().children.push(element)
    if (!selfClosing) stack.push(element)
  }
  const first = root.children[0]
  if (!first) throw new XmlError('No element')
  return first
}

/** Every descendant with this local name, in document order. */
export function findAll(element: XmlElement, name: string): XmlElement[] {
  const found: XmlElement[] = []
  const walk = (node: XmlElement) => {
    for (const child of node.children) {
      if (child.name === name) found.push(child)
      walk(child)
    }
  }
  walk(element)
  return found
}

export function findFirst(element: XmlElement, name: string): XmlElement | null {
  return findAll(element, name)[0] ?? null
}

/** The trimmed text of the first descendant with this name, or null. */
export function textOf(element: XmlElement, name: string): string | null {
  const found = findFirst(element, name)
  return found ? found.text.trim() : null
}

function findTagEnd(source: string, from: number): number {
  let quote: string | null = null
  for (let i = from + 1; i < source.length; i++) {
    const c = source[i]
    if (quote) {
      if (c === quote) quote = null
    } else if (c === '"' || c === "'") {
      quote = c
    } else if (c === '>') {
      return i
    }
  }
  throw new XmlError('Unclosed tag')
}

function localName(name: string): string {
  const colon = name.indexOf(':')
  return colon === -1 ? name : name.slice(colon + 1)
}

function readAttributes(text: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  const pattern = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    attributes[localName(match[1])] = decode(match[3] ?? match[4] ?? '')
  }
  return attributes
}

const ENTITIES: Record<string, string> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'"
}

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity[0] === '#') {
      const code =
        entity[1] === 'x' || entity[1] === 'X'
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole
    }
    return ENTITIES[entity.toLowerCase()] ?? whole
  })
}

/** Text made safe to put inside an XML element. */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
