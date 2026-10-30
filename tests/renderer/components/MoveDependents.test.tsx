// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  PlanningMilestone,
  PlanningWorkItem,
  UpdatePlanningWorkItemInput
} from '@shared/ostler-api'
import type { DependentMovePlan, TaskDateMove } from '@shared/planning/move-dependents'
import type { RescheduleChange } from '@shared/planning/reschedule'
import { usePlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import { TimelineView } from '@renderer/views/planning/timeline/TimelineView'
import { MoveDependentsProvider } from '@renderer/components/move-dependents/MoveDependentsProvider'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { StaticPeopleProvider } from '@renderer/context/PeopleContext'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { __resetDismissableStackForTests } from '@renderer/hooks/useDismissable'
import { makeWorkItem } from '../fixtures/planning-records'
import { emptyPlanningReads } from '../fixtures/planning-workspace'
import { installOstlerApi } from '../fixtures/ostler-api'
import { fakeSavedViews } from '../fixtures/saved-views'
import { withElementSize } from '../fixtures/layout'

if (typeof window.PointerEvent === 'undefined')
  (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = class extends (
    MouseEvent
  ) {}

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

const items = () => [
  makeWorkItem('design', {
    title: 'Design review',
    milestoneId: 'm1',
    startDate: '2026-10-05',
    targetDate: '2026-10-12',
    status: 'active'
  }),
  makeWorkItem('build', {
    title: 'Build stage',
    milestoneId: 'm1',
    startDate: '2026-10-13',
    targetDate: '2026-10-15',
    status: 'ready',
    dependencyIds: ['design']
  }),
  makeWorkItem('shipped', {
    title: 'Shipped bit',
    targetDate: '2026-10-13',
    status: 'done',
    dependencyIds: ['design']
  })
]

const PLAN: DependentMovePlan = {
  entries: [
    {
      id: 'build',
      title: 'Build stage',
      dependencyId: 'design',
      days: 2,
      fromStart: '2026-10-13',
      fromDue: '2026-10-15',
      toStart: '2026-10-15',
      toDue: '2026-10-19'
    }
  ],
  skipped: [{ id: 'shipped', title: 'Shipped bit', reason: 'done' }]
}

let ws: ReturnType<typeof usePlanningWorkspace>
function Live() {
  ws = usePlanningWorkspace('p1', () => {})
  return <TimelineView ws={ws} />
}

function setup() {
  let current = items()
  const updatePlanningWorkItem = vi.fn(async (id: string, patch: UpdatePlanningWorkItemInput) => {
    const item = current.find((candidate) => candidate.id === id)!
    const updated = { ...item, ...patch } as PlanningWorkItem
    current = current.map((candidate) => (candidate.id === id ? updated : candidate))
    return { ok: true as const, value: updated }
  })
  const previewMoveDependents = vi.fn(async (_moves: TaskDateMove[]) => ({
    ok: true as const,
    value: PLAN
  }))
  const applyReschedule = vi.fn(async (changes: RescheduleChange[]) => ({
    ok: true as const,
    value: { changed: changes, skipped: [] }
  }))
  installOstlerApi({
    ...emptyPlanningReads(),
    ...fakeSavedViews().api,
    getPlanningWorkItems: async () => ({ ok: true, value: current }),
    getPlanningMilestones: async () => ({ ok: true, value: [milestone] }),
    updatePlanningWorkItem,
    previewMoveDependents,
    applyReschedule
  })
  render(
    <ToastProvider>
      <ConfirmProvider>
        <MoveDependentsProvider>
          <StaticFeaturesProvider value={{ agents: false, ai: false }}>
            <StaticPeopleProvider people={[]}>
              <Live />
            </StaticPeopleProvider>
          </StaticFeaturesProvider>
        </MoveDependentsProvider>
      </ConfirmProvider>
    </ToastProvider>
  )
  return { previewMoveDependents, applyReschedule }
}

const bar = (title: string) => screen.getByRole('button', { name: new RegExp(`^${title},`) })
const offerToast = async () =>
  (await screen.findByText('1 task that waits on this now starts too early')).closest(
    '.ui-toast'
  ) as HTMLElement

describe('Move what waits on it (N7.1)', () => {
  withElementSize(1280, 600)
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 8, 12) })
  })
  afterEach(() => {
    __resetDismissableStackForTests()
    vi.useRealTimers()
  })

  it('offers after a Timeline drag; Preview shows the dates and Move applies with one undo', async () => {
    const { previewMoveDependents, applyReschedule } = setup()
    await screen.findByRole('button', { name: /^Design review,/ })
    // Month zoom: 10 px a day, so 20 px is two days later.
    await act(async () => {
      fireEvent.pointerDown(bar('Design review'), { button: 0, clientX: 500 })
      fireEvent.pointerMove(window, { clientX: 520 })
      fireEvent.pointerUp(window, { clientX: 520 })
    })
    await waitFor(() =>
      expect(previewMoveDependents).toHaveBeenCalledWith([
        {
          id: 'design',
          fromDue: '2026-10-12',
          toDue: '2026-10-14',
          fromStart: '2026-10-05',
          toStart: '2026-10-07'
        }
      ])
    )
    const toast = await offerToast()
    await act(async () => within(toast).getByRole('button', { name: 'Preview' }).click())

    const dialog = await screen.findByRole('dialog', { name: 'Move what waits on it' })
    const row = within(dialog).getByText('Build stage').closest('tr')!
    expect(row.textContent).toContain('2 days later')
    expect(within(dialog).getByText('Shipped bit: done')).toBeInTheDocument()
    await act(async () => within(dialog).getByRole('button', { name: 'Move 1 task' }).click())
    expect(applyReschedule).toHaveBeenCalledWith([
      {
        id: 'build',
        fromDue: '2026-10-15',
        toDue: '2026-10-19',
        fromStart: '2026-10-13',
        toStart: '2026-10-15'
      }
    ])
    const moved = (await screen.findByText('Moved 1 task that waits on it')).closest(
      '.ui-toast'
    ) as HTMLElement
    await act(async () => within(moved).getByRole('button', { name: 'Undo' }).click())
    expect(applyReschedule).toHaveBeenLastCalledWith([
      {
        id: 'build',
        fromDue: '2026-10-19',
        toDue: '2026-10-15',
        fromStart: '2026-10-15',
        toStart: '2026-10-13'
      }
    ])
  })

  it('Leave them closes the offer and moves nothing', async () => {
    const { applyReschedule } = setup()
    await screen.findByRole('button', { name: /^Design review,/ })
    act(() => bar('Design review').focus())
    await act(async () => {
      fireEvent.keyDown(bar('Design review'), { key: 'ArrowRight', altKey: true })
    })
    const toast = await offerToast()
    await act(async () => within(toast).getByRole('button', { name: 'Leave them' }).click())
    expect(
      screen.queryByText('1 task that waits on this now starts too early')
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(applyReschedule).not.toHaveBeenCalled()
  })

  it('offers after the drawer moves a due date later, not earlier', async () => {
    const { previewMoveDependents } = setup()
    await screen.findByRole('button', { name: /^Design review,/ })
    act(() => ws.openWorkItem(ws.workItems.find((item) => item.id === 'design')!))
    act(() => ws.setEditTargetDate('2026-10-14'))
    await waitFor(
      () =>
        expect(previewMoveDependents).toHaveBeenCalledWith([
          expect.objectContaining({ id: 'design', fromDue: '2026-10-12', toDue: '2026-10-14' })
        ]),
      { timeout: 3000 }
    )
    expect(await offerToast()).toBeInTheDocument()
    previewMoveDependents.mockClear()
    act(() => ws.setEditTargetDate('2026-10-13'))
    await new Promise((resolve) => setTimeout(resolve, 1300))
    expect(previewMoveDependents).not.toHaveBeenCalled()
  })
})
