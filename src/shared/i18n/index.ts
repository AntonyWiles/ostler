import i18next, { type i18n as I18n, type TOptions } from 'i18next'
import { BRAND } from '../brand'
import { BUNDLED_LOCALES, NAMESPACES } from '../locales'
import { LANGUAGE_SYSTEM, type LocaleInfo } from '../ostler-api/locale-types'
import { pseudoLocalizeTree } from './pseudo'

/**
 * The one i18next set-up (P11.1), for main and the renderer alike. Strings
 * live in `src/shared/locales/<language>/<namespace>.json`; code asks for them
 * by key, `t('tasks:drawer.dueDate.label')`, with named values for anything
 * that varies (`t('…', { name })`) and `count` for plurals (`_one`, `_other`
 * keys, through `Intl.PluralRules`). Never build a sentence from pieces.
 *
 * It starts in English as soon as it is imported, so tests and early start-up
 * code get real text. `applyLocale` switches the language; the renderer
 * re-renders and main rebuilds its menus when it does.
 *
 * Every string can use `{{brand}}` (the product's short name), `{{brandFull}}`
 * and `{{aiName}}`: the brand comes from `src/shared/brand.ts`, never the
 * strings.
 */

export const SOURCE_LANGUAGE = 'en'

/** The pseudo-locale (`pseudo.ts`), offered in development builds only. */
export const PSEUDO_LANGUAGE = 'en-XA'

export const i18n: I18n = i18next.createInstance()

void i18n.init({
  resources: { ...BUNDLED_LOCALES },
  lng: SOURCE_LANGUAGE,
  fallbackLng: SOURCE_LANGUAGE,
  ns: NAMESPACES,
  defaultNS: 'common',
  fallbackNS: false,
  initAsync: false,
  returnNull: false,
  returnEmptyString: false,
  interpolation: {
    // React escapes what it renders; menus and notifications are plain text.
    escapeValue: false,
    defaultVariables: { brand: BRAND.name, brandFull: BRAND.fullName, aiName: BRAND.aiName }
  }
})

/** Translates a key: `t('tasks:drawer.dueDate.label')`, `t('common:count.task', { count })`. */
export const t = i18n.t.bind(i18n) as (key: string | string[], options?: TOptions) => string

/**
 * Until a locale is applied (tests, the first moments of start-up), dates and
 * numbers follow the runtime's own locale, as they did before P11.1.
 */
function runtimeLocale(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || SOURCE_LANGUAGE
  } catch {
    return SOURCE_LANGUAGE
  }
}

let formatLocaleTag = runtimeLocale()

/** The locale dates and numbers are formatted in (`format.ts`, `dates.ts`). */
export function formatLocale(): string {
  return formatLocaleTag
}

/** The language strings are shown in now. */
export function currentLanguage(): string {
  return i18n.language || SOURCE_LANGUAGE
}

/** The bundled languages, English first, then the pseudo-locale when it is allowed. */
export function bundledLanguages(pseudo: boolean): string[] {
  const languages = Object.keys(BUNDLED_LOCALES).sort((a, b) =>
    a === SOURCE_LANGUAGE ? -1 : b === SOURCE_LANGUAGE ? 1 : a.localeCompare(b)
  )
  return pseudo ? [...languages, PSEUDO_LANGUAGE] : languages
}

function languageOf(tag: string): string {
  return tag.split('-')[0].toLowerCase()
}

/** A tag's language and script, filled in from its likely subtags (`zh-CN` → `zh`, `Hans`). */
function languageAndScript(tag: string): { language: string; script: string } | null {
  try {
    const { language, script } = new Intl.Locale(tag).maximize()
    return script ? { language, script } : null
  } catch {
    return null
  }
}

/**
 * The bundled language that best matches `tag`, tried in three rules: exact
 * (case-insensitive), then by language alone (`de-DE` → `de`), then by
 * language and script (`zh-CN` and `zh-Hans-CN` → `zh-Hans`, `pt-PT` → `pt-BR`).
 * Returns null when none matches.
 */
export function matchBundled(tag: string, languages: readonly string[]): string | null {
  const exact = languages.find((language) => language.toLowerCase() === tag.toLowerCase())
  if (exact && exact !== PSEUDO_LANGUAGE) return exact
  const byLanguage = languages.find((language) => language === languageOf(tag))
  if (byLanguage) return byLanguage
  const wanted = languageAndScript(tag)
  if (!wanted) return null
  return (
    languages.find((language) => {
      if (language === PSEUDO_LANGUAGE) return false
      const bundled = languageAndScript(language)
      return bundled?.language === wanted.language && bundled.script === wanted.script
    }) ?? null
  )
}

function canonical(tag: string): string | null {
  try {
    return Intl.getCanonicalLocales(tag)[0] ?? null
  } catch {
    return null
  }
}

/**
 * Turns the language setting into what to show and how to format.
 * `systemLocales` are Windows' preferred languages, most preferred first
 * (`app.getPreferredSystemLanguages()`). "Match Windows" takes the first one
 * Ostler has, falling back to English. Dates and numbers follow the Windows
 * locale whenever it is in the language shown, so English in New Zealand
 * formats as en-NZ; the pseudo-locale formats as Windows does.
 */
export function resolveLocale(
  setting: string,
  systemLocales: readonly string[],
  { pseudo }: { pseudo: boolean }
): LocaleInfo {
  const languages = bundledLanguages(pseudo)
  const system = systemLocales.map(canonical).filter((tag): tag is string => tag !== null)
  let language: string | null = null
  if (setting !== LANGUAGE_SYSTEM && languages.includes(setting)) language = setting
  if (language === null) {
    for (const tag of system) {
      language = matchBundled(tag, languages)
      if (language) break
    }
  }
  language ??= SOURCE_LANGUAGE
  const formatLocale =
    language === PSEUDO_LANGUAGE
      ? (system[0] ?? SOURCE_LANGUAGE)
      : (system.find((tag) => languageOf(tag) === languageOf(language)) ?? language)
  return { language, formatLocale, languages }
}

let pseudoLoaded = false

function loadPseudo(): void {
  if (pseudoLoaded) return
  pseudoLoaded = true
  for (const [namespace, tree] of Object.entries(BUNDLED_LOCALES[SOURCE_LANGUAGE])) {
    i18n.addResourceBundle(
      PSEUDO_LANGUAGE,
      namespace,
      pseudoLocalizeTree(tree as Parameters<typeof pseudoLocalizeTree>[0]),
      true,
      true
    )
  }
}

/** Switches the language and the formatting locale. Synchronous: every string is bundled. */
export function applyLocale(locale: Pick<LocaleInfo, 'language' | 'formatLocale'>): void {
  formatLocaleTag = canonical(locale.formatLocale) ?? SOURCE_LANGUAGE
  if (locale.language === PSEUDO_LANGUAGE) loadPseudo()
  if (i18n.language !== locale.language) void i18n.changeLanguage(locale.language)
}

/** Calls `listener` after every language change; returns the unsubscribe. */
export function onLanguageChanged(listener: (language: string) => void): () => void {
  i18n.on('languageChanged', listener)
  return () => i18n.off('languageChanged', listener)
}

/**
 * A language's own name, for the setting: "English", "Deutsch". The
 * pseudo-locale has a name of its own.
 */
export function languageName(language: string): string {
  if (language === PSEUDO_LANGUAGE) return t('settings:general.language.pseudo')
  try {
    const name = new Intl.DisplayNames([language], { type: 'language' }).of(language)
    if (name) return name.charAt(0).toLocaleUpperCase(language) + name.slice(1)
  } catch {
    // An unknown tag: shown as it is.
  }
  return language
}

/**
 * Extra search words kept as one translated, comma-separated string ("add,
 * create, capture"), so each language can offer its own (the command
 * palette's keywords).
 */
export function keywordList(key: string): string[] {
  return t(key)
    .split(',')
    .map((word) => word.trim())
    .filter(Boolean)
}

/**
 * Short sentences read out together, such as a search result's kind and
 * title, its excerpt and its project, joined the way the language joins
 * sentences ("a. b. c"). Empty parts are left out.
 */
export function joinSentences(parts: readonly (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(t('common:sentenceSeparator'))
}
