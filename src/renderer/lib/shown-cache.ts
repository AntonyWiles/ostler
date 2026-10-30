/**
 * What a view showed last, by key (a project id, say), so that opening it
 * again shows that at once while a fresh read lands behind it. Without this a
 * view that reads on mount empties to a spinner or a placeholder each time it
 * is opened, then fills again, and the app flickers as the person clicks
 * around. Kept in memory only, for the most recent keys.
 */
export interface ShownCache<Value> {
  get(key: string): Value | undefined
  has(key: string): boolean
  set(key: string, value: Value): void
}

const caches = new Set<Map<string, unknown>>()

export function shownCache<Value>(keep = 8): ShownCache<Value> {
  const entries = new Map<string, Value>()
  caches.add(entries)
  return {
    get: (key) => entries.get(key),
    has: (key) => entries.has(key),
    set(key, value) {
      // Least recently set first, so the oldest goes when there are too many.
      entries.delete(key)
      entries.set(key, value)
      for (const oldest of entries.keys()) {
        if (entries.size <= keep) break
        entries.delete(oldest)
      }
    }
  }
}

/** Forgets everything every cache has shown (tests start from nothing). */
export function forgetShown(): void {
  for (const entries of caches) entries.clear()
}
