// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { OutsideCalendar } from '@shared/ostler-api'
import { CalendarsGroup } from '@renderer/views/settings/sections/CalendarsGroup'
import { CalendarsProvider } from '@renderer/context/CalendarsContext'
import { SettingsProvider } from '@renderer/views/settings/settings-form'
import { ToastProvider } from '@renderer/ui'
import { installOstlerApi, RENDERER_DEFAULT_CONFIG } from '../../fixtures/ostler-api'

function calendar(overrides: Partial<OutsideCalendar> & { id: string }): OutsideCalendar {
  return {
    name: 'Work',
    color: '#3b82f6',
    kind: 'file',
    path: 'C:\\cal\\work.ics',
    hidden: false,
    loadedAt: Date.parse('2026-10-16T09:00:00Z'),
    readCount: 120,
    skippedCount: 3,
    shownOnceCount: 2,
    createdAt: 0,
    updatedAt: 0,
    ...overrides
  }
}

function setup(initial: OutsideCalendar[] = []) {
  let list = [...initial]
  const ok = <T,>(value: T) => ({ ok: true as const, value })
  const removed = new Map<string, OutsideCalendar>()
  const api = {
    getOutsideCalendars: vi.fn(async () => ok([...list])),
    chooseCalendarFile: vi.fn(async () =>
      ok({
        path: 'C:\\cal\\team.ics',
        fileName: 'team.ics',
        readCount: 40,
        skippedCount: 1,
        shownOnceCount: 1
      })
    ),
    addCalendarFile: vi.fn(async (input: { path: string; name: string; color?: string }) => {
      const added = calendar({ id: 'team', name: input.name, path: input.path, color: input.color })
      list.push(added)
      return ok(added)
    }),
    reloadOutsideCalendar: vi.fn(async (id: string) => ok(list.find((item) => item.id === id)!)),
    updateOutsideCalendar: vi.fn(async (id: string, updates: Partial<OutsideCalendar>) => {
      list = list.map((item) => (item.id === id ? { ...item, ...updates } : item))
      return ok(list.find((item) => item.id === id)!)
    }),
    removeOutsideCalendar: vi.fn(async (id: string) => {
      const item = list.find((entry) => entry.id === id)!
      removed.set(id, item)
      list = list.filter((entry) => entry.id !== id)
      return ok(item)
    }),
    restoreOutsideCalendar: vi.fn(async (id: string) => {
      list.push(removed.get(id)!)
      return ok(removed.get(id)!)
    })
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

describe('CalendarsGroup (N3.3a)', () => {
  it('says what to do before any calendar is added', async () => {
    setup()
    expect(await screen.findByText(/No calendars yet/)).toBeInTheDocument()
  })

  it('adds a calendar file: preview, name and colour', async () => {
    const api = setup()
    await screen.findByText(/No calendars yet/)
    await act(async () => screen.getByRole('button', { name: 'Add a calendar file…' }).click())
    const dialog = await screen.findByRole('dialog', { name: 'Add a calendar file' })
    expect(
      within(dialog).getByText('40 events read, 1 skipped, 1 repeat shown once')
    ).toBeInTheDocument()
    const name = within(dialog).getByRole('textbox', { name: 'Name' })
    expect(name).toHaveValue('team')
    fireEvent.change(name, { target: { value: 'Team' } })
    act(() => within(dialog).getByRole('radio', { name: 'Violet' }).click())
    await act(async () => within(dialog).getByRole('button', { name: 'Add calendar' }).click())
    expect(api.addCalendarFile).toHaveBeenCalledWith({
      path: 'C:\\cal\\team.ics',
      name: 'Team',
      color: '#8b5cf6'
    })
    await waitFor(() => expect(screen.getByText('Team')).toBeInTheDocument())
  })

  it('reloads, hides, renames, and removes with undo', async () => {
    const api = setup([calendar({ id: 'work' })])
    await screen.findByText('Work')
    expect(screen.getByText(/120 events read, 3 skipped, 2 repeats shown once/)).toBeInTheDocument()

    await act(async () => screen.getByRole('button', { name: 'Reload Work from its file' }).click())
    expect(api.reloadOutsideCalendar).toHaveBeenCalledWith('work')

    await act(async () => screen.getByRole('button', { name: 'Hide Work' }).click())
    expect(api.updateOutsideCalendar).toHaveBeenCalledWith('work', { hidden: true })
    await screen.findByText('Hidden')

    act(() => screen.getByRole('button', { name: 'Rename Work' }).click())
    const field = screen.getByRole('textbox', { name: 'Name' })
    fireEvent.change(field, { target: { value: 'Office' } })
    await act(async () => screen.getByRole('button', { name: 'Save' }).click())
    expect(api.updateOutsideCalendar).toHaveBeenLastCalledWith('work', { name: 'Office' })
    await screen.findByText('Office')

    await act(async () => screen.getByRole('button', { name: 'Remove Office' }).click())
    await waitFor(() => expect(screen.queryByText('Office')).not.toBeInTheDocument())
    await act(async () => screen.getByRole('button', { name: 'Undo' }).click())
    expect(api.restoreOutsideCalendar).toHaveBeenCalledWith('work')
    await screen.findByText('Office')
  })

  it('offers no Reload for a calendar the automation API added', async () => {
    setup([calendar({ id: 'api', name: 'From API', path: null })])
    await screen.findByText('From API')
    expect(screen.queryByRole('button', { name: /^Reload/ })).not.toBeInTheDocument()
  })
})
