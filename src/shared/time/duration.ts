import { MAX_TIME_ENTRY_SECONDS } from '../ostler-api/time-types'
import { formatNumber, numberFormat } from '../format'

/**
 * Durations for time tracking (R2.3): typed by a person as `1h 30m`, `1.5h`
 * or `90m`, with the decimal separator of their region (`1,5h` where a comma
 * is the separator), and shown back in hours. The one parser: the drawer,
 * the Timesheet's editor and the automation API mean the same forms.
 */

/** The decimal separator of the region numbers are formatted in. */
export function decimalSeparator(): string {
  return (
    numberFormat()
      .formatToParts(1.5)
      .find((part) => part.type === 'decimal')?.value ?? '.'
  )
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Seconds, or null when the text is not a duration Ostler reads: empty, zero,
 * longer than a week, a number without a unit, the other region's decimal
 * separator, or anything else.
 */
export function parseDuration(text: string, separator: string = decimalSeparator()): number | null {
  const value = text.trim().toLowerCase()
  if (value === '') return null
  const number = `\\d+(?:${escapeRegExp(separator)}\\d+)?`
  const match = new RegExp(`^(?:(${number})\\s*h)?\\s*(?:(${number})\\s*m(?:in)?)?$`).exec(value)
  if (!match || (match[1] === undefined && match[2] === undefined)) return null
  const read = (part: string | undefined) =>
    part === undefined ? 0 : Number(part.replace(separator, '.'))
  const seconds = Math.round(read(match[1]) * 3600 + read(match[2]) * 60)
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_TIME_ENTRY_SECONDS) return null
  return seconds
}

/** A duration as the parser reads it back: `1h 30m`, `2h`, `45m`. Rounded to the minute. */
export function durationInputText(seconds: number): string {
  const minutes = Math.max(0, Math.round(seconds / 60))
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest}m`
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

/** Hours in the region's format, at most two decimals: "3.5h", "3,5 h". */
export function formatHours(seconds: number): string {
  return formatNumber(Math.round((seconds / 3600) * 100) / 100, {
    style: 'unit',
    unit: 'hour',
    unitDisplay: 'narrow',
    maximumFractionDigits: 2
  })
}

/** A running timer's clock: "0:04", "1:05:09" (hours only once there are any). */
export function formatTimerClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (part: number) => String(part).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`
}

/** Hours as a plain number for CSV, so a spreadsheet can sum it: "1.5", "0.25". */
export function csvHours(seconds: number): string {
  return String(Math.round((seconds / 3600) * 100) / 100)
}
