/** How many labels a task form offers for one click. */
export const FREQUENT_LABEL_COUNT = 8

/**
 * A project's most used labels, for the one-click row in the task forms: by
 * how many of `items` carry each, most first, then alphabetically. Deleted
 * tasks do not count.
 */
export function frequentLabels(
  items: ReadonlyArray<{ labels: readonly string[]; deletedAt?: number | null }>,
  limit = FREQUENT_LABEL_COUNT
): string[] {
  const counts = new Map<string, number>()
  for (const item of items) {
    if (item.deletedAt) continue
    for (const label of new Set(item.labels)) counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return [...counts]
    .sort(([a, countA], [b, countB]) => countB - countA || a.localeCompare(b))
    .slice(0, limit)
    .map(([label]) => label)
}
