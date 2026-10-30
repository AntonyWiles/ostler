// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GoalsMilestonesPanel } from '@renderer/views/planning/GoalsMilestonesPanel'
import { HealthBadge } from '@renderer/views/planning/HealthBadge'
import type { PlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import type { PlanningGoal, PlanningMilestone, PlanningWorkItem } from '@shared/ostler-api'
import { milestoneHealth } from '@shared/planning/health'
import { renderPlanningWorkspace, withWorkspace } from '../../fixtures/planning-workspace'
import { StaticFeaturesProvider } from '@renderer/navigation/features'

const goal: PlanningGoal = {
  id: 'goal-1',
  projectId: 'proj-1',
  title: 'Launch v1',
  outcome: 'Ship initial release to users',
  status: 'active',
  createdAt: 1,
  updatedAt: 1
}

const milestone = (overrides: Partial<PlanningMilestone> = {}): PlanningMilestone => ({
  id: 'ms-1',
  projectId: 'proj-1',
  goalId: 'goal-1',
  name: 'Sprint 1 - Core UI',
  outcome: '',
  successCriteria: [],
  targetDate: '2026-09-01',
  status: 'planned',
  createdAt: 1,
  updatedAt: 1,
  ...overrides
})

const task = (overrides: Partial<PlanningWorkItem> = {}): PlanningWorkItem => ({
  id: 'w1',
  projectId: 'proj-1',
  milestoneId: 'ms-1',
  title: 'Ship it',
  description: '',
  status: 'done',
  priority: 'medium',
  labels: [],
  acceptanceCriteria: [],
  dependencyIds: [],
  targetDate: null,
  startDate: null,
  assigneeId: null,
  estimate: null,
  checkedCriteria: [],
  origin: 'human',
  linkedHarnessTaskId: null,
  autoQueue: false,
  parentWorkItemId: null,
  taskCode: '',
  phaseCode: '',
  phaseName: '',
  subtaskPhaseNumber: null,
  subtaskPhaseName: '',
  verificationStatus: 'unverified',
  verifiedBy: null,
  verifiedAt: null,
  verificationNotes: '',
  createdAt: 1,
  updatedAt: 1,
  ...overrides
})

describe('GoalsMilestonesPanel', () => {
  // The real workspace, loaded with these records through the API.
  const createWorkspace = async (
    data: { goals?: PlanningGoal[]; milestones?: PlanningMilestone[]; items?: PlanningWorkItem[] },
    overrides: Partial<PlanningWorkspace> = {}
  ): Promise<PlanningWorkspace> => {
    const base = await renderPlanningWorkspace({
      projectId: 'proj-1',
      api: {
        getPlanningGoals: async () => ({ ok: true, value: data.goals ?? [] }),
        getPlanningMilestones: async () => ({ ok: true, value: data.milestones ?? [] }),
        getPlanningWorkItems: async () => ({ ok: true, value: data.items ?? [] }),
        getAIMilestoneAdvisory: async () => ({ ok: true, value: null }),
        getAITaskSplitJob: async () => ({ ok: true, value: null }),
        onTaskSplitProgress: () => () => {}
      }
    })
    return withWorkspace(base, overrides)
  }

  it('offers a first goal when there are no goals or milestones', async () => {
    const setCreateMode = vi.fn()
    const ws = await createWorkspace({}, { setCreateMode })
    render(<GoalsMilestonesPanel ws={ws} />)

    expect(screen.getByRole('heading', { name: 'No goals or milestones yet' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Create goal' }))
    expect(setCreateMode).toHaveBeenCalledWith('goal')
  })

  it('shows a goal as a section header with AI breakdown and status, and adds from the header', async () => {
    const breakDownGoal = vi.fn()
    const setGoalStatus = vi.fn()
    const setCreateMode = vi.fn()
    const setMilestoneGoalId = vi.fn()
    const ws = await createWorkspace(
      { goals: [goal] },
      { breakDownGoal, setGoalStatus, setCreateMode, setMilestoneGoalId }
    )

    render(
      <StaticFeaturesProvider value={{ agents: false, ai: true }}>
        <GoalsMilestonesPanel ws={ws} />
      </StaticFeaturesProvider>
    )

    const group = screen.getByRole('region', { name: 'Goal: Launch v1' })
    expect(within(group).getByRole('heading', { name: 'Launch v1', level: 2 })).toBeInTheDocument()
    expect(within(group).getByText('Ship initial release to users')).toBeInTheDocument()

    fireEvent.click(within(group).getByRole('button', { name: 'Break down with AI…' }))
    expect(breakDownGoal).toHaveBeenCalledWith(goal)

    fireEvent.change(screen.getByLabelText('Goal status Launch v1'), {
      target: { value: 'achieved' }
    })
    expect(setGoalStatus).toHaveBeenCalledWith(goal, 'achieved')

    fireEvent.click(screen.getByRole('button', { name: 'Goal' }))
    expect(setCreateMode).toHaveBeenCalledWith('goal')
    fireEvent.click(screen.getByRole('button', { name: 'Milestone' }))
    expect(setMilestoneGoalId).toHaveBeenCalledWith('')
    expect(setCreateMode).toHaveBeenCalledWith('milestone')
  })

  it('hides the AI actions while AI is off', async () => {
    const ws = await createWorkspace({ goals: [goal] })
    render(
      <StaticFeaturesProvider value={{ agents: false, ai: false }}>
        <GoalsMilestonesPanel ws={ws} />
      </StaticFeaturesProvider>
    )
    expect(screen.queryByRole('button', { name: 'Break down with AI…' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Plan and split…' })).toBeNull()
  })

  it('lists milestones under their goal and the rest under "No goal", last', async () => {
    const setMilestoneStatus = vi.fn()
    const ws = await createWorkspace(
      {
        goals: [goal],
        milestones: [milestone(), milestone({ id: 'ms-2', goalId: null, name: 'Loose ends' })]
      },
      { setMilestoneStatus }
    )
    render(<GoalsMilestonesPanel ws={ws} />)

    const goalGroup = screen.getByRole('region', { name: 'Goal: Launch v1' })
    expect(
      within(goalGroup).getByRole('article', { name: 'Sprint 1 - Core UI' })
    ).toBeInTheDocument()
    const groups = screen.getAllByRole('region', { name: /^Goal: |^No goal$/ })
    expect(groups.at(-1)).toHaveAccessibleName('No goal')
    expect(within(groups.at(-1)!).getByRole('article', { name: 'Loose ends' })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Milestone status Sprint 1 - Core UI'), {
      target: { value: 'active' }
    })
    expect(setMilestoneStatus).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ms-1' }),
      'active'
    )
  })

  it('shows progress from linked tasks and a complete milestone as complete', async () => {
    const ws = await createWorkspace({
      milestones: [milestone({ goalId: null, status: 'complete', targetDate: null })],
      items: [task()]
    })
    render(<GoalsMilestonesPanel ws={ws} />)

    const card = screen.getByRole('article', { name: 'Sprint 1 - Core UI' })
    expect(within(card).getByRole('progressbar', { name: 'Progress' })).toHaveAttribute(
      'aria-valuetext',
      '1 of 1 task done'
    )
    expect(
      within(card).getByText('Every linked item is done and the milestone is marked complete.')
    ).toBeInTheDocument()
    expect(within(card).getByText('On track')).toBeInTheDocument()
  })

  it('puts the readiness checks behind a disclosure under the verdict', async () => {
    const ws = await createWorkspace({
      milestones: [milestone({ goalId: null })],
      items: [task({ status: 'blocked' })]
    })
    render(<GoalsMilestonesPanel ws={ws} />)

    const card = screen.getByRole('article', { name: 'Sprint 1 - Core UI' })
    const checks = within(card).getByRole('list', { name: 'Release readiness' })
    expect(checks.closest('details')).not.toHaveAttribute('open')
    expect(within(card).getByText('Not ready')).toBeInTheDocument()
  })
})

describe('HealthBadge', () => {
  it.each([
    [{ linkedCount: 3, blockedCount: 0, overdue: false }, 'On track', 'ui-badge--success'],
    [{ linkedCount: 3, blockedCount: 0, overdue: true }, 'At risk', 'ui-badge--warning'],
    [{ linkedCount: 3, blockedCount: 1, overdue: true }, 'Blocked', 'ui-badge--danger'],
    [{ linkedCount: 0, blockedCount: 0, overdue: false }, 'No linked tasks', 'ui-badge--neutral']
  ])('shows %o as %s with the right tone', (input, label, toneClass) => {
    render(<HealthBadge verdict={milestoneHealth(input)} />)
    const badge = screen.getByText(label)
    expect(badge).toHaveClass(toneClass)
    expect(badge).toHaveAttribute('title')
  })

  it('never shows on track in the warning tone', () => {
    render(<HealthBadge verdict={{ health: 'on-track', reason: 'fine' }} />)
    expect(screen.getByText('On track')).not.toHaveClass('ui-badge--warning')
  })
})
