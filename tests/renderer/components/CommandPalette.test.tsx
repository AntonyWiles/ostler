// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type {
  PlanningSubproject,
  RendererProject,
  SavedView,
  SearchResult
} from '@shared/ostler-api'
import { CommandPalette, Highlight } from '@renderer/components/CommandPalette'
import { installOstlerApi } from '../fixtures/ostler-api'

const projects = [
  {
    id: 'alpha',
    name: 'Alpha launch',
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
]

vi.mock('@renderer/context/OstlerContext', () => ({
  useOstler: () => ({ projects })
}))

function Where() {
  const location = useLocation()
  return (
    <>
      <span data-testid="where">{location.pathname}</span>
      <span data-testid="search">{location.search}</span>
    </>
  )
}

const SUBPROJECTS: PlanningSubproject[] = [
  {
    id: 's1',
    projectId: 'alpha',
    name: 'Website',
    archivedAt: null
  } as PlanningSubproject,
  {
    id: 's2',
    projectId: 'alpha',
    name: 'Retired stream',
    archivedAt: 5
  } as PlanningSubproject
]

const TASK_IN_WORKSTREAM: SearchResult = {
  type: 'task',
  id: 't9',
  projectId: 'alpha',
  title: 'Tidy footer',
  snippet: [],
  workItemId: 't9',
  key: 'ALP-9',
  subprojectId: 's1',
  score: -3
}

const FOUND: SearchResult[] = [
  {
    type: 'comment',
    id: 'c1',
    projectId: 'alpha',
    title: 'Homepage',
    snippet: [
      { text: 'Where did we decide the ', match: false },
      { text: 'colour', match: true },
      { text: ' scheme?', match: false }
    ],
    workItemId: 't1',
    score: -2
  },
  {
    type: 'decision',
    id: 'd1',
    projectId: 'alpha',
    title: 'Brand',
    snippet: [{ text: 'colour', match: true }],
    workItemId: null,
    score: -1
  },
  {
    type: 'library',
    id: 'l1',
    projectId: 'alpha',
    title: 'Style guide',
    snippet: [{ text: 'colour', match: true }],
    workItemId: null,
    score: -1
  }
]

const VIEWS: SavedView[] = [
  {
    id: 'v1',
    projectId: 'alpha',
    name: 'Overdue',
    viewType: 'list',
    config: { filter: { match: 'all', conditions: [] }, query: '', options: {} },
    position: 0,
    isDefault: false,
    createdAt: 1,
    updatedAt: 1
  }
]

function renderPalette(onOpenChange = vi.fn(), found: SearchResult[] = FOUND) {
  const search = vi.fn(async (query: string) => ({
    ok: true as const,
    value: query.startsWith('col') ? found : []
  }))
  installOstlerApi({
    search,
    listSubprojects: async () => ({ ok: true, value: SUBPROJECTS }),
    listSavedViews: async () => ({ ok: true, value: VIEWS })
  })
  render(
    <MemoryRouter initialEntries={['/home']}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <CommandPalette open onOpenChange={onOpenChange} onNewProject={vi.fn()} />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  )
  return onOpenChange
}

describe('CommandPalette', () => {
  // jsdom has no layout, so no scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn()

  it('is a dialog with a search field and a grouped list of results', () => {
    renderPalette()
    const dialog = screen.getByRole('dialog', { name: 'Command palette' })
    expect(within(dialog).getByRole('combobox', { name: 'Command palette search' })).toBeTruthy()
    const list = within(dialog).getByRole('listbox', { name: 'Results' })
    expect(within(list).getByText('Go to')).toBeTruthy()
    expect(within(list).getByRole('option', { name: /Alpha launch/ })).toBeTruthy()
  })

  it('shows the shortcut for an entry that has one', () => {
    renderPalette()
    const settings = screen.getByRole('option', { name: /^Settings Ctrl plus ,$/ })
    expect(settings.querySelector('kbd')).not.toBeNull()
  })

  it('marks what matched the search and opens the result on Enter', () => {
    const onOpenChange = renderPalette()
    const search = screen.getByRole('combobox', { name: 'Command palette search' })
    fireEvent.change(search, { target: { value: 'alpha' } })

    const option = screen.getAllByRole('option')[0]
    expect(option.querySelector('mark')?.textContent).toBe('Alpha')

    fireEvent.keyDown(search, { key: 'Enter' })
    expect(screen.getByTestId('where').textContent).toBe('/projects/alpha')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('moves the active result with the arrow keys', () => {
    renderPalette()
    const search = screen.getByRole('combobox', { name: 'Command palette search' })
    const first = screen.getAllByRole('option')[0]
    expect(first.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    expect(screen.getAllByRole('option')[1].getAttribute('aria-selected')).toBe('true')
    expect(search.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[1].id)
  })

  it('finds content by its words, grouped by type with the matches marked, and opens it in place', async () => {
    const onOpenChange = renderPalette()
    const search = screen.getByRole('combobox', { name: 'Command palette search' })
    fireEvent.change(search, { target: { value: 'colour' } })
    const comment = await screen.findByRole('option', { name: /Comment on Homepage/ })
    const list = screen.getByRole('listbox', { name: 'Results' })
    for (const group of ['Comments', 'Decisions', 'Library', 'Search'])
      expect(within(list).getByText(group)).toBeTruthy()
    expect(comment.querySelector('.palette__snippet mark')?.textContent).toBe('colour')
    expect(within(list).getByRole('option', { name: /See all results for/ })).toBeTruthy()

    // From the keyboard: down to the comment, Enter opens its task's drawer.
    const options = screen.getAllByRole('option')
    const index = options.indexOf(comment)
    for (let step = 0; step < index; step++) fireEvent.keyDown(search, { key: 'ArrowDown' })
    expect(comment.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(screen.getByTestId('where').textContent).toBe('/projects/alpha/tasks/t1')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('opens the search page with "See all results"', async () => {
    renderPalette()
    const search = screen.getByRole('combobox', { name: 'Command palette search' })
    fireEvent.change(search, { target: { value: 'colour' } })
    fireEvent.click(await screen.findByRole('option', { name: /See all results for/ }))
    expect(screen.getByTestId('where').textContent).toBe('/search')
  })

  it('offers saved views as "Open view: name · project"', async () => {
    renderPalette()
    const search = screen.getByRole('combobox', { name: 'Command palette search' })
    fireEvent.change(search, { target: { value: 'open view' } })
    const option = await screen.findByRole('option', { name: /Open view.*Overdue · Alpha launch/ })
    fireEvent.click(option)
    await waitFor(() =>
      expect(screen.getByTestId('where').textContent).toBe('/projects/alpha/list')
    )
  })

  it('lists workstreams below the projects and opens one scoped to it', async () => {
    renderPalette()
    const search = screen.getByRole('combobox', { name: 'Command palette search' })
    fireEvent.change(search, { target: { value: 'website' } })
    const option = await screen.findByRole('option', { name: /Website/ })
    expect(option.textContent).toContain('Alpha launch')
    expect(screen.queryByRole('option', { name: /Retired stream/ })).toBeNull()
    fireEvent.click(option)
    await waitFor(() => expect(screen.getByTestId('search').textContent).toBe('?sub=s1'))
    expect(screen.getByTestId('where').textContent).toBe('/projects/alpha')
  })

  it('names a task result by its project and workstream', async () => {
    renderPalette(vi.fn(), [TASK_IN_WORKSTREAM])
    const search = screen.getByRole('combobox', { name: 'Command palette search' })
    fireEvent.change(search, { target: { value: 'col' } })
    const option = await screen.findByRole('option', { name: /Tidy footer/ })
    await waitFor(() => expect(option.textContent).toContain('Alpha launch › Website'))
  })
})

describe('Highlight', () => {
  it('marks every case-insensitive match', () => {
    const { container } = render(<Highlight text="Board and board" needle="BOARD" />)
    expect([...container.querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual([
      'Board',
      'board'
    ])
  })

  it('marks the right letters when lowercasing changes a character’s length', () => {
    const { container } = render(<Highlight text="İstanbul plan" needle="plan" />)
    expect([...container.querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual([
      'plan'
    ])
    expect(container.textContent).toBe('İstanbul plan')
  })
})
