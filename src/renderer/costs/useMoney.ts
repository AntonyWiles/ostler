import { useCallback, useEffect, useState } from 'react'
import type { Cost, CostQuery, MoneySummary } from '@shared/money'

/**
 * Reloads when main says something changed: a cost or budget written from
 * this window, another one or the automation API arrives the same way
 * (`onProjectStateChange` with `home`, as every planning write sends).
 */
function useOnPlanningChange(reload: () => void): void {
  useEffect(
    () =>
      window.ostlerAPI.onProjectStateChange((update) => {
        if (update.field === 'home') reload()
      }),
    [reload]
  )
}

/** A project's money summary (N6.3a), in one call: the Budget card and milestone totals. */
export function useMoneySummary(projectId: string): {
  summary: MoneySummary | null
  reload: () => Promise<void>
} {
  const [summary, setSummary] = useState<MoneySummary | null>(null)
  const reload = useCallback(async () => {
    const result = await window.ostlerAPI.getMoneySummary(projectId)
    if (result.ok) setSummary(result.value)
  }, [projectId])
  useEffect(() => {
    setSummary(null)
    void reload()
  }, [reload])
  useOnPlanningChange(useCallback(() => void reload(), [reload]))
  return { summary, reload }
}

/** A project's costs, filtered, by date; with the categories it has used. */
export function useCosts(
  projectId: string,
  query: CostQuery = {}
): {
  costs: Cost[] | null
  categories: string[]
  error: string | null
  reload: () => Promise<void>
} {
  const [costs, setCosts] = useState<Cost[] | null>(null)
  const [categories, setCategories] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const key = JSON.stringify(query)
  const reload = useCallback(async () => {
    const [list, used] = await Promise.all([
      window.ostlerAPI.listCosts(projectId, JSON.parse(key) as CostQuery),
      window.ostlerAPI.listCostCategories(projectId)
    ])
    if (list.ok) {
      setCosts(list.value)
      setError(null)
    } else setError(list.error)
    if (used.ok) setCategories(used.value)
  }, [projectId, key])
  useEffect(() => {
    void reload()
  }, [reload])
  useOnPlanningChange(useCallback(() => void reload(), [reload]))
  return { costs, categories, error, reload }
}
