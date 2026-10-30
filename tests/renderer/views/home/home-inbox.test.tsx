// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InboxList, MyWork, RendererProject } from '@shared/ostler-api'
import { todayIsoDate, shiftIsoDate } from '@shared/dates'
import { QuickAddForm } from '@renderer/components/quick-add/QuickAddForm'
import { InboxView } from '@renderer/views/inbox/InboxView'
import { HomeView } from '@renderer/views/home/HomeView'
import { ToastProvider } from '@renderer/ui'
import { installOstlerApi } from '../../fixtures/ostler-api'

const project = (id: string, name: string) =>
  ({
    id,
    name,
    path: null,
    color: '#3b82f6',
    enabled: true,
    customIgnorePatterns: [],
    notes: '',
    tags: [],
    addedAt: 0,
    lastActivity: null,
    hasAutomationToken: false
  }) as RendererProject

const projects = [project('web', 'Website'), project('home', 'Home Reno')]

vi.mock('@renderer/context/OstlerContext', () => ({
  useOstler: () => ({ projects, loading: false })
}))
// Portfolio cards read a lot of their own; Home's lists are what is under test.
vi.mock('@renderer/views/planning/PortfolioView', () => ({ PortfolioView: () => null }))

function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>
}

function renderAt(element: React.ReactNode) {
  render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/start']}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                {element}
                <Where />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </ToastProvider>
  )
}

describe('QuickAddForm', () => {
  beforeEach(() => localStorage.clear())

  it('previews what it found as chips and creates the parsed task on Enter', async () => {
    const createPlanningWorkItem = vi.fn(async (projectId: string, input: { title: string }) => ({
      ok: true as const,
      value: { id: 't1', projectId, title: input.title } as never
    }))
    installOstlerApi({
      createPlanningWorkItem,
      getPlanningLabels: async () => ({ ok: true, value: [] })
    })
    renderAt(<QuickAddForm defaultProjectId="web" />)
    const field = screen.getByRole('textbox', { name: 'Quick add a task' })
    fireEvent.change(field, { target: { value: 'Pay invoice tomorrow #admin !high +home' } })

    const chips = within(screen.getByRole('list', { name: 'What quick add found' }))
    expect(chips.getByText('admin', { exact: false })).toBeInTheDocument()
    expect(chips.getByText('High', { exact: false })).toBeInTheDocument()
    expect(chips.getByText('Home Reno', { exact: false })).toBeInTheDocument()

    fireEvent.submit(field.closest('form')!)
    await waitFor(() => expect(createPlanningWorkItem).toHaveBeenCalled())
    expect(createPlanningWorkItem).toHaveBeenCalledWith('home', {
      title: 'Pay invoice',
      labels: ['admin'],
      priority: 'high',
      targetDate: shiftIsoDate(todayIsoDate(), 1),
      capture: 'quick-add'
    })
    await waitFor(() => expect(field).toHaveValue(''))
  })

  it('keeps a removed chip’s words in the title', async () => {
    const createPlanningWorkItem = vi.fn(async () => ({
      ok: true as const,
      value: { id: 't1', projectId: 'web', title: 'x' } as never
    }))
    installOstlerApi({
      createPlanningWorkItem,
      getPlanningLabels: async () => ({ ok: true, value: [] })
    })
    renderAt(<QuickAddForm defaultProjectId="web" />)
    const field = screen.getByRole('textbox', { name: 'Quick add a task' })
    fireEvent.change(field, { target: { value: 'Read Monday notes' } })
    fireEvent.click(
      screen.getByRole('button', { name: /^Remove due .*"Monday" stays in the title$/ })
    )
    expect(screen.queryByRole('list', { name: 'What quick add found' })).toBeNull()
    fireEvent.submit(field.closest('form')!)
    await waitFor(() =>
      expect(createPlanningWorkItem).toHaveBeenCalledWith('web', {
        title: 'Read Monday notes',
        labels: [],
        capture: 'quick-add'
      })
    )
  })

  it('says when a person matches nobody', () => {
    installOstlerApi({ getPlanningLabels: async () => ({ ok: true, value: [] }) })
    renderAt(<QuickAddForm />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Quick add a task' }), {
      target: { value: 'Ask @zed' }
    })
    expect(screen.getByText('No one is called @zed; it stays in the title.')).toBeInTheDocument()
  })
})

const inbox = (unread: boolean): InboxList => ({
  items: [
    {
      key: 'reminder:r1',
      kind: 'reminder',
      title: 'Pay invoice',
      body: 'Due today · Website',
      projectId: 'web',
      taskId: 't1',
      createdAt: Date.now() - 60_000,
      readAt: unread ? null : Date.now()
    }
  ],
  unreadCount: unread ? 1 : 0
})

describe('InboxView', () => {
  it('lists items, opens one at its task and marks it read', async () => {
    const setInboxRead = vi.fn(async () => ({ ok: true as const, value: inbox(false) }))
    installOstlerApi({ getInbox: async () => ({ ok: true, value: inbox(true) }), setInboxRead })
    renderAt(<InboxView />)
    expect(await screen.findByText('1 unread')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Unread\. Reminder: Pay invoice/ }))
    expect(setInboxRead).toHaveBeenCalledWith(['reminder:r1'], true)
    expect(screen.getByTestId('where')).toHaveTextContent('/projects/web/tasks/t1')
  })

  it('archives with undo, snoozes reminders and marks everything read', async () => {
    const archiveInboxItems = vi.fn(async () => ({
      ok: true as const,
      value: { items: [], unreadCount: 0 }
    }))
    const markAllInboxRead = vi.fn(async () => ({ ok: true as const, value: inbox(false) }))
    const snoozeInboxReminder = vi.fn(async () => ({
      ok: true as const,
      value: { items: [], unreadCount: 0 }
    }))
    installOstlerApi({
      getInbox: async () => ({ ok: true, value: inbox(true) }),
      archiveInboxItems,
      markAllInboxRead,
      snoozeInboxReminder
    })
    renderAt(<InboxView />)
    await screen.findByText('1 unread')

    fireEvent.click(screen.getByRole('button', { name: 'Mark all as read' }))
    await waitFor(() => expect(markAllInboxRead).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: 'Snooze' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'For an hour' }))
    await waitFor(() => expect(snoozeInboxReminder).toHaveBeenCalledWith('reminder:r1', 'hour'))
  })

  it('offers Snooze, Done and Stop reminding on a reminder that keeps reminding (N1.7)', async () => {
    const list = inbox(true)
    list.items[0] = { ...list.items[0], body: 'Keeps reminding · Website', nudging: true }
    const updatePlanningWorkItem = vi.fn(async () => ({ ok: true as const, value: {} as never }))
    const stopPlanningReminder = vi.fn(async () => ({ ok: true as const, value: {} as never }))
    const snoozeInboxReminder = vi.fn(async () => ({ ok: true as const, value: list }))
    installOstlerApi({
      getInbox: async () => ({ ok: true, value: list }),
      updatePlanningWorkItem,
      stopPlanningReminder,
      snoozeInboxReminder
    })
    renderAt(<InboxView />)
    await screen.findByText('1 unread')

    fireEvent.click(screen.getByRole('button', { name: 'Snooze' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Tomorrow at the same time' }))
    await waitFor(() => expect(snoozeInboxReminder).toHaveBeenCalledWith('reminder:r1', 'tomorrow'))

    fireEvent.click(screen.getByRole('button', { name: 'Mark the task done' }))
    await waitFor(() =>
      expect(updatePlanningWorkItem).toHaveBeenCalledWith('t1', { status: 'done' })
    )

    fireEvent.click(screen.getByRole('button', { name: 'Stop reminding' }))
    await waitFor(() => expect(stopPlanningReminder).toHaveBeenCalledWith('t1', 'r1'))
  })

  it('offers no Done or Stop reminding on a plain reminder', async () => {
    installOstlerApi({ getInbox: async () => ({ ok: true, value: inbox(true) }) })
    renderAt(<InboxView />)
    await screen.findByText('1 unread')
    expect(screen.queryByRole('button', { name: 'Stop reminding' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Mark the task done' })).toBeNull()
  })

  it('teaches when it is empty', async () => {
    installOstlerApi({ getInbox: async () => ({ ok: true, value: { items: [], unreadCount: 0 } }) })
    renderAt(<InboxView />)
    expect(await screen.findByText("You're all caught up")).toBeInTheDocument()
  })
})

describe('HomeView', () => {
  const today = todayIsoDate()
  const work: MyWork = {
    today: [
      {
        id: 't1',
        projectId: 'web',
        projectName: 'Website',
        projectColor: '#3b82f6',
        title: 'Fix the footer',
        status: 'ready',
        priority: 'high',
        targetDate: today,
        assigneeId: null,
        linked: false,
        reason: 'today'
      }
    ],
    upcoming: [
      {
        date: shiftIsoDate(today, 1),
        tasks: [
          {
            id: 't2',
            projectId: 'home',
            projectName: 'Home Reno',
            projectColor: '#3b82f6',
            title: 'Pay invoice',
            status: 'backlog',
            priority: 'high',
            targetDate: shiftIsoDate(today, 1),
            assigneeId: null,
            linked: false
          }
        ]
      }
    ],
    myDay: [],
    leftOver: null
  }

  it('shows Today and Upcoming by day, and changes a status in place', async () => {
    const updatePlanningWorkItem = vi.fn(async () => ({
      ok: true as const,
      value: { id: 't1', title: 'Fix the footer', repeatedAs: 't2' } as never
    }))
    const getMyWork = vi.fn(async () => ({ ok: true as const, value: work }))
    installOstlerApi({
      getMyWork,
      getNeedsYou: async () => ({ ok: true, value: [] }),
      getPlanningLabels: async () => ({ ok: true, value: [] }),
      updatePlanningWorkItem
    })
    renderAt(<HomeView />)
    expect(getMyWork).toHaveBeenCalledWith(today)
    const todaySection = await screen.findByRole('link', { name: 'Fix the footer' })
    expect(todaySection).toHaveAttribute('href', '/projects/web/tasks/t1')
    const tomorrow = screen.getByRole('region', { name: 'Tomorrow' })
    expect(within(tomorrow).getByRole('link', { name: 'Pay invoice' })).toBeInTheDocument()
    expect(screen.getByText('Nothing is waiting for you.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Ready. Change status' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Done' }))
    await waitFor(() =>
      expect(updatePlanningWorkItem).toHaveBeenCalledWith('t1', { status: 'done' })
    )
    // The one repeat notice the Board and the drawer give.
    await screen.findByText('“Fix the footer” repeats, so the next one is on the Board.')
  })

  it('teaches with empty states', async () => {
    installOstlerApi({
      getMyWork: async () => ({
        ok: true,
        value: { today: [], upcoming: [], myDay: [], leftOver: null }
      }),
      getNeedsYou: async () => ({ ok: true, value: [] }),
      getPlanningLabels: async () => ({ ok: true, value: [] })
    })
    renderAt(<HomeView />)
    expect(
      await screen.findByText('Nothing due today. Tasks with due dates show up here.')
    ).toBeInTheDocument()
  })

  it('shows My day first, keeps its tasks out of Today, and offers what was left (N1.4)', async () => {
    const [footer] = work.today
    const left = {
      ...footer,
      id: 't9',
      title: 'Paint the fence',
      estimate: null,
      estimateUnit: 'hours' as const
    }
    const letGoMyDay = vi.fn(async () => ({ ok: true as const, value: 1 }))
    installOstlerApi({
      getMyWork: async () => ({
        ok: true,
        value: {
          ...work,
          myDay: [{ ...footer, estimate: 1, estimateUnit: 'hours' }],
          leftOver: { date: shiftIsoDate(today, -1), tasks: [left] }
        }
      }),
      getNeedsYou: async () => ({ ok: true, value: [] }),
      getPlanningLabels: async () => ({ ok: true, value: [] }),
      letGoMyDay
    })
    renderAt(<HomeView />)
    const myDay = await screen.findByRole('list', { name: 'My day tasks' })
    expect(within(myDay).getByRole('link', { name: 'Fix the footer' })).toBeInTheDocument()
    // Only once on Home: Today leaves it out.
    expect(screen.getAllByRole('link', { name: 'Fix the footer' })).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Change my day' })).toBeInTheDocument()

    expect(screen.getByText(/1 unfinished from/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Let them go' }))
    await waitFor(() => expect(letGoMyDay).toHaveBeenCalledWith(shiftIsoDate(today, -1), ['t9']))
  })
})

describe('Home checklist items (N2.2)', () => {
  const today = todayIsoDate()
  const item = (text: string, dueDate: string, overdue = false) => ({
    workItemId: 'party',
    projectId: 'web',
    projectName: 'Website',
    projectColor: '#3b82f6',
    taskTitle: 'Plan the party',
    text,
    dueDate,
    assigneeId: null,
    overdue
  })

  it('lists dated items on Today and Upcoming as "item, in task", and ticks one there', async () => {
    let ticked = false
    const work = (): MyWork => ({
      today: [],
      todayItems: ticked ? [] : [item('Confirm caterer', shiftIsoDate(today, -1), true)],
      upcoming: [
        {
          date: shiftIsoDate(today, 2),
          tasks: [],
          items: [item('Send invitations', shiftIsoDate(today, 2))]
        }
      ],
      myDay: [],
      leftOver: null
    })
    const setPlanningChecklistItemChecked = vi.fn(async () => {
      ticked = true
      return { ok: true as const, value: {} as never }
    })
    installOstlerApi({
      getMyWork: async () => ({ ok: true, value: work() }),
      getNeedsYou: async () => ({ ok: true, value: [] }),
      getPlanningLabels: async () => ({ ok: true, value: [] }),
      setPlanningChecklistItemChecked
    })
    renderAt(<HomeView />)
    const link = await screen.findByRole('link', { name: 'Confirm caterer, in Plan the party' })
    expect(link).toHaveAttribute('href', '/projects/web/tasks/party')
    expect(screen.getByText('Overdue by 1 day')).toHaveClass('is-overdue')
    expect(
      screen.getByRole('link', { name: 'Send invitations, in Plan the party' })
    ).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Done: Confirm caterer, in Plan the party' })
    )
    await waitFor(() =>
      expect(setPlanningChecklistItemChecked).toHaveBeenCalledWith('party', 'Confirm caterer', true)
    )
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Confirm caterer, in Plan the party' })).toBeNull()
    )
  })
})
