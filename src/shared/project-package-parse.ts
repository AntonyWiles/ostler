import { isIsoDate } from './dates'
import { t } from './i18n'
import { isOneOf } from './parse-primitives'
import { isRelativeDate, type PackageDate } from './relative-dates'

/**
 * The checks project-package.ts parses a package with. Each throws a `PackageError` naming the
 * path of the bad value; `validateProjectPackage` turns that into a Result.
 */

const HEX = /^#[0-9a-f]{6}$/i
export const REF = /^[A-Za-z0-9_-]{1,40}$/

/** Thrown inside the validator only; `validateProjectPackage` turns it into a Result. */
export class PackageError extends Error {}

export type Json = Record<string, unknown>

export function fail(message: string): never {
  throw new PackageError(message)
}

export function describe(value: unknown): string {
  if (typeof value === 'string') return `'${value.length > 40 ? `${value.slice(0, 40)}…` : value}'`
  return JSON.stringify(value) ?? String(value)
}

export function record(value: unknown, path: string): Json {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail(t('data:projectPackage.mustObject', { path }))
  return value as Json
}

/** Refuses any field the format does not have, and any required one missing. */
export function fields(value: Json, path: string, required: string[], optional: string[]): void {
  const known = new Set([...required, ...optional])
  for (const key of Object.keys(value)) {
    if (!known.has(key)) fail(t('data:projectPackage.notFieldFormatHas', { path, key }))
  }
  for (const key of required) {
    if (value[key] === undefined) fail(t('data:projectPackage.missing', { path, key }))
  }
}

export function text(value: unknown, path: string, max: number, required = false): string {
  if (value === undefined || value === null) {
    if (required) fail(t('data:projectPackage.missing2', { path }))
    return ''
  }
  if (typeof value !== 'string') fail(t('data:projectPackage.mustText', { path }))
  const trimmed = value.trim()
  if (required && !trimmed) fail(t('data:projectPackage.mustNotEmpty', { path }))
  if (value.length > max) fail(t('data:projectPackage.longerThanCharacters', { path, max }))
  return required ? trimmed : value
}

export function list(value: unknown, path: string, max: number): unknown[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) fail(t('data:projectPackage.mustList', { path }))
  if (value.length > max) fail(t('data:projectPackage.hasMoreThanEntries', { path, max }))
  return value
}

export function textList(
  value: unknown,
  path: string,
  maxItems: number,
  maxLength: number
): string[] {
  return list(value, path, maxItems).map((item, index) =>
    text(item, `${path}[${index}]`, maxLength, true)
  )
}

export function oneOf<T extends string>(
  value: unknown,
  allowed: T[],
  path: string,
  fallback: T
): T {
  if (value === undefined || value === null) return fallback
  if (!isOneOf(value, allowed))
    fail(
      t('data:projectPackage.notOne', { path, describe: describe(value), join: allowed.join(', ') })
    )
  return value
}

export function color(value: unknown, path: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || !HEX.test(value))
    fail(t('data:projectPackage.mustColourLikeB82f6', { path, describe: describe(value) }))
  return value.toLowerCase()
}

export function date(value: unknown, path: string): PackageDate | null {
  if (value === undefined || value === null || value === '') return null
  if (isRelativeDate(value) || isIsoDate(value)) return value
  fail(t('data:projectPackage.mustDateLike2026', { path, describe: describe(value) }))
}

export function ref(value: unknown, path: string): string {
  if (typeof value !== 'string' || !REF.test(value))
    fail(t('data:projectPackage.mustShortReferenceLetters', { path, describe: describe(value) }))
  return value
}

export function optionalRef(value: unknown, path: string): string | null {
  return value === undefined || value === null ? null : ref(value, path)
}

/** Refuses a ref used twice in one list. */
export function uniqueRefs(items: { ref: string }[], path: string): Set<string> {
  const seen = new Set<string>()
  items.forEach((item, index) => {
    if (seen.has(item.ref))
      fail(t('data:projectPackage.refUsedTwice', { path, index, ref: item.ref }))
    seen.add(item.ref)
  })
  return seen
}

export function resolves(
  value: string | null,
  known: Set<string>,
  path: string,
  what: string
): void {
  if (value !== null && !known.has(value))
    fail(t('data:projectPackage.doesNotMatchAny', { path, value, what }))
}
