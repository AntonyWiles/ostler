import { useState } from 'react'

/**
 * Shared text-query + category-filter state, extracted from the duplicated
 * search/filter/clear-all pattern in the Planning board and the Project
 * Detail execution queue.
 */
export function useSearchFilter<F extends Record<string, string>>(defaultFilters: F) {
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<F>(defaultFilters)

  const setFilterValue = <K extends keyof F>(key: K, value: F[K]) => {
    setFilters((previous) => ({ ...previous, [key]: value }))
  }

  const isFiltered =
    query.trim() !== '' ||
    (Object.keys(defaultFilters) as (keyof F)[]).some((key) => filters[key] !== defaultFilters[key])

  const clearAll = () => {
    setQuery('')
    setFilters(defaultFilters)
  }

  const replaceAll = (nextQuery: string, nextFilters: F) => {
    setQuery(nextQuery)
    setFilters(nextFilters)
  }

  return { query, setQuery, filters, setFilterValue, isFiltered, clearAll, replaceAll }
}
