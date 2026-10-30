import { BRAND } from '../brand'
import { itemLinkTarget, itemLinkUrl, type ItemLinkRef } from '../item-links'
import { WHITEBOARD_LIMITS, type WhiteboardObjectInput } from './model'

/**
 * What a paste onto a whiteboard becomes, as pure rules (plan
 * `docs/plans/whiteboards/`, decision D16): a picture becomes an image
 * object; an Ostler link becomes an item card; a web address becomes a note
 * linked to it; other text becomes one note (Ctrl+Shift+V: one note per line,
 * at most 50); objects copied from a board paste as objects, recognised by
 * the text last put on the clipboard when they were copied. That match by
 * text exists because off screen (tests and agents) only text travels through
 * the clipboard (`electron/preload-clipboard.ts`).
 *
 * The editor and main both read these rules, so this module stays pure: no
 * DOM, Electron, Node or interface words. Reading the clipboard is the
 * caller's job.
 */

/** D16: Ctrl+Shift+V makes at most this many notes. */
export const PASTE_LINES_MAX = 50

/** The picture types a whiteboard accepts, pasted or in a whiteboard file. */
export const PICTURE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const

/** What pasted text becomes. */
export type PastedText =
  | { kind: 'objects' }
  | { kind: 'item-link'; url: string; ref: ItemLinkRef }
  | { kind: 'web-link'; url: string }
  | { kind: 'lines'; lines: string[]; dropped: number }
  | { kind: 'text'; text: string }
  | { kind: 'nothing' }

export interface PasteOptions {
  /** Ctrl+Shift+V: one note per line. */
  asLines?: boolean
  /** The text put on the clipboard when objects were last copied from a board, if any. */
  copiedText?: string | null
}

/** True for a picture type a whiteboard accepts; case and `;` parameters are ignored. */
export function isPictureMime(mimeType: string): boolean {
  const type = mimeType.split(';')[0].trim().toLowerCase()
  return (PICTURE_MIME_TYPES as readonly string[]).includes(type)
}

/** Line endings made `\n`, then trimmed. */
function normalise(text: string): string {
  return text.replace(/\r\n?/g, '\n').trim()
}

function isWebAddress(text: string): boolean {
  try {
    const url = new URL(text)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** D16: what a pasted text becomes, in the order the rules are tried. */
export function classifyPastedText(text: string, options: PasteOptions = {}): PastedText {
  const pasted = normalise(text)
  if (pasted === '') return { kind: 'nothing' }
  if (options.copiedText != null && pasted === normalise(options.copiedText)) {
    return { kind: 'objects' }
  }
  if (!/\s/.test(pasted)) {
    const ref = itemLinkTarget(pasted, BRAND.urlScheme)
    if (ref) return { kind: 'item-link', url: itemLinkUrl(ref, BRAND.urlScheme), ref }
    if (isWebAddress(pasted)) return { kind: 'web-link', url: pasted }
  }
  if (options.asLines) {
    const all = pasted
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
    return {
      kind: 'lines',
      lines: all
        .slice(0, PASTE_LINES_MAX)
        .map((line) => line.slice(0, WHITEBOARD_LIMITS.textChars)),
      dropped: Math.max(0, all.length - PASTE_LINES_MAX)
    }
  }
  return { kind: 'text', text: pasted.slice(0, WHITEBOARD_LIMITS.textChars) }
}

/**
 * The plain text put on the system clipboard when objects are copied: one
 * line per object, top to bottom then left to right (ties by id); a line is
 * the object's text on one line, or `kindWord(object)` when it has none. The
 * editor passes a translated word, so this module holds no interface words.
 */
export function copiedObjectsText(
  objects: readonly WhiteboardObjectInput[],
  kindWord: (object: WhiteboardObjectInput) => string
): string {
  return [...objects]
    .sort((a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((object) => {
      const line = object.text.replace(/\r\n?|\n/g, ' ').trim()
      return line === '' ? kindWord(object) : line
    })
    .join('\n')
}
