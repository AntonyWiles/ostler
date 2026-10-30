import {
  DEFAULT_FOCUS_SETTINGS,
  FOCUS_BREAK_MAX_MINUTES,
  FOCUS_BREAK_MIN_MINUTES,
  FOCUS_MAX_LENGTHS,
  FOCUS_MAX_MINUTES,
  FOCUS_MIN_MINUTES,
  type FocusSettings,
  type FocusState
} from './ostler-api/focus-types'

/**
 * The focus rules (N3.5) shared by main, the renderer and the automation API:
 * which lengths are allowed, the settings within their bounds, and time left
 * from the stored end, so a laptop that slept wakes to the right time.
 */

/** A whole number of minutes from 5 to 180. */
export function isFocusMinutes(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= FOCUS_MIN_MINUTES &&
    value <= FOCUS_MAX_MINUTES
  )
}

export function isBreakMinutes(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= FOCUS_BREAK_MIN_MINUTES &&
    value <= FOCUS_BREAK_MAX_MINUTES
  )
}

/** The settings within their bounds: unknown values fall back to the defaults. */
export function normalizeFocusSettings(value: unknown): FocusSettings {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Partial<FocusSettings>
  const lengths = Array.isArray(raw.lengths)
    ? [...new Set(raw.lengths.filter(isFocusMinutes))].slice(0, FOCUS_MAX_LENGTHS)
    : []
  return {
    lengths: lengths.length > 0 ? lengths : [...DEFAULT_FOCUS_SETTINGS.lengths],
    breakMinutes: isBreakMinutes(raw.breakMinutes)
      ? raw.breakMinutes
      : DEFAULT_FOCUS_SETTINGS.breakMinutes,
    chime: typeof raw.chime === 'boolean' ? raw.chime : DEFAULT_FOCUS_SETTINGS.chime,
    lastMinutes: isFocusMinutes(raw.lastMinutes)
      ? raw.lastMinutes
      : DEFAULT_FOCUS_SETTINGS.lastMinutes
  }
}

/** The lengths offered, smallest first, with the last one used among them. */
export function focusLengthChoices(settings: FocusSettings): number[] {
  return [...new Set([...settings.lengths, settings.lastMinutes])].sort((a, b) => a - b)
}

/** Milliseconds left until `end`, never below zero. */
export function msLeft(end: number, now: number): number {
  return Math.max(0, end - now)
}

/** Whole minutes left, rounded up, so "1 min left" shows until the very end. */
export function minutesLeft(end: number, now: number): number {
  return Math.ceil(msLeft(end, now) / 60_000)
}

/** When the running countdown (the focus, or its break) ends, or null once focus has ended. */
export function countdownEnd(focus: FocusState): number | null {
  if (focus.phase === 'focus') return focus.endsAt
  if (focus.phase === 'break') return focus.breakEndsAt
  return null
}
