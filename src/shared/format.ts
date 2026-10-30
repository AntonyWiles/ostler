import { formatLocale, t } from './i18n'

/**
 * Numbers, moments, relative times, durations and lists in the active
 * locale (P11.1), through `Intl`. Calendar dates (`YYYY-MM-DD`) are formatted
 * by `formatIsoDate` in `dates.ts`, which never reads them as instants.
 * Formatters are cached per locale and options.
 */

const cache = new Map<string, unknown>()

function cached<T>(kind: string, options: object, make: (locale: string) => T): T {
  const locale = formatLocale()
  const key = `${kind}|${locale}|${JSON.stringify(options)}`
  let value = cache.get(key) as T | undefined
  if (value === undefined) {
    value = make(locale)
    cache.set(key, value)
  }
  return value
}

export function numberFormat(options: Intl.NumberFormatOptions = {}): Intl.NumberFormat {
  return cached('number', options, (locale) => new Intl.NumberFormat(locale, options))
}

export function dateTimeFormat(options: Intl.DateTimeFormatOptions = {}): Intl.DateTimeFormat {
  return cached('date', options, (locale) => new Intl.DateTimeFormat(locale, options))
}

/** "1,234.5" or "1.234,5". */
export function formatNumber(value: number, options: Intl.NumberFormatOptions = {}): string {
  return numberFormat(options).format(value)
}

/** A fraction from 0 to 1 as a whole percentage: "42%", "42 %". */
export function formatPercent(fraction: number, maximumFractionDigits = 0): string {
  return formatNumber(fraction, { style: 'percent', maximumFractionDigits })
}

function toDate(at: number | Date): Date {
  return at instanceof Date ? at : new Date(at)
}

/** A moment's date: "8 Oct 2026" (medium) by default. */
export function formatDate(
  at: number | Date,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }
): string {
  return dateTimeFormat(options).format(toDate(at))
}

/** A moment's time of day: "14:05" or "2:05 pm". */
export function formatTime(
  at: number | Date,
  options: Intl.DateTimeFormatOptions = { timeStyle: 'short' }
): string {
  return dateTimeFormat(options).format(toDate(at))
}

/** The exact moment: "8 Oct 2026, 14:05". */
export function formatDateTime(
  at: number | Date,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }
): string {
  return dateTimeFormat(options).format(toDate(at))
}

/** A date without the year when it is this year: "8 Oct", or "8 Oct 2025". */
export function formatShortDate(at: number | Date, now: number | Date = Date.now()): string {
  const date = toDate(at)
  const sameYear = date.getFullYear() === toDate(now).getFullYear()
  return formatDate(date, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' })
  })
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * When something happened: "just now", "5 minutes ago", "yesterday", "3 days
 * ago", and the date beyond a week.
 */
export function formatRelativeTime(at: number, now: number = Date.now()): string {
  const elapsed = Math.max(0, now - at)
  if (elapsed < MINUTE) return t('common:time.justNow')
  // Hermes, the phone's engine, has no RelativeTimeFormat: today's clock time, then calendar days.
  if (typeof Intl.RelativeTimeFormat !== 'function') {
    const midnight = (ms: number) => new Date(ms).setHours(0, 0, 0, 0)
    const days = Math.round((midnight(now) - midnight(at)) / DAY)
    if (days === 0) return formatTime(at)
    if (days === 1) return t('common:date.yesterday')
    if (days < 7) return t('common:date.daysAgo', { count: days })
    return formatShortDate(at, now)
  }
  const words = cached(
    'relative',
    { numeric: 'auto' },
    (locale) => new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  )
  if (elapsed < HOUR) return words.format(-Math.floor(elapsed / MINUTE), 'minute')
  if (elapsed < DAY) return words.format(-Math.floor(elapsed / HOUR), 'hour')
  if (elapsed < 7 * DAY) return words.format(-Math.floor(elapsed / DAY), 'day')
  return formatShortDate(at, now)
}

/**
 * A length of time, largest units first, at most two: "45 s", "3 min 20 s",
 * "2 h 5 min", "3 d 4 h". `long` writes the units out ("2 hours, 5 minutes").
 */
export function formatDuration(ms: number, { long = false }: { long?: boolean } = {}): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const parts: [number, Intl.NumberFormatOptions['unit']][] = [
    [Math.floor(total / 86_400), 'day'],
    [Math.floor((total % 86_400) / 3600), 'hour'],
    [Math.floor((total % 3600) / 60), 'minute'],
    [total % 60, 'second']
  ]
  const first = parts.findIndex(([value]) => value > 0)
  const shown = first === -1 ? [parts[3]] : parts.slice(first, first + 2).filter(([v]) => v > 0)
  const unitDisplay = long ? 'long' : 'short'
  return formatList(
    shown.map(([value, unit]) => formatNumber(value, { style: 'unit', unit, unitDisplay })),
    long ? 'unit' : 'narrow'
  )
}

/** "a, b and c" in the active language. */
export function formatList(
  items: readonly string[],
  style: 'and' | 'or' | 'unit' | 'narrow' = 'and'
): string {
  const options: Intl.ListFormatOptions =
    style === 'or'
      ? { type: 'disjunction' }
      : style === 'unit'
        ? { type: 'unit', style: 'long' }
        : style === 'narrow'
          ? { type: 'unit', style: 'narrow' }
          : { type: 'conjunction' }
  return cached('list', options, (locale) => new Intl.ListFormat(locale, options)).format(items)
}

/** A file size: "512 bytes", "3 kB", "12.0 MB", in the active locale's units. */
export function formatFileSize(bytes: number): string {
  const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const
  let value = Math.max(0, bytes)
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return formatNumber(value, {
    style: 'unit',
    unit: units[index],
    unitDisplay: index === 0 ? 'long' : 'short',
    // Whole bytes and kilobytes, one decimal beyond that.
    minimumFractionDigits: index <= 1 ? 0 : 1,
    maximumFractionDigits: index <= 1 ? 0 : 1
  })
}
