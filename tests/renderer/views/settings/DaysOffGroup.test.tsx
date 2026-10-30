// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { DayOff, Person } from '@shared/ostler-api'
import { DaysOffGroup } from '@renderer/views/settings/sections/DaysOffGroup'
import { DaysOffProvider } from '@renderer/context/DaysOffContext'
import { StaticPeopleProvider } from '@renderer/context/PeopleContext'
import { SettingsProvider } from '@renderer/views/settings/settings-form'
import { ToastProvider } from '@renderer/ui'
import { installOstlerApi, RENDERER_DEFAULT_CONFIG } from '../../fixtures/ostler-api'

const sam: Person = {
  id: 'sam',
  name: 'Sam',
  initials: 'S',
  color: '#3b82f6',
  isMe: false,
  archivedAt: null,
  weeklyCapacityHours: null,
  workingDays: [1, 2, 3, 4, 5],
  projectId: null,
  createdAt: 0,
  updatedAt: 0
}

function day(overrides: Partial<DayOff> & { id: string }): DayOff {
  return {
    personId: null,
    firstDate: '2026-12-25',
    lastDate: '2026-12-25',
    name: 'Christmas Day',
    sourceFile: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides
  }
}

function setup(initial: DayOff[] = []) {
  let days = [...initial]
  const ok = <T,>(value: T) => ({ ok: true as const, value })
  const api = {
    getDaysOff: vi.fn(async () => ok([...days])),
    createDayOff: vi.fn(async (input: Partial<DayOff>) => {
      const added = day({ id: `new-${days.length}`, ...input })
      days.push(added)
      return ok(added)
    }),
    updateDayOff: vi.fn(async (id: string, updates: Partial<DayOff>) => {
      days = days.map((entry) => (entry.id === id ? { ...entry, ...updates } : entry))
      return ok(days.find((entry) => entry.id === id)!)
    }),
    removeDayOff: vi.fn(async (id: string) => {
      const removed = days.find((entry) => entry.id === id)!
      days = days.filter((entry) => entry.id !== id)
      return ok(removed)
    }),
    restoreDaysOff: vi.fn(async (restored: DayOff[]) => {
      days.push(...restored)
      return ok(restored)
    }),
    removeDaysOffFile: vi.fn(async (fileName: string, personId?: string | null) => {
      const inLoad = (entry: DayOff) =>
        entry.sourceFile === fileName && (personId === undefined || entry.personId === personId)
      const removed = days.filter(inLoad)
      days = days.filter((entry) => !inLoad(entry))
      return ok(removed)
    }),
    chooseDaysOffFile: vi.fn(async () => ok({ fileName: 'england.ics', text: 'BEGIN:VCALENDAR' })),
    previewDaysOffImport: vi.fn(async (input: { personId?: string | null }) =>
      ok({
        fileName: 'england.ics',
        personId: input.personId ?? null,
        days: [{ firstDate: '2026-12-28', lastDate: '2026-12-28', name: 'Boxing Day' }],
        replacedCount: 0,
        skipped: [{ name: 'Office party', reason: 'timed' as const }]
      })
    ),
    importDaysOff: vi.fn(async (input: { personId?: string | null }) => {
      const added = day({
        id: 'imported',
        name: 'Boxing Day',
        firstDate: '2026-12-28',
        lastDate: '2026-12-28',
        sourceFile: 'england.ics',
        personId: input.personId ?? null
      })
      days.push(added)
      return ok({
        fileName: 'england.ics',
        personId: null,
        days: [],
        replacedCount: 0,
        skipped: [],
        added: [added],
        replaced: []
      })
    })
  }
  installOstlerApi(api as never)
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
        <StaticPeopleProvider people={[sam]}>
          <DaysOffProvider>
            <DaysOffGroup />
          </DaysOffProvider>
        </StaticPeopleProvider>
      </SettingsProvider>
    </ToastProvider>
  )
  return api
}

describe('DaysOffGroup (N3.2)', () => {
  it('lists everyone’s days off and a person’s leave apart', async () => {
    setup([
      day({ id: 'x' }),
      day({
        id: 'l',
        personId: 'sam',
        name: 'Leave',
        firstDate: '2026-08-03',
        lastDate: '2026-08-14'
      })
    ])
    const everyone = await screen.findByRole('list', { name: 'Everyone' })
    expect(within(everyone).getByText('Christmas Day')).toBeInTheDocument()
    const leave = screen.getByRole('list', { name: "Sam's leave" })
    expect(within(leave).getByText('Leave')).toBeInTheDocument()
    expect(within(leave).getByText(/3 August 2026 to 14 August 2026/)).toBeInTheDocument()
  })

  it('adds a range for one person', async () => {
    const api = setup()
    const form = await screen.findByRole('form', { name: 'Add a day off' })
    fireEvent.change(within(form).getByLabelText('For'), { target: { value: 'sam' } })
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Leave' } })
    fireEvent.change(within(form).getByLabelText('First day'), { target: { value: '2026-08-03' } })
    fireEvent.change(within(form).getByLabelText('Last day'), { target: { value: '2026-08-14' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Add day off' }))
    await waitFor(() =>
      expect(api.createDayOff).toHaveBeenCalledWith({
        personId: 'sam',
        name: 'Leave',
        firstDate: '2026-08-03',
        lastDate: '2026-08-14'
      })
    )
    expect(await screen.findByRole('list', { name: "Sam's leave" })).toBeInTheDocument()
  })

  it('edits a day off', async () => {
    const api = setup([day({ id: 'x' })])
    fireEvent.click(await screen.findByRole('button', { name: /^Edit Christmas Day/ }))
    const form = screen.getByRole('form', { name: 'Save' })
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Christmas' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(api.updateDayOff).toHaveBeenCalledWith(
        'x',
        expect.objectContaining({ name: 'Christmas' })
      )
    )
  })

  it('removes a day off at once and puts it back with Undo', async () => {
    const api = setup([day({ id: 'x' })])
    fireEvent.click(await screen.findByRole('button', { name: /^Remove Christmas Day/ }))
    await waitFor(() => expect(screen.queryByText('Christmas Day')).not.toBeInTheDocument())
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(api.restoreDaysOff).toHaveBeenCalledWith([day({ id: 'x' })]))
    expect(await screen.findByText('Christmas Day')).toBeInTheDocument()
  })

  it('previews an import, then adds it; a file’s days can be removed together', async () => {
    const api = setup()
    fireEvent.click(await screen.findByRole('button', { name: 'Import a holiday calendar…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Import a holiday calendar' })
    expect(await within(dialog).findByText('Boxing Day')).toBeInTheDocument()
    expect(within(dialog).getByText('Office party')).toBeInTheDocument()
    expect(within(dialog).getByText('has a time, not a whole day')).toBeInTheDocument()
    expect(api.importDaysOff).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add 1 day off' }))
    await waitFor(() => expect(api.importDaysOff).toHaveBeenCalled())
    // Each load says who it is for, and Remove all from this file takes away that load only.
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Remove all days off from england.ics, for everyone'
      })
    )
    await waitFor(() => expect(api.removeDaysOffFile).toHaveBeenCalledWith('england.ics', null))
  })

  it('lists the same file loaded for two people as two loads, each removed on its own', async () => {
    const api = setup([
      day({ id: 'a', sourceFile: 'team.ics', personId: null, name: 'Boxing Day' }),
      day({ id: 'b', sourceFile: 'team.ics', personId: 'sam', name: 'Boxing Day' })
    ])
    const files = await screen.findByRole('list', { name: 'Calendar files' })
    expect(within(files).getByText('team.ics, for everyone')).toBeInTheDocument()
    expect(within(files).getByText('team.ics, for Sam')).toBeInTheDocument()
    fireEvent.click(
      within(files).getByRole('button', { name: 'Remove all days off from team.ics, for Sam' })
    )
    await waitFor(() => expect(api.removeDaysOffFile).toHaveBeenCalledWith('team.ics', 'sam'))
    await waitFor(() => expect(within(files).queryByText('team.ics, for Sam')).toBeNull())
    expect(within(files).getByText('team.ics, for everyone')).toBeInTheDocument()
  })
})
