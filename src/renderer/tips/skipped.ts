/**
 * Tips and the tour invitation put away for now ("Not now", X, "Got it").
 * They stay away until Ostler restarts, so they are kept in sessionStorage:
 * a reload of the window keeps them, a new start of Ostler does not. A
 * convenience, not data, so it is no config setting.
 */
const KEY = 'ostler.tips.skipped'

export function readSkipped(): Set<string> {
  try {
    const raw = sessionStorage.getItem(KEY)
    const ids: unknown = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}

export function writeSkipped(ids: ReadonlySet<string>): void {
  try {
    if (ids.size === 0) sessionStorage.removeItem(KEY)
    else sessionStorage.setItem(KEY, JSON.stringify([...ids]))
  } catch {
    // Storage refused: they stay away until a reload instead.
  }
}
