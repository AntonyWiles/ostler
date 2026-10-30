// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OstlerAPI, PlanningWorkItem } from '@shared/ostler-api'
import { usePlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import { ListView } from '@renderer/views/planning/list/ListView'
import { BoardView } from '@renderer/views/planning/BoardView'
import { TaskShowFromField } from '@renderer/views/planning/TaskScheduleFields'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { StaticPeopleProvider } from '@renderer/context/PeopleContext'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { __resetDismissableStackForTests } from '@renderer/hooks/useDismissable'
import { SHOW_HIDDEN_KEY } from '@renderer/hooks/useHiddenTasks'
import { makeWorkItem } from '../../fixtures/planning-records'
import { emptyPlanningReads } from '../../fixtures/planning-workspace'
import { installOstlerApi } from '../../fixtures/ostler-api'
import { withElementSize } from '../../fixtures/layout'

type View = 'list' | 'board' | 'someday'

function Live({ view }: { view: View }) {
  const ws = usePlanningWorkspace('p1', () => {})
  if (view === 'board') return <BoardView ws={ws} />
  return <ListView ws={ws} someday={view === 'someday'} />
}

function renderView(items: PlanningWorkItem[], view: View, api: Partial<OstlerAPI> = {}) {
  installOstlerApi({
    ...emptyPlanningReads(),
    getPlanningWorkItems: async () => ({ ok: true, value: items }),
    ...api
  })
  return render(
    <ToastProvider>
      <ConfirmProvider>
        <StaticFeaturesProvider value={{ agents: false, ai: false }}>
          <StaticPeopleProvider people={[]}>
            <Live view={view} />
          </StaticPeopleProvider>
        </StaticFeaturesProvider>
      </ConfirmProvider>
    </ToastProvider>
  )
}

// Wednesday 7 October 2026.
const ITEMS = () => [
  makeWorkItem('now', { title: 'Do it now' }),
  makeWorkItem('later', { title: 'Renew insurance', showFrom: '2026-10-20' }),
  makeWorkItem('later2', { title: 'Book the dentist', showFrom: '2026-11-01' }),
  makeWorkItem('idea', { title: 'Learn the cello', someday: true })
]

describe('Show from and Someday on the Board and the List (N1.1a)', () => {
  withElementSize(1200, 800)
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 7, 9, 30))
  })
  afterEach(() => {
    __resetDismissableStackForTests()
    vi.useRealTimers()
  })

  it('leaves hidden tasks off the Board, counts them, and shows them on request', async () => {
    renderView(ITEMS(), 'board')
    await screen.findByText('Do it now')
    expect(screen.queryByText('Renew insurance')).toBeNull()
    expect(screen.queryByText('Learn the cello')).toBeNull()
    expect(screen.getByText('2 hidden until later · 1 in Someday')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Show them' }))
    expect(await screen.findByText('Renew insurance')).toBeTruthy()
    expect(screen.getByText('Learn the cello')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Hide them' }).getAttribute('aria-pressed')).toBe(
      'true'
    )
    // The choice is the view's own, kept for next time.
    expect(JSON.parse(localStorage.getItem(SHOW_HIDDEN_KEY)!)).toEqual({ 'p1:board': true })
  })

  it('leaves hidden tasks off the List too', async () => {
    renderView(ITEMS(), 'list')
    await screen.findByRole('grid', { name: 'Tasks' })
    expect(screen.getByText('Do it now')).toBeTruthy()
    expect(screen.queryByText('Book the dentist')).toBeNull()
    expect(screen.getByText('2 hidden until later · 1 in Someday')).toBeTruthy()
  })

  it('lists only Someday tasks in the Someday view, and brings one back', async () => {
    const updatePlanningWorkItem = vi.fn(async (id: string, patch: object) => ({
      ok: true as const,
      value: { ...ITEMS().find((item) => item.id === id)!, ...patch } as PlanningWorkItem
    }))
    renderView(ITEMS(), 'someday', { updatePlanningWorkItem } as Partial<OstlerAPI>)
    await screen.findByRole('grid', { name: 'Tasks' })
    expect(screen.getByText('Learn the cello')).toBeTruthy()
    expect(screen.queryByText('Do it now')).toBeNull()
    expect(screen.queryByText('Renew insurance')).toBeNull()
    expect(screen.getByText('1 task in Someday')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Bring back “Learn the cello”' }))
    await waitFor(() =>
      expect(updatePlanningWorkItem).toHaveBeenCalledWith('idea', { someday: false })
    )
    await waitFor(() => expect(screen.queryByText('Learn the cello')).toBeNull())
  })
})

describe('the drawer’s Show from field (N1.1a)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 7, 9, 30))
  })
  afterEach(() => vi.useRealTimers())

  it('says when a task is hidden until a later day', () => {
    const onChange = vi.fn()
    const { rerender } = render(<TaskShowFromField value="2027-03-01" onChange={onChange} />)
    expect(screen.getByText('Hidden until 1 March')).toBeTruthy()
    rerender(<TaskShowFromField value="2026-10-07" onChange={onChange} />)
    expect(screen.queryByText(/Hidden until/)).toBeNull()
    fireEvent.change(screen.getByLabelText('Show from'), { target: { value: '2026-12-24' } })
    expect(onChange).toHaveBeenCalledWith('2026-12-24')
  })
})
