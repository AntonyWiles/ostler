// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RendererProject } from '@shared/ostler-api'
import type { ProjectArea } from '@shared/project-areas'
import { Sidebar, FOLDED_AREAS_KEY } from '@renderer/components/Sidebar'
import { ToastProvider } from '@renderer/ui/Toast'
import { installOstlerApi } from '../fixtures/ostler-api'

function project(id: string, name: string, areaId: string | null = null): RendererProject {
  return {
    id,
    name,
    path: null,
    color: '#3b82f6',
    enabled: true,
    customIgnorePatterns: [],
    notes: '',
    tags: [],
    addedAt: 0,
    lastActivity: null,
    hasAutomationToken: false,
    areaId,
    icon: null
  } as RendererProject
}

const refreshProjects = vi.fn(async () => {})
let projects: RendererProject[] = []
let areas: ProjectArea[] = []

vi.mock('@renderer/context/OstlerContext', () => ({
  useOstler: () => ({ projects, areas, refreshProjects })
}))

function renderSidebar() {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/home']}>
        <Sidebar
          collapsed={false}
          onToggleCollapsed={() => {}}
          onOpenPalette={() => {}}
          onNewProject={() => {}}
        />
      </MemoryRouter>
    </ToastProvider>
  )
}

const region = () => screen.getByRole('region', { name: 'Projects' })
const listOf = (name: string) => within(region()).getByRole('list', { name }).querySelectorAll('a')

describe('Sidebar areas (N5.1)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    refreshProjects.mockClear()
    areas = [
      { id: 'home', name: 'Home' },
      { id: 'work', name: 'Work' }
    ]
    projects = [
      project('a', 'Garden', 'home'),
      project('b', 'Budget', 'work'),
      project('c', 'Taxes', 'home'),
      project('d', 'Novel')
    ]
  })

  it('groups projects under area headings in area order, with No area last', () => {
    installOstlerApi()
    renderSidebar()
    const headings = within(region())
      .getAllByRole('button', { expanded: true })
      .map((button) => button.textContent)
    expect(headings).toEqual(['Home', 'Work', 'No area'])
    expect([...listOf('Home')].map((link) => link.textContent)).toEqual(['Garden', 'Taxes'])
    expect([...listOf('No area')].map((link) => link.textContent)).toEqual(['Novel'])
  })

  it('shows one list with no headings while there are no areas', () => {
    areas = []
    installOstlerApi()
    renderSidebar()
    expect(within(region()).queryByRole('button', { expanded: true })).toBeNull()
    expect(within(region()).getAllByRole('link')).toHaveLength(4)
  })

  it('folds an area and remembers it in local storage, not config', () => {
    const updateConfig = vi.fn()
    installOstlerApi({ updateConfig })
    const { unmount } = renderSidebar()
    fireEvent.click(within(region()).getByRole('button', { name: /^Home/ }))
    expect(within(region()).queryByRole('link', { name: 'Garden' })).toBeNull()
    expect(within(region()).getByRole('button', { name: /^Home/ })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
    expect(JSON.parse(window.localStorage.getItem(FOLDED_AREAS_KEY)!)).toEqual(['home'])
    unmount()
    renderSidebar()
    expect(within(region()).queryByRole('link', { name: 'Garden' })).toBeNull()
    expect(updateConfig).not.toHaveBeenCalled()
  })

  it('moves a project to another area by dragging it onto a project there', async () => {
    const updateProject = vi.fn(async (id: string, updates: object) => ({
      ok: true as const,
      value: { ...projects.find((entry) => entry.id === id)!, ...updates }
    }))
    const reorderProjects = vi.fn(async () => ({ ok: true as const, value: projects }))
    installOstlerApi({ updateProject, reorderProjects })
    renderSidebar()
    const dataTransfer = {
      data: {} as Record<string, string>,
      setData(type: string, value: string) {
        this.data[type] = value
      },
      getData(type: string) {
        return this.data[type] ?? ''
      },
      effectAllowed: ''
    }
    fireEvent.dragStart(screen.getByRole('link', { name: 'Novel' }), { dataTransfer })
    fireEvent.drop(screen.getByRole('link', { name: 'Budget' }).closest('li')!, { dataTransfer })
    await waitFor(() => expect(updateProject).toHaveBeenCalledWith('d', { areaId: 'work' }))
    await waitFor(() => expect(reorderProjects).toHaveBeenCalledWith(['a', 'c', 'd', 'b']))
  })

  it('moves a project to an area from its menu, and Alt+Up stays within its area', async () => {
    const updateProject = vi.fn(async () => ({ ok: true as const, value: projects[0] }))
    const reorderProjects = vi.fn(async () => ({ ok: true as const, value: projects }))
    installOstlerApi({ updateProject, reorderProjects })
    renderSidebar()

    fireEvent.contextMenu(screen.getByRole('link', { name: 'Garden' }))
    const group = screen.getByRole('group', { name: 'Move to area' })
    expect(within(group).getByRole('menuitem', { name: /Home/ })).toHaveAttribute(
      'aria-disabled',
      'true'
    )
    fireEvent.click(within(group).getByRole('menuitem', { name: /Work/ }))
    await waitFor(() => expect(updateProject).toHaveBeenCalledWith('a', { areaId: 'work' }))
    await waitFor(() => expect(reorderProjects).toHaveBeenCalledWith(['c', 'b', 'a', 'd']))

    // Budget is first in Work: Alt+Up does not move it into Home.
    reorderProjects.mockClear()
    fireEvent.keyDown(screen.getByRole('link', { name: 'Budget' }), {
      key: 'ArrowUp',
      altKey: true
    })
    expect(reorderProjects).not.toHaveBeenCalled()
  })

  it('reorders areas with Alt+Down on a heading', async () => {
    const saveAreas = vi.fn(async (next: ProjectArea[]) => ({ ok: true as const, value: next }))
    installOstlerApi({ saveAreas })
    renderSidebar()
    fireEvent.keyDown(within(region()).getByRole('button', { name: /^Home/ }), {
      key: 'ArrowDown',
      altKey: true
    })
    await waitFor(() =>
      expect(saveAreas).toHaveBeenCalledWith(
        [
          { id: 'work', name: 'Work' },
          { id: 'home', name: 'Home' }
        ],
        undefined
      )
    )
  })

  it('makes a new area from the sidebar menu', async () => {
    const saveAreas = vi.fn(async (next: ProjectArea[]) => ({ ok: true as const, value: next }))
    installOstlerApi({ saveAreas })
    renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: 'Project list actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /New area/ }))
    fireEvent.change(screen.getByLabelText('Area name'), { target: { value: ' Side projects ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() =>
      expect(saveAreas).toHaveBeenCalledWith([...areas, { name: 'Side projects' }], undefined)
    )
  })

  it('renames an area from its menu', async () => {
    const saveAreas = vi.fn(async (next: ProjectArea[]) => ({ ok: true as const, value: next }))
    installOstlerApi({ saveAreas })
    renderSidebar()
    fireEvent.contextMenu(within(region()).getByRole('button', { name: /^Work/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Rename/ }))
    const field = screen.getByLabelText('Area name')
    expect(field).toHaveValue('Work')
    fireEvent.change(field, { target: { value: 'Day job' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(saveAreas).toHaveBeenCalledWith(
        [
          { id: 'home', name: 'Home' },
          { id: 'work', name: 'Day job' }
        ],
        undefined
      )
    )
  })

  it('removes an area at once and puts it and its projects back with Undo', async () => {
    const saveAreas = vi.fn(async (next: ProjectArea[]) => ({ ok: true as const, value: next }))
    installOstlerApi({
      saveAreas,
      getProjects: async () => ({ ok: true as const, value: projects })
    })
    renderSidebar()
    fireEvent.contextMenu(within(region()).getByRole('button', { name: /^Home/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Remove/ }))
    await waitFor(() =>
      expect(saveAreas).toHaveBeenCalledWith([{ id: 'work', name: 'Work' }], undefined)
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(saveAreas).toHaveBeenLastCalledWith(areas, { a: 'home', c: 'home' }))
  })
})
