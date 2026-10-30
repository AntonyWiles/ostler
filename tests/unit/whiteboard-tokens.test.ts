import * as fs from 'fs'
import * as path from 'path'
import { describe, expect, it } from 'vitest'
import { WHITEBOARD_COLOURS } from '../../src/shared/whiteboard/model'
import { contrastRatio } from '../../src/renderer/ui/theme/accent'

/**
 * The whiteboard's colour tokens (plan docs/plans/whiteboards, D9). The board
 * is paper, the same in every theme, so the pairs are checked once, in the
 * theme-independent :root block; high contrast sets every token to a system
 * colour. If a pair fails, change the value in tokens.css.
 */

const css = fs.readFileSync(path.join(__dirname, '../../src/renderer/styles/tokens.css'), 'utf-8')

function block(start: number): Record<string, string> {
  const body = css.slice(start, css.indexOf('}', start))
  const tokens: Record<string, string> = {}
  for (const match of body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g))
    tokens[match[1]] = match[2].trim()
  return tokens
}

const root = block(css.indexOf(':root {'))
const forcedStart = css.indexOf('@media (forced-colors: active)')
// The media query's own brace, then the brace of the selector list inside it.
const forced = block(css.indexOf('{', css.indexOf('{', forcedStart) + 1))

const TEXT = 4.5

/** [foreground, background] */
const PAIRS: [string, string][] = [
  ['--whiteboard-ink', '--whiteboard-paper'],
  ...WHITEBOARD_COLOURS.flatMap((name): [string, string][] => [
    [`--whiteboard-${name}`, '--whiteboard-paper'],
    ['--whiteboard-ink', `--whiteboard-${name}-light`],
    [`--whiteboard-on-${name}`, `--whiteboard-${name}`]
  ])
]

/** Every whiteboard token and its high-contrast value. */
const FORCED: [string, string][] = [
  ['--whiteboard-paper', 'Canvas'],
  ['--whiteboard-grid', 'GrayText'],
  ['--whiteboard-ink', 'CanvasText'],
  ...WHITEBOARD_COLOURS.flatMap((name): [string, string][] => [
    [`--whiteboard-${name}`, 'CanvasText'],
    [`--whiteboard-${name}-light`, 'Canvas'],
    [`--whiteboard-on-${name}`, 'Canvas']
  ])
]

describe('whiteboard tokens', () => {
  it.each(PAIRS)('%s on %s reaches 4.5:1', (fg, bg) => {
    expect(root[fg], `${fg} is defined`).toMatch(/^#[0-9a-f]{6}$/i)
    expect(root[bg], `${bg} is defined`).toMatch(/^#[0-9a-f]{6}$/i)
    expect(contrastRatio(root[fg], root[bg])).toBeGreaterThanOrEqual(TEXT)
  })

  it('defines the grid colour', () => {
    expect(root['--whiteboard-grid']).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('writes text on a solid fill in pure black or white', () => {
    for (const name of WHITEBOARD_COLOURS) {
      expect(['#000000', '#ffffff']).toContain(root[`--whiteboard-on-${name}`].toLowerCase())
    }
  })

  it.each(FORCED)('high contrast sets %s to %s', (token, value) => {
    expect(forced[token]).toBe(value)
  })

  it('defines no whiteboard token the checks above miss', () => {
    const checked = new Set(FORCED.map(([token]) => token))
    const defined = Object.keys(root).filter((token) => token.startsWith('--whiteboard-'))
    expect(defined.sort()).toEqual([...checked].sort())
  })
})
