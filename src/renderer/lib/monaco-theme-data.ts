/**
 * Monaco's light and dark theme data, built from token values (tokens.css).
 * Pure, so it is unit-tested; monaco-themes.ts reads the values from the page
 * and defines the themes.
 */

export type OstlerMonacoTheme = 'ostler-light' | 'ostler-dark'

export const MONACO_THEME_NAME: Record<'light' | 'dark', OstlerMonacoTheme> = {
  light: 'ostler-light',
  dark: 'ostler-dark'
}

/** Which Monaco colour each token paints. */
export const COLOR_TOKENS: Record<string, string> = {
  'editor.background': '--color-surface',
  'editor.foreground': '--color-text',
  'editorLineNumber.foreground': '--color-text-muted',
  'editorLineNumber.activeForeground': '--color-text',
  'editorCursor.foreground': '--color-accent',
  'editor.selectionBackground': '--color-surface-selected',
  'editor.inactiveSelectionBackground': '--color-surface-active',
  'editor.lineHighlightBackground': '--color-surface-hover',
  'editorIndentGuide.background': '--color-border',
  'editorWhitespace.foreground': '--color-border-strong',
  'editorWidget.background': '--color-surface-raised',
  'editorWidget.border': '--color-border',
  'editorGutter.background': '--color-surface',
  'minimap.background': '--color-surface-sunken',
  'scrollbarSlider.background': '--color-surface-active',
  'scrollbarSlider.hoverBackground': '--color-border-strong',
  focusBorder: '--color-focus',
  'diffEditor.insertedTextBackground': '--color-success-subtle',
  'diffEditor.removedTextBackground': '--color-danger-subtle',
  'diffEditor.insertedLineBackground': '--color-success-subtle',
  'diffEditor.removedLineBackground': '--color-danger-subtle'
}

export interface MonacoThemeData {
  base: 'vs' | 'vs-dark'
  inherit: boolean
  rules: []
  colors: Record<string, string>
}

const HEX = /^#[0-9a-f]{3,8}$/i

/**
 * The theme for one appearance. `read` returns a token's value; anything
 * Monaco cannot take (not a hex colour, as under Windows high contrast) is
 * left to Monaco's base theme.
 */
export function monacoThemeFromTokens(
  theme: 'light' | 'dark',
  read: (token: string) => string
): MonacoThemeData {
  const colors: Record<string, string> = {}
  for (const [key, token] of Object.entries(COLOR_TOKENS)) {
    const value = read(token).trim()
    if (HEX.test(value)) colors[key] = value
  }
  return { base: theme === 'dark' ? 'vs-dark' : 'vs', inherit: true, rules: [], colors }
}
