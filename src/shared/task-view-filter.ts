import {
  matchesFilter,
  type FilterableTask,
  type TaskFilter,
  type TaskFilterContext
} from './task-filter'

/**
 * The tasks a view shows for a filter, its search text and Hide done, all
 * through the one `matchesFilter`. The List and every task view
 * (`applyTaskFilters`) and live lists in notes (N4.4c) call this, so a note
 * and the List agree on the same filter.
 */
export function matchingTasks<T extends FilterableTask>(
  items: readonly T[],
  filter: TaskFilter,
  query: string,
  context: TaskFilterContext,
  hideDone = false
): T[] {
  const text = query.trim()
  const extra: TaskFilter = {
    match: 'all',
    conditions: [
      ...(text ? [{ field: 'text' as const, op: 'contains' as const, value: text }] : []),
      ...(hideDone ? [{ field: 'status' as const, op: 'isNot' as const, value: ['done'] }] : [])
    ]
  }
  return items.filter(
    (item) => matchesFilter(item, filter, context) && matchesFilter(item, extra, context)
  )
}
