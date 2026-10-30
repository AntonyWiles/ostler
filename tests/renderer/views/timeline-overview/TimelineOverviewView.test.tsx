// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  OstlerAPI,
  PlanningMilestone,
  PlanningSubproject,
  PlanningWorkItem,
  TimelineOverviewProject,
  UpdatePlanningMilestoneInput,
  UpdatePlanningWorkItemInput
} from '@shared/ostler-api'
import { TimelineOverviewView } from '@renderer/views/timeline-overview/TimelineOverviewView'
import { TIMELINE_OVERVIEW_SETTINGS_KEY } from '@renderer/views/timeline-overview/timeline-overview-settings'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { StaticPeopleProvider } from '@renderer/context/PeopleContext'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { __resetDismissableStackForTests } from '@renderer/hooks/useDismissable'
import { makeWorkItem } from '../../fixtures/planning-records'
import { emptyPlanningReads } from '../../fixtures/planning-workspace'
import { installOstlerApi } from '../../fixtures/ostler-api'
import { withElementSize } from '../../fixtures/layout'

// jsdom has no PointerEvent; a MouseEvent carries the clientX a drag reads.
if (typeof window.PointerEvent === 'undefined')
  (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = class extends (
    MouseEvent
  ) {}

const projects = [
  { id: 'p1', name: 'House move', color: '#3b82f6', enabled: true, areaId: 'home', icon: null },
  { id: 'p2', name: 'Launch', color: '#ec4899', enabled: true, areaId: 'work', icon: null },
  { id: 'p3', name: 'Garden', color: '#22c55e', enabled: true, areaId: 'home', icon: null },
  { id: 'p4', name: 'Old', color: '#999999', enabled: false, areaId: null, icon: null }
]
const areas = [
  { id: 'home', name: 'Home' },
  { id: 'work', name: 'Work' }
]

vi.mock('@renderer/context/OstlerContext', () => ({
  useOstler: () => ({ projects, areas, loading: false })
}))

const keys: PlanningMilestone = {
  id: 'm1',
  projectId: 'p1',
  goalId: null,
  name: 'Keys',
  outcome: '',
  targetDate: '2026-10-16',
  successCriteria: [],
  status: 'planned',
  createdAt: 1,
  updatedAt: 1
}

function renderView(api: Partial<OstlerAPI> = {}) {
  let overview: TimelineOverviewProject[] = [
    {
      projectId: 'p1',
      milestones: [{ id: 'm1', name: 'Keys', targetDate: '2026-10-16', status: 'planned' }],
      firstDate: '2026-10-05',
      lastDate: '2026-10-20'
    },
    {
      projectId: 'p2',
      milestones: [{ id: 'm2', name: 'Go live', targetDate: '2026-10-14', status: 'planned' }],
      firstDate: null,
      lastDate: null
    },
    { projectId: 'p3', milestones: [], firstDate: null, lastDate: null }
  ]
  let items: PlanningWorkItem[] = [
    makeWorkItem('pack', {
      projectId: 'p1',
      title: 'Pack boxes',
      milestoneId: 'm1',
      startDate: '2026-10-05',
      targetDate: '2026-10-09',
      status: 'active'
    }),
    makeWorkItem('done', {
      projectId: 'p1',
      title: 'Book van',
      targetDate: '2026-10-02',
      status: 'done'
    })
  ]
  const getPlanningWorkItems = vi.fn(async (projectId: string) => ({
    ok: true as const,
    value: items.filter((item) => item.projectId === projectId)
  }))
  const updatePlanningWorkItem = vi.fn(async (id: string, patch: UpdatePlanningWorkItemInput) => {
    const item = items.find((candidate) => candidate.id === id)!
    const updated = { ...item, ...patch } as PlanningWorkItem
    items = items.map((candidate) => (candidate.id === id ? updated : candidate))
    return { ok: true as const, value: updated }
  })
  const updatePlanningMilestone = vi.fn(async (id: string, patch: UpdatePlanningMilestoneInput) => {
    overview = overview.map((entry) => ({
      ...entry,
      milestones: entry.milestones.map((milestone) =>
        milestone.id === id ? { ...milestone, targetDate: patch.targetDate! } : milestone
      )
    }))
    return { ok: true as const, value: { ...keys, ...patch } as PlanningMilestone }
  })
  const getTimelineOverview = vi.fn(async () => ({ ok: true as const, value: overview }))
  installOstlerApi({
    ...emptyPlanningReads(),
    getPlanningWorkItems,
    getPlanningMilestones: async (projectId: string) => ({
      ok: true,
      value: projectId === 'p1' ? [keys] : []
    }),
    updatePlanningWorkItem,
    updatePlanningMilestone,
    getTimelineOverview,
    ...api
  })
  render(
    <ToastProvider>
      <ConfirmProvider>
        <StaticFeaturesProvider value={{ agents: false, ai: false }}>
          <StaticPeopleProvider people={[]}>
            <MemoryRouter initialEntries={['/timeline']}>
              <TimelineOverviewView />
            </MemoryRouter>
          </StaticPeopleProvider>
        </StaticFeaturesProvider>
      </ConfirmProvider>
    </ToastProvider>
  )
  return {
    getPlanningWorkItems,
    updatePlanningWorkItem,
    updatePlanningMilestone,
    getTimelineOverview
  }
}

const openButton = (name: string) => screen.getByRole('button', { name: `Show ${name}'s tasks` })

async function drag(element: Element, dx: number) {
  await act(async () => {
    fireEvent.pointerDown(element, { button: 0, clientX: 500 })
    fireEvent.pointerMove(window, { clientX: 500 + dx })
    fireEvent.pointerUp(window, { clientX: 500 + dx })
  })
}

describe('TimelineOverviewView (N5.4)', () => {
  withElementSize(1280, 800)
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 8, 12) })
  })
  afterEach(() => {
    __resetDismissableStackForTests()
    vi.useRealTimers()
  })

  it('shows a row per enabled project in its area, its milestones, and No dates yet', async () => {
    const { getPlanningWorkItems } = renderView()
    await screen.findByRole('button', { name: /^House move: Milestone: Keys,/ })
    expect(screen.getByRole('button', { name: /^Launch: Milestone: Go live,/ })).toBeInTheDocument()
    expect(openButton('Garden')).toBeInTheDocument()
    expect(screen.queryByText('Old')).not.toBeInTheDocument()
    expect(screen.getByText('No dates yet')).toBeInTheDocument()
    expect(screen.getAllByText('Home').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Work').length).toBeGreaterThan(0)
    expect(
      screen.getByRole('button', { name: /^House move: dated tasks from/ })
    ).toBeInTheDocument()
    // Tasks are read only for a row that opens.
    expect(getPlanningWorkItems).not.toHaveBeenCalled()
  })

  it('marks the week where milestones from two projects meet, and lists them in a popover', async () => {
    renderView()
    const mark = await screen.findByRole('button', { name: /^2 milestones from 2 projects/ })
    act(() => mark.click())
    const popover = await screen.findByRole('dialog', { name: /^2 milestones from 2 projects/ })
    expect(within(popover).getByRole('button', { name: /Go live, Launch/ })).toBeInTheDocument()
    expect(within(popover).getByRole('button', { name: /Keys, House move/ })).toBeInTheDocument()
  })

  it('opens a project row to its dated tasks, done ones left out, and closes it again', async () => {
    const { getPlanningWorkItems } = renderView()
    await screen.findByRole('button', { name: /^House move: Milestone: Keys,/ })
    act(() => openButton('House move').click())
    await screen.findByRole('button', { name: /^Pack boxes,/ })
    expect(getPlanningWorkItems).toHaveBeenCalledWith('p1')
    expect(screen.queryByRole('button', { name: /^Book van,/ })).not.toBeInTheDocument()
    const close = screen.getByRole('button', { name: "Hide House move's tasks" })
    expect(close).toHaveAttribute('aria-expanded', 'true')
    act(() => close.click())
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /^Pack boxes,/ })).not.toBeInTheDocument()
    )
  })

  it('drags a task as the project Timeline does, with undo', async () => {
    const { updatePlanningWorkItem } = renderView()
    await screen.findByRole('button', { name: /^House move: Milestone: Keys,/ })
    act(() => openButton('House move').click())
    const bar = await screen.findByRole('button', { name: /^Pack boxes,/ })
    // Month zoom: 10 px a day.
    await drag(bar, 20)
    expect(updatePlanningWorkItem).toHaveBeenLastCalledWith('pack', {
      startDate: '2026-10-07',
      targetDate: '2026-10-11'
    })
    const toast = await screen.findByText(/"Pack boxes" is now due/)
    act(() =>
      within(toast.closest('[role="status"], .ui-toast') as HTMLElement)
        .getByRole('button', { name: 'Undo' })
        .click()
    )
    await waitFor(() =>
      expect(updatePlanningWorkItem).toHaveBeenLastCalledWith('pack', {
        startDate: '2026-10-05',
        targetDate: '2026-10-09'
      })
    )
  })

  it('drags a milestone, and Alt with an arrow moves it a day, each with undo', async () => {
    const { updatePlanningMilestone } = renderView()
    const diamond = await screen.findByRole('button', { name: /^House move: Milestone: Keys,/ })
    await drag(diamond, 20)
    expect(updatePlanningMilestone).toHaveBeenLastCalledWith('m1', { targetDate: '2026-10-18' })
    const toast = await screen.findByText(/"Keys" is now due/)
    act(() =>
      within(toast.closest('[role="status"], .ui-toast') as HTMLElement)
        .getByRole('button', { name: 'Undo' })
        .click()
    )
    await waitFor(() =>
      expect(updatePlanningMilestone).toHaveBeenLastCalledWith('m1', { targetDate: '2026-10-16' })
    )
    const again = await screen.findByRole('button', { name: /^House move: Milestone: Keys,/ })
    await act(async () => {
      fireEvent.keyDown(again, { key: 'ArrowLeft', altKey: true })
    })
    expect(updatePlanningMilestone).toHaveBeenLastCalledWith('m1', { targetDate: '2026-10-15' })
  })

  it('zooms, and remembers the zoom', async () => {
    renderView()
    await screen.findByRole('button', { name: /^House move: Milestone: Keys,/ })
    act(() => screen.getByRole('radio', { name: 'Week' }).click())
    expect(document.querySelector('.ui-timeline')).toHaveAttribute('data-zoom', 'week')
    expect(JSON.parse(localStorage.getItem(TIMELINE_OVERVIEW_SETTINGS_KEY)!)).toMatchObject({
      zoom: 'week'
    })
  })

  it('filters by area or chosen projects, and remembers the choice', async () => {
    renderView()
    await screen.findByRole('button', { name: /^House move: Milestone: Keys,/ })
    fireEvent.change(screen.getByLabelText('Projects shown'), { target: { value: 'area:work' } })
    await waitFor(() => expect(screen.queryByText('House move')).not.toBeInTheDocument())
    expect(openButton('Launch')).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(TIMELINE_OVERVIEW_SETTINGS_KEY)!).filter).toEqual({
      kind: 'area',
      areaId: 'work'
    })

    fireEvent.change(screen.getByLabelText('Projects shown'), { target: { value: 'chosen' } })
    const chooser = await screen.findByRole('dialog', { name: 'Choose projects' })
    // Choosing starts from what was shown.
    expect(within(chooser).getByRole('checkbox', { name: 'Launch' })).toBeChecked()
    act(() => within(chooser).getByRole('checkbox', { name: 'Garden' }).click())
    await waitFor(() => expect(openButton('Garden')).toBeInTheDocument())
    expect(JSON.parse(localStorage.getItem(TIMELINE_OVERVIEW_SETTINGS_KEY)!).filter).toEqual({
      kind: 'chosen',
      projectIds: ['p2', 'p3']
    })
  })

  it('moves between rows with the arrow keys, and opens and closes a row with right and left', async () => {
    renderView()
    await screen.findByRole('button', { name: /^House move: Milestone: Keys,/ })
    const first = openButton('House move')
    first.focus()
    fireEvent.keyDown(first, { key: 'ArrowDown' })
    expect(openButton('Garden')).toHaveFocus()
    fireEvent.keyDown(openButton('Garden'), { key: 'ArrowUp' })
    expect(first).toHaveFocus()
    fireEvent.keyDown(first, { key: 'ArrowRight' })
    await screen.findByRole('button', { name: /^Pack boxes,/ })
    // Down from the open project reaches its first task.
    const hide = screen.getByRole('button', { name: "Hide House move's tasks" })
    hide.focus()
    fireEvent.keyDown(hide, { key: 'ArrowDown' })
    expect(document.activeElement).toHaveAttribute('title', 'Pack boxes')
    fireEvent.keyDown(hide, { key: 'ArrowLeft' })
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /^Pack boxes,/ })).not.toBeInTheDocument()
    )
  })

  it('shows a project’s live workstreams as folding rows under it, with their own tasks', async () => {
    const website = {
      id: 's1',
      projectId: 'p1',
      name: 'Website',
      archivedAt: null
    } as PlanningSubproject
    const retired = {
      id: 's2',
      projectId: 'p1',
      name: 'Retired stream',
      archivedAt: 5
    } as PlanningSubproject
    const dated = { startDate: '2026-10-05', targetDate: '2026-10-09', status: 'active' as const }
    const items = [
      makeWorkItem('pack', { projectId: 'p1', title: 'Pack boxes', ...dated }),
      makeWorkItem('footer', {
        projectId: 'p1',
        title: 'Tidy footer',
        subprojectId: 's1',
        ...dated
      }),
      makeWorkItem('old', { projectId: 'p1', title: 'Old banner', subprojectId: 's2', ...dated })
    ]
    renderView({
      getPlanningWorkItems: async () => ({ ok: true, value: items }),
      listSubprojects: async () => ({ ok: true, value: [website, retired] })
    })
    await screen.findByRole('button', { name: /^House move: Milestone: Keys,/ })
    act(() => openButton('House move').click())
    const toggle = await screen.findByRole('button', { name: 'Hide tasks of workstream Website' })
    await screen.findByRole('button', { name: /^Tidy footer,/ })
    // Work in no workstream, or an archived one, stays on the project; an archived one has no row.
    expect(screen.getByRole('button', { name: /^Pack boxes,/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Old banner,/ })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /workstream Retired stream/ })
    ).not.toBeInTheDocument()
    act(() => toggle.click())
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /^Tidy footer,/ })).not.toBeInTheDocument()
    )
    expect(
      screen.getByRole('button', { name: 'Show tasks of workstream Website' })
    ).toHaveAttribute('aria-expanded', 'false')
  })
})
