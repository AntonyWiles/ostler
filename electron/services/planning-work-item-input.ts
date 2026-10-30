/**
 * Checking and normalising what a caller asks a planning write to store: text
 * lengths, dates, ids, flags and scores. Pure: each returns the clean value or
 * throws the refusal every surface shows.
 */
import { MAX_ESTIMATE } from '@shared/ostler-api'
import { compareIsoDates, isIsoDate } from '@shared/dates'
import { parseGoalMeasure, type GoalMeasure } from '@shared/goal-measures'
import { t } from '@shared/i18n'
import { Refusal } from '@shared/refusal'
import { readScore, type ScoreField } from '@shared/planning/idea-scores'
import { PLAN_FIRST_CHOICES, type PlanFirstChoice } from '@shared/plan-first'

/** A measure as sent (N5.6a), checked by the one parser; null takes it away. */
export function measureValue(value: unknown): GoalMeasure | null {
  if (value === undefined || value === null) return null
  try {
    return parseGoalMeasure(value)
  } catch (error) {
    throw new Refusal(error instanceof Error ? error.message : String(error))
  }
}

export function requiredText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Refusal(`${label} is required`)
  if (value.trim().length > maximum) throw new Refusal(`${label} is too long`)
  return value.trim()
}

export function optionalText(value: unknown, label: string, maximum: number): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new Refusal(`${label} must be text`)
  if (value.trim().length > maximum) throw new Refusal(`${label} is too long`)
  return value.trim()
}

export function textList(
  value: unknown,
  label: string,
  maximumItems: number,
  maximumLength: number
): string[] {
  if (value === undefined) return []
  // Reported separately: a string here used to be counted as an array of
  // characters, so passing "Ships by Friday" complained that it held more
  // than `maximumItems` items rather than that it was not a list at all.
  if (!Array.isArray(value)) {
    throw new Refusal(`${label} must be an array of strings, not ${typeof value}`)
  }
  if (value.length > maximumItems) {
    throw new Refusal(`${label} must contain at most ${maximumItems} items`)
  }
  const result = value.map((item) => requiredText(item, label, maximumLength))
  return [...new Set(result)]
}

export function uniqueIds(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    throw new Refusal(`Dependencies must be an array of ids, not ${typeof value}`)
  }
  if (value.length > 50) {
    throw new Refusal('Dependencies must contain at most 50 items')
  }
  if (value.some((item) => typeof item !== 'string' || !item)) {
    throw new Refusal('Dependency identifiers must be non-empty strings')
  }
  return [...new Set(value as string[])]
}

export function targetDate(value: unknown): string | null {
  return calendarDate(value, 'Target date')
}

/** A calendar day, `YYYY-MM-DD` (`@shared/dates`), or null when empty. */
/** A true-or-false field from untrusted input, or undefined when it was not sent. */
/** Plan first (N9.3b): "default", "yes" or "no"; undefined when not given. */
export function planFirstChoice(value: unknown): PlanFirstChoice | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !PLAN_FIRST_CHOICES.includes(value as PlanFirstChoice)) {
    throw new Refusal('planFirst must be "default", "yes" or "no"')
  }
  return value as PlanFirstChoice
}

export function flag(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw new Refusal(`${label} must be true or false`)
  return value
}

/**
 * An idea's score (N1.1b, the one rule in `idea-scores.ts`): null clears
 * it, and only a whole number from 1 to 5 is kept; 0, 6, 2.5 and text are
 * refused.
 */
export function score(value: unknown, field: ScoreField): number | null {
  if (value === undefined) return null
  const read = readScore(value)
  if (!read.ok) throw new Refusal(t(`errors:planningService.${field}MustScore`))
  return read.value
}

export function calendarDate(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Refusal(`${label} must use YYYY-MM-DD`)
  }
  if (!isIsoDate(value)) throw new Refusal(`${label} is invalid`)
  return value
}

/** One rule for every surface: a task cannot start after it is due. */
export function validateDateRange(startDate: string | null, dueDate: string | null): void {
  if (startDate && dueDate && compareIsoDates(startDate, dueDate) > 0) {
    throw new Refusal(t('errors:planningService.startDateAfterDue'))
  }
}

export function estimate(value: unknown): number | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Refusal(t('errors:planningService.estimateMustNumber'))
  }
  if (value < 0 || value > MAX_ESTIMATE) {
    throw new Refusal(t('errors:planningService.estimateMust0', { MAX_ESTIMATE }))
  }
  return value
}

export function enumValue<T extends string>(value: unknown, allowed: T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Refusal(`Invalid ${label}`)
  }
  return value as T
}
