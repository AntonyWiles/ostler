/**
 * The interface language (P11.1). The setting lives in `OstlerConfig.ui.language`:
 * 'system' ("Match Windows") or a bundled language tag. Main resolves it
 * against Windows' preferred languages and hands the renderer the result on
 * the command line, so the first paint is already in the right language, and
 * again on `ON_LOCALE_CHANGED` when it changes.
 */

/** "Match Windows": the first of Windows' preferred languages that Ostler has. */
export const LANGUAGE_SYSTEM = 'system'

/** The language setting: 'system' or a bundled language tag ('en', 'de', …). */
export type LanguageSetting = string

/** What the renderer needs to translate and format. */
export interface LocaleInfo {
  /** The language strings are shown in: a bundled language tag. */
  language: string
  /**
   * The locale dates and numbers are formatted in: the Windows locale when it
   * is in the same language ('en-NZ' for 'en'), otherwise the language.
   */
  formatLocale: string
  /** The languages the setting offers, in order; the pseudo-locale only in development. */
  languages: string[]
}

/** The `webPreferences.additionalArguments` switch that carries it. */
export const LOCALE_ARGUMENT = '--ostler-locale='

export function encodeLocaleArgument(locale: LocaleInfo): string {
  return `${LOCALE_ARGUMENT}${JSON.stringify(locale)}`
}

const TAG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/

/** Coerces untrusted input into a locale, or null. */
export function normalizeLocaleInfo(value: unknown): LocaleInfo | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const tag = (entry: unknown): entry is string => typeof entry === 'string' && TAG.test(entry)
  if (!tag(raw.language) || !tag(raw.formatLocale)) return null
  const languages = Array.isArray(raw.languages) ? raw.languages.filter(tag) : []
  return { language: raw.language, formatLocale: raw.formatLocale, languages }
}

/** Finds and parses the locale switch in `argv`; null when absent or invalid. */
export function parseLocaleArgument(argv: readonly string[]): LocaleInfo | null {
  const argument = argv.find((entry) => entry.startsWith(LOCALE_ARGUMENT))
  if (!argument) return null
  try {
    return normalizeLocaleInfo(JSON.parse(argument.slice(LOCALE_ARGUMENT.length)))
  } catch {
    return null
  }
}
