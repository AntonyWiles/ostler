import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { DayOff } from '@shared/ostler-api'

/**
 * Days off (N3.2), read once for the whole app: they are global, like people,
 * and a person's list is short (a few dozen bank holidays and some leave), so
 * the Calendar, the Timeline, Workload and every date field share one list
 * instead of asking per day or per task. Main pushes `daysOff` whenever they
 * change, from the app or the automation API, and the list is read again.
 * What a day off means is decided only by `@shared/planning/working-days`.
 */
export interface DaysOffState {
  daysOff: DayOff[]
  loaded: boolean
  refresh: () => Promise<void>
}

const EMPTY: DaysOffState = { daysOff: [], loaded: false, refresh: async () => {} }

const DaysOffContext = createContext<DaysOffState>(EMPTY)

export function DaysOffProvider({ children }: { children: ReactNode }) {
  const [daysOff, setDaysOff] = useState<DayOff[]>([])
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    const result = await window.ostlerAPI.getDaysOff()
    if (result.ok) setDaysOff(result.value)
    setLoaded(true)
  }, [])

  useEffect(() => {
    void refresh()
    return window.ostlerAPI.onProjectStateChange((update) => {
      if (update.field === 'daysOff') void refresh()
    })
  }, [refresh])

  const value = useMemo<DaysOffState>(
    () => ({ daysOff, loaded, refresh }),
    [daysOff, loaded, refresh]
  )
  return <DaysOffContext.Provider value={value}>{children}</DaysOffContext.Provider>
}

/** Fixed days off, for a component rendered on its own (tests, the component gallery). */
export function StaticDaysOffProvider({
  daysOff,
  children
}: {
  daysOff: DayOff[]
  children: ReactNode
}) {
  const value = useMemo<DaysOffState>(() => ({ ...EMPTY, daysOff, loaded: true }), [daysOff])
  return <DaysOffContext.Provider value={value}>{children}</DaysOffContext.Provider>
}

export function useDaysOff(): DaysOffState {
  return useContext(DaysOffContext)
}
