import { createContext, Fragment, useContext, useEffect, useState, type ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import { applyLocale, i18n, SOURCE_LANGUAGE } from '@shared/i18n'
import type { LocaleInfo } from '@shared/ostler-api'

/**
 * The renderer's side of the interface language (P11.1). Main hands the
 * window its language on the command line, so the first paint is already
 * translated (`applyInitialLocale`, called before React renders), and sends
 * a new one when the setting or Windows' language changes. Components
 * translate with `t` from `@shared/i18n`; `LanguageBoundary` re-mounts the
 * pages below the router when the language changes, so every string is read
 * again without a restart and the current page stays open.
 */

const FALLBACK: LocaleInfo = {
  language: SOURCE_LANGUAGE,
  formatLocale: SOURCE_LANGUAGE,
  languages: [SOURCE_LANGUAGE]
}

function apply(locale: LocaleInfo): void {
  applyLocale(locale)
  document.documentElement.lang = locale.language
}

/** The locale the window opened in; English when main sent none (tests, the print page). */
export function initialLocale(): LocaleInfo {
  return window.ostlerAPI?.initialLocale ?? FALLBACK
}

/** Before React renders: the language the window opened in. */
export function applyInitialLocale(): void {
  apply(initialLocale())
}

const LocaleContext = createContext<LocaleInfo>(FALLBACK)

/** The language, the formatting locale and the languages the setting offers. */
export function useLocale(): LocaleInfo {
  return useContext(LocaleContext)
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<LocaleInfo>(initialLocale)
  useEffect(() => {
    const update = (next: LocaleInfo) => {
      apply(next)
      setLocale((current) =>
        current.language === next.language &&
        current.formatLocale === next.formatLocale &&
        current.languages.join() === next.languages.join()
          ? current
          : next
      )
    }
    const unsubscribe = window.ostlerAPI?.onLocaleChanged(update)
    // The command line holds the language the window was created in; after a
    // reload the setting may have changed since.
    void window.ostlerAPI?.getLocale?.().then((result) => {
      if (result.ok) update(result.value)
    })
    return unsubscribe
  }, [])
  return (
    <I18nextProvider i18n={i18n}>
      <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>
    </I18nextProvider>
  )
}

/** Re-mounts its children when the language or formatting locale changes. */
export function LanguageBoundary({ children }: { children: ReactNode }) {
  const { language, formatLocale } = useLocale()
  return <Fragment key={`${language}|${formatLocale}`}>{children}</Fragment>
}
