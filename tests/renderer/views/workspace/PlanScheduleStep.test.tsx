// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { PlanScheduleStep } from '@renderer/views/workspace/plan/PlanScheduleStep'
import type { PlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import { planProgress } from '@shared/planning/plan-steps'
import { formatIsoDate } from '@shared/dates'
import type { PlanningMilestone, PlanningWorkItem, RendererProject } from '@shared/ostler-api'
import { RENDERER_DEFAULT_CONFIG } from '../../fixtures/ostler-api'
import { renderPlanningWorkspace, withWorkspace } from '../../fixtures/planning-workspace'

// The real dialog reads the project's baselines; the pane only opens it.
vi.mock('@renderer/views/planning/baselines/BaselineDialogs', () => ({
  SaveBaselineDialog: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-label="Save a baseline">
      <button type="button" onClick={onClose}>
        Close
      </button>
    </div>
  )
}))

const project = {
  id: 'p1',
  name: 'Alpha',
  path: null,
  color: '#2563EB',
  hasAutomationToken: false,
  stage: 'planning'
} as unknown as RendererProject

function milestone(id: string, targetDate: string | null): PlanningMilestone {
  return {
    id,
    projectId: 'p1',
    goalId: null,
    name: `Milestone ${id}`,
    outcome: '',
    targetDate,
    successCriteria: [],
    status: 'active'
  } as unknown as PlanningMilestone
}

function task(id: string, fields: Partial<PlanningWorkItem> = {}): PlanningWorkItem {
  return {
    id,
    projectId: 'p1',
    milestoneId: null,
    title: `Task ${id}`,
    status: 'backlog',
    dependencyIds: [],
    targetDate: null,
    startDate: null,
    assigneeId: null,
    estimate: null,
    ...fields
  } as unknown as PlanningWorkItem
}

async function workspace(overrides: Partial<PlanningWorkspace> = {}): Promise<PlanningWorkspace> {
  const base = await renderPlanningWorkspace({
    projectId: 'p1',
    api: { getConfig: async () => ({ ok: true, value: RENDERER_DEFAULT_CONFIG }) }
  })
  return withWorkspace(base, overrides)
}

function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>
}

function renderSchedule(ws: PlanningWorkspace) {
  const progress = planProgress({
    goals: ws.goals,
    milestones: ws.milestones,
    workItems: ws.workItems
  })
  render(
    <MemoryRouter initialEntries={['/projects/p1/plan']}>
      <PlanScheduleStep
        project={project}
        ws={ws}
        features={{ hasFolder: false, agents: false, ai: false }}
        suggestTasks={{ busy: false, start: () => {} }}
        progress={progress}
        people={null}
      />
      <LocationProbe />
    </MemoryRouter>
  )
  return progress
}

const group = (heading: string) =>
  screen.getByRole('heading', { name: heading }).parentElement as HTMLElement

describe('Plan, Schedule step', () => {
  it('says when the plan finishes and what sets the date, and nothing with no dates', async () => {
    renderSchedule(
      await workspace({
        workItems: [
          task('w1', { startDate: '2030-03-01', targetDate: '2030-03-10' }),
          task('w2', { targetDate: '2030-04-01', status: 'done' })
        ]
      })
    )
    expect(
      screen.getByText(`If the plan holds, it finishes on ${formatIsoDate('2030-03-10')}.`)
    ).toBeInTheDocument()
    expect(screen.getByText('Set by 1 task')).toBeInTheDocument()
  })

  it('shows no finish line when no task has a date', async () => {
    renderSchedule(await workspace({ workItems: [task('w1')] }))
    expect(screen.queryByText(/If the plan holds/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Set by/)).not.toBeInTheDocument()
  })

  it('lists the tasks with no date, opening each, but not those in a dated milestone', async () => {
    const loose = task('w1')
    const openWorkItem = vi.fn()
    renderSchedule(
      await workspace({
        milestones: [milestone('dated', '2030-06-01'), milestone('undated', null)],
        workItems: [
          loose,
          task('w2', { milestoneId: 'dated' }),
          task('w3', { milestoneId: 'undated' })
        ],
        openWorkItem
      })
    )
    const noDate = group('No date yet')
    expect(
      within(noDate).getByText('2 tasks have no date and no dated milestone')
    ).toBeInTheDocument()
    expect(within(noDate).queryByRole('button', { name: 'Task w2' })).not.toBeInTheDocument()
    expect(within(noDate).getByRole('button', { name: 'Task w3' })).toBeInTheDocument()
    fireEvent.click(within(noDate).getByRole('button', { name: 'Task w1' }))
    expect(openWorkItem).toHaveBeenCalledWith(loose)

    expect(screen.getByText('1 milestone has no date')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open Milestones' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/projects/p1/milestones')
  })

  it('lists a task dated before what it waits on, and one due after its milestone', async () => {
    renderSchedule(
      await workspace({
        milestones: [milestone('m1', '2030-05-01')],
        workItems: [
          task('first', { startDate: '2030-03-01', targetDate: '2030-03-20' }),
          task('second', {
            startDate: '2030-03-05',
            targetDate: '2030-03-25',
            dependencyIds: ['first']
          }),
          task('late', { milestoneId: 'm1', targetDate: '2030-05-10' })
        ]
      })
    )
    const order = group('Starts before what it waits on')
    expect(
      within(order).getByText('1 task is dated before something it waits on')
    ).toBeInTheDocument()
    expect(within(order).getByRole('button', { name: 'Task second' })).toBeInTheDocument()
    const late = group('Due after its milestone')
    expect(within(late).getByText('1 task is due after its milestone')).toBeInTheDocument()
    expect(within(late).getByRole('button', { name: 'Task late' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open Timeline' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/projects/p1/timeline')
  })

  it('says every task is set when nothing is to fix, and offers a baseline then', async () => {
    renderSchedule(
      await workspace({
        milestones: [milestone('m1', '2030-05-01')],
        workItems: [task('w1', { milestoneId: 'm1' }), task('w2', { targetDate: '2030-04-01' })]
      })
    )
    expect(screen.getByText('Every task has a date, in an order that works.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'No date yet' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save a baseline' }))
    const dialog = await screen.findByRole('dialog', { name: 'Save a baseline' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('offers no baseline until the schedule step is done', async () => {
    const progress = renderSchedule(await workspace({ workItems: [task('w1')] }))
    expect(progress.done.schedule).toBe(false)
    expect(screen.queryByRole('button', { name: 'Save a baseline' })).not.toBeInTheDocument()
  })
})
