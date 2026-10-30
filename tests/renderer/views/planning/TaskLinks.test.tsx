// @vitest-environment jsdom
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { OstlerAPI, PlanningTaskLink, PlanningWorkItem } from '@shared/ostler-api'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { TaskLinksSection } from '@renderer/views/planning/TaskLinksSection'
import {
  MarkDuplicateDialog,
  type MarkDuplicateDialogWorkspace
} from '@renderer/views/planning/MarkDuplicateDialog'
import { useTaskLinkActions } from '@renderer/hooks/planning/useTaskLinkActions'
import { StaticFeaturesProvider } from '@renderer/navigation/features'
import { WorkItemDrawer } from '@renderer/views/planning/WorkItemDrawer'
import { MemoryRouter } from 'react-router-dom'
import { installOstlerApi } from '../../fixtures/ostler-api'
import { makeWorkItem } from '../../fixtures/planning-records'
import { renderPlanningWorkspace, withWorkspace } from '../../fixtures/planning-workspace'

const ok = <T,>(value: T) => ({ ok: true as const, value })

function link(overrides: Partial<PlanningTaskLink> = {}): PlanningTaskLink {
  return {
    id: 'l1',
    projectId: 'p1',
    kind: 'duplicates',
    role: 'duplicated-by',
    workItemId: 'a',
    otherWorkItemId: 'b',
    otherTitle: 'Sign-in broken',
    otherStatus: 'active',
    otherClosed: false,
    createdAt: 1,
    ...overrides
  }
}

function workspace(items: PlanningWorkItem[]) {
  return { workItems: items, workItemsById: new Map(items.map((item) => [item.id, item])) }
}

describe('Links section (N2.4)', () => {
  it('lists each link with its words and opens the other task', async () => {
    const a = makeWorkItem('a', { title: 'Login fails' })
    const b = makeWorkItem('b', { title: 'Sign-in broken' })
    installOstlerApi({ getPlanningWorkItemLinks: async () => ok([link()]) })
    const openTask = vi.fn()
    render(
      <ToastProvider>
        <TaskLinksSection ws={workspace([a, b])} item={a} openTask={openTask} />
      </ToastProvider>
    )
    expect(await screen.findByText('Duplicated by')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Sign-in broken' }))
    expect(openTask).toHaveBeenCalledWith(b)
  })

  it('adds a link of the chosen kind to a task picked from the project', async () => {
    const a = makeWorkItem('a', { title: 'Login fails' })
    const b = makeWorkItem('b', { title: 'Sign-in broken' })
    const add = vi.fn(async () => ok(link({ kind: 'relates', role: 'relates' })))
    installOstlerApi({
      getPlanningWorkItemLinks: async () => ok([]),
      addPlanningWorkItemLink: add as OstlerAPI['addPlanningWorkItemLink']
    })
    render(
      <ToastProvider>
        <TaskLinksSection ws={workspace([a, b])} item={a} openTask={vi.fn()} />
      </ToastProvider>
    )
    expect(await screen.findByText('No links yet.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Link to…' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Kind of link' }), {
      target: { value: 'copied-from' }
    })
    const picker = screen.getByRole('combobox', { name: 'Task to link to' })
    fireEvent.change(picker, { target: { value: 'Sign' } })
    fireEvent.keyDown(picker, { key: 'Enter' })
    await waitFor(() => expect(add).toHaveBeenCalledWith('a', 'b', 'copied-from'))
  })

  it('removes a link at once, and undo puts it back the way it pointed', async () => {
    const a = makeWorkItem('a', { title: 'Login fails' })
    let links = [link()]
    const remove = vi.fn(async () => {
      links = []
      return ok(undefined)
    })
    const add = vi.fn(async () => ok(link()))
    installOstlerApi({
      getPlanningWorkItemLinks: async () => ok(links),
      removePlanningWorkItemLink: remove as OstlerAPI['removePlanningWorkItemLink'],
      addPlanningWorkItemLink: add as OstlerAPI['addPlanningWorkItemLink']
    })
    render(
      <ToastProvider>
        <TaskLinksSection ws={workspace([a])} item={a} openTask={vi.fn()} />
      </ToastProvider>
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Remove the link to Sign-in broken' })
    )
    await waitFor(() => expect(remove).toHaveBeenCalledWith('a', 'l1'))
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    // "Duplicated by": the link points from the other task to this one.
    await waitFor(() => expect(add).toHaveBeenCalledWith('b', 'a', 'duplicates'))
  })
})

describe('Mark as duplicate dialog (N2.4)', () => {
  it('sends the picked original and shows a refusal', async () => {
    const task = makeWorkItem('a', { title: 'Sign-in broken' })
    const original = makeWorkItem('b', { title: 'Login fails' })
    const ws: MarkDuplicateDialogWorkspace = {
      workItems: [task, original],
      markAsDuplicate: vi.fn(async () => 'This task is done.'),
      setDuplicateTarget: vi.fn()
    }
    render(<MarkDuplicateDialog ws={ws} target={task} />)
    const confirm = screen.getByRole('button', { name: 'Mark as duplicate' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    const picker = screen.getByRole('combobox', { name: 'Original task' })
    fireEvent.change(picker, { target: { value: 'Login' } })
    fireEvent.keyDown(picker, { key: 'Enter' })
    fireEvent.click(confirm)
    await waitFor(() => expect(ws.markAsDuplicate).toHaveBeenCalledWith(task, 'b'))
    expect(await screen.findByText('This task is done.')).toBeTruthy()
  })
})

describe('Task drawer menu (N2.4)', () => {
  it('offers Copy task and Mark as duplicate for an open task', async () => {
    const task = makeWorkItem('a', { title: 'Sign-in broken' })
    const base = await renderPlanningWorkspace()
    const copyWorkItem = vi.fn(async () => undefined)
    const setDuplicateTarget = vi.fn()
    const ws = withWorkspace(base, {
      selectedWorkItem: task,
      selectedWorkItemId: task.id,
      workItems: [task],
      workItemsById: new Map([[task.id, task]]),
      editTitle: task.title,
      editStatus: task.status,
      editDependencyIds: [],
      copyWorkItem,
      setDuplicateTarget
    })
    render(
      <MemoryRouter>
        <ConfirmProvider>
          <StaticFeaturesProvider value={{ agents: false, ai: false }}>
            <WorkItemDrawer ws={ws} />
          </StaticFeaturesProvider>
        </ConfirmProvider>
      </MemoryRouter>
    )
    // Links sit beside Waits on, as their own section, once added to a task with none.
    expect(screen.queryByRole('region', { name: 'Links' })).toBeNull()
    const bar = screen.getByRole('group', { name: 'Add to this task' })
    fireEvent.click(within(bar).getByRole('button', { name: /more$/ }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Link' }))
    expect(await screen.findByRole('region', { name: 'Links' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Task actions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /Copy task/ }))
    expect(copyWorkItem).toHaveBeenCalledWith(task)
    fireEvent.click(screen.getByRole('button', { name: 'Task actions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /Mark as duplicate/ }))
    expect(setDuplicateTarget).toHaveBeenCalledWith(task)
  })
})

describe('Mark as duplicate and Copy task actions (N2.4)', () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ToastProvider>
      {children}
      <span />
    </ToastProvider>
  )

  function setup() {
    const options = {
      setError: vi.fn(),
      loadPlanning: vi.fn(async () => undefined),
      openWorkItem: vi.fn(),
      closeDrawerIf: vi.fn()
    }
    return { options, hook: renderHook(() => useTaskLinkActions(options), { wrapper }) }
  }

  it('marks a duplicate, and undo reopens it and removes the link', async () => {
    const task = makeWorkItem('a', { title: 'Sign-in broken' })
    const api = installOstlerApi({
      markPlanningWorkItemDuplicate: vi.fn(async () =>
        ok({ workItem: task, link: link({ id: 'l9' }), cancelledTask: false })
      ),
      unarchivePlanningWorkItem: vi.fn(async () => ok(task)),
      removePlanningWorkItemLink: vi.fn(async () => ok(undefined))
    })
    const { hook, options } = setup()
    let failure: string | null = 'unset'
    await act(async () => {
      failure = await hook.result.current.markAsDuplicate(task, 'b')
    })
    expect(failure).toBeNull()
    expect(api.markPlanningWorkItemDuplicate).toHaveBeenCalledWith('a', 'b')
    expect(options.closeDrawerIf).toHaveBeenCalledWith('a')
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(api.removePlanningWorkItemLink).toHaveBeenCalledWith('a', 'l9'))
    expect(api.unarchivePlanningWorkItem).toHaveBeenCalledWith('a')
  })

  it('copies a task, opens the copy, and undo removes it for good', async () => {
    const source = makeWorkItem('a', { title: 'Write the guide' })
    const copy = makeWorkItem('c', { title: 'Write the guide (copy)' })
    const api = installOstlerApi({
      copyPlanningWorkItem: vi.fn(async () => ok({ workItem: copy, link: link() })),
      deletePlanningWorkItem: vi.fn(async () => ok(undefined)),
      deletePlanningWorkItemForever: vi.fn(async () => ok(undefined))
    })
    const { hook, options } = setup()
    await act(async () => {
      await hook.result.current.copyWorkItem(source)
    })
    expect(api.copyPlanningWorkItem).toHaveBeenCalledWith('a')
    expect(options.openWorkItem).toHaveBeenCalledWith(copy)
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(api.deletePlanningWorkItemForever).toHaveBeenCalledWith('c'))
    expect(api.deletePlanningWorkItem).toHaveBeenCalledWith('c')
  })
})
