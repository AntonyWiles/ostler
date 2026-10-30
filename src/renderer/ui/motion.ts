/**
 * A motion token (tokens.css) in milliseconds. 0 under reduced motion, and 0
 * where the tokens are not loaded (unit tests), so callers that wait for an
 * animation to end can skip waiting.
 */
export function motionMs(token: '--motion-fast' | '--motion-normal' | '--motion-slow'): number {
  if (typeof document === 'undefined') return 0
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim()
  const ms = value.endsWith('ms') ? parseFloat(value) : parseFloat(value) * 1000
  return Number.isFinite(ms) ? ms : 0
}

/** The standard easing (tokens.css), for animations started from script. */
export function motionEasing(): string {
  if (typeof document === 'undefined') return 'ease'
  const value = getComputedStyle(document.documentElement).getPropertyValue('--ease-standard')
  return value.trim() || 'ease'
}
