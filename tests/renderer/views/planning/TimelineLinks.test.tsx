// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  OstlerAPI,
  PlanningWorkItem,
  Result,
  UpdatePlanningWorkItemInput
} from '@shared/ostler-api'
import { t } from '@shared/i18n'
import { usePlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import { TimelineView } from '@renderer/views/planning/timeline/TimelineView'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { StaticPeopleProvider } from '@renderer/context/PeopleContext'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { __resetDismissableStackForTests } from '@renderer/hooks/useDismissable'
import { makeWorkItem } from '../../fixtures/planning-records'
import { emptyPlanningReads } from '../../fixtures/planning-workspace'
import { installOstlerApi } from '../../fixtures/ostler-api'
import { fakeSavedViews } from '../../fixtures/saved-views'
import { withElementSize } from '../../fixtures/layout'

// jsdom has no PointerEvent; a MouseEvent carries what a drag reads.
if (typeof window.PointerEvent === 'undefined')
  (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = class extends (
    MouseEvent
  ) {}

function Live() {
  const ws = usePlanningWorkspace('p1', () => {})
  return <TimelineView ws={ws} />
}

type Update = (id: string, patch: UpdatePlanningWorkItemInput) => Promise<Result<PlanningWorkItem>>

function renderView(
  items: PlanningWorkItem[],
  refuse?: (patch: UpdatePlanningWorkItemInput) => string | null
) {
  let current = items
  const updatePlanningWorkItem = vi.fn<Update>(async (id, patch) => {
    const reason = refuse?.(patch)
    if (reason) return { ok: false as const, error: reason }
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
    getPlanningMilestones: async () => ({ ok: true, value: [] }),
    updatePlanningWorkItem
  } as Partial<OstlerAPI>)
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
  return { updatePlanningWorkItem }
}

const bar = (title: string) => screen.getByRole('button', { name: new RegExp(`^${title},`) })
const handle = (id: string, end: 'start' | 'end') =>
  document.querySelector(`[data-bar-id="${id}"] [data-link-end="${end}"]`) as Element

async function drawLink(from: [string, 'start' | 'end'], to: [string, 'start' | 'end']) {
  fireEvent.pointerDown(handle(...from), { button: 0, clientX: 10, clientY: 10 })
  await act(async () => {
    fireEvent.pointerUp(handle(...to), { button: 0, clientX: 40, clientY: 40 })
  })
}

const undoIn = (text: RegExp) => {
  const toasts = screen.getAllByText(text)
  const toast = toasts[toasts.length - 1]
  return within(toast.closest('[role="status"], .ui-toast') as HTMLElement).getByRole('button', {
    name: 'Undo'
  })
}

describe('TimelineView: links on the Timeline (N7.2b)', () => {
  withElementSize(1280, 600)
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 8, 12) })
  })
  afterEach(() => {
    __resetDismissableStackForTests()
    vi.useRealTimers()
  })

  const plan = (): PlanningWorkItem[] => [
    makeWorkItem('plaster', {
      title: 'Plastering',
      startDate: '2026-10-05',
      targetDate: '2026-10-09',
      status: 'active'
    }),
    makeWorkItem('paint', {
      title: 'Painting',
      startDate: '2026-10-12',
      targetDate: '2026-10-16',
      status: 'ready',
      dependencyIds: ['plaster']
    }),
    makeWorkItem('tiles', {
      title: 'Tiling',
      startDate: '2026-10-07',
      targetDate: '2026-10-14',
      status: 'ready'
    })
  ]

  it('draws each link from its true ends, with its lag labelled and said in words', async () => {
    renderView([
      ...plan().slice(0, 2),
      makeWorkItem('tiles', {
        title: 'Tiling',
        startDate: '2026-10-07',
        targetDate: '2026-10-14',
        dependencyIds: ['plaster'],
        dependencyLinks: [{ id: 'plaster', type: 'start-to-start', lagDays: 2 }]
      })
    ])
    await screen.findByRole('button', { name: /^Plastering,/ })
    const plain = document.querySelector('[data-arrow-id="plaster->paint"]')!
    expect(plain.getAttribute('data-link-from')).toBe('end')
    expect(plain.getAttribute('data-link-to')).toBe('start')
    const typed = document.querySelector('[data-arrow-id="plaster->tiles"]')!
    expect(typed.getAttribute('data-link-from')).toBe('start')
    expect(typed.getAttribute('data-link-to')).toBe('start')
    expect(typed.textContent).toBe('Tiling starts 2 days after Plastering starts')
    const link = screen.getByRole('button', {
      name: 'Tiling starts 2 days after Plastering starts'
    })
    expect(link.querySelector('.ui-timeline__lag')?.textContent).toBe('+2d')
  })

  it.each([
    ['start', 'start', 'start-to-start', 'Starts after it starts'],
    ['end', 'end', 'finish-to-finish', 'Due after it is due'],
    ['end', 'start', 'finish-to-start', 'Starts after it is due']
  ] as const)(
    'drawing from %s to %s makes %s, confirmed in a popover with a lag',
    async (fromEnd, toEnd, type, words) => {
      const { updatePlanningWorkItem } = renderView(plan())
      await screen.findByRole('button', { name: /^Plastering,/ })
      await drawLink(['plaster', fromEnd], ['tiles', toEnd])
      const popover = await screen.findByRole('dialog', {
        name: 'Link from Plastering to Tiling'
      })
      const kind = within(popover).getByLabelText('How it waits') as HTMLSelectElement
      expect(kind.value).toBe(type)
      expect(kind.selectedOptions[0].textContent).toBe(words)
      fireEvent.change(within(popover).getByLabelText(/Days after/), { target: { value: '2' } })
      await act(async () => within(popover).getByRole('button', { name: 'Add link' }).click())
      expect(updatePlanningWorkItem).toHaveBeenLastCalledWith('tiles', {
        dependencyIds: ['plaster'],
        dependencyLinks: [{ id: 'plaster', type, lagDays: 2 }]
      })
      await waitFor(() =>
        expect(document.querySelector('[data-arrow-id="plaster->tiles"]')).not.toBeNull()
      )
      await act(async () => undoIn(/Tiling now waits on Plastering/).click())
      expect(updatePlanningWorkItem).toHaveBeenLastCalledWith('tiles', {
        dependencyIds: [],
        dependencyLinks: []
      })
    }
  )

  it('refuses start to end with a short note', async () => {
    const { updatePlanningWorkItem } = renderView(plan())
    await screen.findByRole('button', { name: /^Plastering,/ })
    await drawLink(['plaster', 'start'], ['tiles', 'end'])
    expect(await screen.findByText(/Start to finish links aren't offered/)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(updatePlanningWorkItem).not.toHaveBeenCalled()
  })

  it('refuses a cycle with the same words as the drawer', async () => {
    const loop = t('errors:planningService.planningDependenciesCannotContain')
    renderView(plan(), (patch) => (patch.dependencyIds?.includes('paint') ? loop : null))
    await screen.findByRole('button', { name: /^Plastering,/ })
    await drawLink(['paint', 'end'], ['plaster', 'start'])
    const popover = await screen.findByRole('dialog', { name: 'Link from Painting to Plastering' })
    await act(async () => within(popover).getByRole('button', { name: 'Add link' }).click())
    expect(await screen.findByText(loop)).toBeInTheDocument()
    expect(document.querySelector('[data-arrow-id="paint->plaster"]')).toBeNull()
  })

  it('links by keyboard with Link to… in the bar menu', async () => {
    const { updatePlanningWorkItem } = renderView(plan())
    await screen.findByRole('button', { name: /^Plastering,/ })
    act(() => bar('Plastering').focus())
    fireEvent.keyDown(bar('Plastering'), { key: 'F10', shiftKey: true })
    const item = await screen.findByRole('menuitem', { name: 'Link to…' })
    act(() => item.click())
    const popover = await screen.findByRole('dialog', { name: 'Link from Plastering to Tiling' })
    // Painting already waits on Plastering, so only Tiling is offered.
    const task = within(popover).getByLabelText('Task that waits on it') as HTMLSelectElement
    expect([...task.options].map((option) => option.textContent)).toEqual(['Tiling'])
    fireEvent.change(within(popover).getByLabelText('How it waits'), {
      target: { value: 'start-to-start' }
    })
    fireEvent.change(within(popover).getByLabelText(/Days after/), { target: { value: '-1' } })
    expect(within(popover).getByText('Tiling starts 1 day before Plastering starts')).toBeVisible()
    await act(async () => within(popover).getByRole('button', { name: 'Add link' }).click())
    expect(updatePlanningWorkItem).toHaveBeenLastCalledWith('tiles', {
      dependencyIds: ['plaster'],
      dependencyLinks: [{ id: 'plaster', type: 'start-to-start', lagDays: -1 }]
    })
  })

  it('selects an arrow to change its type and lag, or remove it, with undo', async () => {
    const { updatePlanningWorkItem } = renderView(plan())
    await screen.findByRole('button', { name: /^Plastering,/ })
    const arrow = () => screen.getByRole('button', { name: /Painting.*Plastering/ })
    act(() => arrow().focus())
    fireEvent.keyDown(arrow(), { key: 'Enter' })
    let popover = await screen.findByRole('dialog', { name: 'Link from Plastering to Painting' })
    expect(arrow()).toHaveAttribute('aria-pressed', 'true')
    fireEvent.change(within(popover).getByLabelText('How it waits'), {
      target: { value: 'finish-to-finish' }
    })
    fireEvent.change(within(popover).getByLabelText(/Days after/), { target: { value: '3' } })
    await act(async () => within(popover).getByRole('button', { name: 'Save' }).click())
    expect(updatePlanningWorkItem).toHaveBeenLastCalledWith('paint', {
      dependencyIds: ['plaster'],
      dependencyLinks: [{ id: 'plaster', type: 'finish-to-finish', lagDays: 3 }]
    })
    await waitFor(() =>
      expect(
        document.querySelector('[data-arrow-id="plaster->paint"]')?.getAttribute('data-link-to')
      ).toBe('end')
    )

    act(() => arrow().dispatchEvent(new MouseEvent('click', { bubbles: true })))
    popover = await screen.findByRole('dialog', { name: 'Link from Plastering to Painting' })
    await act(async () => within(popover).getByRole('button', { name: 'Remove link' }).click())
    expect(updatePlanningWorkItem).toHaveBeenLastCalledWith('paint', {
      dependencyIds: [],
      dependencyLinks: []
    })
    await waitFor(() =>
      expect(document.querySelector('[data-arrow-id="plaster->paint"]')).toBeNull()
    )
    await act(async () => undoIn(/Painting no longer waits on Plastering/).click())
    expect(updatePlanningWorkItem).toHaveBeenLastCalledWith('paint', {
      dependencyIds: ['plaster'],
      dependencyLinks: [{ id: 'plaster', type: 'finish-to-finish', lagDays: 3 }]
    })
  })

  it('draws the critical path heavier from its true ends and names each link in the panel', async () => {
    renderView([
      makeWorkItem('plaster', {
        title: 'Plastering',
        startDate: '2026-10-05',
        targetDate: '2026-10-09'
      }),
      makeWorkItem('paint', {
        title: 'Painting',
        startDate: '2026-10-07',
        targetDate: '2026-10-16',
        dependencyIds: ['plaster'],
        dependencyLinks: [{ id: 'plaster', type: 'start-to-start', lagDays: 2 }]
      })
    ])
    await screen.findByRole('button', { name: /^Plastering,/ })
    act(() => screen.getByRole('checkbox', { name: 'Show critical path' }).click())
    const arrow = document.querySelector('[data-arrow-id="plaster->paint"]')!
    expect(arrow).toHaveClass('ui-timeline__arrow--strong')
    expect(arrow.getAttribute('data-link-from')).toBe('start')
    const panel = screen.getByRole('complementary', { name: 'Critical path' })
    expect(within(panel).getByText('Starts 2 days after Plastering starts')).toBeInTheDocument()
  })
})
