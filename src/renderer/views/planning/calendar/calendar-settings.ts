import type { TaskViewSpec } from '../../../hooks/task-view-spec'
import type { CalendarMode } from '../../../ui/calendar-layout'

/**
 * The Calendar view's own settings per project: month, week, year or agenda, and whether
 * the Unscheduled panel is open. A per-viewer convenience in localStorage,
 * stored like the List's (`list-settings.ts`), all projects under one key.
 */

export interface CalendarViewSettings {
  mode: CalendarMode
  unscheduledOpen: boolean
  /** Outside calendars' events beside tasks (N3.3a), in Month, Week and Agenda. */
  showCalendars: boolean
}

/** What is stored under `CALENDAR_SETTINGS_KEY`. */
export interface StoredCalendarSettings {
  version: 1
  projects: Record<string, CalendarViewSettings>
}

/** Every mode a saved view may hold; anything else falls back to Month. */
export const CALENDAR_MODES: readonly CalendarMode[] = ['month', 'week', 'year', 'agenda']

export const CALENDAR_SETTINGS_KEY = 'ostler.viewSettings.calendar'

export function defaultCalendarSettings(): CalendarViewSettings {
  return { mode: 'month', unscheduledOpen: false, showCalendars: true }
}

/** Settings as stored, made safe: anything unknown falls back to the default. */
export function normalizeCalendarSettings(value: unknown): CalendarViewSettings {
  const fallback = defaultCalendarSettings()
  if (!value || typeof value !== 'object') return fallback
  const raw = value as Partial<Record<keyof CalendarViewSettings, unknown>>
  return {
    mode: CALENDAR_MODES.includes(raw.mode as CalendarMode)
      ? (raw.mode as CalendarMode)
      : fallback.mode,
    unscheduledOpen:
      typeof raw.unscheduledOpen === 'boolean' ? raw.unscheduledOpen : fallback.unscheduledOpen,
    showCalendars:
      typeof raw.showCalendars === 'boolean' ? raw.showCalendars : fallback.showCalendars
  }
}

/**
 * The Calendar's state lives in its saved views (P5.7). `CALENDAR_SETTINGS_KEY`
 * is where P5.4 kept it in localStorage; the first load moves it into the
 * project's default view.
 */
export const CALENDAR_VIEW_SPEC: TaskViewSpec<CalendarViewSettings> = {
  normalize: normalizeCalendarSettings,
  legacyKey: CALENDAR_SETTINGS_KEY
}
