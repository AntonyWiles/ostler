import { useCallback, useEffect, useState } from 'react'
import type { GoalCheckIn, GoalGlance } from '@shared/ostler-api'

/**
 * Every check-in of a project's goals (N5.6a), by goal id, in one call.
 * Reloads when main says the project changed, so a check-in from the
 * automation API arrives the same way as one from this window.
 */
export function useGoalCheckIns(projectId: string | null): {
  checkIns: Record<string, GoalCheckIn[]>
  reload: () => Promise<void>
} {
  const [checkIns, setCheckIns] = useState<Record<string, GoalCheckIn[]>>({})
  const reload = useCallback(async () => {
    if (!projectId) return
    const result = await window.ostlerAPI.listGoalCheckIns(projectId)
    if (result.ok) setCheckIns(result.value)
  }, [projectId])

  useEffect(() => {
    setCheckIns({})
    void reload()
    return window.ostlerAPI.onProjectStateChange((update) => {
      if (update.field === 'home') void reload()
    })
  }, [reload])

  return { checkIns, reload }
}

/** Each project's active goals with a measure, by project id, in one call (Home's cards). */
export function useGoalGlances(): Record<string, GoalGlance[]> {
  const [glances, setGlances] = useState<Record<string, GoalGlance[]>>({})
  useEffect(() => {
    let active = true
    const load = async () => {
      const result = await window.ostlerAPI.goalGlances()
      if (active && result.ok) setGlances(result.value)
    }
    void load()
    const unsubscribe = window.ostlerAPI.onProjectStateChange((update) => {
      if (update.field === 'home') void load()
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])
  return glances
}
