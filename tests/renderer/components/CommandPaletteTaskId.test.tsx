// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { RendererProject, SearchResult } from '@shared/ostler-api'
import { CommandPalette } from '@renderer/components/CommandPalette'
import { installOstlerApi } from '../fixtures/ostler-api'

/** Finding a task by its ID (N9.8a) in the command palette: first, and opened on Enter. */

// A project whose name matches what is typed, so its commands compete with the task.
const projects = [
  {
    id: 'shop',
    name: 'Shop 12 things',
    path: null,
    color: '#3b82f6',
    enabled: true,
    taskPrefix: 'SHOP'
  } as RendererProject
]

vi.mock('@renderer/context/OstlerContext', () => ({
  useOstler: () => ({ projects })
}))

function Where() {
  return <span data-testid="where">{useLocation().pathname + useLocation().search}</span>
}

const TASK: SearchResult = {
  type: 'task',
  id: 't12',
  projectId: 'shop',
  title: 'Fix the login',
  snippet: [],
  workItemId: 't12',
  key: 'SHOP-12',
  score: Number.NEGATIVE_INFINITY
}

describe('CommandPalette and task IDs', () => {
  Element.prototype.scrollIntoView = vi.fn()

  for (const typed of ['SHOP-12', 'shop-12', 'shop 12']) {
    it(`shows the task first for "${typed}" and opens it on Enter`, async () => {
      const search = vi.fn(async () => ({ ok: true as const, value: [TASK] }))
      installOstlerApi({ search, listSavedViews: async () => ({ ok: true, value: [] }) })
      const onOpenChange = vi.fn()
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
      const field = screen.getByRole('combobox', { name: 'Command palette search' })
      fireEvent.change(field, { target: { value: typed } })
      await waitFor(() => expect(search).toHaveBeenCalledWith(typed, expect.anything()))
      await waitFor(() =>
        expect(screen.getAllByRole('option')[0].textContent).toContain('Fix the login')
      )
      expect(screen.getAllByRole('option')[0].textContent).toContain('SHOP-12')
      fireEvent.keyDown(field, { key: 'Enter' })
      expect(screen.getByTestId('where').textContent).toContain('/projects/shop')
      expect(screen.getByTestId('where').textContent).toContain('t12')
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  }
})
