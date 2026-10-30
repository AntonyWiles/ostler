import * as fs from 'fs'
import * as path from 'path'
import { describe, expect, it } from 'vitest'
import { WINDOW_BACKGROUND } from '../../src/shared/ostler-api'
import { contrastRatio } from '../../src/renderer/ui/theme/accent'

/**
 * Proves the colour tokens meet WCAG AA in both themes: 4.5:1 for text, 3:1 for
 * icons, focus rings and fills that
 * carry meaning. If a pair fails, change the value in tokens.css.
 */

const css = fs.readFileSync(path.join(__dirname, '../../src/renderer/styles/tokens.css'), 'utf-8')

function themeBlock(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`No block for ${selector}`)
  const body = css.slice(start, css.indexOf('}', start))
  const tokens: Record<string, string> = {}
  for (const match of body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g))
    tokens[match[1]] = match[2].trim()
  return tokens
}

const THEMES = {
  light: themeBlock(":root,\n[data-theme='light']"),
  dark: themeBlock("[data-theme='dark']")
}

const TEXT = 4.5
const NON_TEXT = 3

/** [foreground, background, minimum ratio] */
const PAIRS: [string, string, number][] = [
  // Primary, secondary and muted text on every surface text sits on.
  ...['--color-text', '--color-text-secondary', '--color-text-muted'].flatMap((fg) =>
    ['--color-bg', '--color-surface', '--color-surface-raised', '--color-surface-hover'].map(
      (bg): [string, string, number] => [fg, bg, TEXT]
    )
  ),
  ['--color-text', '--color-surface-sunken', TEXT],
  ['--color-text-secondary', '--color-surface-sunken', TEXT],
  ['--color-text', '--color-surface-active', TEXT],
  ['--color-text', '--color-surface-selected', TEXT],
  ['--color-text-secondary', '--color-surface-selected', TEXT],
  // Accent fills and links.
  ['--color-accent-contrast', '--color-accent', TEXT],
  ['--color-accent-contrast', '--color-accent-hover', TEXT],
  ['--color-accent-contrast', '--color-danger-fill', TEXT],
  ['--color-link', '--color-bg', TEXT],
  ['--color-link', '--color-surface', TEXT],
  ['--color-link', '--color-accent-subtle', TEXT],
  ['--color-focus', '--color-bg', NON_TEXT],
  ['--color-focus', '--color-surface', NON_TEXT],
  // Semantic text on the page, on surfaces and on its own tinted background.
  ...['success', 'warning', 'danger', 'info'].flatMap((tone): [string, string, number][] => [
    [`--color-${tone}`, '--color-bg', TEXT],
    [`--color-${tone}`, '--color-surface', TEXT],
    [`--color-${tone}`, `--color-${tone}-subtle`, TEXT]
  ]),
  // Status and priority icons on cards and rows.
  ...['backlog', 'ready', 'active', 'blocked', 'review', 'done'].map(
    (status): [string, string, number] => [`--status-${status}`, '--color-surface', NON_TEXT]
  ),
  ...['low', 'medium', 'high', 'critical'].map((priority): [string, string, number] => [
    `--priority-${priority}`,
    '--color-surface',
    NON_TEXT
  ])
]

describe('design tokens', () => {
  for (const [theme, tokens] of Object.entries(THEMES)) {
    describe(`${theme} theme`, () => {
      it.each(PAIRS)('%s on %s reaches %s:1', (fg, bg, minimum) => {
        expect(tokens[fg], `${fg} is defined`).toMatch(/^#[0-9a-f]{6}$/i)
        expect(tokens[bg], `${bg} is defined`).toMatch(/^#[0-9a-f]{6}$/i)
        expect(contrastRatio(tokens[fg], tokens[bg])).toBeGreaterThanOrEqual(minimum)
      })

      it('paints the window background in --color-bg', () => {
        expect(WINDOW_BACKGROUND[theme as 'light' | 'dark'].toLowerCase()).toBe(
          tokens['--color-bg'].toLowerCase()
        )
      })
    })
  }

  it('keeps raw colours and pixel sizes in tokens.css only', () => {
    const stylesDir = path.join(__dirname, '../../src/renderer/styles')
    for (const file of ['base.css', 'ostler-theme.css', 'global.css']) {
      const source = fs.readFileSync(path.join(stylesDir, file), 'utf-8')
      expect(source, file).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|font-size:\s*[\d.]+px/i)
    }
  })
})
