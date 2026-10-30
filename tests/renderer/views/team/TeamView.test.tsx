// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AssignedTask,
  OstlerAPI,
  Person,
  Team,
  TeamOverviewQuery,
  TeamOverviewRow
} from '@shared/ostler-api'
import { TeamView } from '@renderer/views/team/TeamView'
import { StaticPeopleProvider } from '@renderer/context/PeopleContext'
import { ToastProvider } from '@renderer/ui'
import { installOstlerApi } from '../../fixtures/ostler-api'

const person = (id: string, name: string): Person => ({
  id,
  name,
  initials: name.slice(0, 2),
  color: '#3b82f6',
  isMe: false,
  archivedAt: null,
  weeklyCapacityHours: null,
  workingDays: [1, 2, 3, 4, 5],
  projectId: null,
  createdAt: 1,
  updatedAt: 1
})

const PEOPLE = [person('ada', 'Ada'), person('bo', 'Bo')]

const projects = [{ id: 'p1', name: 'Website', color: '#3b82f6', enabled: true }]

vi.mock('@renderer/context/OstlerContext', () => ({
  useOstler: () => ({ projects, areas: [], loading: false })
}))

const row = (personId: string, extra: Partial<TeamOverviewRow> = {}): TeamOverviewRow => ({
  personId,
  open: 0,
  overdue: 0,
  dueThisWeek: 0,
  blocked: 0,
  waitingForSignOff: 0,
  stalled: 0,
  hoursThisWeek: 0,
  capacityThisWeek: null,
  awayDays: [],
  lastActiveAt: null,
  projectIds: [],
  ...extra
})

const ROWS = [
  row('ada', { open: 3, overdue: 2, blocked: 0, hoursThisWeek: 10, capacityThisWeek: 40 }),
  row('bo', {
    open: 5,
    overdue: 0,
    blocked: 1,
    awayDays: [{ firstDate: '2026-11-03', lastDate: '2026-11-05' }]
  })
]

const TEAM: Team = {
  id: 't1',
  name: 'Design',
  memberIds: ['ada'],
  archivedAt: null
} as Team

const task = (extra: Partial<AssignedTask>): AssignedTask =>
  ({
    id: 'task1',
    projectId: 'p1',
    projectName: 'Website',
    projectColor: '#3b82f6',
    estimateUnit: 'hours',
    title: 'Launch plan',
    status: 'active',
    priority: 'medium',
    targetDate: null,
    startDate: null,
    assigneeId: 'ada',
    milestoneId: null,
    milestoneName: null,
    estimate: null,
    labels: [],
    linked: false,
    createdAt: 0,
    updatedAt: 0,
    ...extra
  }) as AssignedTask

function renderView(api: Partial<OstlerAPI>, path = '/team') {
  installOstlerApi({
    listTeams: async () => ({ ok: true as const, value: [TEAM] }),
    ...api
  })
  return render(
    <ToastProvider>
      <StaticPeopleProvider people={PEOPLE}>
        <MemoryRouter initialEntries={[path]}>
          <TeamView />
        </MemoryRouter>
      </StaticPeopleProvider>
    </ToastProvider>
  )
}

describe('TeamView', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 29, 12))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows a row for each person, with overdue in the danger tone', async () => {
    const getTeamOverview = vi.fn(async (_query: TeamOverviewQuery) => ({
      ok: true as const,
      value: ROWS
    }))
    renderView({ getTeamOverview })

    const ada = (await screen.findByRole('rowheader', { name: /Ada/ })).closest('tr')!
    expect(getTeamOverview).toHaveBeenCalledWith({ today: '2026-10-29' })
    const cells = within(ada).getAllByRole('cell')
    expect(cells[1]).toHaveTextContent('2')
    expect(cells[1]).toHaveAttribute('data-tone', 'danger')
    expect(cells[3]).not.toHaveAttribute('data-tone')
    expect(cells[6]).toHaveTextContent('10 h of 40 h')

    const bo = screen.getByRole('rowheader', { name: /Bo/ }).closest('tr')!
    expect(within(bo).getAllByRole('cell')[3]).toHaveAttribute('data-tone', 'warning')
    expect(within(bo).getAllByRole('cell')[7]).toHaveTextContent('Away 3–5 Nov')
  })

  it('asks for the chosen team', async () => {
    const getTeamOverview = vi.fn(async (_query: TeamOverviewQuery) => ({
      ok: true as const,
      value: ROWS
    }))
    renderView({ getTeamOverview })
    await screen.findByRole('rowheader', { name: /Ada/ })
    await waitFor(() => expect(screen.getByRole('option', { name: 'Design' })).toBeTruthy())

    fireEvent.change(screen.getByLabelText('Team'), { target: { value: 't1' } })
    await waitFor(() =>
      expect(getTeamOverview).toHaveBeenLastCalledWith({ today: '2026-10-29', teamId: 't1' })
    )
  })

  it("opens a person's tasks under their row", async () => {
    const getWorkloadTasks = vi.fn(async () => ({
      ok: true as const,
      value: [task({}), task({ id: 'task2', title: 'Bo task', assigneeId: 'bo' })]
    }))
    renderView({
      getTeamOverview: async () => ({ ok: true as const, value: ROWS }),
      getWorkloadTasks
    })
    await screen.findByRole('rowheader', { name: /Ada/ })

    fireEvent.click(screen.getByRole('button', { name: 'Show open tasks for Ada' }))
    expect(await screen.findByRole('link', { name: 'Open Launch plan' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Open Bo task' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Website' })).toBeTruthy()
  })

  it('sorts by a column and says so', async () => {
    renderView({ getTeamOverview: async () => ({ ok: true as const, value: ROWS }) })
    await screen.findByRole('rowheader', { name: /Ada/ })
    const names = () =>
      screen
        .getAllByRole('rowheader')
        .map((header) => header.textContent)
        .filter((text) => /Ada|Bo/.test(text ?? ''))

    expect(names()[0]).toMatch(/Ada/)
    const open = screen.getByRole('columnheader', { name: 'Open' })
    fireEvent.click(within(open).getByRole('button'))
    expect(open).toHaveAttribute('aria-sort', 'descending')
    expect(names()[0]).toMatch(/Bo/)
    fireEvent.click(within(open).getByRole('button'))
    expect(open).toHaveAttribute('aria-sort', 'ascending')
    expect(names()[0]).toMatch(/Ada/)
  })

  it('says when no one is in scope', async () => {
    renderView({ getTeamOverview: async () => ({ ok: true as const, value: [] }) })
    expect(await screen.findByText('No one to show')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open People settings' })).toBeTruthy()
  })
})
