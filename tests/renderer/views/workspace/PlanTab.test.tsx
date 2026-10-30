// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PlanTab } from '@renderer/views/workspace/PlanTab'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { StaticPeopleProvider } from '@renderer/context/PeopleContext'
import type { PlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import type {
  AssignedTask,
  OstlerAPI,
  Person,
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

// The brief reads the Library; the Plan only places it.
vi.mock('@renderer/views/project-detail/ProjectBriefCard', () => ({
  ProjectBriefCard: () => null
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

function milestone(id: string, name: string, goalId: string | null): PlanningMilestone {
  return {
    id,
    projectId: 'p1',
    goalId,
    name,
    outcome: '',
    targetDate: '2030-06-01',
    successCriteria: [],
    status: 'active'
  } as unknown as PlanningMilestone
}

function task(id: string, milestoneId: string | null): PlanningWorkItem {
  return {
    id,
    projectId: 'p1',
    milestoneId,
    title: `Task ${id}`,
    status: 'backlog',
    dependencyIds: [],
    targetDate: null,
    startDate: null,
    assigneeId: null,
    estimate: null
  } as unknown as PlanningWorkItem
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

/** Shows where the app has gone. */
function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>
}

function renderPlan(ws: PlanningWorkspace, people: Person[] = []) {
  return render(
    <StaticPeopleProvider people={people}>
      <MemoryRouter initialEntries={['/projects/p1/plan']}>
        <StaticFeaturesProvider value={{ agents: false, ai: false }}>
          <PlanTab
            project={project}
            ws={ws}
            features={{ hasFolder: false, agents: false, ai: false }}
            suggestTasks={{ busy: false, start: () => {} }}
          />
          <Where />
        </StaticFeaturesProvider>
      </MemoryRouter>
    </StaticPeopleProvider>
  )
}

function stepButtons() {
  return within(screen.getByRole('navigation', { name: 'Plan steps' })).getAllByRole('button')
}

function stepButton(name: string) {
  return stepButtons().find((button) => button.textContent?.startsWith(name)) as HTMLElement
}

describe('Plan', () => {
  it('opens an empty project on Goal, with five steps and a way to add a goal', async () => {
    const setCreateMode = vi.fn()
    renderPlan(await workspace({ setCreateMode }))

    expect(stepButtons().map((button) => button.textContent)).toEqual([
      expect.stringMatching(/^GoalTo do0 goals$/),
      expect.stringMatching(/^MilestonesTo do0 milestones$/),
      expect.stringMatching(/^TasksTo do0 tasks$/),
      expect.stringMatching(/^ScheduleTo do$/),
      expect.stringMatching(/^StartTo do4 steps to go$/)
    ])
    expect(stepButton('Goal')).toHaveAttribute('aria-current', 'step')
    expect(screen.getByRole('heading', { level: 2, name: 'Goal' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'No goal yet' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add a goal' }))
    expect(setCreateMode).toHaveBeenCalledWith('goal')
  })

  it('opens on Milestones once there is a goal, and marks Goal done', async () => {
    renderPlan(await workspace({ goals: [goal('g1', 'Launch the website')] }))

    expect(stepButton('Milestones')).toHaveAttribute('aria-current', 'step')
    expect(stepButton('Goal')).toHaveTextContent('Done')
    expect(stepButton('Goal')).not.toHaveTextContent('To do')
    expect(screen.getByRole('heading', { level: 2, name: 'Milestones' })).toBeInTheDocument()
  })

  it('shows the step a person picks', async () => {
    renderPlan(await workspace())

    fireEvent.click(stepButton('Tasks'))
    expect(stepButton('Tasks')).toHaveAttribute('aria-current', 'step')
    expect(stepButton('Goal')).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('heading', { level: 2, name: 'Tasks' })).toBeInTheDocument()
  })

  it('lists milestones with their goal and tasks, and adds tasks to them', async () => {
    const openWorkItemCreate = vi.fn()
    renderPlan(
      await workspace({
        goals: [goal('g1', 'Launch the website')],
        milestones: [milestone('m1', 'Content ready', 'g1'), milestone('m2', 'Go live', null)],
        workItems: [task('w1', 'm1'), task('w2', 'm1')],
        openWorkItemCreate
      })
    )
    fireEvent.click(stepButton('Milestones'))

    const pane = screen.getByRole('region', { name: 'Milestones' })
    expect(within(pane).getByText('1 milestone has no tasks yet')).toBeInTheDocument()
    const items = within(pane).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Content ready')
    expect(items[0]).toHaveTextContent('For Launch the website')
    expect(items[0]).toHaveTextContent('2 tasks')
    expect(items[1]).toHaveTextContent('Go live')
    expect(items[1]).toHaveTextContent('No goal')
    expect(items[1]).toHaveTextContent('0 tasks')

    fireEvent.click(within(pane).getByRole('button', { name: 'Add a task to Go live' }))
    expect(openWorkItemCreate).toHaveBeenCalledWith('backlog', 'm2')

    fireEvent.click(within(pane).getByRole('button', { name: 'Open Milestones' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/projects/p1/milestones')
  })

  it('counts a task with no date and no milestone as one to fix on the Schedule step', async () => {
    renderPlan(await workspace({ workItems: [task('w1', null)] }))

    expect(stepButton('Schedule')).toHaveTextContent('1 task to fix')
  })
})

describe('Plan, People', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  const person = (id: string, name: string, isMe = false) =>
    ({
      id,
      name,
      initials: name.slice(0, 2),
      color: '#3b82f6',
      isMe,
      archivedAt: null,
      weeklyCapacityHours: 40,
      workingDays: [1, 2, 3, 4, 5],
      projectId: null,
      createdAt: 1,
      updatedAt: 1
    }) as Person
  const PEOPLE = [person('me', 'Me', true), person('ana', 'Ana')]

  // Ana has 50 h in the week of Monday 12 October 2026.
  const anas = {
    ...task('w1', null),
    assigneeId: 'ana',
    startDate: '2026-10-12',
    targetDate: '2026-10-16',
    estimate: 50
  } as PlanningWorkItem
  const asWorkload = (item: PlanningWorkItem) =>
    ({ ...item, estimateUnit: 'hours', projectName: 'Alpha' }) as unknown as AssignedTask

  const names = () => stepButtons().map((button) => button.textContent?.match(/^[A-Z][a-z]+/)?.[0])

  it('keeps five steps when only Me has work', async () => {
    renderPlan(await workspace({ workItems: [{ ...task('w1', null), assigneeId: 'me' }] }), PEOPLE)

    expect(names()).toEqual(['Goal', 'Milestones', 'Tasks', 'Schedule', 'Start'])
  })

  it('adds People between Schedule and Start, which waits on someone over capacity', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 14, 12))
    renderPlan(
      await workspace(
        { workItems: [anas] },
        { getWorkloadTasks: async () => ({ ok: true, value: [asWorkload(anas)] }) }
      ),
      PEOPLE
    )

    expect(names()).toEqual(['Goal', 'Milestones', 'Tasks', 'Schedule', 'People', 'Start'])
    expect(await screen.findByText('1 week over')).toBeInTheDocument()
    expect(stepButton('People')).toHaveTextContent('To do')
    expect(stepButton('Start')).toHaveTextContent('To do')
  })
})
