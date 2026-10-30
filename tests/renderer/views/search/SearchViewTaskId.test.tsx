// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { RendererProject, SearchResult } from '@shared/ostler-api'
import { SearchView } from '@renderer/views/search/SearchView'
import { installOstlerApi } from '../../fixtures/ostler-api'

/** Finding a task by its ID (N9.8a) in Search: shown first, with its ID, and opened on Enter. */

const projects = [
  { id: 'shop', name: 'Shop', color: '#3b82f6', enabled: true, taskPrefix: 'SHOP' }
] as RendererProject[]

vi.mock('@renderer/context/OstlerContext', () => ({
  useOstler: () => ({ projects })
}))

function Where() {
  const location = useLocation()
  return <span data-testid="where">{location.pathname + location.search}</span>
}

const RESULTS: SearchResult[] = [
  {
    type: 'task',
    id: 't12',
    projectId: 'shop',
    title: 'Fix the login',
    snippet: [],
    workItemId: 't12',
    key: 'SHOP-12',
    score: Number.NEGATIVE_INFINITY
  },
  {
    type: 'task',
    id: 't3',
    projectId: 'shop',
    title: 'Shop 12 banner',
    snippet: [],
    workItemId: 't3',
    key: 'SHOP-3',
    score: -2
  }
]

describe('SearchView and task IDs', () => {
  Element.prototype.scrollIntoView = vi.fn()

  it('shows the task with that ID first, with its ID, and opens it on Enter', async () => {
    installOstlerApi({ search: async () => ({ ok: true, value: RESULTS }) })
    render(
      <MemoryRouter initialEntries={['/search?q=shop%2012']}>
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
    const list = await screen.findByRole('listbox', { name: 'Results' })
    const [first] = within(list).getAllByRole('option')
    expect(first).toHaveTextContent('Fix the login')
    expect(first).toHaveTextContent('SHOP-12')
    expect(first.getAttribute('aria-label')).toContain('SHOP-12')
    fireEvent.keyDown(screen.getAllByRole('combobox')[0], { key: 'Enter' })
    expect(screen.getByTestId('where').textContent).toContain('t12')
  })
})
