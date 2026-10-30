// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OstlerAPI, PlanningMilestone, PlanningWorkItem } from '@shared/ostler-api'
import { usePlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import { CalendarView } from '@renderer/views/planning/calendar/CalendarView'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { StaticPeopleProvider } from '@renderer/context/PeopleContext'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { __resetDismissableStackForTests } from '@renderer/hooks/useDismissable'
import { makeWorkItem } from '../../fixtures/planning-records'
import { emptyPlanningReads } from '../../fixtures/planning-workspace'
import { installOstlerApi } from '../../fixtures/ostler-api'
import { fakeSavedViews } from '../../fixtures/saved-views'

/** Year and Agenda in the Calendar (N3.1a). Today is Thursday 8 October 2026. */

const milestone: PlanningMilestone = {
  id: 'm1',
  projectId: 'p1',
  goalId: null,
  name: 'Launch',
  outcome: '',
  targetDate: '2026-10-20',
  successCriteria: [],
  status: 'planned' as PlanningMilestone['status'],
  createdAt: 1,
  updatedAt: 1
}

function renderView(items: PlanningWorkItem[], api: Partial<OstlerAPI> = {}) {
  const navigate = vi.fn()
  function Live() {
    const ws = usePlanningWorkspace('p1', navigate)
    return <CalendarView ws={ws} />
  }
  const saved = fakeSavedViews()
  installOstlerApi({
    ...emptyPlanningReads(),
    ...saved.api,
    getPlanningWorkItems: async () => ({ ok: true, value: items }),
    getPlanningMilestones: async () => ({ ok: true, value: [milestone] }),
    ...api
  })
  render(
    <ToastProvider>
      <ConfirmProvider>
        <StaticFeaturesProvider value={{ agents: false, ai: false }}>
          <StaticPeopleProvider people={[]}>
            <Live />
          </StaticPeopleProvider>
        </StaticFeaturesProvider>
      </ConfirmProvider>
    </ToastProvider>
  )
  return { saved, navigate }
}

const yearDay = (date: string) =>
  document.querySelector<HTMLElement>(`.calendar-year [data-date="${date}"]`)!

const TASKS = [
  makeWorkItem('a', { title: 'Book venue', targetDate: '2026-10-15', status: 'ready' }),
  makeWorkItem('b', {
    title: 'Build stage',
    startDate: '2026-10-14',
    targetDate: '2026-10-18',
    status: 'active',
    priority: 'high',
    labels: ['site']
  }),
  makeWorkItem('c', { title: 'Plan', startDate: '2026-09-28', targetDate: '2026-10-02' })
]

describe('CalendarView Year and Agenda', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 8, 12) })
  })
  afterEach(() => {
    __resetDismissableStackForTests()
    vi.useRealTimers()
  })

  it('switches to Year, marks days with work and names their counts', async () => {
    const { saved } = renderView(TASKS)
    await screen.findByRole('grid', { name: 'Calendar' })
    act(() => screen.getByRole('radio', { name: 'Year' }).click())
    expect(screen.getByRole('heading', { name: '2026' })).toBeInTheDocument()
    expect(document.querySelectorAll('.calendar-year__month')).toHaveLength(12)
    expect(document.querySelectorAll('.calendar-year [data-date]')).toHaveLength(365)

    expect(yearDay('2026-10-15')).toHaveClass('calendar-year__day--2')
    expect(yearDay('2026-10-15').getAttribute('aria-label')).toMatch(/15.*: 2 tasks$/)
    expect(yearDay('2026-10-20').getAttribute('aria-label')).toMatch(/: 1 milestone$/)
    expect(yearDay('2026-10-21')).toHaveClass('calendar-year__day--0')
    expect(yearDay('2026-10-21').getAttribute('aria-label')).not.toContain(':')
    expect(yearDay('2026-10-08')).toHaveAttribute('tabindex', '0')
    expect(yearDay('2026-10-08')).toHaveAttribute('aria-current', 'date')

    act(() => screen.getByRole('button', { name: 'Next year' }).click())
    expect(screen.getByRole('heading', { name: '2027' })).toBeInTheDocument()
    await waitFor(() => expect(saved.defaultOf('p1', 'calendar')?.config.options.mode).toBe('year'))
  })

  it('moves between days with the arrows and months with Page keys', async () => {
    renderView(TASKS)
    await screen.findByRole('grid', { name: 'Calendar' })
    act(() => screen.getByRole('radio', { name: 'Year' }).click())
    act(() => yearDay('2026-10-08').focus())
    fireEvent.keyDown(yearDay('2026-10-08'), { key: 'ArrowRight' })
    await waitFor(() => expect(yearDay('2026-10-09')).toHaveFocus())
    fireEvent.keyDown(yearDay('2026-10-09'), { key: 'ArrowDown' })
    await waitFor(() => expect(yearDay('2026-10-16')).toHaveFocus())
    fireEvent.keyDown(yearDay('2026-10-16'), { key: 'PageDown' })
    await waitFor(() => expect(yearDay('2026-11-16')).toHaveFocus())
    fireEvent.keyDown(yearDay('2026-11-16'), { key: 'PageUp' })
    await waitFor(() => expect(yearDay('2026-10-16')).toHaveFocus())
    expect(yearDay('2026-10-16')).toHaveAttribute('tabindex', '0')
  })

  it('opens Week at a day on Enter or a click', async () => {
    renderView(TASKS)
    await screen.findByRole('grid', { name: 'Calendar' })
    act(() => screen.getByRole('radio', { name: 'Year' }).click())
    act(() => {
      fireEvent.keyDown(yearDay('2026-03-04'), { key: 'Enter' })
    })
    expect(screen.getByRole('radio', { name: 'Week', checked: true })).toBeInTheDocument()
    expect(screen.getAllByRole('gridcell')).toHaveLength(7)
    expect(document.querySelector('[role="gridcell"][data-date="2026-03-04"]')).toBeInTheDocument()

    act(() => screen.getByRole('radio', { name: 'Year' }).click())
    act(() => yearDay('2026-12-25').click())
    expect(screen.getByRole('radio', { name: 'Week', checked: true })).toBeInTheDocument()
    expect(document.querySelector('[role="gridcell"][data-date="2026-12-25"]')).toBeInTheDocument()
  })

  it('lists the month as days with headings, each task once with its span', async () => {
    renderView(TASKS)
    await screen.findByRole('grid', { name: 'Calendar' })
    act(() => screen.getByRole('radio', { name: 'Agenda' }).click())
    const list = screen.getByRole('list', { name: 'Days this month' })
    const headings = within(list).getAllByRole('heading', { level: 3 })
    // 1 October (Plan, from September), 14 (Build stage), 15 (Book venue), 20 (Launch).
    expect(headings).toHaveLength(4)
    expect(headings[0]).toHaveTextContent(/1 October|October 1/)
    expect(within(list).getAllByRole('button', { name: /Build stage/ })).toHaveLength(1)
    const build = within(list).getByRole('button', { name: /Build stage/ })
    expect(build).toHaveTextContent(/14.*18/)
    expect(within(build).getByText('site')).toBeInTheDocument()
    expect(within(list).getByText('Milestone: Launch')).toBeInTheDocument()
    expect(screen.getByText('Nothing else this month')).toBeInTheDocument()

    act(() => build.click())
    // The drawer opens on it: the row shows as the selected task.
    await waitFor(() =>
      expect(within(list).getByRole('button', { name: /Build stage/ })).toHaveClass('is-active')
    )
  })

  it('marks today and says so when the month is empty', async () => {
    renderView([makeWorkItem('t', { title: 'Today task', targetDate: '2026-10-08' })])
    await screen.findByRole('grid', { name: 'Calendar' })
    act(() => screen.getByRole('radio', { name: 'Agenda' }).click())
    const today = screen.getByRole('heading', { name: /Today/ })
    expect(today).toHaveTextContent(/8/)
    act(() => screen.getByRole('button', { name: 'Previous month' }).click())
    expect(screen.queryByRole('list', { name: 'Days this month' })).not.toBeInTheDocument()
    expect(screen.getByText('Nothing this month')).toBeInTheDocument()
  })
})
