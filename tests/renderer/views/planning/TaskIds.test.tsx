// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OstlerAPI, PlanningWorkItem, RendererProject } from '@shared/ostler-api'
import { OstlerProvider } from '@renderer/context/OstlerContext'
import { PlanningCard } from '@renderer/views/planning/PlanningCard'
import { WorkItemDrawer } from '@renderer/views/planning/WorkItemDrawer'
import { ListView } from '@renderer/views/planning/list/ListView'
import { LIST_SETTINGS_KEY, defaultListSettings } from '@renderer/views/planning/list/list-settings'
import { usePlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { StaticPeopleProvider } from '@renderer/context/PeopleContext'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { __resetDismissableStackForTests } from '@renderer/hooks/useDismissable'
import { makeWorkItem } from '../../fixtures/planning-records'
import {
  emptyPlanningReads,
  renderPlanningWorkspace,
  withWorkspace
} from '../../fixtures/planning-workspace'
import { installOstlerApi } from '../../fixtures/ostler-api'
import { withElementSize } from '../../fixtures/layout'
import type { ReactElement } from 'react'

/** Task IDs (N9.8a) where tasks are: cards, the List and the drawer, with Copy ID and Copy branch name. */

const project = { id: 'p1', name: 'Shop', enabled: true, taskPrefix: 'SHOP' } as RendererProject

const item = (overrides: Partial<PlanningWorkItem> = {}) =>
  makeWorkItem('a', { projectId: 'p1', title: 'Fix the login', number: 12, ...overrides })

function projectApi(
  copyText = vi.fn(async (_text: string) => ({ ok: true as const, value: undefined }))
) {
  const api: Partial<OstlerAPI> = {
    getProjects: async () => ({ ok: true, value: [project] }),
    getAreas: async () => ({ ok: true, value: [] }),
    copyText
  }
  return { api, copyText }
}

const shell = (ui: ReactElement) => (
  <MemoryRouter>
    <OstlerProvider>
      <ToastProvider>
        <ConfirmProvider>
          <StaticFeaturesProvider value={{ agents: false, ai: false }}>{ui}</StaticFeaturesProvider>
        </ConfirmProvider>
      </ToastProvider>
    </OstlerProvider>
  </MemoryRouter>
)

afterEach(() => __resetDismissableStackForTests())

describe('task IDs on cards', () => {
  it('says the ID after the title, without showing it on the card', async () => {
    const { api } = projectApi()
    const ws = await renderPlanningWorkspace({ api })
    render(shell(<PlanningCard item={item()} ws={ws} />))
    await screen.findByRole('article', { name: 'Fix the login, SHOP-12' })
    expect(screen.queryByText('SHOP-12')).toBeNull()
  })

  it('copies the ID and the branch name from its menu', async () => {
    const { api, copyText } = projectApi()
    const ws = await renderPlanningWorkspace({ api })
    render(shell(<PlanningCard item={item()} ws={ws} />))
    await screen.findByRole('article', { name: 'Fix the login, SHOP-12' })
    const more = () => fireEvent.click(screen.getByRole('button', { name: /More actions/ }))
    more()
    fireEvent.click(screen.getByRole('menuitem', { name: /Copy ID/ }))
    await waitFor(() => expect(copyText).toHaveBeenCalledWith('SHOP-12'))
    expect(await screen.findByText('Copied SHOP-12')).toBeTruthy()
    more()
    fireEvent.click(screen.getByRole('menuitem', { name: /Copy branch name/ }))
    await waitFor(() => expect(copyText).toHaveBeenCalledWith('shop-12-fix-the-login'))
  })

  it('shows no ID for a task without a number', async () => {
    const { api } = projectApi()
    const ws = await renderPlanningWorkspace({ api })
    render(shell(<PlanningCard item={item({ number: null })} ws={ws} />))
    await waitFor(() => expect(screen.getByRole('article', { name: 'Fix the login' })).toBeTruthy())
    expect(screen.queryByText(/SHOP-/)).toBeNull()
  })
})

describe('task IDs in the drawer', () => {
  it('leaves the ID out of its header and copies it from its menu', async () => {
    const { api, copyText } = projectApi()
    const base = await renderPlanningWorkspace({ api })
    const task = item()
    const ws = withWorkspace(base, {
      selectedWorkItem: task,
      selectedWorkItemId: task.id,
      workItems: [task],
      workItemsById: new Map([[task.id, task]]),
      editTitle: task.title,
      editStatus: task.status,
      editDependencyIds: []
    })
    render(shell(<WorkItemDrawer ws={ws} />))
    // The header no longer shows the ID; the task's menu still offers it and its branch name.
    const actions = await screen.findByRole('button', { name: 'Task actions' })
    expect(document.querySelector('header')?.textContent).not.toContain('SHOP-12')
    fireEvent.click(actions)
    const menu = screen.getByRole('menu')
    expect(within(menu).getByText('SHOP-12')).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: /Copy branch name/ }))
    await waitFor(() => expect(copyText).toHaveBeenCalledWith('shop-12-fix-the-login'))
  })

  it('shows the ID on its bottom line, with a button that copies it', async () => {
    const { api, copyText } = projectApi()
    const base = await renderPlanningWorkspace({ api })
    const task = item()
    const ws = withWorkspace(base, {
      selectedWorkItem: task,
      selectedWorkItemId: task.id,
      workItems: [task],
      workItemsById: new Map([[task.id, task]]),
      editTitle: task.title,
      editStatus: task.status,
      editDependencyIds: []
    })
    render(shell(<WorkItemDrawer ws={ws} />))
    const footer = (await screen.findByRole('button', { name: 'Copy ID' })).closest(
      '.task-drawer__footer'
    ) as HTMLElement
    expect(footer.textContent).toContain('SHOP-12')
    fireEvent.click(within(footer).getByRole('button', { name: 'Copy ID' }))
    await waitFor(() => expect(copyText).toHaveBeenCalledWith('SHOP-12'))
  })
})

describe('task IDs in the List', () => {
  withElementSize(1200, 800)
  afterEach(() => localStorage.clear())

  function Live() {
    const ws = usePlanningWorkspace('p1', () => {})
    return <ListView ws={ws} />
  }

  const items = () => [
    item({ id: 'b', title: 'Second', number: 10 }),
    item({ id: 'c', title: 'Third', number: 9 }),
    item({ id: 'a', title: 'First', number: 2 })
  ]

  function renderList() {
    installOstlerApi({
      ...emptyPlanningReads(),
      ...projectApi().api,
      getPlanningWorkItems: async () => ({ ok: true, value: items() })
    })
    render(
      shell(
        <StaticPeopleProvider people={[]}>
          <Live />
        </StaticPeopleProvider>
      )
    )
  }

  it('leaves the ID column off by default', async () => {
    renderList()
    await screen.findByText('Second')
    const headers = screen.getAllByRole('columnheader').map((header) => header.textContent)
    expect(headers.slice(0, 2)).toEqual(['', 'Title'])
    expect(screen.queryByText('SHOP-10')).toBeNull()
  })

  it('has an ID column, once chosen, sortable by number', async () => {
    const settings = defaultListSettings()
    settings.columns = settings.columns.map((column) =>
      column.id === 'key' ? { ...column, visible: true } : column
    )
    localStorage.setItem(
      LIST_SETTINGS_KEY,
      JSON.stringify({ version: 1, projects: { p1: settings } })
    )
    renderList()
    await screen.findByText('SHOP-10')
    const headers = screen.getAllByRole('columnheader').map((header) => header.textContent)
    expect(headers.slice(0, 3)).toEqual(['', 'ID', 'Title'])
    const titles = () =>
      screen
        .getAllByRole('row')
        .slice(1)
        .flatMap((row) => row.querySelector('.list-cell__title-text')?.textContent ?? [])
    expect(titles()).toEqual(['Second', 'Third', 'First'])
    const idHeader = screen.getAllByRole('columnheader').find((h) => h.textContent === 'ID')!
    fireEvent.click(idHeader)
    await waitFor(() => expect(titles()).toEqual(['First', 'Third', 'Second']))
  })
})
