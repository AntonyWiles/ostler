import { useCallback, useEffect, useState } from 'react'
import type { GoalCountsTowards, PersonalGoalView } from '@shared/ostler-api'

/**
 * Goals of one's own (N5.6b), with their check-ins, links and progress, in
 * one call. Reads again when main says something Home shows changed, so a
 * change from the automation API or a project goal's check-in arrives the
 * same way as one from this window. Null until first read.
 */
export function usePersonalGoals(): {
  goals: PersonalGoalView[] | null
  reload: () => Promise<void>
} {
  const [goals, setGoals] = useState<PersonalGoalView[] | null>(null)
  const reload = useCallback(async () => {
    const result = await window.ostlerAPI.listPersonalGoals()
    if (result.ok) setGoals(result.value)
  }, [])
  useEffect(() => {
    void reload()
    return window.ostlerAPI.onProjectStateChange((update) => {
      if (update.field === 'home') void reload()
    })
  }, [reload])
  return { goals, reload }
}

/** What each of a project's goals counts towards (N5.6b), by goal id, in one call. */
export function useCountsTowards(projectId: string | null): {
  countsTowards: Record<string, GoalCountsTowards>
  reload: () => Promise<void>
} {
  const [countsTowards, setCountsTowards] = useState<Record<string, GoalCountsTowards>>({})
  const reload = useCallback(async () => {
    if (!projectId) return
    const result = await window.ostlerAPI.listGoalsCountsTowards(projectId)
    if (result.ok) setCountsTowards(result.value)
  }, [projectId])
  useEffect(() => {
    setCountsTowards({})
    void reload()
    return window.ostlerAPI.onProjectStateChange((update) => {
      if (update.field === 'home') void reload()
    })
  }, [reload])
  return { countsTowards, reload }
}
