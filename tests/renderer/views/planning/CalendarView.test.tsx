// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  OstlerAPI,
  PlanningMilestone,
  PlanningWorkItem,
  UpdatePlanningWorkItemInput
} from '@shared/ostler-api'
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

const ORIGINAL_TZ = process.env.TZ

function Live() {
  const ws = usePlanningWorkspace('p1', () => {})
  return <CalendarView ws={ws} />
}

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
  let current = items
  const updatePlanningWorkItem = vi.fn(async (id: string, patch: UpdatePlanningWorkItemInput) => {
    const item = current.find((candidate) => candidate.id === id)!
    const updated = { ...item, ...patch } as PlanningWorkItem
    current = current.map((candidate) => (candidate.id === id ? updated : candidate))
    return { ok: true as const, value: updated }
  })
  const saved = fakeSavedViews()
  installOstlerApi({
    ...emptyPlanningReads(),
    ...saved.api,
    getPlanningWorkItems: async () => ({ ok: true, value: current }),
    getPlanningMilestones: async () => ({ ok: true, value: [milestone] }),
    updatePlanningWorkItem,
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
  return { updatePlanningWorkItem, saved }
}

const day = (date: string) =>
  document.querySelector<HTMLElement>(`[role="gridcell"][data-date="${date}"]`)!
const chip = (title: string) => screen.getByRole('button', { name: new RegExp(`^${title},`) })

function fakeTransfer() {
  const data = new Map<string, string>()
  return {
    types: ['text/plain'],
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
    effectAllowed: 'all',
    dropEffect: 'none'
  }
}

describe.each([
  ['UTC+13', 'Pacific/Tongatapu'],
  ['UTC-5', 'America/Bogota']
])('CalendarView in %s', (_name, zone) => {
  beforeEach(() => {
    process.env.TZ = zone
    localStorage.clear()
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 8, 12) })
  })
  afterEach(() => {
    __resetDismissableStackForTests()
    vi.useRealTimers()
    process.env.TZ = ORIGINAL_TZ
  })

  it('shows tasks on their days, ranges across them, and milestones as flags', async () => {
    renderView([
      makeWorkItem('a', { title: 'Book venue', targetDate: '2026-10-15', status: 'ready' }),
      makeWorkItem('b', {
        title: 'Build stage',
        startDate: '2026-10-11',
        targetDate: '2026-10-13',
        status: 'active'
      }),
      makeWorkItem('c', { title: 'Old thing', targetDate: '2026-10-02', status: 'ready' }),
      makeWorkItem('d', { title: 'Finished', targetDate: '2026-10-05', status: 'done' }),
      makeWorkItem('e', { title: 'Someday', status: 'backlog' })
    ])
    await screen.findByRole('button', { name: /^Book venue,/ })
    expect(day('2026-10-15')).toContainElement(chip('Book venue'))
    // A range starting on a Sunday wraps into the next week: two pieces.
    expect(document.querySelectorAll('[data-item-id="b"]')).toHaveLength(2)
    expect(chip('Old thing').getAttribute('aria-label')).toContain('overdue')
    expect(screen.queryByRole('button', { name: /^Finished,/ })).not.toBeInTheDocument()
    expect(
      within(day('2026-10-20')).getByRole('img', { name: /Milestone: Launch/ })
    ).toBeInTheDocument()

    act(() => screen.getByRole('checkbox', { name: 'Show done' }).click())
    expect(chip('Finished')).toHaveClass('is-done')
  })

  it('moves a task a day or a week with Alt and the arrow keys, with undo', async () => {
    const { updatePlanningWorkItem } = renderView([
      makeWorkItem('a', {
        title: 'Book venue',
        startDate: '2026-10-14',
        targetDate: '2026-10-15',
        status: 'ready'
      })
    ])
    const target = await screen.findByRole('button', { name: /^Book venue,/ })
    act(() => target.focus())
    await act(async () => {
      fireEvent.keyDown(target, { key: 'ArrowRight', altKey: true })
    })
    expect(updatePlanningWorkItem).toHaveBeenLastCalledWith('a', {
      targetDate: '2026-10-16',
      startDate: '2026-10-15'
    })
    await waitFor(() => expect(chip('Book venue')).toHaveFocus())
    await act(async () => {
      fireEvent.keyDown(chip('Book venue'), { key: 'ArrowUp', altKey: true })
    })
    expect(updatePlanningWorkItem).toHaveBeenLastCalledWith('a', {
      targetDate: '2026-10-09',
      startDate: '2026-10-08'
    })
    await waitFor(() => expect(day('2026-10-08')).toContainElement(chip('Book venue')))

    const toasts = await screen.findAllByText(/"Book venue" is now due/)
    const toast = toasts[toasts.length - 1]
    const undo = within(toast.closest('[role="status"], .ui-toast') as HTMLElement).getByRole(
      'button',
      { name: 'Undo' }
    )
    await act(async () => undo.click())
    expect(updatePlanningWorkItem).toHaveBeenLastCalledWith('a', {
      targetDate: '2026-10-16',
      startDate: '2026-10-15'
    })
  })

  it('drags a task to the next day, and an unscheduled one onto a day', async () => {
    const { updatePlanningWorkItem, saved } = renderView([
      makeWorkItem('a', { title: 'Book venue', targetDate: '2026-10-15', status: 'ready' }),
      makeWorkItem('e', { title: 'Someday', status: 'backlog' })
    ])
    await screen.findByRole('button', { name: /^Book venue,/ })

    const transfer = fakeTransfer()
    fireEvent.dragStart(document.querySelector('[data-item-id="a"]')!, { dataTransfer: transfer })
    await act(async () => {
      fireEvent.drop(day('2026-10-16'), { dataTransfer: transfer })
    })
    expect(updatePlanningWorkItem).toHaveBeenLastCalledWith('a', { targetDate: '2026-10-16' })

    act(() => screen.getByRole('button', { name: /Unscheduled \(1\)/ }).click())
    const panel = screen.getByRole('complementary', { name: 'Unscheduled tasks' })
    const someday = within(panel).getByText('Someday').closest('li')!
    const second = fakeTransfer()
    fireEvent.dragStart(someday, { dataTransfer: second })
    await act(async () => {
      fireEvent.drop(day('2026-10-21'), { dataTransfer: second })
    })
    expect(updatePlanningWorkItem).toHaveBeenLastCalledWith('e', { targetDate: '2026-10-21' })
    // The panel stays open next time: the project's default Calendar view keeps it.
    await waitFor(() =>
      expect(saved.defaultOf('p1', 'calendar')?.config.options).toMatchObject({
        mode: 'month',
        unscheduledOpen: true
      })
    )
  })

  it('adds a task due on a day from its "+"', async () => {
    const createPlanningWorkItem = vi.fn(async (_projectId: string, input: { title: string }) => ({
      ok: true as const,
      value: makeWorkItem('n', { ...input, targetDate: '2026-10-22' })
    }))
    renderView([], { createPlanningWorkItem: createPlanningWorkItem as never })
    await screen.findByText('No dated tasks here yet')
    act(() =>
      within(day('2026-10-22'))
        .getByRole('button', { name: /^Add task on / })
        .click()
    )
    const field = await screen.findByLabelText(/New task due/)
    fireEvent.change(field, { target: { value: 'Rehearse' } })
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' })
    })
    expect(createPlanningWorkItem).toHaveBeenCalledWith('p1', {
      title: 'Rehearse',
      targetDate: '2026-10-22'
    })
  })

  it('remembers week mode per project, and T goes back to today', async () => {
    const { saved } = renderView([])
    await screen.findByRole('grid', { name: 'Calendar' })
    act(() => screen.getByRole('radio', { name: 'Week' }).click())
    expect(screen.getAllByRole('gridcell')).toHaveLength(7)
    act(() => screen.getByRole('button', { name: 'Next week' }).click())
    expect(day('2026-10-08')).toBeNull()
    act(() => {
      fireEvent.keyDown(document.body, { key: 't' })
    })
    expect(day('2026-10-08')).not.toBeNull()
    await waitFor(() => expect(saved.defaultOf('p1', 'calendar')?.config.options.mode).toBe('week'))
  })
})
