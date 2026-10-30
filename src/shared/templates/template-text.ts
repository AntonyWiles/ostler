import { BRAND } from '../brand'
import { currentLanguage, SOURCE_LANGUAGE } from '../i18n'
import type { DemoKind } from '../ostler-api/project-types'
import de from './template-text/de.json'
import es from './template-text/es.json'
import fr from './template-text/fr.json'
import it from './template-text/it.json'
import ja from './template-text/ja.json'
import ptBR from './template-text/pt-BR.json'
import zhHans from './template-text/zh-Hans.json'

/**
 * The built-in templates' words in each bundled language, the demo projects
 * included. Each is written once, in English, in its file in this folder;
 * each file in `template-text/` maps an English string to its translation, so
 * the structure (refs, dates, amounts) stays in one place and a string used
 * twice (a label and the rule that matches it, or "Kitchen" in two templates)
 * is translated the same way every time. A string a language lacks stays
 * English. A template is read in the language shown when it is read;
 * `templateTexts` lists every string that needs a translation.
 */
export const TEMPLATE_TEXT: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  de,
  es,
  fr,
  it,
  ja,
  'pt-BR': ptBR,
  'zh-Hans': zhHans
}

/** The English names the demos are made with. */
export const DEMO_ENGLISH_NAMES: Record<DemoKind, string> = {
  simple: BRAND.sampleProjectName,
  advanced: BRAND.advancedDemoProjectName
}

/** Keys whose string values (or arrays of strings) are words people read. */
const TEXT_KEYS = new Set([
  'name',
  'title',
  'description',
  'outcome',
  'unit',
  'successCriteria',
  'text',
  'context',
  'decision',
  'alternatives',
  'consequences',
  'body',
  'category',
  'summary',
  'aiInstruction',
  'note',
  'notes',
  'goal',
  'label',
  'labels',
  'items',
  'message',
  'checklist',
  'resolutionReason',
  'role',
  'templateName'
])

/** Subtrees with no words in them: `taskContacts[].role` is a fixed value. */
const SKIPPED_KEYS = new Set(['taskContacts', 'columns'])

type Json = Record<string, unknown>

function mapText(value: unknown, inText: boolean, change: (text: string) => string): unknown {
  if (typeof value === 'string') return inText && value.trim() ? change(value) : value
  if (Array.isArray(value)) return value.map((entry) => mapText(entry, inText, change))
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Json).map(([key, entry]) => {
      if (SKIPPED_KEYS.has(key)) {
        // The Board's column names are words, the project's own columns' too
        // (MOP-26); which columns are hidden and what they count as is not. A
        // saved List view's `columns` is a list of column ids, with no words.
        if (
          key !== 'columns' ||
          entry === null ||
          typeof entry !== 'object' ||
          Array.isArray(entry)
        )
          return [key, entry]
        const columns = entry as Json
        const names = Object.entries((columns.names ?? {}) as Json).map(([status, name]) => [
          status,
          mapText(name, true, change)
        ])
        const custom = Array.isArray(columns.custom)
          ? {
              custom: (columns.custom as Json[]).map((column) => ({
                ...column,
                name: mapText(column.name, true, change)
              }))
            }
          : {}
        return [key, { ...columns, names: Object.fromEntries(names), ...custom }]
      }
      return [key, mapText(entry, TEXT_KEYS.has(key), change)]
    })
  )
}

/** Every string in a template's file that people read, each once. */
export function templateTexts(json: Json): string[] {
  const found = new Set<string>()
  mapText(json, false, (text) => {
    found.add(text)
    return text
  })
  return [...found]
}

/**
 * `text` in `language`: its translation, or itself. The pseudo-locale keeps
 * English, since its padding would break the package's length limits.
 */
export function translateTemplateText(text: string, language = currentLanguage()): string {
  return TEMPLATE_TEXT[language]?.[text] ?? text
}

/** A template's file with its words in `language`. */
export function translateTemplate(json: Json, language = currentLanguage()): Json {
  return mapText(json, false, (text) => translateTemplateText(text, language)) as Json
}

/** The name a demo is made with in `language`. */
export function demoProjectName(kind: DemoKind, language = currentLanguage()): string {
  return translateTemplateText(DEMO_ENGLISH_NAMES[kind], language)
}

/** Whether `name` is what a demo of `kind` is made as, in any language: it has not been renamed. */
export function isDemoProjectName(kind: DemoKind, name: string): boolean {
  return [SOURCE_LANGUAGE, ...Object.keys(TEMPLATE_TEXT)].some(
    (language) => demoProjectName(kind, language) === name
  )
}
