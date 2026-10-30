import { isOneOf } from '../parse-primitives'

/**
 * Appearance: theme, density and accent (P2.1). The settings live in
 * `OstlerConfig.ui`; main hands the renderer its starting appearance on the
 * command line so the first paint is already in the right theme.
 */

export type ThemeSetting = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'
export type DensitySetting = 'comfortable' | 'compact'
export type AccentSetting = 'ostler' | 'windows'

export const THEME_SETTINGS: readonly ThemeSetting[] = ['system', 'light', 'dark']
export const DENSITY_SETTINGS: readonly DensitySetting[] = ['comfortable', 'compact']
export const ACCENT_SETTINGS: readonly AccentSetting[] = ['ostler', 'windows']

/** What the renderer needs before React renders. */
export interface InitialAppearance {
  theme: ThemeSetting
  density: DensitySetting
  accent: AccentSetting
  /** Windows' accent colour as `#RRGGBB`, or null where it cannot be read. */
  windowsAccent: string | null
  /** Whether the OS prefers dark, as main saw it when the window opened. */
  systemDark: boolean
}

/** The `webPreferences.additionalArguments` switch that carries it. */
export const APPEARANCE_ARGUMENT = '--ostler-appearance='

/**
 * The window background for each resolved theme: `--color-bg` in tokens.css.
 * Main cannot read CSS, so tests/unit/design-tokens.test.ts proves these
 * match the tokens.
 */
export const WINDOW_BACKGROUND: Readonly<Record<ResolvedTheme, string>> = {
  light: '#F6F7F9',
  dark: '#111318'
}

export function resolveTheme(theme: ThemeSetting, systemDark: boolean): ResolvedTheme {
  if (theme === 'system') return systemDark ? 'dark' : 'light'
  return theme
}

/** `RRGGBBAA` or `RRGGBB` (with or without `#`) to `#RRGGBB`; null if invalid. */
export function normalizeAccentColor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = /^#?([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(value.trim())
  return match ? `#${match[1].toUpperCase()}` : null
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return isOneOf(value, allowed) ? value : fallback
}

/** Coerces untrusted input (argv, stored config) into a valid appearance. */
export function normalizeAppearance(value: unknown): InitialAppearance {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  return {
    theme: oneOf(raw.theme, THEME_SETTINGS, 'system'),
    density: oneOf(raw.density, DENSITY_SETTINGS, 'comfortable'),
    accent: oneOf(raw.accent, ACCENT_SETTINGS, 'ostler'),
    windowsAccent: normalizeAccentColor(raw.windowsAccent),
    systemDark: raw.systemDark === true
  }
}

export function encodeAppearanceArgument(appearance: InitialAppearance): string {
  return `${APPEARANCE_ARGUMENT}${JSON.stringify(appearance)}`
}

/** Finds and parses the appearance switch in `argv`; null when absent or invalid. */
export function parseAppearanceArgument(argv: readonly string[]): InitialAppearance | null {
  const argument = argv.find((entry) => entry.startsWith(APPEARANCE_ARGUMENT))
  if (!argument) return null
  try {
    return normalizeAppearance(JSON.parse(argument.slice(APPEARANCE_ARGUMENT.length)))
  } catch {
    return null
  }
}
