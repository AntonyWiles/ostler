import { useCallback, useEffect, useState } from 'react'
import type { ShoppingItem } from '@shared/shopping'

/**
 * A project's shopping list (N6.3b), in one call with its suppliers' names.
 * Reloads when main says something changed (`onProjectStateChange` with
 * `home`, as every planning write sends), so a cost deleted in the Costs
 * view or an item bought through the automation API shows here too.
 */
export function useShopping(projectId: string): {
  items: ShoppingItem[] | null
  error: string | null
  reload: () => Promise<void>
} {
  const [items, setItems] = useState<ShoppingItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reload = useCallback(async () => {
    const result = await window.ostlerAPI.listShopping(projectId)
    if (result.ok) {
      setItems(result.value)
      setError(null)
    } else setError(result.error)
  }, [projectId])
  useEffect(() => {
    void reload()
    return window.ostlerAPI.onProjectStateChange((update) => {
      if (update.field === 'home') void reload()
    })
  }, [reload])
  return { items, error, reload }
}
