// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { OutsideCalendar } from '@shared/ostler-api'
import { CalendarsGroup } from '@renderer/views/settings/sections/CalendarsGroup'
import { CalendarsProvider, StaticCalendarsProvider } from '@renderer/context/CalendarsContext'
import { StaleCalendarNote } from '@renderer/components/calendar-events/StaleCalendarNote'
import { SettingsProvider } from '@renderer/views/settings/settings-form'
import { ToastProvider } from '@renderer/ui'
import { installOstlerApi, RENDERER_DEFAULT_CONFIG } from '../../fixtures/ostler-api'

const NOW = Date.now()
const HOUR = 3_600_000

function linkCalendar(overrides: Partial<OutsideCalendar> & { id: string }): OutsideCalendar {
  return {
    name: 'Work',
    color: '#3b82f6',
    kind: 'link',
    path: null,
    hidden: false,
    loadedAt: NOW - HOUR,
    readCount: 12,
    skippedCount: 0,
    shownOnceCount: 0,
    createdAt: NOW - 100 * HOUR,
    updatedAt: NOW - HOUR,
    linkShown: 'outlook.office365.com/…/calendar.ics',
    fetchedAt: NOW - 5 * 60_000,
    failure: null,
    failedAt: null,
    ...overrides
  }
}

function setup(initial: OutsideCalendar[] = []) {
  let list = [...initial]
  const ok = <T,>(value: T) => ({ ok: true as const, value })
  const api = {
    getOutsideCalendars: vi.fn(async () => ok([...list])),
    addCalendarLink: vi.fn(async (input: { link: string; name: string; color?: string }) => {
      const added = linkCalendar({ id: 'team', name: input.name, color: input.color, readCount: 7 })
      list.push(added)
      return ok(added)
    }),
    replaceCalendarLink: vi.fn(async (id: string) => {
      list = list.map((item) =>
        item.id === id ? { ...item, linkShown: 'calendar.google.com/…/basic.ics' } : item
      )
      return ok(list.find((item) => item.id === id)!)
    }),
    refreshCalendarLink: vi.fn(async (id: string) => ok(list.find((item) => item.id === id)!)),
    removeOutsideCalendar: vi.fn(async (id: string) => ok(list.find((item) => item.id === id)!))
  }
  installOstlerApi(api as never)
  localStorage.removeItem('ostler.settingsGroupsOpen')
  render(
    <ToastProvider>
      <SettingsProvider
        value={{
          config: RENDERER_DEFAULT_CONFIG,
          saveConfig: async () => {},
          setConfig: () => {},
          reloadConfig: () => {},
          markSaved: () => {},
          setError: () => {}
        }}
      >
        <CalendarsProvider>
          <CalendarsGroup />
        </CalendarsProvider>
      </SettingsProvider>
    </ToastProvider>
  )
  // The group is one line until opened.
  fireEvent.click(screen.getByRole('button', { name: 'Calendars' }))
  return api
}

describe('Calendar links in Settings (N3.3b)', () => {
  it('subscribes to a link: address, name and colour, then the read count', async () => {
    const api = setup()
    await screen.findByText(/No calendars yet/)
    act(() => screen.getByRole('button', { name: 'Subscribe to a calendar link…' }).click())
    const dialog = await screen.findByRole('dialog', { name: 'Subscribe to a calendar link' })
    expect(within(dialog).getByText(/fetches only this address/)).toBeInTheDocument()
    expect(
      within(dialog).getByText(/Anyone with the address can read the calendar/)
    ).toBeInTheDocument()
    const subscribe = within(dialog).getByRole('button', { name: 'Subscribe' })
    expect(subscribe).toBeDisabled()
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Calendar address' }), {
      target: { value: ' webcal://outlook.office365.com/owa/calendar/x/secret/calendar.ics ' }
    })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Team' }
    })
    await act(async () => subscribe.click())
    expect(api.addCalendarLink).toHaveBeenCalledWith({
      link: 'webcal://outlook.office365.com/owa/calendar/x/secret/calendar.ics',
      name: 'Team',
      color: expect.any(String)
    })
    expect(await screen.findByText('Subscribed to Team: 7 events read')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Team')).toBeInTheDocument())
  })

  it('shows a saved link only shortened, with when it updated, Refresh and Replace link', async () => {
    const api = setup([linkCalendar({ id: 'work' })])
    await screen.findByText('Work')
    expect(screen.getByText('outlook.office365.com/…/calendar.ics')).toBeInTheDocument()
    expect(screen.getByText(/12 events read · updated 5 minutes ago/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Reload/ })).not.toBeInTheDocument()

    await act(async () =>
      screen.getByRole('button', { name: 'Refresh Work from its link' }).click()
    )
    expect(api.refreshCalendarLink).toHaveBeenCalledWith('work')

    act(() => screen.getByRole('button', { name: 'Replace the link for Work' }).click())
    const dialog = await screen.findByRole('dialog', { name: 'Replace the link for Work' })
    expect(within(dialog).queryByRole('textbox', { name: 'Name' })).not.toBeInTheDocument()
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Calendar address' }), {
      target: { value: 'https://calendar.google.com/calendar/ical/me/private-x/basic.ics' }
    })
    await act(async () => within(dialog).getByRole('button', { name: 'Replace link' }).click())
    expect(api.replaceCalendarLink).toHaveBeenCalledWith(
      'work',
      'https://calendar.google.com/calendar/ical/me/private-x/basic.ics'
    )
    expect(await screen.findByText('calendar.google.com/…/basic.ics')).toBeInTheDocument()
  })

  it('says why the last try failed, and to paste the link again', async () => {
    setup([
      linkCalendar({ id: 'work', failure: 'refused', failedAt: NOW - 2 * HOUR }),
      linkCalendar({ id: 'home', name: 'Home', failure: 'pasteAgain', failedAt: NOW - 60_000 })
    ])
    expect(
      await screen.findByText(
        'Last try 2 hours ago failed: The address was refused: check it is still shared'
      )
    ).toBeInTheDocument()
    expect(screen.getByText(/Paste the link again/)).toBeInTheDocument()
  })

  it('shows the error when the first fetch fails, and keeps the dialog open', async () => {
    const api = setup()
    api.addCalendarLink.mockResolvedValueOnce({
      ok: false,
      error: 'Could not reach it'
    } as never)
    await screen.findByText(/No calendars yet/)
    act(() => screen.getByRole('button', { name: 'Subscribe to a calendar link…' }).click())
    const dialog = await screen.findByRole('dialog', { name: 'Subscribe to a calendar link' })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Calendar address' }), {
      target: { value: 'https://example.test/a.ics' }
    })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Team' }
    })
    await act(async () => within(dialog).getByRole('button', { name: 'Subscribe' }).click())
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Could not reach it')
  })
})

describe('StaleCalendarNote (N3.3b)', () => {
  const renderNote = (calendars: OutsideCalendar[]) =>
    render(
      <StaticCalendarsProvider calendars={calendars}>
        <StaleCalendarNote now={NOW} />
      </StaticCalendarsProvider>
    )

  it('says nothing while every link is current', () => {
    installOstlerApi({})
    const { container } = renderNote([
      linkCalendar({ id: 'work' }),
      linkCalendar({ id: 'file', kind: 'file', fetchedAt: null, createdAt: 0 })
    ])
    expect(container).toBeEmptyDOMElement()
  })

  it('names a link that has not updated for a day, with Refresh', async () => {
    const refreshCalendarLink = vi.fn(async () => ({ ok: true as const, value: null as never }))
    installOstlerApi({ refreshCalendarLink } as never)
    renderNote([
      linkCalendar({ id: 'work', name: 'Work calendar', fetchedAt: NOW - 30 * HOUR }),
      linkCalendar({ id: 'hidden', hidden: true, fetchedAt: NOW - 30 * HOUR })
    ])
    expect(screen.getByRole('status')).toHaveTextContent('Work calendar last updated yesterday')
    await act(async () => screen.getByRole('button', { name: 'Refresh the calendar link' }).click())
    expect(refreshCalendarLink).toHaveBeenCalledTimes(1)
    expect(refreshCalendarLink).toHaveBeenCalledWith('work')
  })
})
