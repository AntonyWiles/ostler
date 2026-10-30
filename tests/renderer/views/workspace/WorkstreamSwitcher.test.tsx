// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { PlanningSubproject, RendererProject } from '@shared/ostler-api'
import { OstlerProvider } from '@renderer/context/OstlerContext'
import { ProjectHeader } from '@renderer/views/workspace/ProjectHeader'
import { installOstlerApi } from '../../fixtures/ostler-api'

const project = { id: 'p1', name: 'Café refit', enabled: true, path: null } as RendererProject

function sub(id: string, name: string, archivedAt: number | null = null): PlanningSubproject {
  return {
    id,
    projectId: 'p1',
    name,
    description: '',
    color: '#3b82f6',
    icon: null,
    leadId: null,
    memberIds: [],
    status: 'active',
    position: 0,
    archivedAt,
    createdAt: 1,
    updatedAt: 1
  }
}

function renderHeader(workstreams: {
  list: PlanningSubproject[]
  currentId: string | null
  viewScoped?: boolean
  onChoose?: (id: string | null) => void
}) {
  installOstlerApi({ getProjects: async () => ({ ok: true, value: [project] }) })
  const onChoose = workstreams.onChoose ?? vi.fn()
  render(
    <MemoryRouter>
      <OstlerProvider>
        <ProjectHeader
          project={project}
          onNewTask={() => {}}
          moreItems={[]}
          onRenamed={() => {}}
          workstreams={{ viewScoped: true, ...workstreams, onChoose }}
        />
      </OstlerProvider>
    </MemoryRouter>
  )
  return onChoose
}

describe("the project header's workstream switcher", () => {
  it('is absent while the project has no live workstream', () => {
    renderHeader({ list: [sub('s1', 'Old', 5)], currentId: null })
    expect(screen.queryByRole('button', { name: /All workstreams/ })).toBeNull()
  })

  it('offers every workstream from the whole project', () => {
    const onChoose = renderHeader({
      list: [sub('s1', 'Electrics'), sub('s2', 'Fit-out')],
      currentId: null
    })
    fireEvent.click(screen.getByRole('button', { name: /All workstreams/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Fit-out' }))
    expect(onChoose).toHaveBeenCalledWith('s2')
  })

  it('names the open workstream and goes back to the whole project', () => {
    const onChoose = renderHeader({ list: [sub('s1', 'Electrics')], currentId: 's1' })
    expect(screen.getByRole('button', { name: /Electrics/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'All of Café refit' }))
    expect(onChoose).toHaveBeenCalledWith(null)
  })

  it('says when the view shows the whole project', () => {
    renderHeader({ list: [sub('s1', 'Electrics')], currentId: 's1', viewScoped: false })
    expect(screen.getByText('This view shows the whole project')).toBeTruthy()
  })
})
