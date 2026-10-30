// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PlanTasksStep } from '@renderer/views/workspace/plan/PlanTasksStep'
import { ProjectFeaturesProvider, StaticFeaturesProvider } from '@renderer/navigation/features'
import type { PlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import { planProgress } from '@shared/planning/plan-steps'
import type {
  OstlerAPI,
  PlanningGoal,
  PlanningMilestone,
  PlanningWorkItem,
  RendererProject
} from '@shared/ostler-api'
import { RENDERER_DEFAULT_CONFIG } from '../../fixtures/ostler-api'
import { renderPlanningWorkspace, withWorkspace } from '../../fixtures/planning-workspace'

vi.mock('@renderer/context/OstlerContext', () => ({
  useOstler: () => ({ projects: [], refreshProjects: async () => {} })
}))

// The real chat reads conversations and calls Ostler AI; the pane only places it.
vi.mock('@renderer/components/ProjectNotesChat', () => ({
  ProjectNotesChat: () => <p>Notes chat</p>
}))

const project = {
  id: 'p1',
  name: 'Alpha',
  path: null,
  color: '#2563EB',
  hasAutomationToken: false,
  stage: 'planning'
} as unknown as RendererProject

function goal(id: string, title: string): PlanningGoal {
  return { id, projectId: 'p1', title, outcome: '', status: 'active' } as PlanningGoal
}

function milestone(id: string, name: string): PlanningMilestone {
  return {
    id,
    projectId: 'p1',
    goalId: null,
    name,
    outcome: '',
    targetDate: '2030-06-01',
    successCriteria: [],
    status: 'active'
  } as unknown as PlanningMilestone
}

function task(
  id: string,
  milestoneId: string | null,
  status: PlanningWorkItem['status'] = 'backlog'
): PlanningWorkItem {
  return {
    id,
    projectId: 'p1',
    milestoneId,
    title: `Task ${id}`,
    status,
    dependencyIds: [],
    targetDate: null,
    startDate: null,
    assigneeId: null,
    estimate: null
  } as unknown as PlanningWorkItem
}

const softwareProject: Partial<OstlerAPI> = {
  getProjectAISettings: (async () => ({
    ok: true,
    value: { profile: 'software' }
  })) as unknown as OstlerAPI['getProjectAISettings']
}

async function workspace(
  overrides: Partial<PlanningWorkspace> = {},
  api: Partial<OstlerAPI> = {}
): Promise<PlanningWorkspace> {
  const base = await renderPlanningWorkspace({
    projectId: 'p1',
    api: { getConfig: async () => ({ ok: true, value: RENDERER_DEFAULT_CONFIG }), ...api }
  })
  return withWorkspace(base, overrides)
}

interface RenderOptions {
  ai?: boolean
  agents?: boolean
  /** Wrap in the project's features, so its AI profile is read. */
  inProject?: boolean
  suggestTasks?: { busy: boolean; start: () => void }
}

function renderTasks(ws: PlanningWorkspace, options: RenderOptions = {}) {
  const { ai = false, agents = false, inProject = false } = options
  const suggestTasks = options.suggestTasks ?? { busy: false, start: () => {} }
  const pane = (
    <PlanTasksStep
      project={project}
      ws={ws}
      features={{ hasFolder: false, agents, ai }}
      suggestTasks={suggestTasks}
      progress={planProgress({
        goals: ws.goals,
        milestones: ws.milestones,
        workItems: ws.workItems
      })}
      people={null}
    />
  )
  return render(
    <StaticFeaturesProvider value={{ agents, ai }}>
      {inProject ? (
        <ProjectFeaturesProvider project={project}>{pane}</ProjectFeaturesProvider>
      ) : (
        pane
      )}
    </StaticFeaturesProvider>
  )
}

describe('Plan, Tasks step', () => {
  it('opens the plan grid and the new task form, and says what the grid can do', async () => {
    const setPlanGridOpen = vi.fn()
    const openWorkItemCreate = vi.fn()
    renderTasks(await workspace({ setPlanGridOpen, openWorkItemCreate }))

    fireEvent.click(screen.getByRole('button', { name: 'Plan several tasks' }))
    expect(setPlanGridOpen).toHaveBeenCalledWith(true)
    fireEvent.click(screen.getByRole('button', { name: 'Add a task' }))
    expect(openWorkItemCreate).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/Type or paste a whole list at once\./)).toBeInTheDocument()
  })

  it('lists an empty milestone with a way to add a task to it, until it has one', async () => {
    const openWorkItemCreate = vi.fn()
    const { unmount } = renderTasks(
      await workspace({ milestones: [milestone('m1', 'Content')], openWorkItemCreate })
    )

    expect(screen.getByText('1 milestone has no tasks yet')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add a task to Content' }))
    expect(openWorkItemCreate).toHaveBeenCalledWith('backlog', 'm1')
    unmount()

    renderTasks(
      await workspace({ milestones: [milestone('m1', 'Content')], workItems: [task('w1', 'm1')] })
    )
    expect(screen.queryByRole('button', { name: 'Add a task to Content' })).not.toBeInTheDocument()
    expect(screen.getByText('1 task to do, 0 not in a milestone yet')).toBeInTheDocument()
  })

  it('shows no AI buttons with AI off', async () => {
    renderTasks(await workspace({ goals: [goal('g1', 'Launch')], workItems: [task('w1', null)] }), {
      ai: false
    })

    expect(screen.queryByRole('button', { name: 'Suggest tasks' })).not.toBeInTheDocument()
    expect(screen.queryByText('Break a goal into tasks')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Break down/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Talk it through/ })).not.toBeInTheDocument()
  })

  it('breaks a goal down and suggests tasks with AI on, without saving a task', async () => {
    const launch = goal('g1', 'Launch')
    const breakDownGoal = vi.fn(async () => {})
    const start = vi.fn()
    const createPlanningWorkItem = vi.fn()
    const createPlanningWorkItemBatch = vi.fn()
    renderTasks(
      await workspace({ goals: [launch], breakDownGoal }, {
        createPlanningWorkItem,
        createPlanningWorkItemBatch
      } as Partial<OstlerAPI>),
      { ai: true, suggestTasks: { busy: false, start } }
    )

    fireEvent.click(screen.getByRole('button', { name: 'Break down Launch with AI' }))
    expect(breakDownGoal).toHaveBeenCalledWith(launch)
    fireEvent.click(screen.getByRole('button', { name: 'Suggest tasks' }))
    expect(start).toHaveBeenCalledTimes(1)
    expect(createPlanningWorkItem).not.toHaveBeenCalled()
    expect(createPlanningWorkItemBatch).not.toHaveBeenCalled()
  })

  it('offers Plan and split only for a software project with agents on', async () => {
    const launch = goal('g1', 'Launch')
    const openAgentPlanWizard = vi.fn()
    const { unmount } = renderTasks(
      await workspace({ goals: [launch], openAgentPlanWizard }, softwareProject),
      { ai: true, agents: false, inProject: true }
    )
    expect(screen.getByRole('button', { name: 'Break down Launch with AI' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Plan and split Launch' })).not.toBeInTheDocument()
    unmount()

    renderTasks(await workspace({ goals: [launch], openAgentPlanWizard }, softwareProject), {
      ai: true,
      agents: true,
      inProject: true
    })
    const split = await screen.findByRole('button', { name: 'Plan and split Launch' })
    fireEvent.click(split)
    expect(openAgentPlanWizard).toHaveBeenCalledWith(launch)
  })

  it('lists tasks not in a milestone, ten at most, and opens one', async () => {
    const openWorkItem = vi.fn()
    const loose = Array.from({ length: 12 }, (_, i) => task(`w${i + 1}`, null))
    const done = { ...task('d1', null, 'done'), title: 'Finished task' } as PlanningWorkItem
    renderTasks(await workspace({ workItems: [...loose, done], openWorkItem }))

    expect(screen.getByRole('heading', { name: 'Not in a milestone yet' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Task w1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Task w10' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Task w11' })).not.toBeInTheDocument()
    expect(screen.queryByText('Finished task')).not.toBeInTheDocument()
    expect(screen.getByText('and 2 more')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Task w1' }))
    expect(openWorkItem).toHaveBeenCalledWith(loose[0])
  })

  it('opens and closes the notes chat in place', async () => {
    renderTasks(await workspace({ workItems: [task('w1', null)] }), { ai: true })

    const talk = screen.getByRole('button', { name: 'Talk it through with Ostler AI' })
    expect(talk).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Notes chat')).not.toBeInTheDocument()

    fireEvent.click(talk)
    expect(talk).toHaveAttribute('aria-expanded', 'true')
    await waitFor(() => expect(screen.getByText('Notes chat')).toBeInTheDocument())

    fireEvent.click(talk)
    expect(talk).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Notes chat')).not.toBeInTheDocument()
  })
})
