import { useCallback, useEffect, useState } from 'react'
import type { Team } from '@shared/ostler-api'

export interface TeamsState {
  /** Every team, archived ones included, in the order the person set. */
  all: Team[]
  /** The teams not archived. */
  active: Team[]
  loaded: boolean
  refresh: () => Promise<void>
}

/**
 * The person's teams (D1). Read when the screen opens and again whenever main pushes a `teams`
 * change (a team edited here or on another window, undone, or pulled from another device) or a
 * `people` change (deleting a person takes them out of their teams).
 */
export function useTeams(): TeamsState {
  const [all, setAll] = useState<Team[]>([])
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    const result = await window.ostlerAPI.listTeams({ includeArchived: true })
    if (result.ok) setAll(result.value)
    setLoaded(true)
  }, [])

  useEffect(() => {
    void refresh()
    return window.ostlerAPI.onProjectStateChange((update) => {
      if (update.field === 'teams' || update.field === 'people') void refresh()
    })
  }, [refresh])

  return { all, active: all.filter((team) => team.archivedAt === null), loaded, refresh }
}
