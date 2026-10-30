/**
 * Roving focus for composite widgets (tabs, segmented controls, menus,
 * toolbars): which item an arrow, Home or End key moves to. Disabled items
 * are skipped; movement wraps. Returns null for keys it does not handle.
 */
export function nextRovingIndex(
  key: string,
  current: number,
  disabled: readonly boolean[],
  orientation: 'horizontal' | 'vertical' | 'both' = 'horizontal'
): number | null {
  const count = disabled.length
  if (count === 0) return null
  const forward =
    (orientation !== 'vertical' && key === 'ArrowRight') ||
    (orientation !== 'horizontal' && key === 'ArrowDown')
  const backward =
    (orientation !== 'vertical' && key === 'ArrowLeft') ||
    (orientation !== 'horizontal' && key === 'ArrowUp')

  const scan = (start: number, step: 1 | -1): number | null => {
    for (let n = 0; n < count; n++) {
      const index = (((start + step * n) % count) + count) % count
      if (!disabled[index]) return index
    }
    return null
  }

  if (key === 'Home') return scan(0, 1)
  if (key === 'End') return scan(count - 1, -1)
  if (forward) return scan(current + 1, 1)
  if (backward) return scan(current - 1, -1)
  return null
}

/** One step forward or back through `count` items, wrapping round; 0 when there are none. */
export function stepIndex(current: number, step: 1 | -1, count: number): number {
  if (count <= 0) return 0
  return (((current + step) % count) + count) % count
}

/**
 * Typeahead: the first enabled item after `current` whose label starts with
 * `query` (case-insensitive), wrapping round. Null when nothing matches.
 */
export function typeaheadIndex(
  query: string,
  current: number,
  labels: readonly string[],
  disabled: readonly boolean[]
): number | null {
  const needle = query.toLowerCase()
  if (!needle) return null
  const count = labels.length
  // A repeated single letter cycles through the items that start with it.
  const start = needle.length === 1 ? current + 1 : current
  for (let n = 0; n < count; n++) {
    const index = (((start + n) % count) + count) % count
    if (!disabled[index] && labels[index].toLowerCase().startsWith(needle)) return index
  }
  return null
}
