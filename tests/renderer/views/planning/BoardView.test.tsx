// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { BoardView } from '@renderer/views/planning/BoardView'
import type { PlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { MemoryRouter } from 'react-router-dom'
import { renderPlanningWorkspace, withWorkspace } from '../../fixtures/planning-workspace'
import type { PlanningWorkItem, PlanningWorkItemStatus } from '@shared/ostler-api'

function makeWorkItem(id: string, status: PlanningWorkItemStatus): PlanningWorkItem {
  return {
    id,
    projectId: 'proj-1',
    milestoneId: null,
    title: `Item ${id}`,
    description: '',
    status,
    priority: 'medium',
    labels: [],
    acceptanceCriteria: [],
    dependencyIds: [],
    targetDate: null,
    startDate: null,
    assigneeId: null,
    estimate: null,
    checkedCriteria: [],
    origin: 'human',
    linkedHarnessTaskId: null,
    autoQueue: false,
    parentWorkItemId: null,
    taskCode: '',
    phaseCode: '',
    phaseName: '',
    subtaskPhaseNumber: null,
    subtaskPhaseName: '',
    verificationStatus: 'unverified',
    verifiedBy: null,
    verifiedAt: null,
    verificationNotes: '',
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
}

// The real workspace, loaded with these items, so columns, counts and filters come from the
// same code the app runs.
const createMockWorkspace = async (
  items: PlanningWorkItem[],
  overrides: Partial<PlanningWorkspace> = {}
): Promise<PlanningWorkspace> => {
  const base = await renderPlanningWorkspace({
    projectId: 'proj-1',
    api: { getPlanningWorkItems: async () => ({ ok: true, value: items }) }
  })
  return withWorkspace(base, overrides)
}

const withFeatures = (ui: ReactElement, agents = false) => (
  <ConfirmProvider>
    <StaticFeaturesProvider value={{ agents, ai: false }}>{ui}</StaticFeaturesProvider>
  </ConfirmProvider>
)

const column = (status: PlanningWorkItemStatus) =>
  document.querySelector(`.ostler-planning-column--${status}`) as HTMLElement

describe('BoardView columns', () => {
  it('heads each column with its status word and a plain count when no WIP limit is set', async () => {
    const ws = await createMockWorkspace([makeWorkItem('1', 'active'), makeWorkItem('2', 'active')])
    render(<BoardView ws={ws} />)

    const active = within(column('active'))
    expect(active.getByRole('heading', { name: 'In progress' })).toBeTruthy()
    expect(
      active.getByRole('button', { name: /^2 tasks; click to edit WIP limit/ })
    ).toHaveTextContent('2')
    expect(active.getByRole('button', { name: 'New task in In progress' })).toBeTruthy()
  })

  it('says so in one muted line when a column is empty', async () => {
    const ws = await createMockWorkspace([makeWorkItem('1', 'active')])
    render(<BoardView ws={ws} />)
    expect(within(column('done')).getByText('No tasks')).toBeTruthy()
  })

  it('opens a new task in the column it was asked from', async () => {
    const openWorkItemCreate = vi.fn()
    const ws = await createMockWorkspace([], { openWorkItemCreate })
    render(<BoardView ws={ws} />)
    fireEvent.click(screen.getByRole('button', { name: 'New task in Ready' }))
    expect(openWorkItemCreate).toHaveBeenCalledWith('ready', '', null)
  })

  it('displays count / limit and does not warn when under the limit', async () => {
    const ws = await createMockWorkspace([makeWorkItem('1', 'active')], {
      wipLimits: { active: 3 }
    })
    render(<BoardView ws={ws} />)

    const control = screen.getByRole('button', { name: /1 of 3/ })
    expect(control).toHaveTextContent('1 / 3')
    expect(control.className).not.toContain('is-over')
  })

  it('shows a non-blocking warning when the column exceeds its WIP limit, without preventing drop', async () => {
    const items = [
      makeWorkItem('1', 'active'),
      makeWorkItem('2', 'active'),
      makeWorkItem('3', 'active')
    ]
    const dropWorkItem = vi.fn()
    const ws = await createMockWorkspace(items, { wipLimits: { active: 2 }, dropWorkItem })
    render(<BoardView ws={ws} />)

    const control = screen.getByRole('button', { name: /3 of 2 tasks, over WIP limit/ })
    expect(control).toHaveTextContent('3 / 2')
    expect(control.className).toContain('is-over')

    // Dragging another item onto the already-over-limit column is still allowed (advisory only).
    const dataTransfer = { getData: () => 'item-4', setData: vi.fn(), dropEffect: '' }
    fireEvent.drop(column('active'), { dataTransfer })

    expect(dropWorkItem).toHaveBeenCalledWith('active', undefined, 'item-4', items)
  })

  it('lets a user set a new WIP limit from the column header', async () => {
    const setColumnWipLimit = vi.fn()
    const ws = await createMockWorkspace([makeWorkItem('1', 'ready')], { setColumnWipLimit })
    render(<BoardView ws={ws} />)

    fireEvent.click(screen.getByRole('button', { name: /1.*click to edit WIP limit/ }))
    const input = screen.getByLabelText('WIP limit for Ready')
    fireEvent.change(input, { target: { value: '5' } })
    fireEvent.submit(input.closest('form')!)

    expect(setColumnWipLimit).toHaveBeenCalledWith('ready', 5)
  })

  it('lets a user clear an existing WIP limit', async () => {
    const setColumnWipLimit = vi.fn()
    const ws = await createMockWorkspace([makeWorkItem('1', 'ready')], {
      wipLimits: { ready: 4 },
      setColumnWipLimit
    })
    render(<BoardView ws={ws} />)

    fireEvent.click(screen.getByRole('button', { name: /1 of 4/ }))
    const input = screen.getByLabelText('WIP limit for Ready')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.submit(input.closest('form')!)

    expect(setColumnWipLimit).toHaveBeenCalledWith('ready', null)
  })

  it('marks the drop target and draws a line where the dragged card will land', async () => {
    const items = [
      makeWorkItem('a', 'ready'),
      makeWorkItem('b', 'ready'),
      makeWorkItem('c', 'backlog')
    ]
    const ws = await createMockWorkspace(items, {
      draggingWorkItemId: 'c',
      dragOverStatus: 'ready',
      dragOverLaneId: null,
      dragOverIndex: 1
    })
    render(<BoardView ws={ws} />)

    const ready = column('ready')
    expect(ready.className).toContain('is-drop-target')
    // Manual order: the line is where the pointer is, here between the two cards.
    const line = ready.querySelector('.board-column__drop-line')!
    expect(line).toBeTruthy()
    expect(line.nextElementSibling?.getAttribute('aria-label')).toBe('Item b')
    expect(column('backlog').querySelector('.board-column__drop-line')).toBeNull()
  })
})

describe('BoardView toolbar', () => {
  it('keeps grouping, sorting and Hide done under View options', async () => {
    const setBoardGroupBy = vi.fn()
    const setBoardHideDone = vi.fn()
    const ws = await createMockWorkspace([], { setBoardGroupBy, setBoardHideDone })
    render(withFeatures(<BoardView ws={ws} />))

    expect(screen.queryByLabelText('Group by')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'View options' }))
    const options = screen.getByRole('dialog', { name: 'View options' })
    fireEvent.change(within(options).getByLabelText('Group by'), { target: { value: 'goal' } })
    fireEvent.click(within(options).getByLabelText('Hide done'))
    expect(setBoardGroupBy).toHaveBeenCalledWith('goal')
    expect(setBoardHideDone).toHaveBeenCalledWith(true)
    // One button for the view (MOP-35): no separate Columns or Customise board button.
    expect(within(options).getByRole('group', { name: 'Columns on this board' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Columns' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Customise board' })).toBeNull()
  })

  /** Ctrl and a click selects a card: the boxes are off by default. */
  const ctrlClick = (title: string) =>
    fireEvent.click(screen.getByRole('heading', { name: title }), { ctrlKey: true })

  it('shows no selection boxes until the toolbar asks for them', async () => {
    const setBoardShowBoxes = vi.fn()
    const ws = await createMockWorkspace([makeWorkItem('1', 'ready')], { setBoardShowBoxes })
    const { rerender } = render(withFeatures(<BoardView ws={ws} />))
    expect(screen.queryByRole('checkbox', { name: 'Select Item 1' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show selection boxes' }))
    expect(setBoardShowBoxes).toHaveBeenCalledWith(true)
    rerender(withFeatures(<BoardView ws={{ ...ws, boardShowBoxes: true }} />))
    expect(screen.getByRole('checkbox', { name: 'Select Item 1' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Show selection boxes' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  it('lays the bulk bar over the toolbar while tasks are selected, so nothing moves', async () => {
    const bulkUpdateWorkItems = vi.fn(async () => {})
    const deleteWorkItems = vi.fn(async () => {})
    const ws = await createMockWorkspace(
      [makeWorkItem('1', 'ready'), makeWorkItem('2', 'backlog')],
      {
        bulkUpdateWorkItems,
        deleteWorkItems
      }
    )
    render(withFeatures(<BoardView ws={ws} />))

    const filters = screen.getByRole('toolbar', { name: 'Board filters' })
    ctrlClick('Item 1')
    ctrlClick('Item 2')

    // Still in its place, keeping the row's height, but out of reach.
    expect(filters.closest('.task-toolbar-row__filters')).toHaveAttribute('inert')
    expect(screen.getByRole('toolbar', { name: 'Bulk actions' }).closest('.task-toolbar-row')).toBe(
      filters.closest('.task-toolbar-row')
    )
    const bar = within(screen.getByRole('toolbar', { name: 'Bulk actions' }))
    expect(bar.getByText('2 selected')).toBeTruthy()

    fireEvent.change(bar.getByLabelText('Set priority'), { target: { value: 'high' } })
    expect(bulkUpdateWorkItems).toHaveBeenCalledWith(['1', '2'], { priority: 'high' })
  })

  it('moves the selection to the recycle bin, through the action that offers undo', async () => {
    const deleteWorkItems = vi.fn(async () => {})
    const ws = await createMockWorkspace([makeWorkItem('1', 'ready')], { deleteWorkItems })
    render(withFeatures(<BoardView ws={ws} />))

    ctrlClick('Item 1')
    fireEvent.click(screen.getByRole('button', { name: 'Move to recycle bin' }))
    expect(deleteWorkItems).toHaveBeenCalledWith([expect.objectContaining({ id: '1' })])
  })

  it('offers bulk queueing only while agents are on', async () => {
    const ws = await createMockWorkspace([makeWorkItem('1', 'ready')])
    const { unmount } = render(withFeatures(<BoardView ws={ws} />))
    ctrlClick('Item 1')
    expect(screen.queryByRole('button', { name: /for agent/ })).toBeNull()
    unmount()

    render(withFeatures(<BoardView ws={ws} />, true))
    ctrlClick('Item 1')
    expect(screen.getByRole('button', { name: 'Queue 1 for agent' })).toBeTruthy()
  })

  it('selects a whole column from its header', async () => {
    const ws = await createMockWorkspace([makeWorkItem('1', 'ready'), makeWorkItem('2', 'ready')])
    render(withFeatures(<BoardView ws={ws} />))
    fireEvent.click(screen.getByRole('button', { name: 'Select all in Ready' }))
    expect(screen.getByText('2 selected')).toBeTruthy()
  })
})

describe('Customise board', () => {
  const inApp = (ui: ReactElement) => (
    <MemoryRouter>
      <ToastProvider>{withFeatures(ui)}</ToastProvider>
    </MemoryRouter>
  )

  it('opens beside the board with its toolbar, views, options and columns', async () => {
    const setBoardGroupBy = vi.fn()
    const base = await createMockWorkspace([makeWorkItem('1', 'ready')])
    const saveAs = vi.fn(async () => {})
    const resetDefault = vi.fn(async () => {})
    const setAsAllProjectsDefault = vi.fn(async () => {})
    const ws = withWorkspace(base, {
      setBoardGroupBy,
      boardView: {
        ...base.boardView,
        defaultSource: 'project',
        saveAs,
        resetDefault,
        setAsAllProjectsDefault
      }
    })
    render(inApp(<BoardView ws={ws} />))

    // One View options button (MOP-35): Customise board… is at its foot.
    fireEvent.click(screen.getByRole('button', { name: 'View options' }))
    fireEvent.click(screen.getByRole('button', { name: 'Customise board…' }))
    const panel = screen.getByRole('dialog', { name: 'Customise board' })
    // The toolbar as it stands, without a second Views menu.
    expect(within(panel).getByRole('searchbox', { name: 'Search tasks' })).toBeTruthy()
    expect(within(panel).queryByRole('button', { name: /^Views:/ })).toBeNull()

    // Views: this project's default, all projects', and what to do with what is showing.
    expect(within(panel).getByText('Customised for this project')).toBeTruthy()
    fireEvent.click(within(panel).getByRole('button', { name: 'Set as default for all projects' }))
    expect(setAsAllProjectsDefault).toHaveBeenCalled()
    fireEvent.click(within(panel).getByRole('button', { name: 'Reset to default' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Reset' }))
    await vi.waitFor(() => expect(resetDefault).toHaveBeenCalled())

    fireEvent.click(within(panel).getByRole('button', { name: 'Save view…' }))
    const naming = screen.getByRole('dialog', { name: 'Save view' })
    fireEvent.change(within(naming).getByLabelText('Name'), { target: { value: 'Everyone' } })
    fireEvent.click(within(naming).getByLabelText('All projects'))
    fireEvent.click(within(naming).getByRole('button', { name: 'Save' }))
    await vi.waitFor(() => expect(saveAs).toHaveBeenCalledWith('Everyone', 'allProjects'))

    // The same options form as View options, writing the same view state.
    fireEvent.click(within(panel).getByRole('tab', { name: 'View options' }))
    fireEvent.change(within(panel).getByLabelText('Group by'), { target: { value: 'goal' } })
    expect(setBoardGroupBy).toHaveBeenCalledWith('goal')

    fireEvent.click(within(panel).getByRole('tab', { name: 'Columns' }))
    expect(within(panel).getByText('Work-in-progress limits')).toBeTruthy()
  })

  it('opens from a link (?customise=1)', async () => {
    const ws = await createMockWorkspace([])
    render(
      <MemoryRouter initialEntries={['/projects/proj-1/board?customise=1']}>
        <ToastProvider>{withFeatures(<BoardView ws={ws} />)}</ToastProvider>
      </MemoryRouter>
    )
    expect(await screen.findByRole('dialog', { name: 'Customise board' })).toBeTruthy()
  })
})
