import { formatNumber } from '@shared/format'

/**
 * Age is glanceable metadata on a dense board, not prose. It sits inline in the
 * card meta row next to the priority chip, so it has to read in one token:
 * "3d", not "3 days in column". The full timestamp stays on the title
 * attribute for anyone who wants the exact moment.
 */
export function formatTimeInColumn(changedAt: number, now: number): string {
  const elapsed = Math.max(0, now - changedAt)
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) return 'now'
  // Narrow units in the active locale: "5m", "3h", "2d", "1w" in English.
  const short = (value: number, unit: string) =>
    formatNumber(value, { style: 'unit', unit, unitDisplay: 'narrow' })
  if (minutes < 60) return short(minutes, 'minute')
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return short(hours, 'hour')
  const days = Math.floor(hours / 24)
  if (days < 7) return short(days, 'day')
  return short(Math.floor(days / 7), 'week')
}

export function isAgedInColumn(
  changedAt: number,
  now: number,
  thresholdMs = 3 * 86400000
): boolean {
  return now - changedAt >= thresholdMs
}
