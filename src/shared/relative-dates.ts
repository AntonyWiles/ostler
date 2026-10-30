import { isoDaysBetween, shiftIsoDate } from './dates'

/**
 * Relative dates: a day counted from the one a project template, project
 * package or task template (N2.1) is used on, as `+14d`, `-3d` or `+2w`.
 * Every kind of template shares this one idea.
 */

/** A calendar day, or a day relative to the one the package is used on. */
export type PackageDate = string

const RELATIVE_DATE = /^([+-])(\d{1,4})([dw])$/

export function isRelativeDate(value: unknown): value is string {
  return typeof value === 'string' && RELATIVE_DATE.test(value)
}

/** A package date as a calendar day: relative ones counted from `today`. */
export function resolvePackageDate(value: PackageDate | null, today: string): string | null {
  if (value === null) return null
  const match = RELATIVE_DATE.exec(value)
  if (!match) return value
  const amount = Number(match[2]) * (match[3] === 'w' ? 7 : 1)
  return shiftIsoDate(today, match[1] === '-' ? -amount : amount)
}

/** A calendar day as an offset from `today`, in days: `+14d`, `-3d`, `+0d`. */
export function relativePackageDate(value: string | null, today: string): PackageDate | null {
  if (value === null) return null
  const days = isoDaysBetween(today, value)
  return `${days < 0 ? '-' : '+'}${Math.abs(days)}d`
}
