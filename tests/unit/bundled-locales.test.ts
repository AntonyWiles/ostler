import { describe, expect, it } from 'vitest'
import { resolveLocale } from '@shared/i18n'
import { BUNDLED_LOCALES, NAMESPACES, type LocaleResources } from '@shared/locales'

/** Every leaf value by dotted path, namespace first: `common.count.task_one`. */
function leavesOf(object: object, prefix: string, out = new Map<string, unknown>()) {
  for (const [key, value] of Object.entries(object)) {
    const path = `${prefix}.${key}`
    if (value !== null && typeof value === 'object') leavesOf(value, path, out)
    else out.set(path, value)
  }
  return out
}

function allLeaves(resources: LocaleResources) {
  const out = new Map<string, unknown>()
  for (const namespace of Object.keys(resources)) leavesOf(resources[namespace], namespace, out)
  return out
}

const PLURAL = /^(.+?)(_ordinal)?_(zero|one|two|few|many|other)$/

/** Plural groups by base key (`#ordinal` for ordinal ones), each with the forms it has. */
function pluralGroups(leaves: Map<string, unknown>) {
  const groups = new Map<string, Set<string>>()
  for (const path of leaves.keys()) {
    const match = PLURAL.exec(path)
    if (!match) continue
    const group = match[2] ? `${match[1]}#ordinal` : match[1]
    const forms = groups.get(group) ?? new Set<string>()
    forms.add(match[3])
    groups.set(group, forms)
  }
  return groups
}

const english = allLeaves(BUNDLED_LOCALES.en)
const englishPlurals = pluralGroups(english)
const languages = Object.keys(BUNDLED_LOCALES).filter((language) => language !== 'en')

describe.each(languages)('bundled language %s', (language) => {
  const resources = BUNDLED_LOCALES[language]
  const leaves = allLeaves(resources)

  it('has every namespace English has', () => {
    expect(NAMESPACES.filter((namespace) => !(namespace in resources))).toEqual([])
  })

  it('has no _comment keys', () => {
    const comments = [...leaves.keys()].filter((path) =>
      path.split('.').some((segment) => segment.endsWith('_comment'))
    )
    expect(comments).toEqual([])
  })

  it('has exactly the plural forms the language uses, plus zero where English has it', () => {
    const problems: string[] = []
    for (const [group, forms] of pluralGroups(leaves)) {
      const englishForms = englishPlurals.get(group)
      if (!englishForms) continue
      const ordinal = group.endsWith('#ordinal')
      const { pluralCategories } = new Intl.PluralRules(
        language,
        ordinal ? { type: 'ordinal' } : undefined
      ).resolvedOptions()
      const expected = [...pluralCategories, ...(englishForms.has('zero') ? ['zero'] : [])].sort()
      const actual = [...forms].sort()
      if (actual.join(',') !== [...new Set(expected)].sort().join(',')) {
        problems.push(`${group}: has [${actual.join(', ')}], expected [${expected.join(', ')}]`)
      }
    }
    expect(problems).toEqual([])
  })

  it('has a non-empty string for every value', () => {
    const bad = [...leaves]
      .filter(([, value]) => typeof value !== 'string' || value.trim() === '')
      .map(([path]) => path)
    expect(bad).toEqual([])
  })
})

it('shows Japanese to a Windows set to ja-JP', () => {
  expect(resolveLocale('system', ['ja-JP'], { pseudo: false }).language).toBe('ja')
})
