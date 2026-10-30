// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MyDayTask, PlanMyDayCandidates, RendererProject } from '@shared/ostler-api'
import { PlanMyDayDialog, MY_DAY_HOURS_KEY } from '@renderer/components/my-day/PlanMyDayDialog'
import { MyDaySection } from '@renderer/views/home/MyDaySection'
import { QuickAddForm } from '@renderer/components/quick-add/QuickAddForm'
import { ToastProvider } from '@renderer/ui'
import { __resetDismissableStackForTests } from '@renderer/hooks/useDismissable'
import { installOstlerApi } from '../../fixtures/ostler-api'

const project = {
  id: 'web',
  name: 'Website',
  path: null,
  color: '#3b82f6',
  enabled: true,
  customIgnorePatterns: [],
  notes: '',
  tags: [],
  addedAt: 0,
  lastActivity: null,
  hasAutomationToken: false
} as RendererProject

vi.mock('@renderer/context/OstlerContext', () => ({
  useOstler: () => ({ projects: [project], loading: false })
}))

let me: { id: string; weeklyCapacityHours: number | null; workingDays: number[] } | null = null
vi.mock('@renderer/context/PeopleContext', () => ({
  usePeople: () => ({
    me: me && { ...me, name: 'Jordan', isMe: true },
    active: me ? [{ ...me, name: 'Jordan', isMe: true }] : [],
    offered: () => (me ? [{ ...me, name: 'Jordan', isMe: true }] : []),
    byId: new Map()
  })
}))

const TODAY = '2026-10-16'

const task = (id: string, extra: Partial<MyDayTask> = {}): MyDayTask => ({
  id,
  projectId: 'web',
  projectName: 'Website',
  projectColor: '#3b82f6',
  title: id,
  status: 'ready',
  priority: 'medium',
  targetDate: null,
  assigneeId: null,
  linked: false,
  estimate: null,
  estimateUnit: 'hours',
  ...extra
})

function renderIn(element: React.ReactNode) {
  return render(
    <ToastProvider>
      <MemoryRouter>{element}</MemoryRouter>
    </ToastProvider>
  )
}

beforeEach(() => {
  __resetDismissableStackForTests()
  localStorage.clear()
  me = null
})

describe('Plan my day', () => {
  const candidates: PlanMyDayCandidates = {
    myDay: [],
    leftOver: { date: '2026-10-14', tasks: [task('Left over', { estimate: 1 })] },
    today: [
      task('Late', { reason: 'overdue', targetDate: '2026-10-10', estimate: 2 }),
      task('Due', { reason: 'today', targetDate: TODAY, estimate: 3 }),
      task('Doing', { reason: 'in-progress', status: 'active' })
    ],
    highPriority: [task('Points', { priority: 'high', estimate: 5, estimateUnit: 'points' })]
  }

  it('picks, orders and totals against the typed hours, then starts the day in that order', async () => {
    const startMyDay = vi.fn(async (_date: string, ids: string[]) => ({
      ok: true as const,
      value: ids.map((id) => task(id))
    }))
    const onChanged = vi.fn()
    installOstlerApi({
      getPlanMyDay: async () => ({ ok: true, value: candidates }),
      startMyDay
    })
    renderIn(<PlanMyDayDialog open onClose={() => {}} today={TODAY} onChanged={onChanged} />)

    expect(await screen.findByRole('group', { name: 'Left from Wednesday' })).toBeInTheDocument()
    for (const name of ['Overdue', 'Due today', 'In progress', 'High priority, no date'])
      expect(screen.getByRole('group', { name })).toBeInTheDocument()

    fireEvent.change(screen.getByRole('spinbutton', { name: /Hours you have today/ }), {
      target: { value: '4' }
    })
    fireEvent.click(screen.getByRole('checkbox', { name: /^Late/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /^Due/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /^Points/ }))
    expect(screen.getByText(/5 h picked of 4 h/)).toBeInTheDocument()
    expect(screen.getByText(/1 h over/)).toBeInTheDocument()
    expect(screen.getByText('1 task in a points project (5 pts)')).toBeInTheDocument()
    expect(localStorage.getItem(MY_DAY_HOURS_KEY)).toBe('4')

    // Alt and Up moves Due above Late.
    const order = screen.getByRole('list', { name: 'Your order' })
    fireEvent.keyDown(within(order).getByText('Due'), { key: 'ArrowUp', altKey: true })
    expect(
      within(order)
        .getAllByRole('listitem')
        .map((item) => item.textContent)
    ).toEqual([
      expect.stringContaining('Due'),
      expect.stringContaining('Late'),
      expect.stringContaining('Points')
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Start my day' }))
    await waitFor(() => expect(startMyDay).toHaveBeenCalledWith(TODAY, ['Due', 'Late', 'Points']))
    expect(onChanged).toHaveBeenCalled()
  })

  it('uses the daily capacity from Workload when Me has one', async () => {
    me = { id: 'me', weeklyCapacityHours: 30, workingDays: [1, 2, 3, 4, 5] }
    installOstlerApi({
      getPlanMyDay: async () => ({
        ok: true,
        value: { ...candidates, myDay: [candidates.today[0]] }
      })
    })
    renderIn(<PlanMyDayDialog open onClose={() => {}} today={TODAY} onChanged={() => {}} />)
    expect(await screen.findByText(/2 h picked of 6 h/)).toBeInTheDocument()
    expect(screen.getByText('Your daily capacity from Workload')).toBeInTheDocument()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
    // Already in today's list: not offered again in its section.
    expect(screen.queryByRole('group', { name: 'Overdue' })).not.toBeInTheDocument()
  })
})

describe('My day on Home', () => {
  it('ticks a task done, reorders with Alt and an arrow, and removes with undo', async () => {
    const updatePlanningWorkItem = vi.fn(async () => ({
      ok: true as const,
      value: { id: 'b', title: 'b' } as never
    }))
    const moveInMyDay = vi.fn(async () => ({ ok: true as const, value: undefined }))
    const removeFromMyDay = vi.fn(async () => ({ ok: true as const, value: true }))
    const addToMyDay = vi.fn(async () => ({
      ok: true as const,
      value: { workItemId: 'a', date: TODAY, broughtBack: null, already: false }
    }))
    installOstlerApi({ updatePlanningWorkItem, moveInMyDay, removeFromMyDay, addToMyDay })
    const onChanged = vi.fn()
    renderIn(
      <MyDaySection
        tasks={[task('a', { estimate: 2 }), task('b', { status: 'done' })]}
        today={TODAY}
        onChanged={onChanged}
      />
    )
    expect(screen.getByText('2 h')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Mark b not done' })).toBeChecked()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Mark a done' }))
    await waitFor(() =>
      expect(updatePlanningWorkItem).toHaveBeenCalledWith('a', { status: 'done' })
    )

    fireEvent.keyDown(screen.getByRole('link', { name: 'b' }), { key: 'ArrowUp', altKey: true })
    await waitFor(() =>
      expect(moveInMyDay).toHaveBeenCalledWith('b', { date: TODAY, beforeId: 'a' })
    )

    fireEvent.click(screen.getByRole('button', { name: 'Remove a from My day' }))
    await waitFor(() => expect(removeFromMyDay).toHaveBeenCalledWith('a', TODAY))
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(addToMyDay).toHaveBeenCalled())
  })
})

describe('Where a task in My day lives', () => {
  it('names the project and the workstream, or the project alone', async () => {
    installOstlerApi({
      listSubprojects: async () => ({
        ok: true,
        value: [{ id: 's1', projectId: 'web', name: 'Launch site', archivedAt: 7 } as never]
      })
    })
    renderIn(
      <MyDaySection
        tasks={[task('a', { subprojectId: 's1' }), task('b')]}
        today={TODAY}
        onChanged={vi.fn()}
      />
    )
    // An archived workstream keeps its name.
    expect(await screen.findByText('Website › Launch site')).toBeInTheDocument()
    expect(screen.getAllByText('Website')).toHaveLength(1)
  })
})

describe('Quick add to My day', () => {
  it('adds the new task to today’s My day when ticked', async () => {
    const addToMyDay = vi.fn(async () => ({
      ok: true as const,
      value: { workItemId: 'n1', date: TODAY, broughtBack: null, already: false }
    }))
    installOstlerApi({
      getPlanningLabels: async () => ({ ok: true, value: [] }),
      getTaskTemplates: async () => ({ ok: true, value: [] }),
      createPlanningWorkItem: async () => ({
        ok: true,
        value: { id: 'n1', projectId: 'web', title: 'Call the bank' } as never
      }),
      addToMyDay
    })
    renderIn(<QuickAddForm />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Add to My day' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Quick add a task' }), {
      target: { value: 'Call the bank' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }))
    await waitFor(() => expect(addToMyDay).toHaveBeenCalledWith('n1', { date: expect.any(String) }))
    expect(await screen.findByText('Added Call the bank to My day')).toBeInTheDocument()
  })
})
