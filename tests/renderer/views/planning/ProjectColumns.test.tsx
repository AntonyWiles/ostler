// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlanningColumnSettings, PlanningWorkItem, RendererProject } from '@shared/ostler-api'
import { usePlanningWorkspace, type PlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import { BoardView } from '@renderer/views/planning/BoardView'
import { WorkItemDrawer } from '@renderer/views/planning/WorkItemDrawer'
import { ProjectSettingsDialog } from '@renderer/components/ProjectSettingsDialog'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { StaticPeopleProvider } from '@renderer/context/PeopleContext'
import { ColumnsProvider, ProjectColumnsScope } from '@renderer/context/ColumnsContext'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { __resetDismissableStackForTests } from '@renderer/hooks/useDismissable'
import { makeWorkItem } from '../../fixtures/planning-records'
import { emptyPlanningReads } from '../../fixtures/planning-workspace'
import { installOstlerApi } from '../../fixtures/ostler-api'
import { withElementSize } from '../../fixtures/layout'

vi.mock('@renderer/context/OstlerContext', async (actual) => ({
  ...(await actual<typeof import('@renderer/context/OstlerContext')>()),
  useOstler: () => ({ projects: [], loading: false, refreshProjects: async () => {} })
}))

/** A project with its own column words and hidden In review (R2.4, D34). */
const COLUMNS: PlanningColumnSettings = {
  names: { backlog: 'To do', active: 'Doing' },
  hidden: ['review']
}

const ITEMS: PlanningWorkItem[] = [
  makeWorkItem('a', { title: 'Paint the hall', status: 'active' }),
  makeWorkItem('b', { title: 'Book the van', status: 'backlog' })
]

function shell(children: ReactNode, agents = false) {
  return (
    <MemoryRouter>
      <ToastProvider>
        <ConfirmProvider>
          <StaticFeaturesProvider value={{ agents, ai: false }}>
            <StaticPeopleProvider people={[]}>
              <ColumnsProvider>
                <ProjectColumnsScope projectId="p1">{children}</ProjectColumnsScope>
              </ColumnsProvider>
            </StaticPeopleProvider>
          </StaticFeaturesProvider>
        </ConfirmProvider>
      </ToastProvider>
    </MemoryRouter>
  )
}

describe('a project’s columns in its views', () => {
  withElementSize(1200, 800)
  afterEach(() => __resetDismissableStackForTests())

  let live!: PlanningWorkspace
  function Live({ drawer = false }: { drawer?: boolean }) {
    live = usePlanningWorkspace('p1', () => {})
    return drawer ? <WorkItemDrawer ws={live} /> : <BoardView ws={live} />
  }

  async function renderLive(drawer = false) {
    installOstlerApi({
      ...emptyPlanningReads(),
      getPlanningWorkItems: async () => ({ ok: true, value: ITEMS }),
      getPlanningActivity: async () => ({ ok: true, value: { entries: [], nextBefore: null } }),
      getPlanningColumnSettings: async () => ({ ok: true, value: { p1: COLUMNS } })
    })
    render(shell(<Live drawer={drawer} />))
    await waitFor(() => expect(live.loading).toBe(false))
    await waitFor(() => expect(live.statusWords.columns).toEqual(COLUMNS))
  }

  it('the Board shows the project’s names and leaves out a hidden column', async () => {
    await renderLive()
    const titles = screen
      .getAllByRole('heading')
      .map((heading) => heading.textContent ?? '')
      .filter((text) => /^(To do|Ready|Doing|Blocked|In review|Done)/.test(text))
    expect(titles.map((text) => text.replace(/\d+$/, '').trim())).toEqual([
      'To do',
      'Ready',
      'Doing',
      'Blocked',
      'Done'
    ])
  })

  it('Add filter offers the shown statuses only, in the project’s words', async () => {
    await renderLive()
    fireEvent.click(screen.getByRole('button', { name: 'Add filter' }))
    fireEvent.click(screen.getByRole('button', { name: 'Status' }))
    const editor = screen.getByRole('dialog', { name: 'Edit filter: Status' })
    expect(within(editor).getAllByRole('checkbox')).toHaveLength(5)
    for (const name of ['To do', 'Ready', 'Doing', 'Blocked', 'Done'])
      expect(within(editor).getByRole('checkbox', { name })).toBeTruthy()
    expect(within(editor).queryByRole('checkbox', { name: 'In review' })).toBeNull()
  })

  it('the drawer’s status picker leaves out a hidden status', async () => {
    await renderLive(true)
    act(() => live.openWorkItem(ITEMS[0]))
    const picker = (await screen.findByRole('combobox', { name: 'Status' })) as HTMLSelectElement
    expect([...picker.options].map((option) => option.textContent)).toEqual([
      'To do',
      'Ready',
      'Doing',
      'Blocked',
      'Done'
    ])
  })
})

describe('Project settings › Columns', () => {
  const project: RendererProject = {
    id: 'p1',
    name: 'Moving house',
    path: null,
    color: '#3b82f6',
    enabled: true,
    customIgnorePatterns: [],
    notes: '',
    tags: [],
    addedAt: 0,
    lastActivity: null,
    hasAutomationToken: false
  }

  function renderSettings(
    update: (
      change: unknown
    ) => { ok: true; value: PlanningColumnSettings } | { ok: false; error: string },
    options: { agents?: boolean; path?: string | null } = {}
  ) {
    const call = vi.fn(async (_projectId: string, change: unknown) => update(change))
    installOstlerApi({
      getNewProjectDefaults: async () => ({ ok: true, value: { colors: [] } as never }),
      getProjectAutoDispatchConfig: async () => ({ ok: false, error: 'not needed' }),
      getProjectAISettings: async () => ({ ok: false, error: 'not needed' }),
      getPlanningLabels: async () => ({ ok: true, value: [] }),
      getPlanningFields: async () => ({ ok: true, value: [] }),
      getPlanningColumnSettings: async () => ({ ok: true, value: {} }),
      updatePlanningColumnSettings: call
    })
    render(
      shell(
        <ProjectSettingsDialog
          project={{ ...project, path: options.path ?? null }}
          onClose={() => undefined}
          onChanged={() => undefined}
        />,
        options.agents ?? false
      )
    )
    // The columns are in the dialog's Board section.
    fireEvent.click(screen.getByRole('tab', { name: 'Board' }))
    return call
  }

  it('renames a column, and a blank name goes back to the standard word', async () => {
    const call = renderSettings(() => ({
      ok: true,
      value: { names: { active: 'Doing' }, hidden: [] }
    }))
    const name = await screen.findByRole('textbox', { name: 'Name for In progress' })
    expect(name).toHaveAttribute('placeholder', 'In progress')
    fireEvent.change(name, { target: { value: 'Doing' } })
    fireEvent.blur(name)
    await waitFor(() => expect(call).toHaveBeenCalledWith('p1', { names: { active: 'Doing' } }))
    expect(await screen.findByRole('checkbox', { name: 'Show Ready' })).toBeChecked()
  })

  it('hides a column, and shows the refusal when tasks are in it', async () => {
    let refuse = false
    const call = renderSettings(() =>
      refuse
        ? { ok: false, error: 'Ready can’t be hidden while 2 tasks are in it.' }
        : { ok: true, value: { names: {}, hidden: ['blocked'] } }
    )
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Show Blocked' }))
    await waitFor(() => expect(call).toHaveBeenCalledWith('p1', { hidden: ['blocked'] }))
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: 'Show Blocked' })).not.toBeChecked()
    )
    refuse = true
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show Ready' }))
    expect(await screen.findByText('Ready can’t be hidden while 2 tasks are in it.')).toBeTruthy()
    // Backlog, In progress and Done always show.
    expect(screen.queryByRole('checkbox', { name: 'Show Done' })).toBeNull()
  })

  it('keeps Ready and In review while agents are on and the project has a folder', async () => {
    renderSettings(() => ({ ok: true, value: { names: {}, hidden: [] } }), {
      agents: true,
      path: 'C:\\work\\site'
    })
    expect(await screen.findByRole('checkbox', { name: 'Show Ready' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Show In review' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Show Blocked' })).toBeEnabled()
  })
})
