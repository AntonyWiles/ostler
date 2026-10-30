// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PlanningWorkItem, UpdatePlanningWorkItemInput } from '@shared/ostler-api'
import { usePlanningWorkspace, type PlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import { WontDoDialog, type WontDoDialogWorkspace } from '@renderer/views/planning/WontDoDialog'
import { ArchiveView } from '@renderer/views/planning/ArchiveView'
import { makeWorkItem } from '../../fixtures/planning-records'
import { emptyPlanningReads, renderPlanningWorkspace } from '../../fixtures/planning-workspace'
import { installOstlerApi } from '../../fixtures/ostler-api'

function dialogWorkspace(
  workItems: PlanningWorkItem[],
  overrides: Partial<WontDoDialogWorkspace> = {}
): WontDoDialogWorkspace {
  return {
    workItems,
    harnessTaskFor: () => null,
    wontDoBlocker: () => null,
    closeAsWontDo: vi.fn(async () => null),
    setWontDoTargets: vi.fn(),
    ...overrides
  }
}

describe('Won’t do dialog (N1.2)', () => {
  it('sends the reason, and its open subtasks only when ticked', async () => {
    const parent = makeWorkItem('a', { title: 'Rewrite the site' })
    const children = [
      makeWorkItem('b', { parentWorkItemId: 'a' }),
      makeWorkItem('c', { parentWorkItemId: 'a' }),
      makeWorkItem('d', { parentWorkItemId: 'a', status: 'done' })
    ]
    const ws = dialogWorkspace([parent, ...children])
    render(<WontDoDialog ws={ws} targets={[parent]} />)

    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'No longer needed' } })
    const subtasks = screen.getByRole('checkbox', { name: 'Also close its 2 open subtasks' })
    fireEvent.click(subtasks)
    fireEvent.click(screen.getByRole('button', { name: 'Close as won’t do' }))

    await waitFor(() =>
      expect(ws.closeAsWontDo).toHaveBeenCalledWith([parent], {
        reason: 'No longer needed',
        includeSubtasks: true,
        cancelQueuedWork: false
      })
    )
  })

  it('offers no subtask choice for a task without open subtasks', () => {
    const task = makeWorkItem('a')
    render(<WontDoDialog ws={dialogWorkspace([task])} targets={[task]} />)
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('says when queued agent work will be cancelled, and asks to cancel it', async () => {
    const task = makeWorkItem('a', { linkedHarnessTaskId: 'h1' })
    const ws = dialogWorkspace([task], { harnessTaskFor: () => ({ status: 'pending' }) })
    render(<WontDoDialog ws={ws} targets={[task]} />)

    expect(screen.getByText(/queued work will be cancelled/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel queued work and close' }))
    await waitFor(() =>
      expect(ws.closeAsWontDo).toHaveBeenCalledWith([task], {
        reason: '',
        includeSubtasks: false,
        cancelQueuedWork: true
      })
    )
  })

  it('refuses running work before anything is sent', () => {
    const task = makeWorkItem('a', { title: 'Busy' })
    const ws = dialogWorkspace([task], { wontDoBlocker: () => 'An agent is working on it' })
    render(<WontDoDialog ws={ws} targets={[task]} />)
    expect(screen.getByText(/An agent is working on it/)).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'Close as won’t do' }) as HTMLButtonElement).disabled
    ).toBe(true)
  })
})

describe('Archive marks won’t do (N1.2)', () => {
  it('marks won’t-do tasks with their reason, offers Reopen, and shows one kind at a time', async () => {
    const finished = makeWorkItem('f', { title: 'Shipped', status: 'done', archivedAt: 2 })
    const dropped = makeWorkItem('w', {
      title: 'Dropped idea',
      status: 'active',
      archivedAt: 3,
      resolution: 'wont-do',
      resolutionReason: 'Out of scope'
    })
    const ws = await renderPlanningWorkspace({
      api: {
        getPlanningWorkItems: async (_projectId, scope) => ({
          ok: true,
          value: scope === 'archived' ? [finished, dropped] : []
        })
      }
    })
    render(<ArchiveView ws={ws} mode="archive" />)

    const table = await screen.findByRole('table')
    const droppedRow = within(table)
      .getByText('Dropped idea')
      .closest('[role="row"]') as HTMLElement
    expect(within(droppedRow).getByText('Won’t do')).toBeTruthy()
    expect(within(droppedRow).getByText('Out of scope')).toBeTruthy()
    expect(within(droppedRow).getByRole('button', { name: 'Bring back' })).toBeTruthy()
    const finishedRow = within(table).getByText('Shipped').closest('[role="row"]') as HTMLElement
    expect(within(finishedRow).queryByText('Won’t do')).toBeNull()

    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'wontDo' } })
    expect(screen.queryByText('Shipped')).toBeNull()
    expect(screen.getByText('Dropped idea')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'finished' } })
    expect(screen.queryByText('Dropped idea')).toBeNull()
    expect(screen.getByText('Shipped')).toBeTruthy()
  })
})

describe('Archive rows follow the drawer', () => {
  it('shows an edit made in the drawer to an archived task at once', async () => {
    const shipped = makeWorkItem('f', { title: 'Shipped', status: 'done', archivedAt: 2 })
    const updatePlanningWorkItem = vi.fn(
      async (id: string, patch: UpdatePlanningWorkItemInput) => ({
        ok: true as const,
        value: { ...shipped, id, ...patch } as PlanningWorkItem
      })
    )
    installOstlerApi({
      ...emptyPlanningReads(),
      getPlanningWorkItems: async (_projectId, scope) => ({
        ok: true,
        value: scope === 'archived' ? [shipped] : []
      }),
      updatePlanningWorkItem
    })
    let ws: PlanningWorkspace | null = null
    function Archive() {
      ws = usePlanningWorkspace('p1', () => {})
      return <ArchiveView ws={ws} mode="archive" />
    }
    render(<Archive />)
    fireEvent.click(await screen.findByRole('button', { name: 'Shipped' }))
    act(() => ws!.setEditTitle('Shipped to everyone'))
    act(() => ws!.flushEdits())
    await waitFor(() => expect(updatePlanningWorkItem).toHaveBeenCalledTimes(1))
    // No reload: the row reads what was saved.
    expect(await screen.findByRole('button', { name: 'Shipped to everyone' })).toBeTruthy()
  })
})
