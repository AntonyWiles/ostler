// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OstlerAPI, PlanningSubproject, PlanningWorkItem } from '@shared/ostler-api'
import { usePlanningWorkspace, type PlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import { BoardView } from '@renderer/views/planning/BoardView'
import { PlanningCard } from '@renderer/views/planning/PlanningCard'
import { WorkItemDrawer } from '@renderer/views/planning/WorkItemDrawer'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { StaticPeopleProvider } from '@renderer/context/PeopleContext'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { makeWorkItem } from '../../fixtures/planning-records'
import { emptyPlanningReads } from '../../fixtures/planning-workspace'
import { installOstlerApi } from '../../fixtures/ostler-api'
import { withElementSize } from '../../fixtures/layout'

function sub(id: string, name: string, position: number): PlanningSubproject {
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
    position,
    archivedAt: null,
    createdAt: 1,
    updatedAt: 1
  }
}

const SUBS = [sub('s1', 'Electrics', 0), sub('s2', 'Fit-out', 1)]
const ITEMS: PlanningWorkItem[] = [
  makeWorkItem('a', { title: 'Wire the lights', subprojectId: 's1' }),
  makeWorkItem('b', { title: 'Order the sofa', subprojectId: 's2' }),
  makeWorkItem('c', { title: 'Paint the hall' })
]

let live!: PlanningWorkspace

function Live({ children }: { children: (ws: PlanningWorkspace) => React.ReactNode }) {
  live = usePlanningWorkspace('p1', () => {})
  return <>{children(live)}</>
}

async function renderLive(
  path: string,
  subprojects: PlanningSubproject[],
  children: (ws: PlanningWorkspace) => React.ReactNode,
  api: Partial<OstlerAPI> = {}
) {
  installOstlerApi({
    ...emptyPlanningReads(),
    getPlanningWorkItems: async () => ({ ok: true, value: ITEMS }),
    getPlanningActivity: async () => ({ ok: true, value: { entries: [], nextBefore: null } }),
    listSubprojects: async () => ({ ok: true, value: subprojects }),
    ...api
  })
  render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <ConfirmProvider>
          <StaticFeaturesProvider value={{ agents: false, ai: false }}>
            <StaticPeopleProvider people={[]}>
              <Live>{children}</Live>
            </StaticPeopleProvider>
          </StaticFeaturesProvider>
        </ConfirmProvider>
      </ToastProvider>
    </MemoryRouter>
  )
  await waitFor(() => expect(live.loading).toBe(false))
  await waitFor(() => expect(live.subprojects.length).toBe(subprojects.length))
}

describe('workstream fields', () => {
  withElementSize(1200, 800)
  beforeEach(() => localStorage.clear())

  it('changing the drawer select updates the task with subprojectId', async () => {
    const update = vi.fn(async (id: string, patch: object) => ({
      ok: true as const,
      value: { ...ITEMS[2], ...patch, id } as PlanningWorkItem
    }))
    await renderLive('/projects/p1/list', SUBS, (ws) => <WorkItemDrawer ws={ws} />, {
      updatePlanningWorkItem: update
    })
    act(() => live.openWorkItem(ITEMS[2]))
    const select = await screen.findByRole('combobox', { name: 'Workstream' })
    fireEvent.change(select, { target: { value: 's2' } })
    await waitFor(() => expect(update).toHaveBeenCalledWith('c', { subprojectId: 's2' }))
  })

  it('a card shows the workstream chip unscoped, not scoped', async () => {
    await renderLive('/projects/p1/list', SUBS, (ws) => <PlanningCard item={ITEMS[0]} ws={ws} />)
    expect(screen.getByText('Electrics')).toBeTruthy()
  })

  it('a card shows no chip in a scoped view', async () => {
    await renderLive('/projects/p1/list?sub=s1', SUBS, (ws) => (
      <PlanningCard item={ITEMS[0]} ws={ws} />
    ))
    expect(screen.queryByText('Electrics')).toBeNull()
  })

  it('the board grouped by workstream puts tasks in the right groups', async () => {
    await renderLive('/projects/p1/board', SUBS, (ws) => (
      <BoardView ws={{ ...ws, boardGroupBy: 'subproject' }} />
    ))
    const lane = (name: string) => screen.getByRole('region', { name: `Swimlane: ${name}` })
    expect(within(lane('Electrics')).getByText('Wire the lights')).toBeTruthy()
    expect(within(lane('Fit-out')).getByText('Order the sofa')).toBeTruthy()
    expect(within(lane('No workstream')).getByText('Paint the hall')).toBeTruthy()
    expect(within(lane('Electrics')).queryByText('Order the sofa')).toBeNull()
  })

  it('a project with no workstreams shows nothing about them', async () => {
    await renderLive('/projects/p1/list', [], (ws) => (
      <>
        <WorkItemDrawer ws={ws} />
        <PlanningCard item={ITEMS[2]} ws={ws} />
      </>
    ))
    act(() => live.openWorkItem(ITEMS[2]))
    await screen.findByRole('combobox', { name: 'Priority' })
    expect(screen.queryByRole('combobox', { name: 'Workstream' })).toBeNull()
    expect(screen.queryByTitle(/Workstream/)).toBeNull()
  })
})
