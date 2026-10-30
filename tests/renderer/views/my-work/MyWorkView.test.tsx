// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssignedTask, AssignedTasksQuery, OstlerAPI, Person } from '@shared/ostler-api'
import { MyWorkView } from '@renderer/views/my-work/MyWorkView'
import { MY_WORK_SETTINGS_KEY } from '@renderer/views/my-work/my-work-settings'
import { StaticPeopleProvider } from '@renderer/context/PeopleContext'
import { ToastProvider } from '@renderer/ui'
import { __resetDismissableStackForTests } from '@renderer/hooks/useDismissable'
import { installOstlerApi } from '../../fixtures/ostler-api'
import { withElementSize } from '../../fixtures/layout'

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
  person('me', 'Jordan', { isMe: true }),
  person('ada', 'Ada'),
  person('old', 'Olga', { archivedAt: 5 })
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
    estimateUnit: 'points',
    title: id,
    status: 'ready',
    priority: 'medium',
    targetDate: null,
    startDate: null,
    assigneeId: 'me',
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

function Where() {
  const location = useLocation()
  return <span data-testid="where">{location.pathname + location.search}</span>
}

function renderView(api: Partial<OstlerAPI>, at = '/my-work') {
  installOstlerApi(api)
  return render(
    <ToastProvider>
      <StaticPeopleProvider people={PEOPLE}>
        <MemoryRouter initialEntries={[at]}>
          <Routes>
            <Route
              path="*"
              element={
                <>
                  <MyWorkView />
                  <Where />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </StaticPeopleProvider>
    </ToastProvider>
  )
}

const rowOf = (title: string) => screen.getByRole('row', { name: new RegExp(title) })
const cellIn = (title: string, column: string) =>
  within(rowOf(title)).getAllByRole('gridcell')[
    screen.getAllByRole('columnheader').findIndex((header) => header.textContent === column)
  ]
const press = (target: Element, key: string) =>
  act(() => {
    fireEvent.keyDown(target, { key })
  })
/** Group headers, and the rows under each, in order. */
const layout = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((row) =>
      row.hasAttribute('aria-expanded')
        ? `# ${row.textContent}`
        : (row.querySelector('.my-work__title')?.textContent ?? '')
    )

describe('MyWorkView (R3.1)', () => {
  withElementSize(1200, 800)
  beforeEach(() => localStorage.clear())
  afterEach(() => {
    __resetDismissableStackForTests()
    vi.useRealTimers()
  })

  it('lists Me’s tasks across projects, grouped by due date, with each project', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 14, 9, 0))
    const getAssignedTasks = vi.fn(async () => ({
      ok: true as const,
      value: [
        task('Fix footer', { targetDate: '2026-10-12' }),
        task('Plant bulbs', {
          projectId: 'p2',
          projectName: 'Garden',
          targetDate: '2026-10-20'
        }),
        task('Write copy')
      ]
    }))
    renderView({ getAssignedTasks })
    await screen.findByRole('grid', { name: 'Tasks assigned to Jordan' })
    expect(getAssignedTasks).toHaveBeenCalledWith(
      expect.objectContaining({ personId: 'me', hideDone: true, projectId: null })
    )
    expect(layout()).toEqual([
      '# Overdue1',
      'Fix footer',
      '# Next week1',
      'Plant bulbs',
      '# No date1',
      'Write copy'
    ])
    expect(cellIn('Plant bulbs', 'Project')).toHaveTextContent('Garden')

    fireEvent.change(screen.getByRole('combobox', { name: 'Group by' }), {
      target: { value: 'project' }
    })
    expect(layout()).toEqual(['# Garden1', 'Plant bulbs', '# Website2', 'Fix footer', 'Write copy'])
  })

  it('changes a status in place and reads the list again', async () => {
    const updatePlanningWorkItem = vi.fn(async () => ({ ok: true as const, value: {} as never }))
    const getAssignedTasks = vi.fn(async () => ({ ok: true as const, value: [task('Write copy')] }))
    renderView({ getAssignedTasks, updatePlanningWorkItem })
    await screen.findByRole('grid')
    const status = cellIn('Write copy', 'Status')
    status.focus()
    press(status, 'Enter')
    fireEvent.click(await screen.findByRole('menuitem', { name: 'In progress' }))
    await waitFor(() => expect(cellIn('Write copy', 'Status')).toHaveTextContent('In progress'))
    expect(updatePlanningWorkItem).toHaveBeenCalledWith('Write copy', { status: 'active' })
    await waitFor(() => expect(getAssignedTasks).toHaveBeenCalledTimes(2))
  })

  it('says when a repeating task done in place made its next occurrence, or could not', async () => {
    const updatePlanningWorkItem = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: { title: 'Water plants', repeatedAs: 'next' } })
      .mockResolvedValueOnce({
        ok: true,
        value: { title: 'Pay rent', repeatError: 'The rule has no next date' }
      })
    const getAssignedTasks = vi.fn(async () => ({
      ok: true as const,
      value: [task('Water plants'), task('Pay rent')]
    }))
    renderView({ getAssignedTasks, updatePlanningWorkItem })
    await screen.findByRole('grid')
    for (const title of ['Water plants', 'Pay rent']) {
      const status = cellIn(title, 'Status')
      status.focus()
      press(status, 'Enter')
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Done' }))
    }
    await screen.findByText('“Water plants” repeats, so the next one is on the Board.')
    await screen.findByText('“Pay rent” is done')
    expect(screen.getByText('The rule has no next date')).toBeInTheDocument()
  })

  it('changes the priority by clicking its cell, and says when a change is refused', async () => {
    const updatePlanningWorkItem = vi.fn(async () => ({
      ok: false as const,
      error: 'Not allowed'
    }))
    renderView({
      getAssignedTasks: async () => ({ ok: true, value: [task('Write copy')] }),
      updatePlanningWorkItem
    })
    await screen.findByRole('grid')
    fireEvent.click(within(cellIn('Write copy', 'Priority')).getByText('Medium'))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'High' }))
    expect(updatePlanningWorkItem).toHaveBeenCalledWith('Write copy', { priority: 'high' })
    await screen.findByText('Not allowed')
  })

  it('opens a task in its project on Enter', async () => {
    renderView({
      getAssignedTasks: async () => ({
        ok: true,
        value: [task('t1', { projectId: 'p2', title: 'Plant bulbs' })]
      })
    })
    await screen.findByRole('grid')
    const title = cellIn('Plant bulbs', 'Title')
    title.focus()
    press(title, 'Enter')
    expect(screen.getByTestId('where')).toHaveTextContent('/projects/p2/tasks/t1')
  })

  it('remembers its person, grouping and filters', async () => {
    const asked: AssignedTasksQuery[] = []
    const api: Partial<OstlerAPI> = {
      getAssignedTasks: async (query) => {
        asked.push(query)
        return { ok: true, value: [task('Write copy', { assigneeId: query.personId })] }
      }
    }
    const first = renderView(api)
    await screen.findByRole('grid')
    fireEvent.change(screen.getByRole('combobox', { name: 'Person' }), {
      target: { value: 'ada' }
    })
    fireEvent.change(screen.getByRole('combobox', { name: 'Group by' }), {
      target: { value: 'priority' }
    })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Hide done' }))
    await waitFor(() => expect(asked.at(-1)).toMatchObject({ personId: 'ada', hideDone: false }))
    expect(JSON.parse(localStorage.getItem(MY_WORK_SETTINGS_KEY)!)).toMatchObject({
      personId: 'ada',
      groupBy: 'priority',
      hideDone: false
    })
    first.unmount()

    asked.length = 0
    renderView(api)
    await screen.findByRole('grid', { name: 'Tasks assigned to Ada' })
    expect(screen.getByRole('combobox', { name: 'Group by' })).toHaveValue('priority')
    expect(asked[0]).toMatchObject({ personId: 'ada', hideDone: false })
  })

  it('opens on an archived person from a link, though the picker hides archived people', async () => {
    const asked: AssignedTasksQuery[] = []
    renderView(
      {
        getAssignedTasks: async (query) => {
          asked.push(query)
          return { ok: true, value: [task('Old job', { assigneeId: 'old' })] }
        }
      },
      '/my-work?person=old'
    )
    await screen.findByRole('grid', { name: 'Tasks assigned to Olga' })
    expect(asked[0]).toMatchObject({ personId: 'old' })
    const picker = screen.getByRole('combobox', { name: 'Person' })
    expect(within(picker).getByRole('option', { name: 'Olga (archived)' })).toBeInTheDocument()
    fireEvent.change(picker, { target: { value: 'me' } })
    await screen.findByRole('grid', { name: 'Tasks assigned to Jordan' })
    expect(within(picker).queryByRole('option', { name: 'Olga (archived)' })).toBeNull()
  })

  it('says nothing is assigned, not "no match", when only project filters remain under All projects', async () => {
    localStorage.setItem(
      MY_WORK_SETTINGS_KEY,
      JSON.stringify({
        projectId: null,
        filter: {
          match: 'all',
          conditions: [{ field: 'labels', op: 'hasAny', value: ['web'] }]
        }
      })
    )
    const asked: AssignedTasksQuery[] = []
    renderView({
      getAssignedTasks: async (query) => {
        asked.push(query)
        return { ok: true, value: [] }
      }
    })
    expect(await screen.findByText('Nothing assigned')).toBeInTheDocument()
    expect(screen.queryByText('No tasks match')).toBeNull()
    expect(asked[0]?.filter?.conditions).toEqual([])
  })

  it('offers milestone and label filters only once one project is chosen', async () => {
    renderView({
      getAssignedTasks: async () => ({ ok: true, value: [task('Write copy')] }),
      getPlanningMilestones: async () => ({ ok: true, value: [] })
    })
    await screen.findByRole('grid')
    const addFilter = within(screen.getByRole('group', { name: 'Filters' })).getByRole('button', {
      name: 'Add filter'
    })
    fireEvent.click(addFilter)
    expect(screen.getByRole('button', { name: 'Due' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Milestone' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Assignee' })).toBeNull()
    fireEvent.click(addFilter)
    fireEvent.change(screen.getByRole('combobox', { name: 'Project' }), {
      target: { value: 'p1' }
    })
    fireEvent.click(addFilter)
    expect(screen.getByRole('button', { name: 'Milestone' })).toBeInTheDocument()
  })
})
