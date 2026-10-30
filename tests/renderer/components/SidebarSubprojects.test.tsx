// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlanningSubproject, RendererProject } from '@shared/ostler-api'
import { Sidebar, OPEN_PROJECTS_KEY } from '@renderer/components/Sidebar'
import { ToastProvider } from '@renderer/ui/Toast'
import { installOstlerApi } from '../fixtures/ostler-api'

function project(id: string, name: string): RendererProject {
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
    areaId: null,
    icon: null
  } as RendererProject
}

function sub(
  id: string,
  projectId: string,
  name: string,
  extra: Partial<PlanningSubproject> = {}
): PlanningSubproject {
  return {
    id,
    projectId,
    name,
    description: '',
    color: '#3b82f6',
    icon: null,
    leadId: null,
    memberIds: [],
    status: 'active',
    position: 0,
    archivedAt: null,
    createdAt: 0,
    updatedAt: 0,
    ...extra
  }
}

const refreshProjects = vi.fn(async () => {})
const projects = [project('a', 'Garden'), project('b', 'Budget')]

vi.mock('@renderer/context/OstlerContext', () => ({
  useOstler: () => ({ projects, areas: [], refreshProjects })
}))

const listCalls = vi.fn()
const lists: Record<string, PlanningSubproject[]> = {
  a: [sub('s1', 'a', 'Front yard'), sub('s2', 'a', 'Greenhouse', { status: 'on_hold' })],
  b: [sub('s3', 'b', 'Old', { archivedAt: 5 })]
}

function renderSidebar(entry = '/home', collapsed = false) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[entry]}>
        <Sidebar
          collapsed={collapsed}
          onToggleCollapsed={() => {}}
          onOpenPalette={() => {}}
          onNewProject={() => {}}
        />
      </MemoryRouter>
    </ToastProvider>
  )
}

const region = () => screen.getByRole('region', { name: 'Projects' })

describe('Sidebar workstreams', () => {
  beforeEach(() => {
    window.localStorage.clear()
    listCalls.mockClear()
    installOstlerApi({
      listSubprojects: async (projectId: string) => {
        listCalls(projectId)
        return { ok: true, value: lists[projectId] ?? [] }
      }
    })
  })

  it('shows a collapsed disclosure for a project with workstreams, none for one without', async () => {
    renderSidebar()
    const button = await within(region()).findByRole('button', {
      name: 'Show workstreams of Garden'
    })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(within(region()).queryByRole('link', { name: 'Front yard' })).toBeNull()
    // Budget has only an archived workstream: it looks as before.
    expect(within(region()).queryByRole('button', { name: /of Budget/ })).toBeNull()
  })

  it('expands to rows that open the workstream, and keeps the state in local storage', async () => {
    const { unmount } = renderSidebar()
    fireEvent.click(
      await within(region()).findByRole('button', { name: 'Show workstreams of Garden' })
    )
    const list = within(region()).getByRole('group', { name: 'Workstreams of Garden' })
    const links = within(list).getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/projects/a?sub=s1',
      '/projects/a?sub=s2'
    ])
    expect(within(list).getByText('On hold')).toBeInTheDocument()
    expect(JSON.parse(window.localStorage.getItem(OPEN_PROJECTS_KEY)!)).toEqual(['a'])
    unmount()

    renderSidebar()
    expect(
      await within(region()).findByRole('button', { name: 'Hide workstreams of Garden' })
    ).toHaveAttribute('aria-expanded', 'true')
    expect(within(region()).getByRole('link', { name: 'Front yard' })).toBeInTheDocument()
  })

  it('shows the open workstream, and marks it, with its project expanded', async () => {
    renderSidebar('/projects/a/board?sub=s2')
    const row = await within(region()).findByRole('link', { name: /Greenhouse/ })
    expect(row).toHaveAttribute('aria-current', 'page')
    expect(row.getAttribute('href')).toBe('/projects/a/board?sub=s2')
    expect(window.localStorage.getItem(OPEN_PROJECTS_KEY)).toBeNull()
  })

  it('shows no workstream rows while the sidebar is collapsed', async () => {
    renderSidebar('/projects/a?sub=s1', true)
    await waitFor(() => expect(listCalls).toHaveBeenCalled())
    expect(within(region()).queryByRole('link', { name: 'Front yard' })).toBeNull()
    expect(within(region()).queryByRole('button', { name: /workstreams of/ })).toBeNull()
  })
})
