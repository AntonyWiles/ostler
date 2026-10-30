import { describe, expect, it } from 'vitest'
import { BRAND } from '../../src/shared/brand'
import { LEGACY_NAMES } from '../../src/shared/legacy-names'
import {
  PASTE_LINES_MAX,
  classifyPastedText,
  copiedObjectsText,
  isPictureMime
} from '../../src/shared/whiteboard/paste-rules'
import {
  WHITEBOARD_LIMITS,
  cleanWhiteboardObject,
  type WhiteboardObjectInput
} from '../../src/shared/whiteboard/model'

/** What a paste onto a whiteboard becomes (docs/plans/whiteboards/, D16). */

const PROJECT = '11111111-2222-4333-8444-555555555555'
const TASK = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const TASK_LINK = `${BRAND.urlScheme}://task/${PROJECT}/${TASK}`

describe('classifyPastedText', () => {
  it('empty and blank text is nothing', () => {
    expect(classifyPastedText('')).toEqual({ kind: 'nothing' })
    expect(classifyPastedText('  \r\n\t ')).toEqual({ kind: 'nothing' })
  })

  it('matches the text last copied from a board, ignoring line endings', () => {
    expect(classifyPastedText('A\nB', { copiedText: 'A\nB' })).toEqual({ kind: 'objects' })
    expect(classifyPastedText('A\r\nB\r\n', { copiedText: 'A\nB' })).toEqual({ kind: 'objects' })
    expect(classifyPastedText('A\nB', { copiedText: 'A\r\nB' })).toEqual({ kind: 'objects' })
    expect(classifyPastedText('A\nC', { copiedText: 'A\nB' })).toEqual({
      kind: 'text',
      text: 'A\nC'
    })
    expect(classifyPastedText('A', { copiedText: null })).toEqual({ kind: 'text', text: 'A' })
  })

  it('an Ostler task link is an item link', () => {
    expect(classifyPastedText(` ${TASK_LINK}\n`)).toEqual({
      kind: 'item-link',
      url: TASK_LINK,
      ref: { kind: 'task', projectId: PROJECT, id: TASK }
    })
  })

  it('a legacy-scheme link is rewritten to the current scheme', () => {
    const legacy = `${LEGACY_NAMES.urlScheme}://task/${PROJECT}/${TASK}`
    expect(classifyPastedText(legacy)).toEqual({
      kind: 'item-link',
      url: TASK_LINK,
      ref: { kind: 'task', projectId: PROJECT, id: TASK }
    })
  })

  it('an https address is a web link', () => {
    expect(classifyPastedText('https://example.com/a?b=1')).toEqual({
      kind: 'web-link',
      url: 'https://example.com/a?b=1'
    })
    expect(classifyPastedText('http://example.com')).toEqual({
      kind: 'web-link',
      url: 'http://example.com'
    })
  })

  it('other schemes and links inside a sentence are plain text', () => {
    expect(classifyPastedText('ftp://example.com')).toEqual({
      kind: 'text',
      text: 'ftp://example.com'
    })
    expect(classifyPastedText('see https://example.com now')).toEqual({
      kind: 'text',
      text: 'see https://example.com now'
    })
    expect(classifyPastedText(`open ${TASK_LINK}`)).toEqual({
      kind: 'text',
      text: `open ${TASK_LINK}`
    })
  })

  it('asLines makes one line per non-blank line, trimmed', () => {
    expect(classifyPastedText(' one \r\n\r\n  two\n\n three ', { asLines: true })).toEqual({
      kind: 'lines',
      lines: ['one', 'two', 'three'],
      dropped: 0
    })
  })

  it('asLines keeps the first 50 lines and counts the rest', () => {
    const text = Array.from({ length: 60 }, (_, index) => `line ${index + 1}`).join('\n')
    const result = classifyPastedText(text, { asLines: true })
    expect(result.kind).toBe('lines')
    if (result.kind !== 'lines') return
    expect(result.lines).toHaveLength(PASTE_LINES_MAX)
    expect(result.lines[49]).toBe('line 50')
    expect(result.dropped).toBe(10)
  })

  it('asLines cuts each line to the text limit', () => {
    const result = classifyPastedText(`${'x'.repeat(WHITEBOARD_LIMITS.textChars + 5)}\nshort`, {
      asLines: true
    })
    expect(result.kind === 'lines' && result.lines.map((line) => line.length)).toEqual([
      WHITEBOARD_LIMITS.textChars,
      5
    ])
  })

  it('a single link still wins over asLines', () => {
    expect(classifyPastedText('https://example.com', { asLines: true }).kind).toBe('web-link')
  })

  it('text over the limit is cut', () => {
    const result = classifyPastedText('y'.repeat(WHITEBOARD_LIMITS.textChars + 100))
    expect(result.kind === 'text' && result.text.length).toBe(WHITEBOARD_LIMITS.textChars)
  })
})

describe('isPictureMime', () => {
  it('accepts the four picture types, any case, with parameters', () => {
    expect(isPictureMime('image/png')).toBe(true)
    expect(isPictureMime('image/PNG')).toBe(true)
    expect(isPictureMime('image/png; charset=binary')).toBe(true)
    expect(isPictureMime('image/jpeg')).toBe(true)
    expect(isPictureMime('image/gif')).toBe(true)
    expect(isPictureMime('image/webp')).toBe(true)
  })

  it('refuses other types', () => {
    expect(isPictureMime('image/svg+xml')).toBe(false)
    expect(isPictureMime('text/plain')).toBe(false)
    expect(isPictureMime('')).toBe(false)
  })
})

describe('copiedObjectsText', () => {
  const at = (id: string, x: number, y: number, text = '', kind = 'note'): WhiteboardObjectInput =>
    cleanWhiteboardObject({ id, kind, x, y, width: 10, height: 10, z: 0, text })
  const kindWord = (object: WhiteboardObjectInput) => `[${object.kind}]`

  it('orders top to bottom, then left to right, then by id', () => {
    const objects = [
      at('d', 0, 50, 'bottom'),
      at('c', 30, 0, 'top right'),
      at('b', 0, 0, 'top left b'),
      at('a', 0, 0, 'top left a')
    ]
    expect(copiedObjectsText(objects, kindWord)).toBe('top left a\ntop left b\ntop right\nbottom')
  })

  it('puts multi-line text on one line and falls back to the kind word', () => {
    const objects = [at('a', 0, 0, 'one\ntwo'), at('b', 0, 10, '', 'shape'), at('c', 0, 20, '  ')]
    expect(copiedObjectsText(objects, kindWord)).toBe('one two\n[shape]\n[note]')
  })

  it('is never empty for objects, and empty for none', () => {
    expect(copiedObjectsText([at('a', 0, 0)], kindWord)).toBe('[note]')
    expect(copiedObjectsText([], kindWord)).toBe('')
  })
})
