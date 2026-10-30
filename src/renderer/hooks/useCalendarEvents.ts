import { useEffect, useState } from 'react'
import type { CalendarOccurrence } from '@shared/ostler-api'
import { useCalendars } from '../context/CalendarsContext'
import { shownCache } from '../lib/shown-cache'

const NONE: CalendarOccurrence[] = []

/** Each range's events as last read, by `from|to`. */
const shownEvents = shownCache<CalendarOccurrence[]>(16)

/**
 * The shown calendars' events between two dates (N3.3a): one call for the
 * range on screen, asked again when the range moves or a calendar changes.
 * With `enabled` false, or no calendars, nothing is asked and the list is
 * empty. Events are read-only; they never become tasks by themselves.
 */
export function useCalendarEvents(from: string, to: string, enabled = true): CalendarOccurrence[] {
  const { calendars, loaded, version } = useCalendars()
  // A range read before shows its events at once, rather than none until the read lands.
  const [events, setEvents] = useState<CalendarOccurrence[]>(
    () => shownEvents.get(`${from}|${to}`) ?? NONE
  )
  const anyShown = calendars.some((calendar) => !calendar.hidden)
  const ask = enabled && loaded && anyShown

  useEffect(() => {
    if (!ask) {
      setEvents(NONE)
      return
    }
    let live = true
    void window.ostlerAPI.getCalendarEvents({ from, to }).then((result) => {
      if (!live) return
      if (result.ok) shownEvents.set(`${from}|${to}`, result.value)
      setEvents(result.ok ? result.value : [])
    })
    return () => {
      live = false
    }
  }, [from, to, ask, version])

  return ask ? events : NONE
}
