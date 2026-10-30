import { useState } from 'react'
import type { OutsideCalendar } from '@shared/ostler-api'
import { formatRelativeTime } from '@shared/format'
import { t } from '@shared/i18n'
import { useCalendars } from '../../context/CalendarsContext'
import { Button } from '../../ui'
import './calendar-events.css'

/** A link that has not updated for this long gets the quiet note. */
export const STALE_LINK_MS = 24 * 60 * 60 * 1000

/** Shown link calendars that last updated a day or more ago (or never, a day after they were added). */
export function staleLinkCalendars(
  calendars: readonly OutsideCalendar[],
  now = Date.now()
): OutsideCalendar[] {
  return calendars.filter(
    (calendar) =>
      calendar.kind === 'link' &&
      !calendar.hidden &&
      now - (calendar.fetchedAt ?? calendar.createdAt) >= STALE_LINK_MS
  )
}

/**
 * Beside the Calendar's Show my calendars switch (N3.3b): "Work last updated
 * yesterday" with Refresh, for the first link that has not updated for a
 * day (and how many more). Nothing when every link is current.
 */
export function StaleCalendarNote({ now }: { now?: number }) {
  const { calendars, refresh } = useCalendars()
  const [busy, setBusy] = useState(false)
  const stale = staleLinkCalendars(calendars, now ?? Date.now())
  if (stale.length === 0) return null
  const first = stale[0]
  const refreshAll = async () => {
    setBusy(true)
    for (const calendar of stale) await window.ostlerAPI.refreshCalendarLink(calendar.id)
    setBusy(false)
    await refresh()
  }
  return (
    <span className="calendar-stale-note" role="status">
      <span>
        {first.fetchedAt
          ? t('views:calendarEvents.staleLink', {
              name: first.name,
              when: formatRelativeTime(first.fetchedAt, now ?? Date.now())
            })
          : t('views:calendarEvents.staleLinkNever', { name: first.name })}
        {stale.length > 1 && ` ${t('views:calendarEvents.staleMore', { count: stale.length - 1 })}`}
      </span>
      <Button
        size="sm"
        variant="ghost"
        loading={busy}
        aria-label={t('views:calendarEvents.staleRefreshLabel', { count: stale.length })}
        onClick={() => void refreshAll()}
      >
        {t('views:calendarEvents.staleRefresh')}
      </Button>
    </span>
  )
}
