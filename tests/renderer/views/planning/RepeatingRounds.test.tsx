// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GoalsMilestonesPanel } from '@renderer/views/planning/GoalsMilestonesPanel'
import { RepeatRoundDialog } from '@renderer/views/planning/rounds/RepeatRoundDialog'
import { OverviewInsights } from '@renderer/views/planning/insights/OverviewInsights'
import type { PlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import type { OstlerAPI, PlanningMilestone, PlanningWorkItem } from '@shared/ostler-api'
import type { RecurrenceRule } from '@shared/recurrence'
import { installOstlerApi } from '../../fixtures/ostler-api'
import { renderPlanningWorkspace, withWorkspace } from '../../fixtures/planning-workspace'

const MONTHLY: RecurrenceRule = { every: 'month', interval: 1, monthDay: 1 }

const milestone = (overrides: Partial<PlanningMilestone> = {}): PlanningMilestone => ({
  id: 'ms-1',
  projectId: 'proj-1',
  goalId: null,
  name: 'Accounts',
  outcome: '',
  successCriteria: [],
  targetDate: '2027-04-10',
  status: 'complete',
  createdAt: 1,
  updatedAt: 1,
  ...overrides
})

const task = (overrides: Partial<PlanningWorkItem> = {}): PlanningWorkItem =>
  ({
    id: 'w1',
    projectId: 'proj-1',
    milestoneId: 'ms-1',
    title: 'Gather receipts',
    status: 'backlog',
    startDate: '2027-04-01',
    targetDate: '2027-04-03',
    dependencyIds: [],
    labels: [],
    acceptanceCriteria: [],
    checkedCriteria: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }) as PlanningWorkItem

const first = milestone()
const latest = milestone({
  id: 'ms-2',
  name: 'Accounts · May 2027',
  status: 'planned',
  targetDate: '2027-05-10',
  previousRoundId: 'ms-1',
  roundStart: '2027-05-01',
  repeat: { rule: MONTHLY, lengthDays: 10, nextStart: '2027-06-01', on: true }
})

async function workspace(
  milestones: PlanningMilestone[],
  items: PlanningWorkItem[],
  api: Partial<OstlerAPI> = {},
  overrides: Partial<PlanningWorkspace> = {}
): Promise<PlanningWorkspace> {
  const base = await renderPlanningWorkspace({
    projectId: 'proj-1',
    api: {
      getPlanningGoals: async () => ({ ok: true, value: [] }),
      getPlanningMilestones: async () => ({ ok: true, value: milestones }),
      getPlanningWorkItems: async () => ({ ok: true, value: items }),
      getAIMilestoneAdvisory: async () => ({ ok: true, value: null }),
      getAITaskSplitJob: async () => ({ ok: true, value: null }),
      onTaskSplitProgress: () => () => {},
      ...api
    }
  })
  return withWorkspace(base, overrides)
}

describe('Repeating rounds in the Goals and milestones panel (N5.7a)', () => {
  it('shows a series’ latest round with its schedule, and folds the earlier rounds', async () => {
    const ws = await workspace([first, latest], [task(), task({ id: 'w2', milestoneId: 'ms-2' })])
    render(<GoalsMilestonesPanel ws={ws} />)

    const series = screen.getByRole('group', { name: 'Rounds of Accounts' })
    const cards = within(series).getAllByRole('article')
    expect(cards[0]).toHaveAccessibleName('Accounts · May 2027')
    expect(within(cards[0]).getByText(/^Monthly on the 1st\. Next round: /)).toBeInTheDocument()
    const earlier = within(series).getByText('1 earlier round')
    expect(earlier.tagName).toBe('SUMMARY')
    expect(earlier.closest('details')).not.toHaveAttribute('open')
    expect(
      within(earlier.closest('details')!).getByRole('article', { hidden: true })
    ).toHaveAccessibleName('Accounts')
  })

  it('starts the next round now from the latest round’s menu, and offers no repeat on an earlier one', async () => {
    const startNextMilestoneRound = vi.fn(async () => ({
      ok: true as const,
      value: milestone({ id: 'ms-3', name: 'Accounts · June 2027' })
    }))
    const loadPlanning = vi.fn(async () => {})
    const ws = await workspace(
      [first, latest],
      [task(), task({ id: 'w2', milestoneId: 'ms-2' })],
      { startNextMilestoneRound },
      { loadPlanning }
    )
    render(<GoalsMilestonesPanel ws={ws} />)

    fireEvent.click(screen.getByRole('button', { name: 'More actions for Accounts · May 2027' }))
    expect(screen.getByRole('menuitem', { name: 'Stop repeating' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Start next round now' }))
    await waitFor(() => expect(startNextMilestoneRound).toHaveBeenCalledWith('ms-2'))
    await waitFor(() => expect(loadPlanning).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: 'More actions for Accounts', hidden: true }))
    expect(screen.queryByRole('menuitem', { name: /Repeat this round/ })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Start next round now' })).toBeNull()
  })

  it('offers Repeat this round on a milestone with tasks', async () => {
    const ws = await workspace([milestone({ status: 'planned' })], [task()])
    render(<GoalsMilestonesPanel ws={ws} />)
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Accounts' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Repeat this round…' }))
    expect(screen.getByRole('dialog', { name: 'Repeat this round' })).toBeInTheDocument()
  })

  it('offers Repeat this round on a milestone with no tasks yet', async () => {
    const previewMilestoneRound = vi.fn(async () => ({
      ok: true as const,
      value: {
        name: 'Accounts · May 2027',
        start: '2027-05-01',
        end: '2027-05-10',
        taskCount: 0,
        repeatingCount: 0
      }
    }))
    const ws = await workspace([milestone({ status: 'planned' })], [], { previewMilestoneRound })
    render(<GoalsMilestonesPanel ws={ws} />)
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Accounts' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Repeat this round…' }))
    const dialog = screen.getByRole('dialog', { name: 'Repeat this round' })
    expect(
      await within(dialog).findByText(/No tasks yet: the ones this round has by then are copied\.$/)
    ).toBeInTheDocument()
  })
})

describe('The Repeat this round dialog (N5.7a)', () => {
  it('opens on a monthly rule from this round’s dates, previews the next round and saves', async () => {
    const previewMilestoneRound = vi.fn(async () => ({
      ok: true as const,
      value: {
        name: 'Accounts · May 2027',
        start: '2027-05-01',
        end: '2027-05-10',
        taskCount: 14,
        repeatingCount: 1
      }
    }))
    const setMilestoneRepeat = vi.fn(async () => ({ ok: true as const, value: latest }))
    installOstlerApi({ previewMilestoneRound, setMilestoneRepeat })
    const onSaved = vi.fn()
    const onClose = vi.fn()
    const ms = milestone({ status: 'planned' })
    render(
      <RepeatRoundDialog milestone={ms} tasks={[task()]} onClose={onClose} onSaved={onSaved} />
    )

    expect(screen.getByLabelText('Next round starts')).toHaveValue('monthly')
    expect(screen.getByLabelText('Each round lasts')).toHaveValue(10)
    const expected = { rule: MONTHLY, lengthDays: 10, nextStart: '2027-05-01' }
    await waitFor(() => expect(previewMilestoneRound).toHaveBeenCalledWith('ms-1', expected))
    expect(
      await screen.findByText(/^Next round: Accounts · May 2027, .+, 14 tasks/)
    ).toHaveTextContent('1 repeating task isn’t copied: it repeats by itself')

    fireEvent.click(screen.getByRole('button', { name: 'Repeat' }))
    await waitFor(() => expect(setMilestoneRepeat).toHaveBeenCalledWith('ms-1', expected))
    expect(onSaved).toHaveBeenCalledWith(latest)
    expect(onClose).toHaveBeenCalled()
  })

  it('follows the rule for the next start until a day is picked', async () => {
    const previewMilestoneRound = vi.fn(async () => ({ ok: false as const, error: 'nope' }))
    installOstlerApi({ previewMilestoneRound })
    render(
      <RepeatRoundDialog
        milestone={milestone({ status: 'planned' })}
        tasks={[task()]}
        onClose={() => {}}
        onSaved={() => {}}
      />
    )
    fireEvent.change(screen.getByLabelText('Next round starts'), { target: { value: 'yearly' } })
    await waitFor(() =>
      expect(previewMilestoneRound).toHaveBeenLastCalledWith('ms-1', {
        rule: { every: 'year', interval: 1, monthDay: 1 },
        lengthDays: 10,
        nextStart: '2028-04-01'
      })
    )
  })
})

describe('The Overview’s range picker groups rounds (N5.7a)', () => {
  it('lists a series’ rounds under its own heading, latest first', async () => {
    const ws = await workspace([first, latest, milestone({ id: 'ms-9', name: 'Launch' })], [], {
      getProjectReport: async () => ({ ok: false, error: 'not now' })
    })
    const { container } = render(
      <OverviewInsights ws={withWorkspace(ws, {})} onOpenMilestones={() => {}} />
    )
    const range = screen.getByLabelText('Range')
    const group = container.querySelector('optgroup[label="Rounds of Accounts"]')!
    expect(range).toContainElement(group as HTMLElement)
    expect([...group.querySelectorAll('option')].map((option) => option.value)).toEqual([
      'milestone:ms-2',
      'milestone:ms-1'
    ])
    expect(
      within(range)
        .getByRole('option', { name: /Launch/ })
        .closest('optgroup')
    ).toBeNull()
  })
})
