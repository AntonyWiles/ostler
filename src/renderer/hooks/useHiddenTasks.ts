import { useCallback, useMemo, useState } from 'react'
import type { PlanningWorkItem } from '@shared/ostler-api'
import { hiddenReason } from '@shared/planning/show-from'
import { todayIsoDate } from '@shared/dates'

/**
 * Hidden tasks on the Board and the List (N1.1a, N9): tasks in Someday or
 * shown from a later day are left out unless the person asks to see them.
 * The choice is the view's own, kept per project and view in localStorage,
 * never a condition added to a saved filter, so a saved view still shows
 * what it showed.
 */

export const SHOW_HIDDEN_KEY = 'ostler.viewSettings.showHidden'

export type HiddenTasksView = 'board' | 'list'

function readStored(): Record<string, boolean> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(SHOW_HIDDEN_KEY) ?? '{}')
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, boolean>)
      : {}
  } catch {
    return {}
  }
}

export interface HiddenTasks {
  /** The tasks to show: all of them when hidden ones are shown, else the available ones. */
  items: PlanningWorkItem[]
  /** Of the tasks given, how many are hidden until later and how many are in Someday. */
  later: number
  someday: number
  showHidden: boolean
  setShowHidden: (show: boolean) => void
}

/** `items` is what the view's filters left; the hidden ones are counted and, by default, left out. */
export function useHiddenTasks(
  projectId: string,
  view: HiddenTasksView,
  items: PlanningWorkItem[]
): HiddenTasks {
  const key = `${projectId}:${view}`
  const [stored, setStored] = useState(readStored)
  const showHidden = stored[key] === true
  const setShowHidden = useCallback(
    (show: boolean) => {
      const next = { ...readStored() }
      if (show) next[key] = true
      else delete next[key]
      try {
        localStorage.setItem(SHOW_HIDDEN_KEY, JSON.stringify(next))
      } catch {
        // A full or blocked storage only loses the choice for next time.
      }
      setStored(next)
    },
    [key]
  )
  const today = todayIsoDate()
  const split = useMemo(() => {
    let later = 0
    let someday = 0
    const available: PlanningWorkItem[] = []
    for (const item of items) {
      const reason = hiddenReason(item, today)
      if (!reason) available.push(item)
      else if (reason.kind === 'someday') someday++
      else later++
    }
    return { available, later, someday }
  }, [items, today])
  return {
    items: showHidden ? items : split.available,
    later: split.later,
    someday: split.someday,
    showHidden,
    setShowHidden
  }
}
