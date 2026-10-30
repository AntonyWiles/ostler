import { useCallback, useMemo, useRef, useState } from 'react'

export interface LibrarySelection {
  /** Ticked items, in the order they were ticked. */
  ids: string[]
  has(id: string): boolean
  toggle(id: string): void
  /** Shift-click: ticks everything between the last ticked item and this one. */
  extendTo(id: string, orderedIds: string[]): void
  clear(): void
  /** Drops ids no longer in the list (deleted, filtered by a live update). */
  retain(ids: string[]): void
}

/**
 * The Library's multi-select, kept in one place. The selection bar reads it,
 * and so will "Plan work from these" (Phase 4).
 */
export function useLibrarySelection(): LibrarySelection {
  const [ids, setIds] = useState<string[]>([])
  const anchorRef = useRef<string | null>(null)

  const toggle = useCallback((id: string) => {
    anchorRef.current = id
    setIds((current) =>
      current.includes(id) ? current.filter((existing) => existing !== id) : [...current, id]
    )
  }, [])

  const extendTo = useCallback((id: string, orderedIds: string[]) => {
    const anchor = anchorRef.current
    const from = anchor ? orderedIds.indexOf(anchor) : -1
    const to = orderedIds.indexOf(id)
    anchorRef.current = id
    if (from < 0 || to < 0) {
      setIds((current) => (current.includes(id) ? current : [...current, id]))
      return
    }
    const range = orderedIds.slice(Math.min(from, to), Math.max(from, to) + 1)
    setIds((current) => [...current, ...range.filter((rangeId) => !current.includes(rangeId))])
  }, [])

  const clear = useCallback(() => {
    anchorRef.current = null
    setIds([])
  }, [])

  const retain = useCallback((keep: string[]) => {
    const allowed = new Set(keep)
    setIds((current) => {
      const next = current.filter((id) => allowed.has(id))
      return next.length === current.length ? current : next
    })
  }, [])

  return useMemo(() => {
    const set = new Set(ids)
    return { ids, has: (id: string) => set.has(id), toggle, extendTo, clear, retain }
  }, [ids, toggle, extendTo, clear, retain])
}
