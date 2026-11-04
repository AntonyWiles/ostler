import { afterEach, describe, expect, it } from 'vitest'
import {
  applyLocale,
  bundledLanguages,
  currentLanguage,
  formatLocale,
  i18n,
  languageName,
  matchBundled,
  PSEUDO_LANGUAGE,
  resolveLocale,
  t
} from '@shared/i18n'
import { pseudoLocalize } from '@shared/i18n/pseudo'
import { formatIsoDate, relativeDateText } from '@shared/dates'
import {
  formatDate,
  formatDuration,
  formatFileSize,
  formatList,
  formatNumber,
  formatPercent,
  formatRelativeTime,
  formatTime
} from '@shared/format'

const startingLocale = formatLocale()
afterEach(() => applyLocale({ language: 'en', formatLocale: startingLocale }))

describe('plurals', () => {
  it('counts 0, 1, 2 and many in English with _one and _other', () => {
    expect(t('common:count.task', { count: 0 })).toBe('0 tasks')
    expect(t('common:count.task', { count: 1 })).toBe('1 task')
    expect(t('common:count.task', { count: 2 })).toBe('2 tasks')
    expect(t('common:count.task', { count: 1250 })).toBe('1250 tasks')
  })

  it('uses Intl.PluralRules, so relative days agree with the count', () => {
    const today = new Date(2026, 9, 9)
    expect(relativeDateText('2026-10-10', { today })).toBe('Tomorrow')
    expect(relativeDateText('2026-10-11', { today })).toBe('In 2 days')
    expect(relativeDateText('2026-10-08', { today })).toBe('Overdue by 1 day')
    expect(relativeDateText('2026-10-07', { today, due: false })).toBe('2 days ago')
  })

  it('nests a count inside a whole sentence', () => {
    i18n.addResource('en', 'common', 'test.nested', 'Has $t(common:count.task, {"count": {{n}} })')
    expect(t('common:test.nested', { n: 3 })).toBe('Has 3 tasks')
    expect(t('common:test.nested', { n: 1 })).toBe('Has 1 task')
  })

  it('fills the brand without the strings naming it', () => {
    i18n.addResource('en', 'common', 'test.brand', 'Open {{brand}}')
    expect(t('common:test.brand')).toMatch(/^Open \S+/)
    expect(t('common:test.brand')).not.toContain('{{')
  })
})

describe('formatting', () => {
  // 8 October 2026, 14:05 local time.
  const moment = new Date(2026, 9, 8, 14, 5).getTime()

  // locale, short date, number, time
  const cases: [string, string, string, string][] = [
    ['en-NZ', '08/10/2026', '1,234,567.5', '2:05 pm'],
    ['en-US', '10/8/26', '1,234,567.5', '2:05 PM'],
    ['de-DE', '08.10.26', '1.234.567,5', '14:05'],
    ['ja-JP', '2026/10/08', '1,234,567.5', '14:05']
  ]

  it.each(cases)('formats dates, numbers and times in %s', (locale, date, number, time) => {
    applyLocale({ language: 'en', formatLocale: locale })
    expect(formatIsoDate('2026-10-08', { dateStyle: 'short' })).toBe(date)
    expect(formatNumber(1234567.5)).toBe(number)
    expect(formatTime(moment).replace(/\s/g, ' ')).toBe(time)
  })

  it('formats long dates in each locale', () => {
    applyLocale({ language: 'en', formatLocale: 'en-NZ' })
    expect(formatDate(moment, { dateStyle: 'long' })).toBe('8 October 2026')
    applyLocale({ language: 'en', formatLocale: 'en-US' })
    expect(formatDate(moment, { dateStyle: 'long' })).toBe('October 8, 2026')
    applyLocale({ language: 'en', formatLocale: 'de-DE' })
    expect(formatDate(moment, { dateStyle: 'long' })).toBe('8. Oktober 2026')
    applyLocale({ language: 'en', formatLocale: 'ja-JP' })
    expect(formatDate(moment, { dateStyle: 'long' })).toBe('2026年10月8日')
  })

  it('formats relative times, durations, percentages, lists and sizes', () => {
    applyLocale({ language: 'en', formatLocale: 'en-NZ' })
    const now = moment
    expect(formatRelativeTime(now - 10_000, now)).toBe('just now')
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe('5 minutes ago')
    expect(formatRelativeTime(now - 26 * 3_600_000, now)).toBe('yesterday')
    expect(formatDuration(2 * 3_600_000 + 5 * 60_000, { long: true })).toBe('2 hours, 5 minutes')
    expect(formatPercent(0.42)).toBe('42%')
    expect(formatList(['a', 'b', 'c'])).toBe('a, b and c')
    expect(formatFileSize(512)).toBe('512 bytes')
    applyLocale({ language: 'en', formatLocale: 'de-DE' })
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe('vor 5 Minuten')
    expect(formatPercent(0.42).replace(/\s/g, ' ')).toBe('42 %')
    expect(formatFileSize(3.5 * 1024 * 1024)).toBe('3,5 MB')
    expect(formatList(['a', 'b', 'c'])).toBe('a, b und c')
  })

  it('says when without RelativeTimeFormat, as on the phone', () => {
    applyLocale({ language: 'en', formatLocale: 'en-NZ' })
    const now = new Date(2026, 9, 30, 14, 0).getTime()
    const at = (day: number, hour: number) => new Date(2026, 9, day, hour, 25).getTime()
    const original = Object.getOwnPropertyDescriptor(Intl, 'RelativeTimeFormat')!
    Object.defineProperty(Intl, 'RelativeTimeFormat', { value: undefined, configurable: true })
    try {
      expect(formatRelativeTime(at(30, 9), now)).toBe(formatTime(at(30, 9)))
      expect(formatRelativeTime(at(29, 19), now)).toBe('Yesterday')
      expect(formatRelativeTime(at(26, 19), now)).toBe('4 days ago')
      expect(formatRelativeTime(at(10, 19), now)).toBe('10 Oct')
    } finally {
      Object.defineProperty(Intl, 'RelativeTimeFormat', original)
    }
  })

  it('lists without ListFormat, as on the phone', () => {
    applyLocale({ language: 'en', formatLocale: 'en-NZ' })
    const original = Object.getOwnPropertyDescriptor(Intl, 'ListFormat')!
    Object.defineProperty(Intl, 'ListFormat', { value: undefined, configurable: true })
    try {
      expect(formatList(['a', 'b', 'c'])).toBe('a, b and c')
      expect(formatList(['a', 'b'], 'or')).toBe('a or b')
      expect(formatList(['a'])).toBe('a')
      expect(formatDuration(2 * 3_600_000 + 5 * 60_000, { long: true })).toBe('2 hours, 5 minutes')
    } finally {
      Object.defineProperty(Intl, 'ListFormat', original)
    }
  })
})

describe('matchBundled', () => {
  it('matches a Chinese tag by language and script, whatever region it names', () => {
    expect(matchBundled('zh-Hans-CN', ['en', 'zh-Hans'])).toBe('zh-Hans')
    expect(matchBundled('zh-CN', ['en', 'zh-Hans'])).toBe('zh-Hans')
    expect(matchBundled('zh-TW', ['en', 'zh-Hans'])).toBeNull()
  })

  it('matches a Portuguese tag to the bundled variant with the same script', () => {
    expect(matchBundled('pt-PT', ['en', 'pt-BR'])).toBe('pt-BR')
    expect(matchBundled('pt-BR', ['pt-BR'])).toBe('pt-BR')
    expect(matchBundled('pt-BR', ['pt-PT', 'pt-BR'])).toBe('pt-BR')
  })

  it('matches a regional tag by its language', () => {
    expect(matchBundled('de-DE', ['en', 'de'])).toBe('de')
  })

  it('returns null for an invalid tag instead of throwing', () => {
    expect(matchBundled('not a tag!!', ['en', 'de'])).toBeNull()
    expect(matchBundled('', ['en', 'de'])).toBeNull()
  })
})

describe('resolveLocale', () => {
  it('matches Windows: the first preferred language that is bundled, formatted in its region', () => {
    const locale = resolveLocale('system', ['en-NZ'], { pseudo: false })
    expect(locale).toMatchObject({ language: 'en', formatLocale: 'en-NZ' })
    expect(locale.languages).toEqual(bundledLanguages(false))
  })

  it('falls back to English when Windows has no bundled language', () => {
    expect(resolveLocale('system', ['xx-YY'], { pseudo: false }).language).toBe('en')
  })

  it('takes a chosen language over Windows, formatted in a Windows region of that language', () => {
    expect(resolveLocale('en', ['de-DE', 'en-GB'], { pseudo: false })).toMatchObject({
      language: 'en',
      formatLocale: 'en-GB'
    })
  })

  it('offers the pseudo-locale only when it is allowed', () => {
    expect(bundledLanguages(false)).not.toContain(PSEUDO_LANGUAGE)
    expect(bundledLanguages(true)).toContain(PSEUDO_LANGUAGE)
    expect(resolveLocale(PSEUDO_LANGUAGE, ['en-NZ'], { pseudo: false }).language).toBe('en')
    expect(resolveLocale(PSEUDO_LANGUAGE, ['en-NZ'], { pseudo: true })).toMatchObject({
      language: PSEUDO_LANGUAGE,
      formatLocale: 'en-NZ'
    })
  })

  it('names each language in itself', () => {
    expect(languageName('en')).toBe('English')
    expect(languageName('de')).toBe('Deutsch')
  })
})

describe('the pseudo-locale', () => {
  it('accents, lengthens and brackets a string but keeps its placeholders', () => {
    const value = pseudoLocalize('Delete {{name}}?')
    expect(value.startsWith('[')).toBe(true)
    expect(value.endsWith(']')).toBe(true)
    expect(value).toContain('{{name}}')
    expect(value).toContain('Ðéļéţé')
    expect(value.length).toBeGreaterThan('[Delete {{name}}?]'.length)
  })

  it('switches every string live, leaving interpolated values as they are', () => {
    applyLocale({ language: PSEUDO_LANGUAGE, formatLocale: 'en-NZ' })
    expect(currentLanguage()).toBe(PSEUDO_LANGUAGE)
    expect(formatLocale()).toBe('en-NZ')
    expect(t('common:count.task', { count: 2 })).toMatch(/^\[2 ţàšķš~+\]$/)
    applyLocale({ language: 'en', formatLocale: 'en' })
    expect(t('common:count.task', { count: 2 })).toBe('2 tasks')
  })
})
