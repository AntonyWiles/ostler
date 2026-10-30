// @vitest-environment jsdom
import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlanningMilestone, RendererProject } from '@shared/ostler-api'
import type { ProjectStage, ProjectStageNames } from '@shared/project-stages'
import { ToastProvider } from '@renderer/ui'
import {
  HomeProjects,
  PROJECTS_LAYOUT_KEY,
  ProjectsLayoutSwitch,
  useProjectsLayout
} from '@renderer/views/home/HomeProjects'
import { RENDERER_DEFAULT_CONFIG, installOstlerApi } from '../../fixtures/ostler-api'

let current: RendererProject[] = []
let rerender: (() => void) | null = null

vi.mock('@renderer/context/OstlerContext', () => ({
  useOstler: () => ({
    projects: current,
    refreshProjects: async () => rerender?.()
  })
}))

function project(
  id: string,
  name: string,
  stage: ProjectStage,
  areaId: string | null = null
): RendererProject {
  return {
    id,
    name,
    path: null,
    color: '#3b82f6',
    enabled: true,
    customIgnorePatterns: [],
    notes: '',
    tags: [],
    addedAt: 0,
    lastActivity: null,
    hasAutomationToken: false,
    areaId,
    icon: null,
    stage
  } as RendererProject
}

let stageNames: ProjectStageNames

function install() {
  installOstlerApi({
    getPlanningWorkItems: async (projectId: string) => ({
      ok: true as const,
      value: (projectId === 'a'
        ? [
            { id: 't1', status: 'done', milestoneId: null, updatedAt: 0 },
            { id: 't2', status: 'blocked', milestoneId: null, updatedAt: 0 }
          ]
        : []) as never
    }),
    getPlanningMilestones: async (projectId: string) => ({
      ok: true as const,
      value: (projectId === 'a'
        ? [
            { id: 'm1', name: 'Launch', targetDate: '2026-11-20', status: 'planned' },
            { id: 'm2', name: 'Beta', targetDate: '2026-11-02', status: 'active' },
            { id: 'm3', name: 'Old', targetDate: '2026-01-01', status: 'complete' }
          ]
        : []) as unknown as PlanningMilestone[]
    }),
    getPlanningProjectMetrics: async () => ({
      ok: true as const,
      value: {
        itemCount: 0,
        completedCount: 0,
        averageLeadTimeMs: null,
        averageCycleTimeMs: null,
        averageQueueAgeMs: 0,
        totalBlockedTimeMs: 0,
        throughput: []
      }
    }),
    getHarnessState: async () => ({ ok: false as const, error: 'off' }),
    getPlanningProjectWorkItemMetrics: async () => ({ ok: true as const, value: {} }),
    getConfig: async () => ({
      ok: true as const,
      value: {
        ...RENDERER_DEFAULT_CONFIG,
        ui: { ...RENDERER_DEFAULT_CONFIG.ui, projectStageNames: stageNames }
      }
    }),
    updateConfig: vi.fn(async (updates) => {
      stageNames = { ...stageNames, ...updates.ui?.projectStageNames } as ProjectStageNames
      return {
        ok: true as const,
        value: {
          ...RENDERER_DEFAULT_CONFIG,
          ui: { ...RENDERER_DEFAULT_CONFIG.ui, projectStageNames: stageNames }
        }
      }
    }),
    updateProject: vi.fn(async (id: string, updates) => {
      current = current.map((entry) => (entry.id === id ? { ...entry, ...updates } : entry))
      return { ok: true as const, value: current.find((entry) => entry.id === id)! as never }
    })
  })
}

function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>
}

function Harness({ areas = [] }: { areas?: { id: string; name: string }[] }) {
  const [, setTick] = useState(0)
  rerender = () => setTick((tick) => tick + 1)
  const [layout, setLayout] = useProjectsLayout()
  return (
    <MemoryRouter>
      <ToastProvider>
        <ProjectsLayoutSwitch value={layout} onChange={setLayout} />
        <HomeProjects projects={current} areas={areas} layout={layout} />
        <LocationProbe />
      </ToastProvider>
    </MemoryRouter>
  )
}

function dataTransfer() {
  const store = new Map<string, string>()
  return {
    setData: (type: string, value: string) => store.set(type, value),
    getData: (type: string) => store.get(type) ?? '',
    dropEffect: 'none',
    effectAllowed: 'all'
  }
}

const column = (name: string) => screen.getByRole('region', { name: `${name} column` })

describe("Home's board of projects (N5.3)", () => {
  beforeEach(() => {
    localStorage.clear()
    stageNames = { planning: '', active: '', 'on-hold': '', done: '' }
    current = [
      project('a', 'Garden', 'active'),
      project('b', 'Novel', 'planning'),
      project('c', 'Taxes', 'on-hold')
    ]
    install()
  })

  it('shows cards by default, and remembers Board in local storage', async () => {
    const { unmount } = render(<Harness />)
    expect(await screen.findByRole('list', { name: 'Projects' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'Board' }))
    expect(await screen.findByRole('region', { name: 'Active column' })).toBeInTheDocument()
    expect(localStorage.getItem(PROJECTS_LAYOUT_KEY)).toBe('board')
    unmount()
    render(<Harness />)
    expect(await screen.findByRole('region', { name: 'Planning column' })).toBeInTheDocument()
  })

  it('puts each project in its column, with progress, next milestone and blockers', async () => {
    localStorage.setItem(PROJECTS_LAYOUT_KEY, 'board')
    render(<Harness />)
    const active = await screen.findByRole('region', { name: 'Active column' })
    const garden = within(active).getByRole('article', { name: 'Garden' })
    expect(within(garden).getByRole('progressbar')).toBeInTheDocument()
    expect(garden).toHaveTextContent(/Next: Beta/)
    expect(garden).toHaveTextContent('1 blocked')
    expect(within(column('Planning')).getByRole('article', { name: 'Novel' })).toBeInTheDocument()
    expect(within(column('On hold')).getByRole('article', { name: 'Taxes' })).toBeInTheDocument()
    expect(within(column('Done')).getByText('No projects')).toBeInTheDocument()
  })

  it('changes the stage by dragging a card to another column, with undo', async () => {
    localStorage.setItem(PROJECTS_LAYOUT_KEY, 'board')
    render(<Harness />)
    const garden = await screen.findByRole('article', { name: 'Garden' })
    const transfer = dataTransfer()
    fireEvent.dragStart(garden, { dataTransfer: transfer })
    fireEvent.dragOver(column('Done'), { dataTransfer: transfer })
    fireEvent.drop(column('Done'), { dataTransfer: transfer })
    await waitFor(() =>
      expect(within(column('Done')).getByRole('article', { name: 'Garden' })).toBeInTheDocument()
    )
    expect(window.ostlerAPI.updateProject).toHaveBeenCalledWith('a', { stage: 'done' })
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() =>
      expect(within(column('Active')).getByRole('article', { name: 'Garden' })).toBeInTheDocument()
    )
    expect(current.find((entry) => entry.id === 'a')?.stage).toBe('active')
  })

  it('moves a card with Alt+Arrow keys and through its menu', async () => {
    localStorage.setItem(PROJECTS_LAYOUT_KEY, 'board')
    render(<Harness />)
    const novel = await screen.findByRole('article', { name: 'Novel' })
    fireEvent.keyDown(novel, { key: 'ArrowRight', altKey: true })
    await waitFor(() =>
      expect(within(column('Active')).getByRole('article', { name: 'Novel' })).toBeInTheDocument()
    )
    // Planning is the first column: Alt+Left from it does nothing.
    fireEvent.keyDown(screen.getByRole('article', { name: 'Garden' }), {
      key: 'ArrowLeft',
      altKey: true
    })
    await waitFor(() =>
      expect(
        within(column('Planning')).getByRole('article', { name: 'Garden' })
      ).toBeInTheDocument()
    )

    fireEvent.click(screen.getByRole('button', { name: 'Taxes options' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Move to Done' }))
    await waitFor(() =>
      expect(within(column('Done')).getByRole('article', { name: 'Taxes' })).toBeInTheDocument()
    )
  })

  it('renames a column for display only', async () => {
    localStorage.setItem(PROJECTS_LAYOUT_KEY, 'board')
    render(<Harness />)
    await screen.findByRole('region', { name: 'On hold column' })
    fireEvent.click(screen.getByRole('button', { name: 'On hold column options' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename column' }))
    const field = await screen.findByLabelText('Column name')
    fireEvent.change(field, { target: { value: 'Summer break' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('region', { name: 'Summer break column' })).toBeInTheDocument()
    expect(window.ostlerAPI.updateConfig).toHaveBeenCalledWith({
      ui: {
        projectStageNames: { planning: '', active: '', 'on-hold': 'Summer break', done: '' }
      }
    })
    // The stage id is the same: Taxes is still in that column.
    expect(
      within(column('Summer break')).getByRole('article', { name: 'Taxes' })
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Garden options' }))
    expect(await screen.findByRole('menuitem', { name: 'Move to Summer break' })).toBeVisible()
  })

  it('collapses Done after the first few, with Show N more', async () => {
    localStorage.setItem(PROJECTS_LAYOUT_KEY, 'board')
    current = Array.from({ length: 8 }, (_, index) => project(`d${index}`, `Done ${index}`, 'done'))
    render(<Harness />)
    const done = await screen.findByRole('region', { name: 'Done column' })
    expect(within(done).getAllByRole('article')).toHaveLength(5)
    act(() => {
      fireEvent.click(within(done).getByRole('button', { name: 'Show 3 more' }))
    })
    expect(within(done).getAllByRole('article')).toHaveLength(8)
    fireEvent.click(within(done).getByRole('button', { name: 'Show fewer' }))
    expect(within(done).getAllByRole('article')).toHaveLength(5)
  })

  it('groups by area within each column when areas exist', async () => {
    localStorage.setItem(PROJECTS_LAYOUT_KEY, 'board')
    current = [
      project('a', 'Garden', 'active', 'home'),
      project('b', 'Budget', 'active', 'work'),
      project('c', 'Novel', 'active', null),
      project('d', 'Taxes', 'on-hold', 'home')
    ]
    render(
      <Harness
        areas={[
          { id: 'home', name: 'Home' },
          { id: 'work', name: 'Work' }
        ]}
      />
    )
    const active = await screen.findByRole('region', { name: 'Active column' })
    expect(
      within(active)
        .getAllByRole('heading', { level: 4 })
        .map((heading) => heading.textContent)
    ).toEqual(['Home', 'Work', 'No area'])
    expect(
      within(within(active).getByRole('list', { name: 'Active: Home' })).getByRole('article', {
        name: 'Garden'
      })
    ).toBeInTheDocument()
    expect(
      within(column('On hold'))
        .getAllByRole('heading', { level: 4 })
        .map((heading) => heading.textContent)
    ).toEqual(['Home'])
  })

  it('opens a Planning project at its Plan and an Active one at its Overview, on the board', async () => {
    localStorage.setItem(PROJECTS_LAYOUT_KEY, 'board')
    render(<Harness />)
    fireEvent.click(await screen.findByRole('article', { name: 'Novel' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/projects/b/plan')
    fireEvent.click(screen.getByRole('article', { name: 'Garden' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/projects/a/overview')
  })

  it("opens a Planning project at its Plan from the board card's Open project", async () => {
    localStorage.setItem(PROJECTS_LAYOUT_KEY, 'board')
    render(<Harness />)
    await screen.findByRole('article', { name: 'Novel' })
    fireEvent.click(screen.getByRole('button', { name: 'Novel options' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Open project' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/projects/b/plan')
  })

  it('opens a Planning project at its Plan and an Active one at its Overview, in the cards', async () => {
    render(<Harness />)
    const cards = await screen.findByRole('list', { name: 'Projects' })
    fireEvent.click(within(cards).getByRole('article', { name: 'Novel' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/projects/b/plan')
    fireEvent.click(within(cards).getByRole('article', { name: 'Garden' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/projects/a/overview')
  })
})
