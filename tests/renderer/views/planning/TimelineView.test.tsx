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
import { TimelineView } from '@renderer/views/planning/timeline/TimelineView'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { StaticPeopleProvider } from '@renderer/context/PeopleContext'
import { ConfirmProvider, ToastProvider, dateToX, timelineRange } from '@renderer/ui'
import { __resetDismissableStackForTests } from '@renderer/hooks/useDismissable'
import { makeWorkItem } from '../../fixtures/planning-records'
import { emptyPlanningReads } from '../../fixtures/planning-workspace'
import { installOstlerApi } from '../../fixtures/ostler-api'
import { fakeSavedViews } from '../../fixtures/saved-views'
import { withElementSize } from '../../fixtures/layout'

const ORIGINAL_TZ = process.env.TZ

// jsdom has no PointerEvent or DragEvent; a MouseEvent carries the clientX a drag reads.
if (typeof window.PointerEvent === 'undefined')
  (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = class extends (
    MouseEvent
  ) {}
if (typeof window.DragEvent === 'undefined')
  (window as unknown as { DragEvent: typeof MouseEvent }).DragEvent = class extends MouseEvent {}
const LABEL_WIDTH = 260

function Live() {
  const ws = usePlanningWorkspace('p1', () => {})
  return <TimelineView ws={ws} />
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

const bar = (title: string) => screen.getByRole('button', { name: new RegExp(`^${title},`) })

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
])('TimelineView in %s', (_name, zone) => {
  withElementSize(1280, 600)
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

  const plan = () => [
    makeWorkItem('design', {
      title: 'Design review',
      milestoneId: 'm1',
      startDate: '2026-10-05',
      targetDate: '2026-10-12',
      status: 'active',
      acceptanceCriteria: ['Sketches', 'Sign-off'],
      checkedCriteria: ['Sketches']
    }),
    makeWorkItem('build', {
      title: 'Build stage',
      milestoneId: 'm1',
      startDate: '2026-10-10',
      targetDate: '2026-10-15',
      status: 'ready',
      dependencyIds: ['design']
    }),
    makeWorkItem('print', { title: 'Print badges', targetDate: '2026-10-14', status: 'ready' }),
    makeWorkItem('someday', { title: 'Someday', status: 'backlog' })
  ]

  it('groups bars by milestone, flags a dependency conflict in words, and lists unscheduled tasks', async () => {
    renderView(plan())
    await screen.findByRole('button', { name: /^Design review,/ })
    expect(screen.getByRole('button', { name: /^Collapse Launch, 2 tasks/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Milestone: Launch,/ })).toBeInTheDocument()
    expect(bar('Design review').getAttribute('aria-label')).toContain('1 of 2 checklist items done')
    expect(bar('Build stage').getAttribute('aria-label')).toContain(
      'Starts before "Design review" is due'
    )
    const arrow = document.querySelector('[data-arrow-id="design->build"]')!
    expect(arrow).toHaveClass('ui-timeline__arrow--warning')
    expect(arrow.textContent).toContain('Starts before "Design review" is due')
    expect(
      screen.getByRole('button', { name: /^Collapse Unscheduled, 1 task/ })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Someday/ })).toBeInTheDocument()
  })

  it('collapses a group, hides its arrows, and remembers it with the zoom and grouping', async () => {
    const { saved } = renderView(plan())
    await screen.findByRole('button', { name: /^Design review,/ })
    act(() => screen.getByRole('button', { name: /^Collapse Launch/ }).click())
    expect(screen.queryByRole('button', { name: /^Design review,/ })).not.toBeInTheDocument()
    expect(document.querySelector('[data-arrow-id]')).toBeNull()
    act(() => screen.getByRole('radio', { name: 'Week' }).click())
    fireEvent.change(screen.getByLabelText('Group by'), { target: { value: 'assignee' } })
    await waitFor(() =>
      expect(saved.defaultOf('p1', 'timeline')?.config.options).toMatchObject({
        zoom: 'week',
        groupBy: 'assignee',
        collapsed: ['milestone:m1']
      })
    )
    expect(screen.getByRole('button', { name: /^Collapse Unassigned/ })).toBeInTheDocument()
  })

  it('edits dates with Alt, Alt+Shift and Alt+Ctrl and the arrow keys, with undo', async () => {
    const { updatePlanningWorkItem } = renderView(plan())
    await screen.findByRole('button', { name: /^Design review,/ })
    act(() => bar('Design review').focus())
    await act(async () => {
      fireEvent.keyDown(bar('Design review'), { key: 'ArrowRight', altKey: true })
    })
    expect(updatePlanningWorkItem).toHaveBeenLastCalledWith('design', {
      targetDate: '2026-10-13',
      startDate: '2026-10-06'
    })
    await waitFor(() => expect(bar('Design review')).toHaveFocus())
    await act(async () => {
      fireEvent.keyDown(bar('Design review'), { key: 'ArrowRight', altKey: true, shiftKey: true })
    })
    expect(updatePlanningWorkItem).toHaveBeenLastCalledWith('design', { targetDate: '2026-10-14' })
    await act(async () => {
      fireEvent.keyDown(bar('Design review'), { key: 'ArrowLeft', altKey: true, ctrlKey: true })
    })
    expect(updatePlanningWorkItem).toHaveBeenLastCalledWith('design', { startDate: '2026-10-05' })

    const toasts = await screen.findAllByText(/"Design review" now starts/)
    const toast = toasts[toasts.length - 1]
    const undo = within(toast.closest('[role="status"], .ui-toast') as HTMLElement).getByRole(
      'button',
      { name: 'Undo' }
    )
    await act(async () => undo.click())
    expect(updatePlanningWorkItem).toHaveBeenLastCalledWith('design', { startDate: '2026-10-06' })
  })

  it('rolls an edit back with a toast when the update is refused', async () => {
    const updatePlanningWorkItem = vi.fn(async () => ({
      ok: false as const,
      error: 'Start date cannot be after the due date'
    }))
    renderView(plan(), { updatePlanningWorkItem: updatePlanningWorkItem as never })
    await screen.findByRole('button', { name: /^Print badges,/ })
    await act(async () => {
      fireEvent.keyDown(bar('Print badges'), { key: 'ArrowRight', altKey: true })
    })
    expect(updatePlanningWorkItem).toHaveBeenCalledWith('print', { targetDate: '2026-10-15' })
    expect(await screen.findByText('Start date cannot be after the due date')).toBeInTheDocument()
    expect(bar('Print badges').getAttribute('aria-label')).toContain('Oct')
    expect(bar('Print badges').getAttribute('aria-label')).toMatch(/14/)
  })

  it('drags a bar by its middle and by its due end', async () => {
    const { updatePlanningWorkItem } = renderView(plan())
    await screen.findByRole('button', { name: /^Print badges,/ })
    // Month zoom: 10 px a day.
    const g = bar('Print badges')
    await act(async () => {
      fireEvent.pointerDown(g, { button: 0, clientX: 500 })
      fireEvent.pointerMove(window, { clientX: 520 })
      fireEvent.pointerUp(window, { clientX: 520 })
    })
    expect(updatePlanningWorkItem).toHaveBeenLastCalledWith('print', { targetDate: '2026-10-16' })
    const end = bar('Build stage').querySelector('.ui-timeline__handle--end')!
    await act(async () => {
      fireEvent.pointerDown(end, { button: 0, clientX: 500 })
      fireEvent.pointerMove(window, { clientX: 530 })
      fireEvent.pointerUp(window, { clientX: 530 })
    })
    expect(updatePlanningWorkItem).toHaveBeenLastCalledWith('build', { targetDate: '2026-10-18' })
  })

  it('schedules an unscheduled task on the day it is dropped, one day long', async () => {
    const { updatePlanningWorkItem } = renderView(plan())
    await screen.findByRole('button', { name: /Someday/ })
    const transfer = fakeTransfer()
    const label = screen.getByRole('button', { name: /Someday/ }).closest('[draggable="true"]')!
    fireEvent.dragStart(label, { dataTransfer: transfer })
    const scroll = document.querySelector<HTMLElement>('.ui-timeline__scroll')!
    const range = timelineRange(
      ['2026-10-05', '2026-10-12', '2026-10-10', '2026-10-15', '2026-10-14', '2026-10-20'],
      '2026-10-08',
      'month'
    )
    const clientX =
      LABEL_WIDTH + dateToX('2026-10-21', range.start, 'month') + 1 - scroll.scrollLeft
    await act(async () => {
      fireEvent.drop(scroll, { dataTransfer: transfer, clientX })
    })
    expect(updatePlanningWorkItem).toHaveBeenLastCalledWith('someday', {
      startDate: '2026-10-21',
      targetDate: '2026-10-21'
    })
  })

  it('shows the same rows as a table, with durations, dependencies and conflicts', async () => {
    renderView(plan())
    await screen.findByRole('button', { name: /^Design review,/ })
    act(() => screen.getByRole('button', { name: 'Show as table' }).click())
    const table = await screen.findByRole('grid', { name: 'Timeline as a table' })
    const row = within(table).getByText('Build stage').closest('[role="row"]') as HTMLElement
    expect(row).toHaveTextContent('6 days')
    expect(row).toHaveTextContent('Design review')
    expect(row).toHaveTextContent('Starts before "Design review" is due')
    expect(within(table).getByText('Someday')).toBeInTheDocument()
  })

  it('renders only the rows in view for 500 tasks', async () => {
    const many = Array.from({ length: 500 }, (_, index) =>
      makeWorkItem(`t${index}`, {
        title: `Task ${index}`,
        targetDate: `2026-${String(10 + (index % 3)).padStart(2, '0')}-${String((index % 28) + 1).padStart(2, '0')}`
      })
    )
    renderView(many)
    await waitFor(() =>
      expect(document.querySelectorAll('.ui-timeline__row').length).toBeGreaterThan(0)
    )
    const rendered = document.querySelectorAll('.ui-timeline__row').length
    expect(rendered).toBeLessThan(60)
    // 500 tasks, the dated Launch group (no tasks) and No milestone.
    expect(document.querySelector('.ui-timeline__canvas')!.getAttribute('style')).toContain(
      `height: ${48 + 502 * 36}px`
    )
  })
})

describe('TimelineView: Show critical path (N7.3)', () => {
  withElementSize(1280, 600)
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 8, 12) })
  })
  afterEach(() => {
    __resetDismissableStackForTests()
    vi.useRealTimers()
  })

  // The project ends on 15 October with Build stage; Print badges can slip a day.
  const plan = () => [
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
      startDate: '2026-10-12',
      targetDate: '2026-10-15',
      status: 'ready',
      dependencyIds: ['design']
    }),
    makeWorkItem('print', { title: 'Print badges', targetDate: '2026-10-14', status: 'ready' }),
    makeWorkItem('someday', { title: 'Someday', status: 'backlog' })
  ]

  const turnOn = async () => {
    await screen.findByRole('button', { name: /^Design review,/ })
    act(() => screen.getByRole('checkbox', { name: 'Show critical path' }).click())
  }

  it('outlines the critical bars and says so in words, with heavier links between them', async () => {
    const { saved } = renderView(plan())
    await turnOn()
    expect(bar('Design review').getAttribute('aria-label')).toContain('Critical')
    expect(bar('Build stage').getAttribute('aria-label')).toContain('Critical')
    expect(bar('Print badges').getAttribute('aria-label')).toContain('Can slip 1 day')
    expect(bar('Print badges').getAttribute('aria-label')).not.toContain('Critical')
    expect(bar('Build stage').querySelector('.timeline-bar__critical')).not.toBeNull()
    expect(bar('Print badges').querySelector('.timeline-bar__critical')).toBeNull()
    expect(bar('Print badges').querySelector('title')?.textContent).toContain('Can slip 1 day')
    expect(
      document
        .querySelector('[data-arrow-id="design->build"]')
        ?.classList.contains('ui-timeline__arrow--strong')
    ).toBe(true)
    await waitFor(() =>
      expect(saved.defaultOf('p1', 'timeline')?.config.options).toMatchObject({
        criticalPath: true,
        criticalFor: null
      })
    )
  })

  it('lists the chain in order and the undated tasks apart, each opening its task', async () => {
    renderView(plan())
    await turnOn()
    const panel = screen.getByRole('complementary', { name: 'Critical path' })
    expect(panel).toHaveTextContent('The end: 15 Oct 2026')
    const chain = within(panel).getAllByRole('list')[0]
    expect(
      within(chain)
        .getAllByRole('button')
        .map((button) => button.textContent)
    ).toEqual(['Design review5 Oct 2026 to 12 Oct 2026', 'Build stage12 Oct 2026 to 15 Oct 2026'])
    expect(panel).toHaveTextContent('1 task has no dates and is not counted')
    expect(within(panel).getByRole('button', { name: 'Someday' })).toBeInTheDocument()
    act(() =>
      within(panel)
        .getByRole('button', { name: /^Build stage/ })
        .click()
    )
    await waitFor(() =>
      expect(bar('Build stage').querySelector('.timeline-bar')?.classList).toContain('is-active')
    )
  })

  it('measures against a milestone chosen in For', async () => {
    renderView(plan())
    await turnOn()
    fireEvent.change(screen.getByLabelText('For'), { target: { value: 'm1' } })
    expect(bar('Build stage').getAttribute('aria-label')).toContain('Can slip 5 days')
    const panel = screen.getByRole('complementary', { name: 'Critical path' })
    expect(panel).toHaveTextContent('The end: 20 Oct 2026, the date of Launch')
    expect(panel).toHaveTextContent('Nothing is critical')
  })

  it('says how late a task is against a milestone it cannot meet', async () => {
    renderView(plan(), {
      getPlanningMilestones: async () => ({
        ok: true,
        value: [{ ...milestone, targetDate: '2026-10-13' }]
      })
    })
    await turnOn()
    fireEvent.change(screen.getByLabelText('For'), { target: { value: 'm1' } })
    const label = bar('Build stage').getAttribute('aria-label')!
    expect(label).toContain('Critical')
    expect(label).toContain('Late against the end by 2 days')
  })

  it('adds a Slack column to the table', async () => {
    renderView(plan())
    await turnOn()
    act(() => screen.getByRole('button', { name: 'Show as table' }).click())
    const table = await screen.findByRole('grid', { name: 'Timeline as a table' })
    const row = within(table).getByText('Print badges').closest('[role="row"]') as HTMLElement
    expect(row).toHaveTextContent('Can slip 1 day')
  })
})
