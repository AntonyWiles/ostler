/**
 * Sorting for `DataTable`: what a header
 * click does to the sort keys, and rows in that order. Pure, so the table and
 * its callers share one rule and tests can check it without a DOM.
 */

export type SortDirection = 'asc' | 'desc'

/** One sort key. The first key in a list is the primary sort. */
export interface SortKey {
  columnId: string
  direction: SortDirection
}

/**
 * The sort after a header click. A plain click makes the column the only key
 * (ascending, then descending, then unsorted). With Shift (`additive`) it is
 * added as the next key, or its direction flips, or it is removed.
 */
export function nextSort(sort: readonly SortKey[], columnId: string, additive: boolean): SortKey[] {
  const existing = sort.find((key) => key.columnId === columnId)
  if (additive) {
    if (!existing) return [...sort, { columnId, direction: 'asc' }]
    if (existing.direction === 'asc')
      return sort.map((key) => (key.columnId === columnId ? { columnId, direction: 'desc' } : key))
    return sort.filter((key) => key.columnId !== columnId)
  }
  if (sort[0]?.columnId === columnId) {
    if (sort[0].direction === 'asc') return [{ columnId, direction: 'desc' }]
    return []
  }
  return [{ columnId, direction: 'asc' }]
}

/** How a column orders its rows. Empty values sort last in either direction. */
export interface RowComparer<Row> {
  compare: (a: Row, b: Row) => number
  isEmpty?: (row: Row) => boolean
}

/**
 * Rows in the order the keys give. Stable: rows the keys call equal keep the
 * order they came in, so an unsorted table is the caller's order. Keys whose
 * column has no comparer are ignored.
 */
export function sortRows<Row>(
  rows: readonly Row[],
  sort: readonly SortKey[],
  comparers: Readonly<Record<string, RowComparer<Row> | undefined>>
): Row[] {
  const keys = sort.filter((key) => comparers[key.columnId])
  if (keys.length === 0) return [...rows]
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      for (const key of keys) {
        const { compare, isEmpty } = comparers[key.columnId]!
        const emptyA = isEmpty?.(a.row) ?? false
        const emptyB = isEmpty?.(b.row) ?? false
        if (emptyA !== emptyB) return emptyA ? 1 : -1
        if (emptyA) continue
        const result = compare(a.row, b.row)
        if (result !== 0) return key.direction === 'asc' ? result : -result
      }
      return a.index - b.index
    })
    .map(({ row }) => row)
}
