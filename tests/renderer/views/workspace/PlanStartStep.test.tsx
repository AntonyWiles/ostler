// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PlanStartStep } from '@renderer/views/workspace/plan/PlanStartStep'
import type { PlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import { ToastProvider } from '@renderer/ui'
import { planProgress, type PlanProgress, type PlanStep } from '@shared/planning/plan-steps'
import type { ProjectStage } from '@shared/project-stages'
import type { RendererProject } from '@shared/ostler-api'
import { RENDERER_DEFAULT_CONFIG, installOstlerApi } from '../../fixtures/ostler-api'

let current: RendererProject[] = []

vi.mock('@renderer/context/OstlerContext', () => ({
  useOstler: () => ({ projects: current, refreshProjects: async () => {} })
}))

function project(stage: ProjectStage): RendererProject {
  return {
    id: 'p1',
    name: 'Alpha',
    path: null,
    color: '#2563EB',
    hasAutomationToken: false,
    stage
  } as unknown as RendererProject
}

const ALL_STEPS: PlanStep[] = ['goal', 'milestones', 'tasks', 'schedule', 'people', 'start']

function progress(fields: Partial<PlanProgress> = {}): PlanProgress {
  const base = planProgress({ goals: [], milestones: [], workItems: [] })
  return { ...base, ...fields }
}

const allDone = Object.fromEntries(ALL_STEPS.map((step) => [step, true])) as Record<
  PlanStep,
  boolean
>

let calls: string[] = []
let baselines: unknown[] = []
let createOk = true

function install() {
  calls = []
  installOstlerApi({
    getConfig: async () => ({ ok: true as const, value: RENDERER_DEFAULT_CONFIG }),
    listBaselines: vi.fn(async () => ({ ok: true as const, value: baselines as never })),
    createBaseline: vi.fn(async () => {
      calls.push('createBaseline')
      return createOk
        ? { ok: true as const, value: { id: 'b1' } as never }
        : { ok: false as const, error: 'disk full' }
    }),
    updateProject: vi.fn(async (id: string, updates) => {
      calls.push(`updateProject:${updates.stage}`)
      current = current.map((entry) => (entry.id === id ? { ...entry, ...updates } : entry))
      return { ok: true as const, value: current.find((entry) => entry.id === id)! as never }
    })
  })
}

function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>
}

function renderStart(stage: ProjectStage, fields: Partial<PlanProgress> = {}) {
  current = [project(stage)]
  render(
    <MemoryRouter initialEntries={['/projects/p1/plan']}>
      <ToastProvider>
        <PlanStartStep
          project={current[0]}
          ws={{} as PlanningWorkspace}
          features={{ hasFolder: false, agents: false, ai: false }}
          suggestTasks={{ busy: false, start: () => {} }}
          progress={progress(fields)}
          people={null}
        />
        <LocationProbe />
      </ToastProvider>
    </MemoryRouter>
  )
}

const startButton = () => screen.getByRole('button', { name: 'Start the project' })

describe('Plan, Start step', () => {
  beforeEach(() => {
    baselines = []
    createOk = true
    install()
  })

  it('starts a Planning project with steps still to do, and opens its Overview', async () => {
    renderStart('planning')
    expect(screen.getByText(/Some steps are still to do\./)).toBeInTheDocument()
    expect(
      screen.getByText(/This moves the project to Active and opens its Overview\./)
    ).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()

    fireEvent.click(startButton())
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/projects/p1/overview')
    )
    expect(window.ostlerAPI.updateProject).toHaveBeenCalledWith('p1', { stage: 'active' })
    expect(window.ostlerAPI.createBaseline).not.toHaveBeenCalled()
  })

  it('saves a baseline first when there are dates and the box stays ticked', async () => {
    renderStart('planning', { hasDates: true })
    const box = await screen.findByRole('checkbox', { name: 'Save these dates as a baseline' })
    expect(box).toBeChecked()

    fireEvent.click(startButton())
    await waitFor(() => expect(calls).toEqual(['createBaseline', 'updateProject:active']))
    expect(window.ostlerAPI.createBaseline).toHaveBeenCalledWith('p1', { name: 'Plan at start' })
  })

  it('saves no baseline once the box is unticked', async () => {
    renderStart('planning', { hasDates: true })
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Save these dates as a baseline' }))
    fireEvent.click(startButton())
    await waitFor(() => expect(calls).toEqual(['updateProject:active']))
    expect(window.ostlerAPI.createBaseline).not.toHaveBeenCalled()
  })

  it('leaves the box out when the project already keeps ten baselines', async () => {
    baselines = Array.from({ length: 10 }, (_, index) => ({ id: `b${index}` }))
    renderStart('planning', { hasDates: true })
    expect(
      await screen.findByText(
        "This project already keeps 10 baselines, the most it can, so starting won't save another."
      )
    ).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('still starts the project when the baseline fails, and says so', async () => {
    createOk = false
    renderStart('planning', { hasDates: true })
    await screen.findByRole('checkbox', { name: 'Save these dates as a baseline' })
    fireEvent.click(startButton())
    expect(await screen.findByText("Couldn't save the baseline: disk full")).toBeInTheDocument()
    await waitFor(() =>
      expect(window.ostlerAPI.updateProject).toHaveBeenCalledWith('p1', { stage: 'active' })
    )
  })

  it('moves the project back to Planning with Undo', async () => {
    renderStart('planning')
    fireEvent.click(startButton())
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() =>
      expect(window.ostlerAPI.updateProject).toHaveBeenLastCalledWith('p1', { stage: 'planning' })
    )
  })

  it('says the plan is ready when every shown step is done, and lists only shown steps', async () => {
    renderStart('planning', {
      steps: ['goal', 'milestones', 'tasks', 'schedule', 'start'],
      done: allDone
    })
    expect(screen.getByText('Your plan is ready.')).toBeInTheDocument()
    const [list] = screen.getAllByRole('list')
    expect(list).toHaveTextContent('Goal')
    expect(list).toHaveTextContent('Schedule')
    expect(list).not.toHaveTextContent('People')
    expect(list).not.toHaveTextContent('Start')
    expect(screen.getAllByText('Done')).toHaveLength(4)
  })

  it('shows where an Active project is, with no button', async () => {
    renderStart('active')
    expect(
      screen.getByText('This project is in Active. The plan stays here for when you need it.')
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start the project' })).not.toBeInTheDocument()
  })
})
