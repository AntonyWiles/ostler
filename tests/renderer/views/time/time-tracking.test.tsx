// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OstlerAPI, PlanningWorkItem, TimeEntry, TimerState } from '@shared/ostler-api'
import { ToastProvider } from '@renderer/ui'
import { TimerProvider } from '@renderer/time/TimerProvider'
import { TaskTimeSection } from '@renderer/time/TaskTimeSection'
import { StatusBarTimer } from '@renderer/time/StatusBarTimer'
import { TimesheetView } from '@renderer/views/timesheet/TimesheetView'
import { OstlerProvider } from '@renderer/context/OstlerContext'
import { installOstlerApi } from '../../fixtures/ostler-api'

const TASK = {
  id: 't1',
  projectId: 'p1',
  title: 'Write the brief',
  estimate: 2,
  archivedAt: null,
  deletedAt: null
} as unknown as PlanningWorkItem

function entry(partial: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: 'e1',
    projectId: 'p1',
    workItemId: 't1',
    workItemTitle: 'Write the brief',
    personId: null,
    startedAt: new Date(2026, 9, 12, 9, 0).getTime(),
    durationSeconds: 5400,
    note: 'First draft',
    source: 'manual',
    billable: false,
    billingId: null,
    createdAt: 0,
    updatedAt: 0,
    ...partial
  }
}

function Where() {
  const location = useLocation()
  return <output data-testid="where">{location.pathname + location.search}</output>
}

function renderWithTimer(ui: React.ReactNode, path = '/') {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[path]}>
        <TimerProvider>
          <Routes>
            <Route path="*" element={ui} />
          </Routes>
          <Where />
        </TimerProvider>
      </MemoryRouter>
    </ToastProvider>
  )
}

describe("the drawer's Time section", () => {
  let entries: TimeEntry[]
  let api: Partial<OstlerAPI>

  beforeEach(() => {
    entries = [entry()]
    api = {
      getTimer: async () => ({ ok: true, value: { running: null, interrupted: null } }),
      getTaskTimeEntries: async () => ({ ok: true, value: entries }),
      deleteTimeEntry: vi.fn(async (_projectId: string, id: string) => {
        const gone = entries.find((candidate) => candidate.id === id)!
        entries = entries.filter((candidate) => candidate.id !== id)
        return { ok: true as const, value: gone }
      }),
      restoreTimeEntry: vi.fn(async (_projectId: string, restored: TimeEntry) => {
        entries = [restored]
        return { ok: true as const, value: restored }
      }),
      createTimeEntry: vi.fn(async (_projectId: string, input) => {
        const created = entry({
          id: 'e2',
          durationSeconds: input.durationSeconds,
          note: input.note
        })
        entries = [created, ...entries]
        return { ok: true as const, value: created }
      }),
      startTimer: vi.fn(async () => ({
        ok: true as const,
        value: {
          started: entry({ id: 'run', durationSeconds: null, source: 'timer' }),
          stopped: null
        }
      }))
    }
    installOstlerApi(api)
  })

  it('lists the entries with the time logged, and deletes one with Undo', async () => {
    renderWithTimer(<TaskTimeSection item={TASK} />)
    expect(await screen.findByText('First draft')).toBeTruthy()
    expect(screen.getByText(/1\.5\s?h logged/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Delete the entry of 1\.5/ }))
    await waitFor(() => expect(api.deleteTimeEntry).toHaveBeenCalledWith('p1', 'e1'))
    await waitFor(() => expect(screen.queryByText('First draft')).toBeNull())
    const toast = await screen.findByText('Time entry deleted')
    fireEvent.click(
      within(toast.closest('[role="status"], .ui-toast') as HTMLElement).getByRole('button', {
        name: 'Undo'
      })
    )
    await waitFor(() => expect(api.restoreTimeEntry).toHaveBeenCalled())
    expect(await screen.findByText('First draft')).toBeTruthy()
  })

  it('adds time by hand from a typed duration, and refuses nonsense', async () => {
    renderWithTimer(<TaskTimeSection item={TASK} />)
    await screen.findByText('First draft')
    fireEvent.click(screen.getByRole('button', { name: 'Add time' }))
    const dialog = await screen.findByRole('dialog')
    const duration = within(dialog).getByLabelText(/Duration/)
    fireEvent.change(duration, { target: { value: 'soon' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add time' }))
    expect(await within(dialog).findByText(/Enter how long/)).toBeTruthy()
    expect(api.createTimeEntry).not.toHaveBeenCalled()

    fireEvent.change(duration, { target: { value: '45m' } })
    fireEvent.change(within(dialog).getByLabelText('Note'), { target: { value: 'Edits' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add time' }))
    await waitFor(() =>
      expect(api.createTimeEntry).toHaveBeenCalledWith(
        'p1',
        expect.objectContaining({ workItemId: 't1', durationSeconds: 2700, note: 'Edits' })
      )
    )
  })

  it('starts the timer on the task', async () => {
    renderWithTimer(<TaskTimeSection item={TASK} />)
    await screen.findByText('First draft')
    fireEvent.click(screen.getByRole('button', { name: 'Start timer' }))
    await waitFor(() => expect(api.startTimer).toHaveBeenCalledWith('p1', 't1'))
    expect(await screen.findByRole('button', { name: 'Stop timer' })).toBeTruthy()
  })
})

describe('the status bar timer', () => {
  afterEach(() => vi.useRealTimers())

  it('shows the running task and its time from the stored start, and opens the task', async () => {
    const start = Date.now() - 65_000
    const state: TimerState = {
      running: entry({ id: 'run', durationSeconds: null, startedAt: start }),
      interrupted: null
    }
    const stopTimer = vi.fn(async () => ({ ok: true as const, value: null }))
    installOstlerApi({ getTimer: async () => ({ ok: true, value: state }), stopTimer })
    renderWithTimer(<StatusBarTimer />)
    const open = await screen.findByRole('button', {
      name: /Timer running on Write the brief, 1:0\d\. Open the task/
    })
    fireEvent.click(open)
    expect(screen.getByTestId('where').textContent).toBe('/projects/p1/tasks/t1')
    fireEvent.click(screen.getByRole('button', { name: 'Stop timer' }))
    await waitFor(() => expect(stopTimer).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByRole('button', { name: /Timer running/ })).toBeNull())
  })

  it('is not there while no timer runs', async () => {
    installOstlerApi({
      getTimer: async () => ({ ok: true, value: { running: null, interrupted: null } })
    })
    renderWithTimer(<StatusBarTimer />)
    await act(async () => {})
    expect(screen.queryByRole('button', { name: /Timer running/ })).toBeNull()
  })

  it('asks after a restart whether to keep a timer that was running, or stop it at the close', async () => {
    const closedAt = new Date(2026, 9, 12, 17, 30).getTime()
    const resolveInterruptedTimer = vi.fn(async () => ({
      ok: true as const,
      value: { running: null, interrupted: null }
    }))
    installOstlerApi({
      getTimer: async () => ({
        ok: true,
        value: {
          running: entry({ id: 'run', durationSeconds: null }),
          interrupted: { entryId: 'run', closedAt }
        }
      }),
      resolveInterruptedTimer
    })
    renderWithTimer(<StatusBarTimer />)
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(/A timer was running when/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: /Stop it at/ }))
    await waitFor(() => expect(resolveInterruptedTimer).toHaveBeenCalledWith('stop'))
  })
})

describe('the Timesheet', () => {
  it('moves a week at a time and back to this week, asking for each week by local days', async () => {
    const listTimeEntries = vi.fn(async (_query: { from: number; to: number }) => ({
      ok: true as const,
      value: [entry()]
    }))
    installOstlerApi({
      getTimer: async () => ({ ok: true, value: { running: null, interrupted: null } }),
      getProjects: async () => ({ ok: true, value: [] }),
      listTimeEntries
    })
    render(
      <ToastProvider>
        <OstlerProvider>
          <MemoryRouter initialEntries={['/timesheet?week=2026-10-12']}>
            <TimerProvider>
              <Routes>
                <Route path="/timesheet" element={<TimesheetView />} />
              </Routes>
              <Where />
            </TimerProvider>
          </MemoryRouter>
        </OstlerProvider>
      </ToastProvider>
    )
    expect(await screen.findByText('First draft')).toBeTruthy()
    const firstQuery = listTimeEntries.mock.calls[0][0]
    expect(firstQuery.from).toBe(new Date(2026, 9, 12).getTime())
    expect(firstQuery.to).toBe(new Date(2026, 9, 19).getTime())

    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    expect(screen.getByTestId('where').textContent).toBe('/timesheet?week=2026-10-19')
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }))
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }))
    expect(screen.getByTestId('where').textContent).toBe('/timesheet?week=2026-10-05')
    fireEvent.click(screen.getByRole('button', { name: 'This week' }))
    expect(screen.getByTestId('where').textContent).toBe('/timesheet')
  })
})
