import { CONTACT_LIMITS, isEmailAddress, websiteHref, type ContactPhone } from './contacts'

/**
 * Reads `.vcf` files (N6.5): one card or many, vCard 2.1, 3.0 and 4.0. Only
 * FN, N, ORG, TITLE, TEL, EMAIL, URL, ADR and NOTE are read; photos, sounds,
 * keys and everything else are skipped unread. The file is untrusted: its
 * size, its number of cards and the length of each line are capped, every
 * value is cut to the contact limits, and nothing in it is ever run or
 * followed.
 *
 * The bytes are read one to one (latin1), so a 2.1 card's CHARSET can be
 * honoured: each value is turned back into bytes, quoted-printable is
 * decoded, and the bytes are read in the card's charset (UTF-8 otherwise).
 */

export const VCARD_LIMITS = {
  /** The largest file read, in bytes. */
  bytes: 5 * 1024 * 1024,
  cards: 5000,
  /** A longer (unfolded) line is skipped: only photos and the like are that long. */
  lineLength: 20000
} as const

export interface VCardContact {
  name: string
  organisation: string
  role: string
  phones: ContactPhone[]
  emails: string[]
  website: string
  address: string
  notes: string
}

export interface VCardReadResult {
  cards: VCardContact[]
  /** Cards left out: no name and no email, or past the card limit. */
  skipped: number
  /** True when the file had more cards than are read. */
  tooManyCards: boolean
}

export class VCardError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VCardError'
  }
}

/** Words for phone types; the person can change them after import. */
export interface VCardWords {
  mobile: string
  home: string
  work: string
  fax: string
}

const DEFAULT_WORDS: VCardWords = { mobile: 'Mobile', home: 'Home', work: 'Work', fax: 'Fax' }

const READ_PROPERTIES = new Set(['FN', 'N', 'ORG', 'TITLE', 'TEL', 'EMAIL', 'URL', 'ADR', 'NOTE'])

interface Property {
  name: string
  params: Map<string, string[]>
  /** Latin1 text: one character per byte. */
  raw: string
}

export function readVCards(bytes: Uint8Array, words: VCardWords = DEFAULT_WORDS): VCardReadResult {
  if (bytes.length > VCARD_LIMITS.bytes) throw new VCardError('too-large')
  let text = latin1(bytes)
  // A UTF-8 byte order mark, as Windows apps write.
  if (text.startsWith('ï»¿')) text = text.slice(3)
  const lines = unfold(text.split(/\r\n|\r|\n/))
  const cards: VCardContact[] = []
  let skipped = 0
  let tooManyCards = false
  let current: Property[] | null = null
  let sawCard = false
  for (const line of lines) {
    if (line.length > VCARD_LIMITS.lineLength) continue
    const upper = line.trim().toUpperCase()
    if (upper === 'BEGIN:VCARD') {
      sawCard = true
      current = []
      continue
    }
    if (upper === 'END:VCARD') {
      if (current) {
        if (cards.length >= VCARD_LIMITS.cards) {
          tooManyCards = true
          skipped += 1
        } else {
          const card = toContact(current, words)
          if (card) cards.push(card)
          else skipped += 1
        }
      }
      current = null
      continue
    }
    if (!current) continue
    const property = parseLine(line)
    if (property && READ_PROPERTIES.has(property.name)) current.push(property)
  }
  if (!sawCard) throw new VCardError('no-cards')
  return { cards, skipped, tooManyCards }
}

function latin1(bytes: Uint8Array): string {
  let text = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk)
    text += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return text
}

/**
 * Joins folded lines: a line starting with a space or tab continues the one
 * before (3.0, 4.0, and 2.1 in practice), and a quoted-printable value ending
 * in "=" continues on the next line (2.1's soft line break).
 */
function unfold(lines: string[]): string[] {
  const out: string[] = []
  let continuesQp = false
  for (const line of lines) {
    if (out.length > 0 && continuesQp) {
      out[out.length - 1] = out[out.length - 1].slice(0, -1) + line
    } else if (out.length > 0 && (line.startsWith(' ') || line.startsWith('\t'))) {
      out[out.length - 1] += line.slice(1)
    } else {
      out.push(line)
    }
    const last = out[out.length - 1]
    // Bail out of runaway lines early; they are skipped anyway.
    if (last.length > VCARD_LIMITS.lineLength * 4) {
      out[out.length - 1] = last.slice(0, VCARD_LIMITS.lineLength + 1)
      continuesQp = false
      continue
    }
    continuesQp =
      /QUOTED-PRINTABLE/i.test(last.slice(0, Math.max(0, last.indexOf(':')))) && last.endsWith('=')
  }
  return out
}

/** "item1.TEL;TYPE=CELL,VOICE:+44 20" → TEL, { TYPE: [CELL, VOICE] }, "+44 20". */
function parseLine(line: string): Property | null {
  let inQuotes = false
  let colon = -1
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (char === '"') inQuotes = !inQuotes
    else if (char === ':' && !inQuotes) {
      colon = i
      break
    }
  }
  if (colon <= 0) return null
  const head = line.slice(0, colon).split(';')
  const name = (head[0].split('.').pop() ?? '').trim().toUpperCase()
  const params = new Map<string, string[]>()
  for (const part of head.slice(1)) {
    const equals = part.indexOf('=')
    // 2.1 writes bare types: TEL;CELL;VOICE, and bare QUOTED-PRINTABLE.
    const key = (equals === -1 ? bareParamKey(part) : part.slice(0, equals)).trim().toUpperCase()
    const values = (equals === -1 ? part : part.slice(equals + 1))
      .split(',')
      .map((value) => value.trim().replace(/^"|"$/g, '').toUpperCase())
      .filter(Boolean)
    params.set(key, [...(params.get(key) ?? []), ...values])
  }
  return { name, params, raw: line.slice(colon + 1) }
}

function bareParamKey(value: string): string {
  const upper = value.trim().toUpperCase()
  if (upper === 'QUOTED-PRINTABLE' || upper === 'BASE64' || upper === '8BIT' || upper === '7BIT')
    return 'ENCODING'
  return 'TYPE'
}

/** A property's value as text: quoted-printable decoded and read in its charset. */
function decode(property: Property): string | null {
  const encoding = property.params.get('ENCODING')?.[0]
  if (encoding === 'B' || encoding === 'BASE64') return null
  let raw = property.raw
  if (encoding === 'QUOTED-PRINTABLE')
    raw = raw.replace(/=([0-9A-Fa-f]{2})/g, (_m, hex: string) =>
      String.fromCharCode(parseInt(hex, 16))
    )
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i) & 0xff
  const charset = property.params.get('CHARSET')?.[0]?.toLowerCase() ?? 'utf-8'
  try {
    return new TextDecoder(charset).decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}

/** Splits on unescaped `;` (structured values), then reads `\n`, `\,`, `\;` and `\\`. */
function components(value: string): string[] {
  const parts: string[] = []
  let current = ''
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i]
    if (char === '\\' && i + 1 < value.length) {
      current += char + value[i + 1]
      i += 1
    } else if (char === ';') {
      parts.push(current)
      current = ''
    } else current += char
  }
  parts.push(current)
  return parts.map(unescape)
}

function unescape(value: string): string {
  return value.replace(/\\([nN,;\\:])/g, (_m, char: string) =>
    char === 'n' || char === 'N' ? '\n' : char
  )
}

function clip(value: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  const clean = value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim()
  return clean.length > max ? clean.slice(0, max).trim() : clean
}

function oneLine(value: string, max: number): string {
  return clip(value.replace(/\s*\n\s*/g, ' '), max)
}

function phoneLabel(types: string[], words: VCardWords): string {
  if (types.includes('CELL')) return words.mobile
  if (types.includes('FAX')) return words.fax
  if (types.includes('WORK')) return words.work
  if (types.includes('HOME')) return words.home
  return ''
}

function toContact(properties: Property[], words: VCardWords): VCardContact | null {
  let fn = ''
  let structured = ''
  let organisation = ''
  let role = ''
  let website = ''
  let address = ''
  const notes: string[] = []
  const phones: ContactPhone[] = []
  const emails: string[] = []
  for (const property of properties) {
    const value = decode(property)
    if (value === null) continue
    switch (property.name) {
      case 'FN':
        if (!fn) fn = oneLine(unescape(value), CONTACT_LIMITS.name)
        break
      case 'N':
        if (!structured) {
          const [family = '', given = '', additional = '', prefix = '', suffix = ''] =
            components(value)
          structured = oneLine(
            [prefix, given, additional, family, suffix].filter((part) => part.trim()).join(' '),
            CONTACT_LIMITS.name
          )
        }
        break
      case 'ORG':
        if (!organisation)
          organisation = oneLine(
            components(value)
              .filter((part) => part.trim())
              .join(', '),
            CONTACT_LIMITS.organisation
          )
        break
      case 'TITLE':
        if (!role) role = oneLine(unescape(value), CONTACT_LIMITS.role)
        break
      case 'TEL': {
        // 4.0 may write a tel: URI.
        const number = oneLine(unescape(value).replace(/^tel:/i, ''), CONTACT_LIMITS.phoneNumber)
        if (number && /\d/.test(number) && phones.length < CONTACT_LIMITS.phones) {
          const types = property.params.get('TYPE') ?? []
          phones.push({ label: clip(phoneLabel(types, words), CONTACT_LIMITS.phoneLabel), number })
        }
        break
      }
      case 'EMAIL': {
        const email = oneLine(unescape(value).replace(/^mailto:/i, ''), CONTACT_LIMITS.email)
        if (
          isEmailAddress(email) &&
          emails.length < CONTACT_LIMITS.emails &&
          !emails.some((known) => known.toLowerCase() === email.toLowerCase())
        )
          emails.push(email)
        break
      }
      case 'URL':
        if (!website) {
          const url = oneLine(unescape(value), CONTACT_LIMITS.website)
          if (websiteHref(url) !== null) website = url
        }
        break
      case 'ADR':
        if (!address)
          address = clip(
            components(value)
              .map((part) => part.replace(/\s*\n\s*/g, ', ').trim())
              .filter(Boolean)
              .join(', '),
            CONTACT_LIMITS.address
          )
        break
      case 'NOTE':
        notes.push(unescape(value))
        break
    }
  }
  const name = fn || structured || organisation || emails[0] || ''
  if (!name) return null
  return {
    name: clip(name, CONTACT_LIMITS.name),
    organisation,
    role,
    phones,
    emails,
    website,
    address,
    notes: clip(notes.join('\n\n'), CONTACT_LIMITS.notes)
  }
}
