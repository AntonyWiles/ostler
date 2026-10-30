/**
 * "Last looked at Home" (N1.6, decision N14): when the person last saw Home
 * without a briefing waiting, or dismissed one. A per-viewer convenience in
 * localStorage, not a setting (decision N2): when storage is unavailable,
 * Home simply shows no card.
 */
const KEY = 'ostler.home.lastLooked'

/** How long away before Home shows Since you were last here: eight hours. */
export const BRIEFING_AWAY_MS = 8 * 60 * 60 * 1000

/** The spans Show what changed offers, in hours. */
export const BRIEFING_SPANS = [24, 72, 168] as const
export type BriefingSpan = (typeof BRIEFING_SPANS)[number]

export function readLastLooked(): number | null {
  try {
    const stored = Number(localStorage.getItem(KEY))
    return Number.isSafeInteger(stored) && stored > 0 ? stored : null
  } catch {
    return null
  }
}

export function writeLastLooked(at: number): void {
  try {
    localStorage.setItem(KEY, String(at))
  } catch {
    // ignore -- see readLastLooked
  }
}

/**
 * When Home opens: the start of the span to brief, or null for no card. A
 * first-ever start (nothing stored) shows none; so does a look less than
 * eight hours ago, or one in the future (a clock set back).
 */
export function briefingSince(lastLooked: number | null, now: number): number | null {
  if (lastLooked === null || lastLooked > now) return null
  return now - lastLooked >= BRIEFING_AWAY_MS ? lastLooked : null
}

/**
 * Home opened: the span to brief, or null. With no card, looking at Home
 * moves "last looked" to now; with one, it stays until the card is dismissed.
 */
export function openHome(now: number): number | null {
  const since = briefingSince(readLastLooked(), now)
  if (since === null) writeLastLooked(now)
  return since
}
