// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  DeletedPersonalGoal,
  GoalMeasure,
  OstlerAPI,
  PersonalGoalView,
  RendererProject
} from '@shared/ostler-api'
import { personalGoalProgress } from '@shared/personal-goals'
import { GoalsView } from '@renderer/views/goals/GoalsView'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { installOstlerApi } from '../../fixtures/ostler-api'

const TODAY = '2026-07-02'

const POUNDS: GoalMeasure = {
  unit: '£',
  startValue: 0,
  targetValue: 5000,
  startDate: '2026-01-01',
  targetDate: '2026-12-31',
  direction: 'up'
}

const projects = [
  { id: 'p1', name: 'Side business', color: '#3b82f6', icon: null, enabled: true, areaId: null },
  { id: 'p2', name: 'House', color: '#22c55e', icon: null, enabled: false, areaId: null }
] as RendererProject[]

vi.mock('@renderer/context/OstlerContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@renderer/context/OstlerContext')>()),
  useProjectList: () => projects,
  useAreas: () => []
}))

function goalView(overrides: Partial<PersonalGoalView> = {}): PersonalGoalView {
  const base = {
    id: 'pg1',
    title: 'Save £5,000',
    outcome: '',
    status: 'active' as const,
    measure: POUNDS,
    createdAt: 1,
    updatedAt: 1,
    checkIns: [],
    links: [],
    ...overrides
  }
  return {
    ...base,
    ...personalGoalProgress(base.measure, base.checkIns, [], TODAY),
    ...overrides
  }
}

function renderView(entry = '/goals') {
  return render(
    <ToastProvider>
      <ConfirmProvider>
        <MemoryRouter initialEntries={[entry]}>
          <GoalsView />
        </MemoryRouter>
      </ConfirmProvider>
    </ToastProvider>
  )
}

describe('the Goals view (N5.6b)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 6, 2, 9))
    Element.prototype.scrollIntoView = vi.fn()
  })
  afterEach(() => vi.useRealTimers())

  it('explains goals of one’s own when there are none, and adds a new one', async () => {
    let goals: PersonalGoalView[] = []
    const createPersonalGoal = vi.fn(async (input: { title: string; outcome?: string }) => {
      goals = [goalView({ title: input.title, measure: null })]
      return { ok: true as const, value: goals[0] }
    })
    installOstlerApi({
      listPersonalGoals: async () => ({ ok: true, value: goals }),
      createPersonalGoal
    } as Partial<OstlerAPI>)
    renderView()
    expect(await screen.findByRole('heading', { name: 'No goals of your own yet' })).toBeTruthy()
    expect(screen.getByText(/sits outside any project/)).toBeTruthy()

    fireEvent.click(screen.getAllByRole('button', { name: 'New goal' })[0])
    const dialog = screen.getByRole('dialog', { name: 'New goal' })
    fireEvent.change(within(dialog).getByLabelText('Title'), {
      target: { value: 'Read 24 books' }
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add goal' }))
    await waitFor(() =>
      expect(createPersonalGoal).toHaveBeenCalledWith({ title: 'Read 24 books', outcome: '' })
    )
    expect(await screen.findByRole('heading', { name: 'Read 24 books', level: 2 })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add a measure' })).toBeTruthy()
  })

  it('checks in, with the value against its target and its pace', async () => {
    let goals = [goalView()]
    const recordPersonalGoalCheckIn = vi.fn(
      async (_id: string, input: { date: string; value: number }) => {
        const checkIns = [{ personalGoalId: 'pg1', note: '', recordedAt: 5, ...input }]
        goals = [goalView({ checkIns, ...personalGoalProgress(POUNDS, checkIns, [], TODAY) })]
        return { ok: true as const, value: { checkIn: checkIns[0], replaced: null } }
      }
    )
    installOstlerApi({
      listPersonalGoals: async () => ({ ok: true, value: goals }),
      recordPersonalGoalCheckIn
    } as Partial<OstlerAPI>)
    renderView()
    const card = await screen.findByRole('article', { name: 'Save £5,000' })
    expect(within(card).getByText('£0 of £5,000')).toBeTruthy()
    fireEvent.click(within(card).getByRole('button', { name: 'Check in' }))
    const dialog = screen.getByRole('dialog', { name: 'Check in on Save £5,000' })
    fireEvent.change(within(dialog).getByLabelText(/^Value/), { target: { value: '2500' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save check-in' }))
    await waitFor(() =>
      expect(recordPersonalGoalCheckIn).toHaveBeenCalledWith('pg1', {
        date: TODAY,
        value: 2500,
        note: ''
      })
    )
    const updated = await screen.findByRole('article', { name: 'Save £5,000' })
    expect(await within(updated).findByText('£2,500 of £5,000')).toBeTruthy()
    expect(within(updated).getByText('On pace')).toBeTruthy()
    expect(await screen.findByText('Checked in £2,500')).toBeTruthy()
  })

  it('changes the status, folding achieved goals below the active ones', async () => {
    let goals = [goalView(), goalView({ id: 'pg2', title: 'Run 10 km', measure: null })]
    const updatePersonalGoal = vi.fn(async (id: string, input: { status?: string }) => {
      goals = goals.map((goal) =>
        goal.id === id ? ({ ...goal, ...input } as PersonalGoalView) : goal
      )
      return { ok: true as const, value: goals.find((goal) => goal.id === id)! }
    })
    installOstlerApi({
      listPersonalGoals: async () => ({ ok: true, value: goals }),
      updatePersonalGoal
    } as Partial<OstlerAPI>)
    renderView()
    fireEvent.change(await screen.findByLabelText('Status of Run 10 km'), {
      target: { value: 'achieved' }
    })
    await waitFor(() =>
      expect(updatePersonalGoal).toHaveBeenCalledWith('pg2', { status: 'achieved' })
    )
    const fold = await screen.findByRole('button', { name: 'Achieved (1)' })
    expect(fold.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('article', { name: 'Run 10 km' })).toBeNull()
    fireEvent.click(fold)
    expect(screen.getByRole('article', { name: 'Run 10 km' })).toBeTruthy()
  })

  it('deletes a goal at once, and Undo puts it back', async () => {
    let goals = [goalView()]
    const deleted: DeletedPersonalGoal = { goal: goals[0], checkIns: [], links: [] }
    const deletePersonalGoal = vi.fn(async () => {
      goals = []
      return { ok: true as const, value: deleted }
    })
    const restorePersonalGoal = vi.fn(async () => {
      goals = [goalView()]
      return { ok: true as const, value: goals[0] }
    })
    installOstlerApi({
      listPersonalGoals: async () => ({ ok: true, value: goals }),
      deletePersonalGoal,
      restorePersonalGoal
    } as Partial<OstlerAPI>)
    renderView()
    const card = await screen.findByRole('article', { name: 'Save £5,000' })
    fireEvent.click(within(card).getByRole('button', { name: 'Actions for Save £5,000' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    await waitFor(() => expect(deletePersonalGoal).toHaveBeenCalledWith('pg1'))
    expect(await screen.findByText('Deleted Save £5,000')).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Save £5,000' })).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(restorePersonalGoal).toHaveBeenCalledWith(deleted))
    expect(await screen.findByRole('article', { name: 'Save £5,000' })).toBeTruthy()
  })

  it('shows linked project goals with their projects, says a project is off, and removes a link', async () => {
    const linked = (goalId: string, projectId: string, title: string, latest: number) => ({
      goalId,
      projectId,
      title,
      measure: { ...POUNDS, targetValue: 2000 },
      latest,
      mismatch: null,
      createdAt: 1
    })
    let goals = [
      goalView({
        links: [linked('g1', 'p1', 'Side income', 900), linked('g2', 'p2', 'House savings', 1200)],
        fromLinks: true,
        readings: [{ date: '2026-06-01', value: 2100 }],
        progress: personalGoalProgress(POUNDS, [{ date: '2026-06-01', value: 2100 }], [], TODAY)
          .progress
      })
    ]
    const setGoalCountsTowards = vi.fn(async (goalId: string, personalGoalId: string | null) => {
      goals = [goalView()]
      return { ok: true as const, value: { goalId, personalGoalId, previous: 'pg1' } }
    })
    installOstlerApi({
      listPersonalGoals: async () => ({ ok: true, value: goals }),
      setGoalCountsTowards
    } as Partial<OstlerAPI>)
    renderView()
    const card = await screen.findByRole('article', { name: 'Save £5,000' })
    expect(within(card).getByText('£2,100 of £5,000')).toBeTruthy()
    expect(
      within(card).getByText('The number is the sum of 2 project goals’ latest values.')
    ).toBeTruthy()
    // Its number comes from the links: no Check in.
    expect(within(card).queryByRole('button', { name: 'Check in' })).toBeNull()
    const links = within(card).getByRole('region', { name: 'Project goals that count towards it' })
    expect(within(links).getByText('Side business')).toBeTruthy()
    expect(within(links).getByText('House (project is off)')).toBeTruthy()
    expect(within(links).getByText('£900 now')).toBeTruthy()

    fireEvent.click(
      within(links).getByRole('button', { name: 'Stop Side income counting towards Save £5,000' })
    )
    await waitFor(() => expect(setGoalCountsTowards).toHaveBeenCalledWith('g1', null))
    expect(await screen.findByText('Side income no longer counts towards Save £5,000')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(setGoalCountsTowards).toHaveBeenLastCalledWith('g1', 'pg1'))
  })

  it('adds a project goal with the same unit, picked across projects', async () => {
    const goals = [goalView()]
    const setGoalCountsTowards = vi.fn(async (goalId: string, personalGoalId: string | null) => ({
      ok: true as const,
      value: { goalId, personalGoalId, previous: null }
    }))
    installOstlerApi({
      listPersonalGoals: async () => ({ ok: true, value: goals }),
      listLinkableProjectGoals: async () => ({
        ok: true,
        value: [
          {
            goalId: 'g1',
            projectId: 'p1',
            title: 'Side income',
            measure: POUNDS,
            personalGoalId: null
          },
          {
            goalId: 'g3',
            projectId: 'p1',
            title: 'Run further',
            measure: { ...POUNDS, unit: 'km' },
            personalGoalId: null
          }
        ]
      }),
      setGoalCountsTowards
    } as Partial<OstlerAPI>)
    renderView()
    const card = await screen.findByRole('article', { name: 'Save £5,000' })
    fireEvent.click(within(card).getByRole('button', { name: 'Actions for Save £5,000' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Add a project goal' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add a project goal to Save £5,000' })
    const select = within(dialog).getByLabelText('Project goal') as HTMLSelectElement
    // Only the goal in £ is offered.
    expect([...select.options].map((option) => option.text)).toEqual([
      'Side income · Side business'
    ])
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(setGoalCountsTowards).toHaveBeenCalledWith('g1', 'pg1'))
  })
})
