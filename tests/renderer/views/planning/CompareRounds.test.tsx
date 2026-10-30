// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CompareRoundsDialog } from '@renderer/views/planning/rounds/CompareRoundsDialog'
import { GoalsMilestonesPanel } from '@renderer/views/planning/GoalsMilestonesPanel'
import { OverviewInsights } from '@renderer/views/planning/insights/OverviewInsights'
import type {
  PlanningMilestone,
  RoundComparison,
  RoundComparisonCell,
  RoundComparisonRound
} from '@shared/ostler-api'
import { installOstlerApi } from '../../fixtures/ostler-api'
import { renderPlanningWorkspace } from '../../fixtures/planning-workspace'

const DAY = 86_400_000

const round = (index: number, overrides: Partial<RoundComparisonRound> = {}) => ({
  milestoneId: `ms-${index}`,
  name: index === 1 ? 'Accounts' : `Accounts · round ${index}`,
  start: '2027-01-01',
  targetDate: '2027-01-10',
  plannedDays: 10,
  firstStartedAt: 1,
  lastFinishedAt: 2,
  tookDays: 8,
  finished: true,
  done: 2,
  wontDo: 0,
  open: 0,
  timeTrackedSeconds: 0,
  summary: `Round ${index} took 8 days of 10 days planned: 2 done, 0 won’t do, 0 still open.`,
  ...overrides
})

const cell = (id: string, days: number | null, seconds = 0): RoundComparisonCell => ({
  workItemId: id,
  title: id,
  outcome: days === null ? 'open' : 'done',
  cycleTimeMs: days === null ? null : days * DAY,
  timeTrackedSeconds: seconds
})

function comparison(roundCount: number, hasTimeTracked = false): RoundComparison {
  const rounds = Array.from({ length: roundCount }, (_, index) => round(index + 1))
  return {
    projectId: 'proj-1',
    seriesName: 'Accounts',
    rounds,
    tasks: [
      {
        title: 'Collect receipts',
        cells: rounds.map((_, index) => cell(`r${index}`, index === 1 ? 6 : 2, index * 600)),
        slowestCycleRound: 1,
        slowestTimeRound: roundCount - 1
      },
      {
        title: 'File the return',
        cells: rounds.map((_, index) => (index === roundCount - 1 ? cell('f', null) : null)),
        slowestCycleRound: null,
        slowestTimeRound: null
      }
    ],
    hasTimeTracked,
    generatedAt: 1,
    summary: `${roundCount} rounds of Accounts`
  }
}

function open(value: RoundComparison) {
  const getRoundComparison = vi.fn(async () => ({ ok: true as const, value }))
  const exportRoundComparisonCsv = vi.fn(async () => ({ ok: true as const, value: null }))
  const printRoundComparison = vi.fn(async () => ({ ok: true as const, value: null }))
  installOstlerApi({ getRoundComparison, exportRoundComparisonCsv, printRoundComparison })
  render(<CompareRoundsDialog projectId="proj-1" milestoneId="ms-2" onClose={() => {}} />)
  return { getRoundComparison, exportRoundComparisonCsv, printRoundComparison }
}

describe('Compare rounds (N5.7b)', () => {
  it('says each round’s duration against its plan in words beside the chart', async () => {
    const { getRoundComparison } = open(comparison(2, false))
    expect(await screen.findByRole('dialog', { name: 'Compare rounds: Accounts' })).toBeVisible()
    expect(getRoundComparison).toHaveBeenCalledWith('proj-1', 'ms-2')
    expect(
      screen.getByText('Round 1 took 8 days of 10 days planned: 2 done, 0 won’t do, 0 still open.')
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'How long each round took' })).toBeInTheDocument()
  })

  it('shows each task’s cycle time per round, the slowest marked in words, absent tasks said so', async () => {
    open(comparison(2))
    const table = await screen.findByRole('table')
    const rows = within(table).getAllByRole('row')
    expect(
      within(rows[0])
        .getAllByRole('columnheader')
        .map((th) => th.textContent)
    ).toEqual(['Task', 'Accounts', 'Accounts · round 2'])
    const receipts = within(rows[1]).getAllByRole('cell')
    expect(receipts[0]).toHaveTextContent(/^2 days$/)
    expect(receipts[1]).toHaveTextContent('6 days slowest')
    expect(receipts[1]).toHaveClass('is-slowest')
    const filing = within(rows[2]).getAllByRole('cell')
    expect(filing[0]).toHaveTextContent('not in this round')
    expect(filing[1]).toHaveTextContent('still open')
    // No time tracked: no switch.
    expect(screen.queryByRole('radiogroup', { name: 'Show' })).toBeNull()
  })

  it('switches to time tracked when there is any', async () => {
    open(comparison(3, true))
    await screen.findByRole('table')
    fireEvent.click(screen.getByRole('radio', { name: 'Time tracked' }))
    const cells = within(screen.getAllByRole('row')[1]).getAllByRole('cell')
    expect(cells[0]).toHaveTextContent('none')
    expect(cells[2]).toHaveTextContent(/slowest/)
    expect(cells[1]).not.toHaveTextContent(/slowest/)
  })

  it('shows the latest six rounds, and earlier ones on request', async () => {
    open(comparison(8))
    const table = await screen.findByRole('table')
    const headers = () =>
      within(table)
        .getAllByRole('columnheader')
        .map((th) => th.textContent)
    expect(headers()).toHaveLength(7)
    expect(headers()[1]).toBe('Accounts · round 3')
    expect(headers()[6]).toBe('Accounts · round 8')
    fireEvent.click(screen.getByRole('button', { name: 'Show 2 earlier rounds' }))
    expect(headers()).toHaveLength(9)
    expect(headers()[1]).toBe('Accounts')
    fireEvent.click(screen.getByRole('button', { name: 'Show the latest six only' }))
    expect(headers()).toHaveLength(7)
  })

  it('exports the table as CSV and prints it with the measure shown', async () => {
    const { exportRoundComparisonCsv, printRoundComparison } = open(comparison(2, true))
    await screen.findByRole('table')
    fireEvent.click(screen.getByRole('radio', { name: 'Time tracked' }))
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    await waitFor(() =>
      expect(exportRoundComparisonCsv).toHaveBeenCalledWith({
        projectId: 'proj-1',
        milestoneId: 'ms-2',
        measure: 'time'
      })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save as PDF' }))
    await waitFor(() =>
      expect(printRoundComparison).toHaveBeenCalledWith({
        projectId: 'proj-1',
        milestoneId: 'ms-2',
        measure: 'time',
        output: 'pdf'
      })
    )
  })
})

const milestone = (overrides: Partial<PlanningMilestone>): PlanningMilestone => ({
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

describe('Where Compare rounds opens (N5.7b)', () => {
  const rounds = [
    milestone({}),
    milestone({ id: 'ms-2', name: 'Accounts · May 2027', previousRoundId: 'ms-1' })
  ]

  async function workspace() {
    return renderPlanningWorkspace({
      projectId: 'proj-1',
      api: {
        getPlanningGoals: async () => ({ ok: true, value: [] }),
        getPlanningMilestones: async () => ({ ok: true, value: rounds }),
        getPlanningWorkItems: async () => ({ ok: true, value: [] }),
        getAIMilestoneAdvisory: async () => ({ ok: true, value: null }),
        getAITaskSplitJob: async () => ({ ok: true, value: null }),
        getProjectReport: async () => ({ ok: false, error: 'not now' }),
        getRoundComparison: async () => ({ ok: true, value: comparison(2) }),
        onTaskSplitProgress: () => () => {}
      }
    })
  }

  it('opens from a series in the Goals and milestones panel', async () => {
    render(<GoalsMilestonesPanel ws={await workspace()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Compare rounds of Accounts' }))
    expect(await screen.findByRole('dialog', { name: 'Compare rounds: Accounts' })).toBeVisible()
  })

  it('opens from the Overview once the range is a round of a series', async () => {
    render(<OverviewInsights ws={await workspace()} onOpenMilestones={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Compare rounds of Accounts' })).toBeNull()
    fireEvent.change(screen.getByLabelText('Range'), { target: { value: 'milestone:ms-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Compare rounds of Accounts' }))
    expect(await screen.findByRole('dialog', { name: 'Compare rounds: Accounts' })).toBeVisible()
  })
})
