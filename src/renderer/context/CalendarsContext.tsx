import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { OutsideCalendar } from '@shared/ostler-api'

/**
 * Outside calendars (N3.3a), read once for the whole app: Settings, the
 * Calendar and Home share one list of names and colours. Main pushes
 * `calendars` whenever a calendar or its events change, from the app or the
 * automation API; `version` then moves on, so whoever shows events asks for
 * its range again (`useCalendarEvents`).
 */
export interface CalendarsState {
  calendars: OutsideCalendar[]
  byId: ReadonlyMap<string, OutsideCalendar>
  loaded: boolean
  /** Moves on each time calendars or their events change. */
  version: number
  refresh: () => Promise<void>
}

const EMPTY: CalendarsState = {
  calendars: [],
  byId: new Map(),
  loaded: false,
  version: 0,
  refresh: async () => {}
}

const CalendarsContext = createContext<CalendarsState>(EMPTY)

export function CalendarsProvider({ children }: { children: ReactNode }) {
  const [calendars, setCalendars] = useState<OutsideCalendar[]>([])
  const [loaded, setLoaded] = useState(false)
  const [version, setVersion] = useState(0)

  const refresh = useCallback(async () => {
    const result = await window.ostlerAPI.getOutsideCalendars()
    if (result.ok) setCalendars(result.value)
    setLoaded(true)
    setVersion((value) => value + 1)
  }, [])

  useEffect(() => {
    void refresh()
    return window.ostlerAPI.onProjectStateChange((update) => {
      if (update.field === 'calendars') void refresh()
    })
  }, [refresh])

  const value = useMemo<CalendarsState>(
    () => ({
      calendars,
      byId: new Map(calendars.map((calendar) => [calendar.id, calendar])),
      loaded,
      version,
      refresh
    }),
    [calendars, loaded, version, refresh]
  )
  return <CalendarsContext.Provider value={value}>{children}</CalendarsContext.Provider>
}

/** Fixed calendars, for a component rendered on its own (tests, the gallery). */
export function StaticCalendarsProvider({
  calendars,
  children
}: {
  calendars: OutsideCalendar[]
  children: ReactNode
}) {
  const value = useMemo<CalendarsState>(
    () => ({
      ...EMPTY,
      calendars,
      byId: new Map(calendars.map((calendar) => [calendar.id, calendar])),
      loaded: true
    }),
    [calendars]
  )
  return <CalendarsContext.Provider value={value}>{children}</CalendarsContext.Provider>
}

export function useCalendars(): CalendarsState {
  return useContext(CalendarsContext)
}
