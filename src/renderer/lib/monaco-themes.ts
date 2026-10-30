/**
 * Monaco's light and dark themes, generated from tokens.css so the editor
 * matches the rest of the app. Monaco cannot read CSS variables, so the
 * values are read once from a probe element per theme and handed over as
 * colours. Define them in the editor's `beforeMount`, before it renders,
 * or it flashes Monaco's own theme first.
 */
import {
  COLOR_TOKENS,
  MONACO_THEME_NAME,
  monacoThemeFromTokens,
  type MonacoThemeData
} from './monaco-theme-data'

export { MONACO_THEME_NAME, type OstlerMonacoTheme } from './monaco-theme-data'

/** Reads one theme's tokens from a hidden element carrying its data-theme. */
function readTokens(theme: 'light' | 'dark'): (token: string) => string {
  const probe = document.createElement('div')
  probe.dataset.theme = theme
  probe.hidden = true
  document.body.append(probe)
  const style = getComputedStyle(probe)
  const values = new Map<string, string>()
  for (const token of Object.values(COLOR_TOKENS)) {
    values.set(token, style.getPropertyValue(token))
  }
  probe.remove()
  return (token) => values.get(token) ?? ''
}

interface MonacoLike {
  editor: { defineTheme: (name: string, data: MonacoThemeData) => void }
}

/** Defines both Ostler themes on a Monaco instance. Safe to call more than once. */
export function defineOstlerMonacoThemes(monaco: MonacoLike): void {
  for (const theme of ['light', 'dark'] as const) {
    monaco.editor.defineTheme(
      MONACO_THEME_NAME[theme],
      monacoThemeFromTokens(theme, readTokens(theme))
    )
  }
}
