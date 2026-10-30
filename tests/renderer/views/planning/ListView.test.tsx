// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OstlerAPI, Person, PlanningWorkItem } from '@shared/ostler-api'
import { usePlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import { ListView } from '@renderer/views/planning/list/ListView'
import { BoardView } from '@renderer/views/planning/BoardView'
import { LIST_SETTINGS_KEY } from '@renderer/views/planning/list/list-settings'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { StaticPeopleProvider } from '@renderer/context/PeopleContext'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { __resetDismissableStackForTests } from '@renderer/hooks/useDismissable'
import { makeWorkItem } from '../../fixtures/planning-records'
import { emptyPlanningReads } from '../../fixtures/planning-workspace'
import { installOstlerApi } from '../../fixtures/ostler-api'
import { fakeSavedViews } from '../../fixtures/saved-views'
import { withElementSize } from '../../fixtures/layout'

const PEOPLE: Person[] = [
  {
    id: 'me',
    name: 'Jordan Reyes',
    initials: 'AW',
    color: '#3b82f6',
    isMe: true,
    archivedAt: null,
    weeklyCapacityHours: null,
    workingDays: [1, 2, 3, 4, 5],
    projectId: null,
    createdAt: 1,
    updatedAt: 1
  },
  {
    id: 'ada',
    name: 'Ada Lovelace',
    initials: 'AL',
    color: '#ec4899',
    isMe: false,
    archivedAt: null,
    weeklyCapacityHours: null,
    workingDays: [1, 2, 3, 4, 5],
    projectId: null,
    createdAt: 1,
    updatedAt: 1
  }
]

/** The real workspace hook against a fake API, live, so edits show as they would in the app. */
function Live({ view }: { view: 'list' | 'board' }) {
  const ws = usePlanningWorkspace('p1', () => {})
  return view === 'list' ? <ListView ws={ws} /> : <BoardView ws={ws} />
}

function renderView(
  items: PlanningWorkItem[],
  api: Partial<OstlerAPI> = {},
  view: 'list' | 'board' = 'list'
) {
  installOstlerApi({
    ...emptyPlanningReads(),
    getPlanningWorkItems: async () => ({ ok: true, value: items }),
    ...api
  })
  return render(
    <ToastProvider>
      <ConfirmProvider>
        <StaticFeaturesProvider value={{ agents: false, ai: false }}>
          <StaticPeopleProvider people={PEOPLE}>
            <Live view={view} />
          </StaticPeopleProvider>
        </StaticFeaturesProvider>
      </ConfirmProvider>
    </ToastProvider>
  )
}

/** Stores List settings for project p1, as an earlier session would have. */
function storeSettings(settings: object) {
  localStorage.setItem(
    LIST_SETTINGS_KEY,
    JSON.stringify({ version: 1, projects: { p1: settings } })
  )
}

const rowOf = (title: string) => screen.getByRole('row', { name: new RegExp(title) })
const cellIn = (title: string, column: string) =>
  within(rowOf(title)).getAllByRole('gridcell')[
    screen.getAllByRole('columnheader').findIndex((header) => header.textContent === column)
  ]
const press = (target: Element, key: string, init: Partial<KeyboardEventInit> = {}) =>
  act(() => {
    fireEvent.keyDown(target, { key, ...init })
  })
/** Group headers, and the rows under each, in order. */
const layout = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((row) =>
      row.hasAttribute('aria-expanded')
        ? `# ${row.textContent}`
        : (row.querySelector('.list-cell__title-text')?.textContent ??
          `+ ${row.textContent?.trim()}`)
    )

describe('ListView', () => {
  withElementSize(1200, 800)
  beforeEach(() => localStorage.clear())
  afterEach(() => {
    __resetDismissableStackForTests()
    vi.useRealTimers()
  })

  it('shows Title, Status, Assignee and Due by default', async () => {
    renderView([makeWorkItem('a', { title: 'Write brief', assigneeId: 'ada', status: 'ready' })])
    await screen.findByRole('grid', { name: 'Tasks' })
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      '',
      'Title',
      'Status',
      'Assignee',
      'Due'
    ])
    expect(cellIn('Write brief', 'Assignee')).toHaveTextContent('Ada Lovelace')
    expect(cellIn('Write brief', 'Status')).toHaveTextContent('Ready')
  })

  it('groups by due date into buckets, seen from a fixed today', async () => {
    // Wednesday 7 October 2026: this week runs to Sunday the 11th.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 7, 9, 30))
    storeSettings({ groupBy: 'due' })
    renderView([
      makeWorkItem('late', { title: 'Late one', targetDate: '2026-10-06' }),
      makeWorkItem('today', { title: 'Due today', targetDate: '2026-10-07' }),
      makeWorkItem('sun', { title: 'Due Sunday', targetDate: '2026-10-11' }),
      makeWorkItem('mon', { title: 'Due next Monday', targetDate: '2026-10-12' }),
      makeWorkItem('far', { title: 'Far off', targetDate: '2026-10-19', estimate: 3 }),
      makeWorkItem('none', { title: 'Someday' })
    ])
    await screen.findByRole('grid', { name: 'Tasks' })
    expect(layout()).toEqual([
      '# Overdue1',
      'Late one',
      '# Today1',
      'Due today',
      '+ Add task to Today',
      '# This week1',
      'Due Sunday',
      '+ Add task to This week',
      '# Next week1',
      'Due next Monday',
      '+ Add task to Next week',
      '# Later13 pts',
      'Far off',
      '+ Add task to Later',
      '# No date1',
      'Someday',
      '+ Add task to No date'
    ])
  })

  it('edits a status in place with one update call, and puts it back when the save is refused', async () => {
    const updatePlanningWorkItem = vi.fn(async () => ({
      ok: false as const,
      error: 'A task cannot be done while its checklist is open'
    }))
    renderView([makeWorkItem('a', { title: 'Write brief', status: 'ready' })], {
      updatePlanningWorkItem
    })
    await screen.findByRole('grid', { name: 'Tasks' })
    const status = cellIn('Write brief', 'Status')
    status.focus()
    press(status, 'Enter')
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Done' }))

    await screen.findByText('A task cannot be done while its checklist is open')
    expect(updatePlanningWorkItem).toHaveBeenCalledTimes(1)
    expect(updatePlanningWorkItem).toHaveBeenCalledWith('a', { status: 'done', columnId: null })
    expect(cellIn('Write brief', 'Status')).toHaveTextContent('Ready')
  })

  it('opens a cell picker with one click, and Ctrl with a click does not (MOP-8)', async () => {
    const updatePlanningWorkItem = vi.fn(async (id: string, patch: object) => ({
      ok: true as const,
      value: makeWorkItem(id, { title: 'Write brief', ...patch })
    }))
    renderView([makeWorkItem('a', { title: 'Write brief', status: 'ready' })], {
      updatePlanningWorkItem
    })
    await screen.findByRole('grid', { name: 'Tasks' })
    fireEvent.click(cellIn('Write brief', 'Status'))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'In progress' }))
    await waitFor(() => expect(cellIn('Write brief', 'Status')).toHaveTextContent('In progress'))
    expect(updatePlanningWorkItem).toHaveBeenCalledTimes(1)
    // Ctrl with a click selects, as before: no picker.
    fireEvent.click(cellIn('Write brief', 'Status'), { ctrlKey: true })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('shows a saved status edit at once', async () => {
    const updatePlanningWorkItem = vi.fn(async (id: string, patch: object) => ({
      ok: true as const,
      value: makeWorkItem(id, { title: 'Write brief', ...patch })
    }))
    renderView([makeWorkItem('a', { title: 'Write brief', status: 'ready' })], {
      updatePlanningWorkItem
    })
    await screen.findByRole('grid', { name: 'Tasks' })
    const status = cellIn('Write brief', 'Status')
    status.focus()
    press(status, 'Enter')
    fireEvent.click(await screen.findByRole('menuitem', { name: 'In progress' }))
    await waitFor(() => expect(cellIn('Write brief', 'Status')).toHaveTextContent('In progress'))
    expect(updatePlanningWorkItem).toHaveBeenCalledTimes(1)
  })

  it('shows a custom field as a column and edits it in place (R2.2)', async () => {
    const size = {
      id: 'f1',
      projectId: 'p1',
      name: 'Size',
      type: 'choice' as const,
      options: [
        { id: 'o1', name: 'Small', color: '#22c55e' },
        { id: 'o2', name: 'Large', color: '#ef4444' }
      ],
      position: 0,
      createdAt: 0
    }
    const updatePlanningWorkItem = vi.fn(async (id: string, patch: object) => ({
      ok: true as const,
      value: makeWorkItem(id, { title: 'Write brief', ...patch } as Partial<PlanningWorkItem>)
    }))
    renderView(
      [
        makeWorkItem('a', {
          title: 'Write brief',
          fieldValues: { f1: 'o1' }
        } as Partial<PlanningWorkItem>)
      ],
      { getPlanningFields: async () => ({ ok: true, value: [size] }), updatePlanningWorkItem }
    )
    await screen.findByRole('grid', { name: 'Tasks' })
    fireEvent.click(screen.getByRole('button', { name: 'Columns' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Size' }))
    await waitFor(() => expect(cellIn('Write brief', 'Size')).toHaveTextContent('Small'))

    const cell = cellIn('Write brief', 'Size')
    cell.focus()
    press(cell, 'Enter')
    const editor = await screen.findByRole('combobox', { name: 'Size' })
    fireEvent.change(editor, { target: { value: 'o2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(updatePlanningWorkItem).toHaveBeenCalledWith('a', { fieldValues: { f1: 'o2' } })
    )
    await waitFor(() => expect(cellIn('Write brief', 'Size')).toHaveTextContent('Large'))
  })

  it('edits the title with E, saving on Enter and keeping it on Esc', async () => {
    const updatePlanningWorkItem = vi.fn(async (id: string, patch: object) => ({
      ok: true as const,
      value: makeWorkItem(id, { title: 'Write brief', ...patch })
    }))
    renderView([makeWorkItem('a', { title: 'Write brief' })], { updatePlanningWorkItem })
    await screen.findByRole('grid', { name: 'Tasks' })
    const cell = cellIn('Write brief', 'Status')
    cell.focus()

    press(cell, 'e')
    let field = screen.getByRole('textbox', { name: 'Title' })
    fireEvent.change(field, { target: { value: 'Never mind' } })
    press(field, 'Escape')
    expect(screen.queryByRole('textbox', { name: 'Title' })).toBeNull()
    expect(updatePlanningWorkItem).not.toHaveBeenCalled()

    press(cellIn('Write brief', 'Title'), 'Enter')
    field = screen.getByRole('textbox', { name: 'Title' })
    fireEvent.change(field, { target: { value: 'Write the brief' } })
    press(field, 'Enter')
    await waitFor(() => expect(rowOf('Write the brief')).toBeInTheDocument())
    expect(updatePlanningWorkItem).toHaveBeenCalledWith('a', { title: 'Write the brief' })
  })

  it('adds a task at the end of a group with the group value filled in', async () => {
    storeSettings({ groupBy: 'status' })
    const createPlanningWorkItem = vi.fn(async (projectId: string, input: object) => ({
      ok: true as const,
      value: makeWorkItem('new', { title: 'Fresh task', status: 'ready', ...input })
    }))
    renderView([makeWorkItem('a', { title: 'Write brief', status: 'backlog' })], {
      createPlanningWorkItem
    })
    await screen.findByRole('grid', { name: 'Tasks' })
    fireEvent.click(screen.getByRole('button', { name: 'Add task to Ready' }))
    const field = screen.getByRole('textbox', { name: 'Add task to Ready' })
    fireEvent.change(field, { target: { value: 'Fresh task' } })
    press(field, 'Enter')

    await waitFor(() =>
      expect(createPlanningWorkItem).toHaveBeenCalledWith('p1', {
        status: 'ready',
        title: 'Fresh task'
      })
    )
    expect(await screen.findByRole('row', { name: /Fresh task/ })).toBeInTheDocument()
    // Still open for the next one.
    expect(screen.getByRole('textbox', { name: 'Add task to Ready' })).toHaveValue('')
  })

  it('opens the task in the drawer on Enter where there is nothing to edit, and Ctrl+Enter', async () => {
    storeSettings({
      columns: [
        { id: 'title', visible: true, width: null },
        { id: 'comments', visible: true, width: null }
      ]
    })
    renderView([
      makeWorkItem('a', { title: 'Write brief' }),
      makeWorkItem('b', { title: 'Book venue' })
    ])
    await screen.findByRole('grid', { name: 'Tasks' })
    const comments = cellIn('Write brief', 'Comments')
    comments.focus()
    press(comments, 'Enter')
    await waitFor(() => expect(rowOf('Write brief')).toHaveClass('is-active'))

    // Enter on the title edits it; Ctrl+Enter opens the task.
    const title = cellIn('Book venue', 'Title')
    title.focus()
    press(title, 'Enter', { ctrlKey: true })
    await waitFor(() => expect(rowOf('Book venue')).toHaveClass('is-active'))
    expect(screen.queryByRole('textbox', { name: 'Title' })).toBeNull()
  })

  it("remembers columns, sort and grouping per project in the project's default view", async () => {
    const saved = fakeSavedViews()
    renderView([makeWorkItem('a', { title: 'Write brief' })], saved.api)
    await screen.findByRole('grid', { name: 'Tasks' })
    // Let the default view load before changing it.
    await screen.findByRole('button', { name: /^Views: Default view/ })
    fireEvent.click(screen.getByRole('columnheader', { name: /^Title/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Columns' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Priority' }))
    await waitFor(() => {
      const options = saved.defaultOf('p1', 'list')?.config.options as {
        sort: unknown
        columns: { id: string }[]
      }
      expect(options.sort).toEqual([{ columnId: 'title', direction: 'asc' }])
      expect(options.columns.find((column) => column.id === 'priority')).toEqual({
        id: 'priority',
        visible: true,
        width: null
      })
    })
  })

  it('moves settings kept in localStorage before saved views into the default view, once', async () => {
    localStorage.setItem(
      LIST_SETTINGS_KEY,
      JSON.stringify({
        version: 1,
        projects: { p1: { groupBy: 'status' }, p2: { groupBy: 'due' } }
      })
    )
    const saved = fakeSavedViews()
    renderView([makeWorkItem('a', { title: 'Write brief', status: 'ready' })], saved.api)
    await waitFor(() =>
      expect(saved.defaultOf('p1', 'list')?.config.options).toMatchObject({ groupBy: 'status' })
    )
    // Only this project's entry leaves; another project's waits for its own first load.
    expect(JSON.parse(localStorage.getItem(LIST_SETTINGS_KEY)!).projects).toEqual({
      p2: { groupBy: 'due' }
    })
  })

  it('says there are no tasks yet, with a way to add one', async () => {
    renderView([])
    expect(await screen.findByText('No tasks yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New task' })).toBeInTheDocument()
  })
})

describe('ListView manual order (D31)', () => {
  withElementSize(1200, 800)
  beforeEach(() => localStorage.clear())
  afterEach(() => __resetDismissableStackForTests())

  const ITEMS = [
    makeWorkItem('c', { title: 'Third', status: 'ready', orderKey: 'c' }),
    makeWorkItem('a', { title: 'First', status: 'ready', orderKey: 'a' }),
    makeWorkItem('b', { title: 'Second', status: 'backlog', orderKey: 'b' })
  ]
  const moveApi = () => {
    const move = vi.fn(async (id: string) => ({
      ok: true as const,
      value: ITEMS.find((item) => item.id === id)!
    }))
    return { move, api: { movePlanningWorkItem: move } as Partial<OstlerAPI> }
  }
  const dataTransfer = (id: string) => ({ getData: () => id, setData: vi.fn(), dropEffect: '' })

  it('shows rows in the manual order, the Board own', async () => {
    renderView(ITEMS)
    await screen.findByRole('grid', { name: 'Tasks' })
    expect(layout().filter((line) => !line.startsWith('+'))).toEqual(['First', 'Second', 'Third'])
  })

  it('moves the focused row with Alt and Up or Down', async () => {
    const { move, api } = moveApi()
    renderView(ITEMS, api)
    await screen.findByRole('grid', { name: 'Tasks' })
    press(cellIn('First', 'Title'), 'ArrowDown', { altKey: true })
    await waitFor(() => expect(move).toHaveBeenCalledWith('a', { afterId: 'b' }))
    press(cellIn('Third', 'Title'), 'ArrowUp', { altKey: true })
    await waitFor(() => expect(move).toHaveBeenLastCalledWith('c', { beforeId: 'b' }))
  })

  it('takes a dragged row, and into another status group when grouped by status', async () => {
    const { move, api } = moveApi()
    storeSettings({ groupBy: 'status' })
    renderView(ITEMS, api)
    await screen.findByRole('grid', { name: 'Tasks' })
    const dragged = rowOf('Third')
    expect(dragged).toHaveAttribute('draggable', 'true')
    fireEvent.dragStart(dragged, { dataTransfer: dataTransfer('c') })
    fireEvent.dragOver(rowOf('Second'), { dataTransfer: dataTransfer('c') })
    fireEvent.drop(rowOf('Second'), { dataTransfer: dataTransfer('c') })
    await waitFor(() => expect(move).toHaveBeenCalledWith('c', { afterId: 'b', status: 'backlog' }))
  })

  it('offers neither while sorted by a column, and Manual order brings them back', async () => {
    const { move, api } = moveApi()
    storeSettings({ sort: [{ columnId: 'title', direction: 'asc' }] })
    renderView(ITEMS, api)
    await screen.findByRole('grid', { name: 'Tasks' })
    expect(rowOf('First')).not.toHaveAttribute('draggable', 'true')
    press(cellIn('First', 'Title'), 'ArrowDown', { altKey: true })
    expect(move).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'View options' }))
    fireEvent.change(screen.getByLabelText('Order'), { target: { value: 'manual' } })
    await waitFor(() => expect(rowOf('First')).toHaveAttribute('draggable', 'true'))
  })
})

describe('the shared bulk bar', () => {
  withElementSize(1200, 800)
  beforeEach(() => localStorage.clear())
  afterEach(() => __resetDismissableStackForTests())

  const items = () => [
    makeWorkItem('a', { title: 'Write brief', status: 'ready' }),
    makeWorkItem('b', { title: 'Book venue', status: 'ready' }),
    makeWorkItem('c', { title: 'Order food', status: 'ready' })
  ]

  /** Selects two tasks in a view, assigns them to Ada, and returns the update calls. */
  async function assignTwo(view: 'list' | 'board') {
    const updatePlanningWorkItem = vi.fn(async (id: string, patch: object) => ({
      ok: true as const,
      value: { ...items().find((item) => item.id === id)!, ...patch }
    }))
    const { unmount } = renderView(items(), { updatePlanningWorkItem }, view)
    // The Board selects with Ctrl and a click; its boxes are off by default.
    if (view === 'board') {
      fireEvent.click(await screen.findByRole('heading', { name: 'Write brief' }), {
        ctrlKey: true
      })
      fireEvent.click(screen.getByRole('heading', { name: 'Book venue' }), { ctrlKey: true })
    } else {
      fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Write brief' }))
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select Book venue' }))
    }
    const bar = within(screen.getByRole('toolbar', { name: 'Bulk actions' }))
    expect(bar.getByText('2 selected')).toBeInTheDocument()
    fireEvent.change(bar.getByLabelText('Assign to'), { target: { value: 'ada' } })
    await waitFor(() => expect(updatePlanningWorkItem).toHaveBeenCalledTimes(2))
    unmount()
    return updatePlanningWorkItem.mock.calls
  }

  it('does the same thing from the Board and the List', async () => {
    const fromBoard = await assignTwo('board')
    const fromList = await assignTwo('list')
    expect(fromList).toEqual(fromBoard)
    expect(fromList).toEqual([
      ['a', { assigneeId: 'ada' }],
      ['b', { assigneeId: 'ada' }]
    ])
  })
})
