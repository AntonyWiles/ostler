// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { GoalsMilestonesPanel } from '@renderer/views/planning/GoalsMilestonesPanel'
import type {
  GoalCountsTowards,
  GoalMeasure,
  PersonalGoalView,
  PlanningGoal
} from '@shared/ostler-api'
import { ToastProvider } from '@renderer/ui'
import { renderPlanningWorkspace } from '../../fixtures/planning-workspace'

const POUNDS: GoalMeasure = {
  unit: '£',
  startValue: 0,
  targetValue: 2000,
  startDate: '2026-01-01',
  targetDate: '2026-12-31',
  direction: 'up'
}

const goal: PlanningGoal = {
  id: 'goal-1',
  projectId: 'proj-1',
  title: 'Side income',
  outcome: '',
  status: 'active',
  measure: POUNDS,
  createdAt: 1,
  updatedAt: 1
}

const personal = (id: string, title: string, unit: string): PersonalGoalView => ({
  id,
  title,
  outcome: '',
  status: 'active',
  measure: { ...POUNDS, unit, targetValue: 5000 },
  createdAt: 1,
  updatedAt: 1,
  checkIns: [],
  links: [],
  fromLinks: false,
  readings: [],
  progress: null
})

describe('Counts towards… on a project goal (N5.6b)', () => {
  it('picks a goal of one’s own with the same unit, then says what it counts towards', async () => {
    let links: Record<string, GoalCountsTowards> = {}
    const setGoalCountsTowards = vi.fn(async (goalId: string, personalGoalId: string | null) => {
      links = personalGoalId
        ? { [goalId]: { goalId, personalGoalId, title: 'Save £5,000', counts: true } }
        : {}
      return { ok: true as const, value: { goalId, personalGoalId, previous: null } }
    })
    const ws = await renderPlanningWorkspace({
      projectId: 'proj-1',
      api: {
        getPlanningGoals: async () => ({ ok: true, value: [goal] }),
        getPlanningMilestones: async () => ({ ok: true, value: [] }),
        getPlanningWorkItems: async () => ({ ok: true, value: [] }),
        getAIMilestoneAdvisory: async () => ({ ok: true, value: null }),
        getAITaskSplitJob: async () => ({ ok: true, value: null }),
        listGoalsCountsTowards: async () => ({ ok: true, value: links }),
        listPersonalGoals: async () => ({
          ok: true,
          value: [personal('pg1', 'Save £5,000', '£'), personal('pg2', 'Run 500 km', 'km')]
        }),
        setGoalCountsTowards
      }
    })
    render(
      <ToastProvider>
        <MemoryRouter>
          <GoalsMilestonesPanel ws={ws} />
        </MemoryRouter>
      </ToastProvider>
    )
    const group = screen.getByRole('region', { name: 'Goal: Side income' })
    fireEvent.click(within(group).getByRole('button', { name: 'More actions for Side income' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Counts towards…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Side income counts towards…' })
    const select = (await within(dialog).findByLabelText('Goal of your own')) as HTMLSelectElement
    await waitFor(() => expect(select.options).toHaveLength(2))
    // Run 500 km counts in km: it is not offered.
    expect([...select.options].map((option) => option.text)).toEqual(['Nothing', 'Save £5,000'])
    fireEvent.change(select, { target: { value: 'pg1' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(setGoalCountsTowards).toHaveBeenCalledWith('goal-1', 'pg1'))
    const line = await within(group).findByRole('link', { name: 'Open Save £5,000 in Goals' })
    expect(line.textContent).toBe('Counts towards Save £5,000')
    expect(line.getAttribute('href')).toBe('/goals?goal=pg1')
    expect(await screen.findByText('Side income counts towards Save £5,000')).toBeTruthy()
  })
})
