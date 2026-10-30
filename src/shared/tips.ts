/**
 * Tips and the walkthrough: the small notes that point at part of the window
 * and explain it. Display only. `enabled` turns every one of them off;
 * `dismissed` holds the ones the person closed with "Don't show again" or
 * finished, by id. "Not now" is never saved: it lasts until Ostler restarts.
 */
export interface TipsSettings {
  enabled: boolean
  dismissed: string[]
}

export const DEFAULT_TIPS_SETTINGS: TipsSettings = { enabled: true, dismissed: [] }

/** A tip's id: short, lower case, words joined by dashes or a colon. */
const TIP_ID = /^[a-z0-9][a-z0-9:-]{0,63}$/

/** More than every tip there is, so a damaged file cannot grow the list without end. */
export const MAX_DISMISSED_TIPS = 200

export function isTipId(value: unknown): value is string {
  return typeof value === 'string' && TIP_ID.test(value)
}

/** Tips settings from whatever the file holds: unknown ids go, repeats go, on by default. */
export function normalizeTipsSettings(value: unknown): TipsSettings {
  const record =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  const dismissed = Array.isArray(record.dismissed)
    ? [...new Set(record.dismissed.filter(isTipId))].slice(0, MAX_DISMISSED_TIPS)
    : []
  return { enabled: record.enabled !== false, dismissed }
}
