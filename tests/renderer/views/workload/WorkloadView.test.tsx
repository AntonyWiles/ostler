// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssignedTask, OstlerAPI, Person, WorkloadTasksQuery } from '@shared/ostler-api'
import { WorkloadView } from '@renderer/views/workload/WorkloadView'
import { StaticPeopleProvider } from '@renderer/context/PeopleContext'
import { ToastProvider } from '@renderer/ui'
import { __resetDismissableStackForTests } from '@renderer/hooks/useDismissable'
import { installOstlerApi } from '../../fixtures/ostler-api'

const person = (id: string, name: string, extra: Partial<Person> = {}): Person => ({
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
  updatedAt: 1,
  ...extra
})

const PEOPLE: Person[] = [
  person('ada', 'Ada', { isMe: true, weeklyCapacityHours: 40 }),
  person('bo', 'Bo')
]

const projects = [
  { id: 'p1', name: 'Website', color: '#3b82f6', enabled: true },
  { id: 'p2', name: 'Garden', color: '#ec4899', enabled: true }
]

vi.mock('@renderer/context/OstlerContext', () => ({
  useOstler: () => ({ projects, loading: false })
}))

function task(id: string, extra: Partial<AssignedTask> = {}): AssignedTask {
  return {
    id,
    projectId: 'p1',
    projectName: 'Website',
    projectColor: '#3b82f6',
    estimateUnit: 'hours',
    title: id,
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
  }
}

// Wednesday 14 October 2026.
const TASKS = [
  task('Launch plan', { startDate: '2026-10-12', targetDate: '2026-10-16', estimate: 46 }),
  task('Garden beds', {
    projectId: 'p2',
    projectName: 'Garden',
    estimateUnit: 'points',
    targetDate: '2026-10-15',
    estimate: 5
  }),
  task('Fix the gate', { assigneeId: 'bo', targetDate: '2026-10-20', estimate: 4 }),
  task('Someday', { assigneeId: null })
]

function renderView(api: Partial<OstlerAPI>, path = '/workload') {
  installOstlerApi(api)
  return render(
    <ToastProvider>
      <StaticPeopleProvider people={PEOPLE}>
        <MemoryRouter initialEntries={[path]}>
          <WorkloadView />
        </MemoryRouter>
      </StaticPeopleProvider>
    </ToastProvider>
  )
}

const cell = (name: RegExp) => screen.getByRole('button', { name })

describe('WorkloadView (R3.2)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 14, 12))
  })
  afterEach(() => {
    __resetDismissableStackForTests()
    vi.useRealTimers()
  })

  it('asks once for six weeks, and says hours against capacity and "over" in words', async () => {
    const getWorkloadTasks = vi.fn(async (_query: WorkloadTasksQuery) => ({
      ok: true as const,
      value: TASKS
    }))
    renderView({ getWorkloadTasks })

    const over = await screen.findByRole('button', { name: /^Ada, Week of 12 Oct: / })
    expect(getWorkloadTasks).toHaveBeenCalledTimes(1)
    expect(getWorkloadTasks).toHaveBeenCalledWith({ projectIds: null, through: '2026-11-22' })
    expect(over).toHaveTextContent('46 h of 40 h')
    expect(over).toHaveTextContent('over by 6 h')
    expect(over).toHaveTextContent('2 tasks (1 in points)')
    expect(over).toHaveClass('is-over')
    expect(over.querySelector<HTMLElement>('.workload__bar-fill')!.style.width).toBe('100%')

    const next = cell(/^Ada, Week of 19 Oct: /)
    expect(next).toHaveTextContent('0 h of 40 h')
    expect(next).not.toHaveTextContent('over')

    // No capacity: hours only, and no bar.
    const bo = cell(/^Bo, Week of 19 Oct: /)
    expect(bo).toHaveTextContent('4 h')
    expect(bo.querySelector('.workload__bar')).toBeNull()
    expect(screen.getByRole('rowheader', { name: /Bo/ })).toHaveTextContent('no capacity set')
    expect(screen.getByRole('rowheader', { name: /Ada/ })).toHaveTextContent('40 h a week')

    expect(cell(/^Unassigned, Unscheduled: /)).toHaveTextContent('1 task')
    expect(screen.getAllByRole('columnheader')).toHaveLength(8)
  })

  it('counts the days other people share as away, by their dates only', async () => {
    const getSharedAway = vi.fn(async () => ({
      ok: true as const,
      value: [{ personId: 'ada', firstDate: '2026-10-19', lastDate: '2026-10-20' }]
    }))
    renderView({
      getWorkloadTasks: async () => ({ ok: true as const, value: TASKS }),
      getSharedAway
    })

    await waitFor(() => expect(cell(/^Ada, Week of 19 Oct: /)).toHaveTextContent('0 h of 24 h'))
    expect(cell(/^Ada, Week of 19 Oct: /)).toHaveTextContent('Away')
    expect(getSharedAway).toHaveBeenCalledWith({ from: '2026-10-12', through: '2026-11-22' })
  })

  it('opens the tasks behind a cell and reassigns one from there', async () => {
    let tasks = TASKS
    const updatePlanningWorkItem = vi.fn(async (id: string, patch: object) => {
      tasks = tasks.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry))
      return { ok: true as const, value: {} as never }
    })
    renderView({
      getWorkloadTasks: async () => ({ ok: true, value: tasks }),
      updatePlanningWorkItem
    })

    fireEvent.click(await screen.findByRole('button', { name: /^Ada, Week of 12 Oct: / }))
    const dialog = screen.getByRole('dialog', { name: 'Ada · Week of 12 Oct' })
    expect(within(dialog).getByRole('link', { name: 'Open Launch plan' })).toHaveAttribute(
      'href',
      '/projects/p1/tasks/Launch%20plan'
    )
    expect(within(dialog).getByText('46 h here')).toBeInTheDocument()
    expect(within(dialog).getByText('In points')).toBeInTheDocument()

    const launch = within(dialog).getByRole('listitem', { name: 'Launch plan' })
    const assignee = within(launch).getByRole('combobox', { name: 'Assignee' })
    fireEvent.change(assignee, { target: { value: 'Bo' } })
    fireEvent.keyDown(assignee, { key: 'Enter' })

    await waitFor(() =>
      expect(updatePlanningWorkItem).toHaveBeenCalledWith('Launch plan', { assigneeId: 'bo' })
    )
    // The task leaves Ada's cell for Bo's.
    await waitFor(() =>
      expect(within(dialog).queryByRole('listitem', { name: 'Launch plan' })).toBeNull()
    )
    expect(cell(/^Bo, Week of 12 Oct: /)).toHaveTextContent('46 h')
  })

  it('filters by project', async () => {
    const getWorkloadTasks = vi.fn(async () => ({ ok: true as const, value: TASKS }))
    renderView({ getWorkloadTasks })
    await screen.findByRole('button', { name: /^Ada, Week of 12 Oct: / })
    fireEvent.change(screen.getByRole('combobox', { name: 'Project' }), {
      target: { value: 'p2' }
    })
    await waitFor(() =>
      expect(getWorkloadTasks).toHaveBeenLastCalledWith({
        projectIds: ['p2'],
        through: '2026-11-22'
      })
    )
  })

  it('opens on the project in its link, and ignores one it does not list', async () => {
    const getWorkloadTasks = vi.fn(async () => ({ ok: true as const, value: TASKS }))
    renderView({ getWorkloadTasks }, '/workload?project=p1')
    await screen.findByRole('button', { name: /^Ada, Week of 12 Oct: / })
    expect(screen.getByRole('combobox', { name: 'Project' })).toHaveValue('p1')
    expect(getWorkloadTasks).toHaveBeenCalledWith({ projectIds: ['p1'], through: '2026-11-22' })
  })

  it('shows every project for a project it does not list', async () => {
    const getWorkloadTasks = vi.fn(async () => ({ ok: true as const, value: TASKS }))
    renderView({ getWorkloadTasks }, '/workload?project=gone')
    await screen.findByRole('button', { name: /^Ada, Week of 12 Oct: / })
    expect(screen.getByRole('combobox', { name: 'Project' })).toHaveValue('')
    expect(getWorkloadTasks).toHaveBeenCalledWith({ projectIds: null, through: '2026-11-22' })
  })
})
