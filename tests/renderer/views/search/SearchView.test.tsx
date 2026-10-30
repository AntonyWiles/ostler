// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { RendererProject, SearchOptions, SearchResult } from '@shared/ostler-api'
import { SearchView } from '@renderer/views/search/SearchView'
import { installOstlerApi } from '../../fixtures/ostler-api'

const projects = [
  { id: 'alpha', name: 'Alpha launch', color: '#3b82f6', enabled: true },
  { id: 'beta', name: 'Beta', color: '#ec4899', enabled: true }
] as RendererProject[]

vi.mock('@renderer/context/OstlerContext', () => ({
  useOstler: () => ({ projects })
}))

const RESULTS: SearchResult[] = [
  {
    type: 'decision',
    id: 'd1',
    projectId: 'alpha',
    title: 'Brand colours',
    snippet: [
      { text: 'We chose the teal ', match: false },
      { text: 'colour', match: true },
      { text: ' scheme', match: false }
    ],
    workItemId: null,
    score: -11
  },
  {
    type: 'comment',
    id: 'c1',
    projectId: 'beta',
    title: 'Homepage',
    snippet: [{ text: 'colour', match: true }],
    workItemId: 't1',
    score: -1
  },
  {
    type: 'library',
    id: 'l1',
    projectId: 'alpha',
    title: 'Venue pack',
    snippet: [
      { text: '…the hall in ', match: false },
      { text: 'colour', match: true },
      { text: ' holds 240…', match: false }
    ],
    workItemId: null,
    location: { kind: 'page', label: '7' },
    score: -0.5
  },
  {
    type: 'library',
    id: 'l2',
    projectId: 'alpha',
    title: 'Budget',
    snippet: [{ text: 'colour', match: true }],
    workItemId: null,
    location: { kind: 'sheet', label: 'Costs' },
    score: -0.4
  }
]

function Where() {
  const location = useLocation()
  return <span data-testid="where">{location.pathname + location.search}</span>
}

function renderSearch(entry: string) {
  const search = vi.fn(async (_query: string, _options?: SearchOptions) => ({
    ok: true as const,
    value: RESULTS
  }))
  installOstlerApi({ search })
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <SearchView />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  )
  return search
}

describe('SearchView', () => {
  Element.prototype.scrollIntoView = vi.fn()

  it('lists results with their type, project and marked snippet', async () => {
    const search = renderSearch('/search?q=colour')
    const list = await screen.findByRole('listbox', { name: 'Results' })
    const decision = within(list).getByRole('option', { name: /^Decision: Brand colours/ })
    expect(decision.querySelector('mark')?.textContent).toBe('colour')
    expect(within(list).getByRole('option', { name: /^Comment: Homepage/ })).toHaveTextContent(
      'Comment on Homepage'
    )
    expect(search).toHaveBeenCalledWith('colour', {
      projectId: undefined,
      types: undefined,
      limit: 100
    })
  })

  it("shows a Library file's passage with its page, slide or sheet", async () => {
    renderSearch('/search?q=colour')
    const list = await screen.findByRole('listbox', { name: 'Results' })
    const pdfResult = within(list).getByRole('option', { name: /^Library item: Venue pack/ })
    expect(pdfResult.querySelector('mark')?.textContent).toBe('colour')
    expect(pdfResult).toHaveTextContent('page 7')
    expect(pdfResult.getAttribute('aria-label')).toContain('page 7')
    expect(within(list).getByRole('option', { name: /^Library item: Budget/ })).toHaveTextContent(
      'Sheet Costs'
    )
  })

  it('filters by type and project, keeping both in the address', async () => {
    const search = renderSearch('/search?q=colour')
    await screen.findByRole('listbox', { name: 'Results' })
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'comment' } })
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'beta' } })
    await waitFor(() =>
      expect(search).toHaveBeenLastCalledWith('colour', {
        projectId: 'beta',
        types: ['comment'],
        limit: 100
      })
    )
    expect(screen.getByTestId('where').textContent).toBe(
      '/search?q=colour&type=comment&project=beta'
    )
  })

  it('works from the keyboard: Down moves, Enter opens the result in place', async () => {
    renderSearch('/search?q=colour')
    const field = screen.getByRole('combobox', { name: 'Search for' })
    expect(document.activeElement).toBe(field)
    const list = await screen.findByRole('listbox', { name: 'Results' })
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    const second = within(list).getAllByRole('option')[1]
    expect(second.getAttribute('aria-selected')).toBe('true')
    expect(field.getAttribute('aria-activedescendant')).toBe(second.id)
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(screen.getByTestId('where').textContent).toBe('/projects/beta/tasks/t1')
  })

  it('opens a decision in its view', async () => {
    renderSearch('/search?q=colour')
    fireEvent.click(await screen.findByRole('option', { name: /^Decision: Brand colours/ }))
    expect(screen.getByTestId('where').textContent).toBe('/projects/alpha/decisions?decision=d1')
  })
})
