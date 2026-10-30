// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OstlerAPI, PlanningWorkItem } from '@shared/ostler-api'
import { usePlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import { MatrixView } from '@renderer/views/planning/matrix/MatrixView'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { StaticPeopleProvider } from '@renderer/context/PeopleContext'
import { AnnouncerProvider, ConfirmProvider, ToastProvider } from '@renderer/ui'
import { __resetDismissableStackForTests } from '@renderer/hooks/useDismissable'
import { makeWorkItem } from '../../fixtures/planning-records'
import { emptyPlanningReads } from '../../fixtures/planning-workspace'
import { installOstlerApi } from '../../fixtures/ostler-api'

function Live() {
  const ws = usePlanningWorkspace('p1', () => {})
  return <MatrixView ws={ws} />
}

// Friday 16 October 2026: urgent is due by Monday 19 October.
const ITEMS = () => [
  makeWorkItem('fire', { title: 'Fix outage', priority: 'critical', targetDate: '2026-10-16' }),
  makeWorkItem('plan', { title: 'Plan launch', priority: 'high', targetDate: '2026-10-30' }),
  makeWorkItem('reply', { title: 'Reply to email', priority: 'low', targetDate: '2026-10-19' }),
  makeWorkItem('tidy', { title: 'Tidy files', priority: 'medium' }),
  makeWorkItem('done', {
    title: 'Shipped',
    priority: 'critical',
    status: 'done',
    targetDate: '2026-10-16'
  }),
  makeWorkItem('idea', { title: 'Learn the cello', priority: 'high', someday: true })
]

function renderMatrix(items: PlanningWorkItem[] = ITEMS()) {
  const updatePlanningWorkItem = vi.fn(async (id: string, patch: object) => ({
    ok: true as const,
    value: { ...items.find((item) => item.id === id)!, ...patch } as PlanningWorkItem
  }))
  installOstlerApi({
    ...emptyPlanningReads(),
    getPlanningWorkItems: async () => ({ ok: true, value: items }),
    updatePlanningWorkItem
  } as Partial<OstlerAPI>)
  render(
    <AnnouncerProvider>
      <ToastProvider>
        <ConfirmProvider>
          <StaticFeaturesProvider value={{ agents: false, ai: false }}>
            <StaticPeopleProvider people={[]}>
              <Live />
            </StaticPeopleProvider>
          </StaticFeaturesProvider>
        </ConfirmProvider>
      </ToastProvider>
    </AnnouncerProvider>
  )
  return { updatePlanningWorkItem }
}

const box = (name: RegExp) => screen.getByRole('region', { name })
const card = (title: string) => screen.getByRole('article', { name: title })

function drag(title: string, id: string, to: HTMLElement) {
  const dataTransfer = { getData: () => id, setData: vi.fn(), dropEffect: '', effectAllowed: '' }
  fireEvent.dragStart(card(title), { dataTransfer })
  fireEvent.dragOver(to, { dataTransfer })
  fireEvent.drop(to, { dataTransfer })
}

describe('the priority matrix (N7.5)', () => {
  beforeEach(() => {
    // jsdom has no layout, so no scrollIntoView.
    Element.prototype.scrollIntoView = vi.fn()
    localStorage.clear()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 16, 9, 30))
  })
  afterEach(() => {
    __resetDismissableStackForTests()
    vi.useRealTimers()
  })

  it('shows the four labelled boxes with their counts, and only open, shown tasks', async () => {
    renderMatrix()
    await screen.findByText('Fix outage')
    expect(within(box(/^Urgent and important, 1 task$/)).getByText('Fix outage')).toBeTruthy()
    expect(within(box(/^Important, not urgent, 1 task$/)).getByText('Plan launch')).toBeTruthy()
    expect(within(box(/^Urgent, not important, 1 task$/)).getByText('Reply to email')).toBeTruthy()
    expect(within(box(/^Neither, 1 task$/)).getByText('Tidy files')).toBeTruthy()
    expect(screen.queryByText('Shipped')).toBeNull()
    expect(screen.queryByText('Learn the cello')).toBeNull()
    expect(screen.getByText('4 open tasks')).toBeTruthy()
  })

  it('sets high when a card is dragged up, with undo', async () => {
    const { updatePlanningWorkItem } = renderMatrix()
    await screen.findByText('Tidy files')
    drag('Tidy files', 'tidy', box(/^Important, not urgent/))
    await waitFor(() =>
      expect(updatePlanningWorkItem).toHaveBeenCalledWith('tidy', { priority: 'high' })
    )
    await waitFor(() =>
      expect(within(box(/^Important, not urgent, 2 tasks$/)).getByText('Tidy files')).toBeTruthy()
    )
    expect(screen.getByText('Tidy files · Priority: High')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() =>
      expect(updatePlanningWorkItem).toHaveBeenLastCalledWith('tidy', { priority: 'medium' })
    )
  })

  it('sets medium when a critical card is dragged down, and says so', async () => {
    const { updatePlanningWorkItem } = renderMatrix()
    await screen.findByText('Fix outage')
    drag('Fix outage', 'fire', box(/^Urgent, not important/))
    await waitFor(() =>
      expect(updatePlanningWorkItem).toHaveBeenCalledWith('fire', { priority: 'medium' })
    )
    expect(await screen.findByText('Fix outage · Priority: Medium')).toBeTruthy()
  })

  it('refuses a drag across, explains it, and offers the due date', async () => {
    const { updatePlanningWorkItem } = renderMatrix()
    await screen.findByText('Plan launch')
    drag('Plan launch', 'plan', box(/^Urgent and important/))
    expect(
      screen.getAllByText('Urgency comes from the due date: change the date to move it across')
        .length
    ).toBeGreaterThan(0)
    expect(updatePlanningWorkItem).not.toHaveBeenCalled()
    expect(within(box(/^Important, not urgent, 1 task$/)).getByText('Plan launch')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Change the due date of Plan launch' }))
    // The drawer is the workspace's: opening it selects the task.
    expect(updatePlanningWorkItem).not.toHaveBeenCalled()
  })

  it('moves between cards and boxes with the arrows, and up a box with Shift', async () => {
    const { updatePlanningWorkItem } = renderMatrix()
    await screen.findByText('Reply to email')
    const grid = screen.getByRole('group', { name: 'Priority matrix' })
    grid.focus()
    fireEvent.keyDown(grid, { key: 'ArrowDown' })
    await waitFor(() => expect(document.activeElement).toBe(card('Fix outage')))
    fireEvent.keyDown(card('Fix outage'), { key: 'ArrowRight' })
    await waitFor(() => expect(document.activeElement).toBe(card('Plan launch')))
    fireEvent.keyDown(card('Plan launch'), { key: 'ArrowDown' })
    await waitFor(() => expect(document.activeElement).toBe(card('Tidy files')))
    fireEvent.keyDown(card('Tidy files'), { key: 'ArrowLeft' })
    await waitFor(() => expect(document.activeElement).toBe(card('Reply to email')))
    await act(async () => {
      fireEvent.keyDown(card('Reply to email'), { key: 'ArrowUp', shiftKey: true })
    })
    await waitFor(() =>
      expect(updatePlanningWorkItem).toHaveBeenCalledWith('reply', { priority: 'high' })
    )
    // Across is refused from the keyboard too.
    fireEvent.keyDown(card('Reply to email'), { key: 'ArrowRight' })
    await waitFor(() => expect(document.activeElement).toBe(card('Plan launch')))
    fireEvent.keyDown(card('Plan launch'), { key: 'ArrowLeft', shiftKey: true })
    expect(
      await screen.findByRole('button', { name: 'Change the due date of Plan launch' })
    ).toBeTruthy()
    expect(updatePlanningWorkItem).toHaveBeenCalledTimes(1)
  })

  it('uses the filter bar: search narrows every box', async () => {
    renderMatrix()
    await screen.findByText('Fix outage')
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tasks' }), {
      target: { value: 'tidy' }
    })
    await waitFor(() => expect(screen.queryByText('Fix outage')).toBeNull())
    expect(screen.getByText('Tidy files')).toBeTruthy()
    expect(box(/^Urgent and important, 0 tasks$/)).toBeTruthy()
  })
})
