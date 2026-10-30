import { app, BrowserWindow } from 'electron'
import * as fs from 'fs'
import { join } from 'path'
import { applyLocale, bundledLanguages, PSEUDO_LANGUAGE, resolveLocale } from '@shared/i18n'
import { IPC_CHANNELS, LANGUAGE_SYSTEM, type LocaleInfo } from '@shared/ostler-api'

/**
 * Main's side of the interface language (P11.1): resolves `ui.language`
 * against Windows' preferred languages, applies it to main's own strings
 * (menus, the tray, notifications and dialogs), and tells every window when it
 * changes, so the renderer re-renders without a restart. The pseudo-locale is
 * offered only when Ostler is not packaged: development runs and the tests.
 */

let current: LocaleInfo | null = null

export function pseudoLocaleAllowed(): boolean {
  return !app.isPackaged
}

/**
 * A locale the tests pin in place of Windows' languages and regional format,
 * so screenshots and money read the same on every machine. Development only.
 */
function pinnedLocale(): string | null {
  return pseudoLocaleAllowed() ? process.env.OSTLER_SYSTEM_LOCALE || null : null
}

/** Windows' preferred languages, most preferred first. */
function systemLocales(): string[] {
  const pinned = pinnedLocale()
  if (pinned) return [pinned]
  try {
    const preferred = app.getPreferredSystemLanguages()
    if (preferred.length > 0) return preferred
  } catch {
    // Older platforms: the app locale below.
  }
  return [app.getLocale()]
}

/**
 * Windows' regional format ("English (New Zealand)" can sit under an en-US
 * display language): what dates and numbers should look like.
 */
function regionalFormat(): string | null {
  const pinned = pinnedLocale()
  if (pinned) return pinned
  try {
    return app.getSystemLocale() || null
  } catch {
    return null
  }
}

export function localeFor(setting: string): LocaleInfo {
  const locale = resolveLocale(setting, systemLocales(), { pseudo: pseudoLocaleAllowed() })
  // Dates and numbers follow the regional format when it is in the language shown.
  const region = regionalFormat()
  const base = (tag: string) => tag.split('-')[0].toLowerCase()
  if (region && (locale.language === PSEUDO_LANGUAGE || base(region) === base(locale.language)))
    return { ...locale, formatLocale: region }
  return locale
}

/** The locale in effect, for a new window. */
export function currentLocale(): LocaleInfo {
  return current ?? localeFor(LANGUAGE_SYSTEM)
}

/**
 * Applies the language setting to main and, when the result changed, sends it
 * to every window. Returns whether it changed.
 */
export function applyLanguageSetting(setting: string): boolean {
  const next = localeFor(setting)
  const changed =
    current === null ||
    current.language !== next.language ||
    current.formatLocale !== next.formatLocale
  current = next
  applyLocale(next)
  if (changed) {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.ON_LOCALE_CHANGED, next)
    }
  }
  return changed
}

/**
 * The language setting straight from `config.json`, before the config store
 * opens it, so the dialogs start-up may show are in the right language.
 * 'system' when there is none or it cannot be read.
 */
export function peekLanguageSetting(dataDir: string): string {
  try {
    const raw = JSON.parse(fs.readFileSync(join(dataDir, 'config.json'), 'utf8')) as {
      ui?: { language?: unknown }
    }
    return typeof raw.ui?.language === 'string' ? raw.ui.language : LANGUAGE_SYSTEM
  } catch {
    return LANGUAGE_SYSTEM
  }
}

/** Whether `value` is a language the setting may hold. */
export function isValidLanguageSetting(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    (value === LANGUAGE_SYSTEM || bundledLanguages(pseudoLocaleAllowed()).includes(value))
  )
}
