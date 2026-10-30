// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OstlerAPI, PlanningSubproject, PlanningWorkItem } from '@shared/ostler-api'
import { usePlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import { ListView } from '@renderer/views/planning/list/ListView'
import { BoardView } from '@renderer/views/planning/BoardView'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { StaticPeopleProvider } from '@renderer/context/PeopleContext'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { makeWorkItem } from '../../fixtures/planning-records'
import { emptyPlanningReads } from '../../fixtures/planning-workspace'
import { installOstlerApi } from '../../fixtures/ostler-api'
import { withElementSize } from '../../fixtures/layout'

function sub(id: string, name: string): PlanningSubproject {
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
    archivedAt: null,
    createdAt: 1,
    updatedAt: 1
  }
}

const ITEMS: PlanningWorkItem[] = [
  makeWorkItem('a', { title: 'Wire the lights', subprojectId: 's1' }),
  makeWorkItem('b', { title: 'Order the sofa', subprojectId: 's2' }),
  makeWorkItem('c', { title: 'Paint the hall' })
]

/** The real workspace hook against a fake API, opened at a path that may carry `?sub=`. */
function Live({ view }: { view: 'list' | 'board' }) {
  const ws = usePlanningWorkspace('p1', () => {})
  return (
    <>
      {view === 'list' ? <ListView ws={ws} /> : <BoardView ws={ws} />}
      <button onClick={() => void ws.quickAddWorkItem({ title: 'New one' })}>quick add</button>
      <button
        onClick={() => {
          ws.setCreateMode('milestone')
          ws.setMilestoneName('Lights on')
        }}
      >
        draft milestone
      </button>
      <button onClick={(event) => void ws.createPlanningRecord(event as never)}>
        save milestone
      </button>
    </>
  )
}

function renderAt(path: string, view: 'list' | 'board', api: Partial<OstlerAPI> = {}) {
  installOstlerApi({
    ...emptyPlanningReads(),
    getPlanningWorkItems: async () => ({ ok: true, value: ITEMS }),
    listSubprojects: async () => ({
      ok: true,
      value: [sub('s1', 'Electrics'), sub('s2', 'Fit-out')]
    }),
    ...api
  })
  return render(
    <MemoryRouter initialEntries={[path]}>
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
}

describe('a view scoped to one sub-project', () => {
  withElementSize(1200, 800)
  beforeEach(() => localStorage.clear())

  it('shows the whole project without ?sub', async () => {
    renderAt('/projects/p1/list', 'list')
    await screen.findByText('Wire the lights')
    expect(screen.getByText('Order the sofa')).toBeTruthy()
    expect(screen.getByText('Paint the hall')).toBeTruthy()
  })

  it('shows only that sub-project in the List', async () => {
    renderAt('/projects/p1/list?sub=s1', 'list')
    await screen.findByText('Wire the lights')
    expect(screen.queryByText('Order the sofa')).toBeNull()
    expect(screen.queryByText('Paint the hall')).toBeNull()
    // The count is the workstream's, not the project's.
    expect(screen.getByText('1 of 1 tasks')).toBeTruthy()
  })

  it('shows only that sub-project on the Board', async () => {
    renderAt('/projects/p1/board?sub=s2', 'board')
    await screen.findByText('Order the sofa')
    expect(screen.queryByText('Wire the lights')).toBeNull()
    expect(screen.queryByText('Paint the hall')).toBeNull()
  })

  it('puts a task made there in the sub-project', async () => {
    const createPlanningWorkItem = vi.fn(async (_projectId: string, input: object) => ({
      ok: true as const,
      value: makeWorkItem('new', { ...input, title: 'New one' } as Partial<PlanningWorkItem>)
    }))
    renderAt('/projects/p1/list?sub=s1', 'list', { createPlanningWorkItem })
    await screen.findByText('Wire the lights')
    act(() => {
      fireEvent.click(screen.getByText('quick add'))
    })
    await waitFor(() => expect(createPlanningWorkItem).toHaveBeenCalled())
    expect(createPlanningWorkItem.mock.calls[0][1]).toMatchObject({ subprojectId: 's1' })
  })

  it('puts a milestone made there in the sub-project', async () => {
    const createPlanningMilestone = vi.fn(async () => ({
      ok: false as const,
      error: 'stop here'
    }))
    renderAt('/projects/p1/list?sub=s1', 'list', { createPlanningMilestone })
    await screen.findByText('Wire the lights')
    act(() => {
      fireEvent.click(screen.getByText('draft milestone'))
    })
    act(() => {
      fireEvent.click(screen.getByText('save milestone'))
    })
    await waitFor(() => expect(createPlanningMilestone).toHaveBeenCalled())
    expect((createPlanningMilestone.mock.calls[0] as unknown[])[1]).toMatchObject({
      subprojectId: 's1'
    })
  })

  it('leaves a task made in the whole project without one', async () => {
    const createPlanningWorkItem = vi.fn(async (_projectId: string, input: object) => ({
      ok: true as const,
      value: makeWorkItem('new', { ...input, title: 'New one' } as Partial<PlanningWorkItem>)
    }))
    renderAt('/projects/p1/list', 'list', { createPlanningWorkItem })
    await screen.findByText('Wire the lights')
    act(() => {
      fireEvent.click(screen.getByText('quick add'))
    })
    await waitFor(() => expect(createPlanningWorkItem).toHaveBeenCalled())
    expect(createPlanningWorkItem.mock.calls[0][1]).not.toHaveProperty('subprojectId', 's1')
  })
})
