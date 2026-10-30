// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RendererProject } from '@shared/ostler-api'
import { Sidebar } from '@renderer/components/Sidebar'
import { installOstlerApi } from '../fixtures/ostler-api'

function project(id: string, name: string, path: string | null = null): RendererProject {
  return {
    id,
    name,
    path,
    color: '#3b82f6',
    enabled: true,
    customIgnorePatterns: [],
    notes: '',
    tags: [],
    addedAt: 0,
    lastActivity: null,
    hasAutomationToken: false
  } as RendererProject
}

const refreshProjects = vi.fn(async () => {})
let projects = [project('a', 'Alpha'), project('b', 'Beta'), project('c', 'Gamma')]

vi.mock('@renderer/context/OstlerContext', () => ({
  useOstler: () => ({ projects, refreshProjects })
}))

function renderSidebar() {
  return render(
    <MemoryRouter initialEntries={['/home']}>
      <Sidebar
        collapsed={false}
        onToggleCollapsed={() => {}}
        onOpenPalette={() => {}}
        onNewProject={() => {}}
      />
    </MemoryRouter>
  )
}

const projectNames = () =>
  within(screen.getByRole('region', { name: 'Projects' }))
    .getAllByRole('link')
    .map((link) => link.textContent)

describe('Sidebar', () => {
  beforeEach(() => {
    projects = [project('a', 'Alpha'), project('b', 'Beta'), project('c', 'Gamma')]
    refreshProjects.mockClear()
  })

  it('moves a project with Alt+Up and saves the order through one reorder call', async () => {
    const reorderProjects = vi.fn(async (ids: string[]) => ({
      ok: true as const,
      value: ids.map((id) => projects.find((entry) => entry.id === id)!)
    }))
    installOstlerApi({ reorderProjects })
    renderSidebar()

    const beta = screen.getByRole('link', { name: 'Beta' })
    beta.focus()
    fireEvent.keyDown(beta, { key: 'ArrowUp', altKey: true })

    expect(projectNames()).toEqual(['Beta', 'Alpha', 'Gamma'])
    await waitFor(() => expect(reorderProjects).toHaveBeenCalledWith(['b', 'a', 'c']))
    expect(reorderProjects).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(refreshProjects).toHaveBeenCalled())
    // Focus stays on the moved project, so it can be moved again.
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Beta' }))
  })

  it('moves a project down with Alt+Down and ignores a move past the end', async () => {
    const reorderProjects = vi.fn(async () => ({ ok: true as const, value: projects }))
    installOstlerApi({ reorderProjects })
    renderSidebar()

    const gamma = screen.getByRole('link', { name: 'Gamma' })
    fireEvent.keyDown(gamma, { key: 'ArrowDown', altKey: true })
    expect(reorderProjects).not.toHaveBeenCalled()

    fireEvent.keyDown(screen.getByRole('link', { name: 'Alpha' }), {
      key: 'ArrowDown',
      altKey: true
    })
    await waitFor(() => expect(reorderProjects).toHaveBeenCalledWith(['b', 'a', 'c']))
  })

  it('moves a project from its menu, without dragging (WCAG 2.5.7)', async () => {
    const reorderProjects = vi.fn(async () => ({ ok: true as const, value: projects }))
    installOstlerApi({ reorderProjects })
    renderSidebar()
    fireEvent.contextMenu(screen.getByRole('link', { name: 'Gamma' }))
    expect(screen.getByRole('menuitem', { name: /Move down/ })).toHaveAttribute(
      'aria-disabled',
      'true'
    )
    fireEvent.click(screen.getByRole('menuitem', { name: /Move up/ }))
    await waitFor(() => expect(reorderProjects).toHaveBeenCalledWith(['a', 'c', 'b']))
  })

  it('puts the order back when saving fails', async () => {
    installOstlerApi({ reorderProjects: async () => ({ ok: false, error: 'disk full' }) })
    renderSidebar()
    fireEvent.keyDown(screen.getByRole('link', { name: 'Beta' }), {
      key: 'ArrowUp',
      altKey: true
    })
    await waitFor(() => expect(projectNames()).toEqual(['Alpha', 'Beta', 'Gamma']))
  })

  it('shows Home, Inbox and Settings, and no Agents entry while agents are off', () => {
    installOstlerApi()
    renderSidebar()
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: /^Inbox/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Agents/ })).toBeNull()
  })

  it('shows the Inbox unread count', async () => {
    installOstlerApi({
      getInbox: async () => ({ ok: true as const, value: { items: [], unreadCount: 3 } })
    })
    renderSidebar()
    expect(await screen.findByLabelText('3 unread')).toHaveTextContent('3')
  })
})
