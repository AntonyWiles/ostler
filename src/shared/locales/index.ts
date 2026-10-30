import de from './de'
import en from './en'
import es from './es'
import fr from './fr'
import it from './it'
import ja from './ja'
import ptBR from './pt-BR'
import zhHans from './zh-Hans'

/**
 * The bundled languages (P11.1): one folder per language under
 * `src/shared/locales/`, holding the same namespace files as `en/` and an
 * `index.ts` that lists them, and one line here. A language may leave keys
 * or whole namespaces out; English fills the gaps. See docs/translating.md.
 */

/** A language's strings: namespace → nested keys → text. */
export type LocaleResources = Record<string, object>

export const BUNDLED_LOCALES: Readonly<Record<string, LocaleResources>> = {
  en,
  de,
  es,
  fr,
  it,
  ja,
  'pt-BR': ptBR,
  'zh-Hans': zhHans
}

/** The namespaces, from English, which has every one. */
export const NAMESPACES = Object.keys(en) as (keyof typeof en)[]

export type Namespace = (typeof NAMESPACES)[number]
