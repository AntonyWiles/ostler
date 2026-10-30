import { normalizeAppearance, resolveTheme } from '@shared/ostler-api'
import { accentTokens } from './accent'
import { applyAppearance, systemPrefersDark } from './apply-appearance'

/**
 * Imported first in main.tsx: applies the appearance main started the window
 * with before React renders, so starting in light never flashes dark.
 * ThemeProvider takes over from here.
 */
const initial = normalizeAppearance(window.ostlerAPI?.initialAppearance ?? undefined)
const theme = resolveTheme(initial.theme, systemPrefersDark())
applyAppearance({
  theme,
  density: initial.density,
  accent: initial.accent === 'windows' ? accentTokens(initial.windowsAccent, theme) : null
})
