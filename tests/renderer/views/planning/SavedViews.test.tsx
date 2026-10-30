// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PlanningWorkItem, SavedView } from '@shared/ostler-api'
import { usePlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import { BoardView } from '@renderer/views/planning/BoardView'
import { ListView } from '@renderer/views/planning/list/ListView'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { StaticPeopleProvider } from '@renderer/context/PeopleContext'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { __resetDismissableStackForTests } from '@renderer/hooks/useDismissable'
import { makeWorkItem } from '../../fixtures/planning-records'
import { emptyPlanningReads } from '../../fixtures/planning-workspace'
import { installOstlerApi } from '../../fixtures/ostler-api'
import { fakeSavedViews } from '../../fixtures/saved-views'
import { withElementSize } from '../../fixtures/layout'

const ITEMS: PlanningWorkItem[] = [
  makeWorkItem('a', { title: 'Release notes', priority: 'high', status: 'ready' }),
  makeWorkItem('b', { title: 'Fix the footer', priority: 'low', status: 'ready' }),
  makeWorkItem('c', { title: 'Release party', priority: 'critical', status: 'backlog' })
]

function Live({ view }: { view: 'board' | 'list' }) {
  const ws = usePlanningWorkspace('p1', () => {})
  return view === 'board' ? <BoardView ws={ws} /> : <ListView ws={ws} />
}

function renderView(view: 'board' | 'list', initial: SavedView[] = [], entry = '/') {
  const saved = fakeSavedViews(initial)
  installOstlerApi({
    ...emptyPlanningReads(),
    ...saved.api,
    getPlanningWorkItems: async () => ({ ok: true, value: ITEMS })
  })
  const result = render(
    <MemoryRouter initialEntries={[entry]}>
      <ToastProvider>
        <ConfirmProvider>
          <StaticFeaturesProvider value={{ agents: false, ai: false }}>
            <StaticPeopleProvider people={[]}>
              <Live view={view} />
            </StaticPeopleProvider>
          </StaticFeaturesProvider>
        </ConfirmProvider>
      </ToastProvider>
    </MemoryRouter>
  )
  return { saved, ...result }
}

const count = () => screen.getByText(/ of 3 tasks$/).textContent
const views = () => screen.getByRole('button', { name: /^Views: / })
const choose = (name: string | RegExp) => {
  fireEvent.click(views())
  // A saved view is one of the views' radios; the rest are actions.
  fireEvent.click(
    screen.queryByRole('menuitem', { name }) ?? screen.getByRole('menuitemradio', { name })
  )
}

async function addPriorityFilter() {
  fireEvent.click(screen.getByRole('button', { name: 'Add filter' }))
  fireEvent.click(screen.getByRole('button', { name: 'Priority' }))
  // The first value offered is High; add Critical too.
  const editor = screen.getByRole('dialog', { name: 'Edit filter: Priority' })
  fireEvent.click(within(editor).getByRole('checkbox', { name: 'Critical' }))
  fireEvent.click(within(editor).getByRole('button', { name: 'Done' }))
}

describe('saved views', () => {
  withElementSize(1200, 800)
  beforeEach(() => localStorage.clear())
  afterEach(() => __resetDismissableStackForTests())

  it('builds a filter, saves it as a view, and reapplies it after the filter is cleared', async () => {
    const { saved } = renderView('board')
    await screen.findByRole('button', { name: /^Views: Default view/ })
    await waitFor(() => expect(count()).toBe('3 of 3 tasks'))
    await addPriorityFilter()
    expect(count()).toBe('2 of 3 tasks')

    choose('Save view…')
    const dialog = screen.getByRole('dialog', { name: 'Save view' })
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Urgent' } })
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    })
    expect(views()).toHaveAccessibleName('Views: Urgent')
    expect(saved.views.find((view) => view.name === 'Urgent')?.config.filter).toEqual({
      match: 'all',
      conditions: [{ field: 'priority', op: 'is', value: ['high', 'critical'] }]
    })

    // Changed: the view says so and offers Update.
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(count()).toBe('3 of 3 tasks')
    expect(views()).toHaveAccessibleName('Views: Urgent, changed')
    choose('Urgent')
    expect(count()).toBe('2 of 3 tasks')

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tasks' }), {
      target: { value: 'party' }
    })
    expect(count()).toBe('1 of 3 tasks')
    choose(/^Update/)
    await waitFor(() =>
      expect(saved.views.find((view) => view.name === 'Urgent')?.config.query).toBe('party')
    )
    // The view takes the saved config once the save's answer is back, a moment after the
    // fake API recorded it: wait for that, not for the recording.
    await waitFor(() => expect(views()).toHaveAccessibleName('Views: Urgent'))
  })

  it('renames, deletes with undo, and sets a view as the default', async () => {
    const urgent: SavedView = {
      id: 'v-urgent',
      projectId: 'p1',
      name: 'Urgent',
      viewType: 'list',
      config: {
        filter: {
          match: 'all',
          conditions: [{ field: 'priority', op: 'is', value: ['critical'] }]
        },
        query: '',
        options: {}
      },
      position: 0,
      isDefault: false,
      createdAt: 1,
      updatedAt: 1
    }
    const { saved } = renderView('list', [urgent])
    await screen.findByRole('button', { name: /^Views: Default view/ })
    choose('Urgent')
    await waitFor(() => expect(count()).toBe('1 of 3 tasks'))

    choose('Rename…')
    const dialog = screen.getByRole('dialog', { name: 'Rename view' })
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'On fire' } })
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Rename' }))
    })
    expect(views()).toHaveAccessibleName('Views: On fire')

    choose('Set as default for this project')
    await waitFor(() =>
      expect(saved.defaultOf('p1', 'list')?.config.filter.conditions).toHaveLength(1)
    )

    choose(/^Delete/)
    await waitFor(() => expect(views()).toHaveAccessibleName('Views: Default view'))
    expect(saved.views.some((view) => view.id === 'v-urgent')).toBe(false)
    // The default now holds the view's filter.
    expect(count()).toBe('1 of 3 tasks')
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    })
    await waitFor(() => expect(saved.views.some((view) => view.id === 'v-urgent')).toBe(true))
    fireEvent.click(views())
    expect(screen.getByRole('menuitemradio', { name: 'On fire' })).toBeTruthy()
  })

  it('opens the view named in the address (the palette\'s "Open view")', async () => {
    const urgent: SavedView = {
      id: 'v-urgent',
      projectId: 'p1',
      name: 'Release work',
      viewType: 'board',
      config: { filter: { match: 'all', conditions: [] }, query: 'release', options: {} },
      position: 0,
      isDefault: false,
      createdAt: 1,
      updatedAt: 1
    }
    renderView('board', [urgent], '/projects/p1/board?view=v-urgent')
    await waitFor(() => expect(views()).toHaveAccessibleName('Views: Release work'))
    expect(count()).toBe('2 of 3 tasks')
  })

  it('gives the same tasks for the same filter on the Board and in the List', async () => {
    const config = {
      filter: {
        match: 'any' as const,
        conditions: [
          { field: 'priority' as const, op: 'is' as const, value: ['low'] },
          { field: 'text' as const, op: 'contains' as const, value: 'party' }
        ]
      },
      query: '',
      options: {}
    }
    const asDefault = (viewType: 'board' | 'list'): SavedView => ({
      id: `d-${viewType}`,
      projectId: 'p1',
      name: 'Default view',
      viewType,
      config,
      position: 0,
      isDefault: true,
      createdAt: 1,
      updatedAt: 1
    })
    const board = renderView('board', [asDefault('board')])
    await waitFor(() => expect(count()).toBe('2 of 3 tasks'))
    board.unmount()
    renderView('list', [asDefault('list')])
    await waitFor(() => expect(count()).toBe('2 of 3 tasks'))
    expect(screen.getByText('Fix the footer')).toBeTruthy()
    expect(screen.getByText('Release party')).toBeTruthy()
  })
})
