import { afterEach, describe, expect, it } from 'vitest'
import {
  applyLocale,
  bundledLanguages,
  PSEUDO_LANGUAGE,
  SOURCE_LANGUAGE
} from '../../src/shared/i18n'
import { validateProjectPackage } from '../../src/shared/project-package'
import { BUILT_IN_TEMPLATES, DEMO_SOURCES, TEMPLATE_SOURCES } from '../../src/shared/templates'
import {
  DEMO_ENGLISH_NAMES,
  TEMPLATE_TEXT,
  demoProjectName,
  templateTexts,
  isDemoProjectName,
  translateTemplate
} from '../../src/shared/templates/template-text'
import { SAMPLE_TEMPLATE_ID } from '../../src/shared/ostler-api'

const english = [...new Set(Object.values(TEMPLATE_SOURCES).flatMap((json) => templateTexts(json)))]

/** What a translation must keep: amounts, the currency, bold, paragraphs, numbered and bulleted lines. */
function shape(text: string): string {
  return [
    (text.match(/\{\{money:[\d.]+\}\}/g) ?? []).sort().join(),
    (text.match(/\{\{currency\}\}/g) ?? []).length,
    (text.match(/\*\*/g) ?? []).length,
    (text.match(/\n/g) ?? []).length,
    (text.match(/^\d\. /gm) ?? []).length,
    (text.match(/^- /gm) ?? []).length
  ].join('|')
}

describe('built-in template text', () => {
  afterEach(() => applyLocale({ language: SOURCE_LANGUAGE, formatLocale: SOURCE_LANGUAGE }))

  it('has a file for every bundled language but English', () => {
    expect(Object.keys(TEMPLATE_TEXT).sort()).toEqual(
      bundledLanguages(false)
        .filter((language) => language !== SOURCE_LANGUAGE)
        .sort()
    )
  })

  it.each(Object.keys(TEMPLATE_TEXT))(
    '%s translates every string the built-in templates show, and no others',
    (language) => {
      const table = TEMPLATE_TEXT[language]
      expect(english.filter((text) => !(text in table))).toEqual([])
      expect(Object.keys(table).filter((text) => !english.includes(text))).toEqual([])
      for (const text of english) expect(shape(table[text]), text).toBe(shape(text))
    }
  )

  it('finds the words people read, not refs, dates or fixed values', () => {
    expect(english).toContain('Pick the weekend')
    expect(english).toContain('Waiting on someone')
    expect(english).toContain('Snag: ')
    expect(english).toContain('Software project')
    expect(english).toContain('Test on phones and tablets')
    expect(english).not.toContain('backlog')
    expect(english).not.toContain('supplier')
    expect(english).not.toContain('+2d')
    expect(english).not.toContain('#8b5cf6')
  })

  it('makes a demo in the language shown, structure untouched', () => {
    applyLocale({ language: 'de', formatLocale: 'de-DE' })
    const sample = BUILT_IN_TEMPLATES.find((entry) => entry.id === SAMPLE_TEMPLATE_ID)!.json as {
      project: { name: string }
      tasks: { ref: string; title: string; status: string; dueDate?: string }[]
      columns: { names: Record<string, string>; hidden: string[] }
    }
    expect(sample.project.name).toBe(TEMPLATE_TEXT.de[DEMO_ENGLISH_NAMES.simple])
    expect(sample.tasks[0]).toMatchObject({
      ref: 'e1',
      title: 'Das Wochenende auswählen',
      status: 'backlog',
      dueDate: '+2d'
    })
    expect(sample.columns).toEqual({
      names: { backlog: 'Zu erledigen' },
      hidden: ['ready', 'blocked', 'review']
    })
  })

  // Translations can break a package's limits, such as a goal unit's 20 characters.
  it.each([SOURCE_LANGUAGE, PSEUDO_LANGUAGE, ...Object.keys(TEMPLATE_TEXT)])(
    'every built-in template is a valid package in %s',
    (language) => {
      applyLocale({ language, formatLocale: SOURCE_LANGUAGE })
      for (const { id, json } of BUILT_IN_TEMPLATES) {
        const result = validateProjectPackage(json)
        if (!result.ok) throw new Error(`${language} ${id}: ${result.error}`)
      }
    }
  )

  it('names and describes a template in the picker in the language shown', () => {
    applyLocale({ language: 'es', formatLocale: 'es-ES' })
    const software = BUILT_IN_TEMPLATES.find((entry) => entry.id === 'software-project')!.json as {
      project: { name: string }
      template: { description: string }
    }
    expect(software.project.name).toBe('Proyecto de software')
    expect(software.template.description).toBe(
      TEMPLATE_TEXT.es[
        (TEMPLATE_SOURCES['software-project'].template as { description: string }).description
      ]
    )
  })

  it('translates a label and the rule that matches it the same way', () => {
    const pkg = translateTemplate(DEMO_SOURCES.advanced, 'fr') as {
      labels: { name: string }[]
      rules: { conditions: { label?: string }[] }[]
      taskContacts: { role: string }[]
    }
    const snag = pkg.labels[0].name
    expect(snag).toBe('Réserve')
    expect(pkg.rules.flatMap((rule) => rule.conditions).find((c) => c.label)?.label).toBe(snag)
    expect(pkg.taskContacts.map((link) => link.role)).toEqual(
      (DEMO_SOURCES.advanced.taskContacts as { role: string }[]).map((link) => link.role)
    )
  })

  it('names the demos in each language, and knows every such name', () => {
    expect(demoProjectName('simple', SOURCE_LANGUAGE)).toBe(DEMO_ENGLISH_NAMES.simple)
    expect(demoProjectName('advanced', 'ja')).toBe('Harbour Café の改装（上級デモ）')
    expect(demoProjectName('simple', PSEUDO_LANGUAGE)).toBe(DEMO_ENGLISH_NAMES.simple)
    for (const language of [...Object.keys(TEMPLATE_TEXT), SOURCE_LANGUAGE])
      expect(isDemoProjectName('simple', demoProjectName('simple', language))).toBe(true)
    expect(isDemoProjectName('simple', demoProjectName('advanced', 'de'))).toBe(false)
    expect(isDemoProjectName('advanced', 'Our café')).toBe(false)
  })
})
