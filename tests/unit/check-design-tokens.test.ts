import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { checkCode, checkCss, checkTsx, checkTree } from '../../scripts/check-design-tokens.cjs'

describe('check-design-tokens', () => {
  let dir: string | null = null

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = null
  })

  /** A throwaway src/renderer with the given files. */
  function renderer(files: Record<string, string>): string {
    dir = mkdtempSync(join(tmpdir(), 'ostler-tokens-'))
    for (const [name, content] of Object.entries(files)) {
      const path = join(dir, name)
      mkdirSync(join(path, '..'), { recursive: true })
      writeFileSync(path, content)
    }
    return dir
  }

  it('catches a hex colour in feature CSS', () => {
    const root = renderer({ 'views/Feature.css': '.feature {\n  color: #ff0000;\n}\n' })
    expect(checkTree(root)).toEqual([
      'src/renderer/views/Feature.css:2: raw colour (use a colour token)'
    ])
  })

  it('ignores tokens.css, where the raw values live', () => {
    const root = renderer({ 'styles/tokens.css': ':root {\n  --color-bg: #f6f7f9;\n}\n' })
    expect(checkTree(root)).toEqual([])
  })

  it('catches rgb(), hsl() and pixel font sizes, and passes tokens', () => {
    expect(checkCss('a {\n  background: rgb(0 0 0 / 50%);\n}')).toHaveLength(1)
    expect(checkCss('a {\n  color: hsla(0, 0%, 0%, 0.5);\n}')).toHaveLength(1)
    expect(checkCss('a {\n  font-size: 13px;\n}')).toEqual([
      '2: pixel font-size (use a type token)'
    ])
    expect(checkCss('a {\n  color: var(--color-text);\n  font-size: var(--text-body);\n}')).toEqual(
      []
    )
  })

  it('does not mistake an id selector or a comment for a colour', () => {
    expect(checkCss('#root {\n  display: flex;\n}\n/* was #ffffff */')).toEqual([])
  })

  it('catches a literal colour in an inline style, not a dynamic one', () => {
    expect(checkTsx("<span style={{ color: '#93c5fd' }} />")).toHaveLength(1)
    expect(checkTsx("<span style={{ background: 'red' }} />")).toHaveLength(1)
    expect(checkTsx('<span style={{ background: project.color }} />')).toEqual([])
    expect(checkTsx("<span style={{ color: 'var(--color-text)' }} />")).toEqual([])
  })

  it('catches named colours and the other colour functions, not words that contain them', () => {
    expect(checkCss('a {\n  color: white;\n}')).toEqual(['2: raw colour (use a colour token)'])
    expect(checkCss('a {\n  border: 1px solid Red;\n}')).toContain(
      '2: raw colour (use a colour token)'
    )
    expect(checkCss('a {\n  background: color-mix(in srgb, var(--x) 20%, black);\n}')).toEqual([
      '2: raw colour (use a colour token)'
    ])
    expect(checkCss('a {\n  color: oklch(70% 0.1 200);\n}')).toHaveLength(1)
    expect(checkCss('a {\n  color: color(display-p3 1 0 0);\n}')).toHaveLength(1)
    expect(
      checkCss(
        [
          'a {',
          '  background: var(--annotation-red);',
          '  white-space: nowrap;',
          "  content: 'red';",
          '  color: CanvasText;',
          '  border-color: Highlight;',
          '  forced-color-adjust: none;',
          '}'
        ].join('\n')
      )
    ).toEqual([])
  })

  it('catches numeric weights and pixel border and outline widths', () => {
    expect(checkCss('a {\n  font-weight: 600;\n}')).toEqual([
      '2: numeric font-weight (use a weight token)'
    ])
    for (const declaration of [
      'border-bottom: 1px solid var(--color-border);',
      'border-block-start: 1px solid var(--color-border);',
      'outline: 2px solid var(--color-focus);',
      'outline-offset: -2px;'
    ]) {
      expect(checkCss(`a {\n  ${declaration}\n}`)).toEqual([
        '2: pixel border or outline width (use --border-width or the focus-ring tokens)'
      ])
    }
    expect(
      checkCss(
        [
          'a {',
          '  font-weight: var(--weight-semibold);',
          '  border-bottom: var(--border-width) solid var(--color-border);',
          '  outline: var(--focus-ring-width) solid var(--color-focus);',
          '  outline-offset: calc(-1 * var(--focus-ring-width));',
          '  border-radius: var(--radius-md);',
          '}'
        ].join('\n')
      )
    ).toEqual([])
  })

  it('catches a selector on translated words', () => {
    expect(checkCss(".view[aria-label='Recycle bin'] .table {\n  gap: 0;\n}")).toEqual([
      '1: selector on translated text (use a class or a data attribute)'
    ])
    expect(checkCss('.view--bin .table,\n[title="Close"] {\n  gap: 0;\n}')).toEqual([
      '2: selector on translated text (use a class or a data attribute)'
    ])
    expect(checkCss("[aria-pressed='true'],\n[data-state='paid'] {\n  gap: 0;\n}")).toEqual([])
  })

  it('catches literal colours in SVG attributes, not tokens or expressions', () => {
    expect(checkTsx('<rect fill="#d1d9e0" />')).toEqual([
      '1: literal colour in an SVG attribute (use a token or a class)'
    ])
    expect(checkTsx("<path stroke={'red'} />")).toEqual([
      '1: literal colour in an SVG attribute (use a token or a class)'
    ])
    expect(
      checkTsx(
        [
          '<path fill="none" stroke={color} />',
          '<rect fill={`url(#${gradient})`} stroke="currentColor" />',
          '<line stroke="var(--chart-2)" fill={\'transparent\'} />'
        ].join('\n')
      )
    ).toEqual([])
  })

  it('catches a colour string in code, outside comments', () => {
    expect(checkCode("const person = { color: '#3b82f6' }")).toEqual([
      '1: literal colour in code (use a token, or PROJECT_COLORS)'
    ])
    expect(checkCode("const ink = 'rgb(0 0 0 / 50%)'")).toHaveLength(1)
    expect(checkCode("// was '#3b82f6'\nconst color = PROJECT_COLORS[0]")).toEqual([])
    expect(checkCode("if (href.startsWith('#')) return")).toEqual([])
  })

  it('checks .ts files as well as components', () => {
    const root = renderer({ 'context/People.ts': "export const fallback = '#3b82f6'\n" })
    expect(checkTree(root)).toEqual([
      'src/renderer/context/People.ts:1: literal colour in code (use a token, or PROJECT_COLORS)'
    ])
  })

  it('passes on the repository', () => {
    expect(checkTree(join(__dirname, '..', '..', 'src', 'renderer'))).toEqual([])
  })
})
