import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { MONACO_THEME_NAME, monacoThemeFromTokens } from '@renderer/lib/monaco-theme-data'

/** Token values for one theme block of tokens.css. */
function tokensFor(theme: 'light' | 'dark'): Map<string, string> {
  const css = readFileSync(join(__dirname, '../../src/renderer/styles/tokens.css'), 'utf8')
  const marker = theme === 'light' ? "[data-theme='light'] {" : "[data-theme='dark'] {"
  const start = css.indexOf(marker)
  const block = css.slice(start, css.indexOf('}', start))
  return new Map([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]))
}

describe('Monaco themes from the tokens', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`paints the ${theme} editor in the ${theme} tokens`, () => {
      const tokens = tokensFor(theme)
      const data = monacoThemeFromTokens(theme, (token) => tokens.get(token) ?? '')
      expect(data.base).toBe(theme === 'dark' ? 'vs-dark' : 'vs')
      expect(data.colors['editor.background']).toBe(tokens.get('--color-surface'))
      expect(data.colors['editor.foreground']).toBe(tokens.get('--color-text'))
      expect(data.colors['diffEditor.insertedTextBackground']).toBe(
        tokens.get('--color-success-subtle')
      )
      expect(data.colors['diffEditor.removedTextBackground']).toBe(
        tokens.get('--color-danger-subtle')
      )
    })
  }

  it('leaves values Monaco cannot take to its base theme', () => {
    const data = monacoThemeFromTokens('light', () => 'Canvas')
    expect(data.colors).toEqual({})
  })

  it('names one theme per appearance', () => {
    expect(MONACO_THEME_NAME).toEqual({ light: 'ostler-light', dark: 'ostler-dark' })
  })
})
