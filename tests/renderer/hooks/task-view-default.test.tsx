// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { SavedView } from '@shared/ostler-api'
import { useTaskView } from '@renderer/hooks/useTaskFilters'
import { ToastProvider } from '@renderer/ui'
import { installOstlerApi } from '../fixtures/ostler-api'
import { fakeSavedViews } from '../fixtures/saved-views'

const named: SavedView = {
  id: 'v1',
  projectId: 'p1',
  name: 'Open releases',
  viewType: 'list',
  config: {
    filter: { match: 'all', conditions: [] },
    query: 'release',
    options: { hideDone: true }
  },
  position: 0,
  isDefault: false,
  createdAt: 1,
  updatedAt: 1
}

function renderTaskView(initial: SavedView[] = [named]) {
  const saved = fakeSavedViews(initial)
  installOstlerApi(saved.api)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter>
      <ToastProvider>{children}</ToastProvider>
    </MemoryRouter>
  )
  const hook = renderHook(() => useTaskView('p1', 'list', { normalize: () => ({}) }), { wrapper })
  return { saved, result: hook.result }
}

describe('the default view after Set as default', () => {
  it('keeps no search text and still writes a change back to an earlier state', async () => {
    const { saved, result } = renderTaskView()
    await waitFor(() => expect(result.current.loaded).toBe(true))
    act(() => result.current.setHideDone(false))
    act(() => result.current.selectView('v1'))
    expect(result.current.query).toBe('release')
    await act(() => result.current.setAsDefault())
    expect(saved.defaultOf('p1', 'list')?.config.query).toBe('')
    act(() => result.current.selectView(null))
    expect(result.current.hideDone).toBe(true)
    act(() => result.current.setHideDone(false))
    await waitFor(() => expect(saved.defaultOf('p1', 'list')?.config.options.hideDone).toBe(false))
  })
})

const allProjectsDefault: SavedView = {
  ...named,
  id: 'shared-default',
  projectId: null,
  name: 'Default view',
  config: { filter: { match: 'all', conditions: [] }, query: '', options: { hideDone: true } },
  isDefault: true
}
const sharedView: SavedView = { ...named, id: 'shared', projectId: null, name: 'Everyone' }

describe('views and a default for all projects', () => {
  it('follows the all-projects default until the project keeps its own, and resets to it', async () => {
    const { saved, result } = renderTaskView([named, allProjectsDefault, sharedView])
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.defaultSource).toBe('allProjects')
    expect(result.current.hideDone).toBe(true)
    expect(result.current.views.map((view) => view.name)).toEqual(['Open releases', 'Everyone'])

    act(() => result.current.setHideDone(false))
    await waitFor(() => expect(saved.defaultOf('p1', 'list')).toBeDefined())
    expect(result.current.defaultSource).toBe('project')

    await act(() => result.current.resetDefault())
    expect(saved.defaultOf('p1', 'list')).toBeUndefined()
    expect(result.current.defaultSource).toBe('allProjects')
    expect(result.current.hideDone).toBe(true)

    await act(() => result.current.resetAllProjectsDefault())
    expect(saved.defaultOf(null, 'list')).toBeUndefined()
    expect(result.current.defaultSource).toBe('standard')
    expect(result.current.hideDone).toBe(false)
  })

  it('saves a view for all projects, and reverts a changed view', async () => {
    const { saved, result } = renderTaskView()
    await waitFor(() => expect(result.current.loaded).toBe(true))
    await act(() => result.current.saveAs('Everyone', 'allProjects'))
    expect(saved.views.find((view) => view.name === 'Everyone')?.projectId).toBeNull()
    expect(result.current.activeView?.name).toBe('Everyone')

    act(() => result.current.selectView('v1'))
    act(() => result.current.setQuery('other'))
    expect(result.current.isChanged).toBe(true)
    act(() => result.current.revert())
    expect(result.current.query).toBe('release')
    expect(result.current.isChanged).toBe(false)

    await act(() => result.current.setAsAllProjectsDefault())
    expect(saved.defaultOf(null, 'list')?.config.query).toBe('')
    expect(result.current.hasAllProjectsDefault).toBe(true)
  })
})
