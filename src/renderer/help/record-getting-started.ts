import type { GettingStartedActivity } from '@shared/getting-started'

const recorded = new Set<GettingStartedActivity>()

/**
 * Tells main the person did one of the getting-started things (P8.1): tried
 * List, Calendar or Timeline, searched, or looked at the backups. Main keeps
 * it; this only saves repeating the call within a session.
 */
export function recordGettingStarted(activity: GettingStartedActivity): void {
  if (recorded.has(activity)) return
  recorded.add(activity)
  // Optional: a component rendered on its own (tests) may have no such call.
  const call = window.ostlerAPI?.recordGettingStarted
  if (!call) return
  void call(activity).then((result) => {
    if (!result?.ok) recorded.delete(activity)
  })
}
