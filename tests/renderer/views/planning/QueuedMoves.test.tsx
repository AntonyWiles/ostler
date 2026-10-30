// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { usePlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import { ToastProvider } from '@renderer/ui'
import type { PlanningWorkItem, UpdatePlanningWorkItemInput } from '@shared/ostler-api'
import { installOstlerApi } from '../../fixtures/ostler-api'
import { emptyPlanningReads } from '../../fixtures/planning-workspace'
import { makeHarnessState, makeTask, makeWorkItem } from '../../fixtures/planning-records'

/**
 * A queued task's moves out of Ready and into Someday (one rule in the main
 * process): the app sends the change, the queue entry goes with it, and the
 * toast's Undo puts the change back and queues the task again.
 */
async function queuedWorkspace(taskStatus: 'pending' | 'claimed' = 'pending') {
  const item = makeWorkItem('a', {
    title: 'Write the importer',
    status: 'ready',
    linkedHarnessTaskId: 'h1'
  })
  const updatePlanningWorkItem = vi.fn(async (id: string, patch: UpdatePlanningWorkItemInput) => ({
    ok: true as const,
    value: {
      ...item,
      id,
      ...patch,
      linkedHarnessTaskId: null,
      leftQueue: true
    } as PlanningWorkItem
  }))
  const queuePlanningWorkItem = vi.fn(async () => ({
    ok: true as const,
    value: { workItem: item, task: makeTask('h2') }
  }))
  installOstlerApi({
    ...emptyPlanningReads(),
    getPlanningWorkItems: async () => ({ ok: true, value: [item] }),
    getHarnessState: async () => ({
      ok: true,
      value: makeHarnessState({
        taskQueue: [makeTask('h1', { planningWorkItemId: 'a', status: taskStatus })]
      })
    }),
    updatePlanningWorkItem,
    queuePlanningWorkItem
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ToastProvider>{children}</ToastProvider>
  )
  const hook = renderHook(() => usePlanningWorkspace('p1', () => {}), { wrapper })
  await waitFor(() => expect(hook.result.current.loading).toBe(false))
  await waitFor(() => expect(hook.result.current.harnessTaskFor(item)).not.toBeNull())
  return { hook, item, updatePlanningWorkItem, queuePlanningWorkItem }
}

describe('a queued task leaving Ready', () => {
  it('moves out of the queue, and Undo moves it back and queues it again', async () => {
    const { hook, item, updatePlanningWorkItem, queuePlanningWorkItem } = await queuedWorkspace()
    await act(() => hook.result.current.moveWorkItem(item, 'backlog'))
    expect(updatePlanningWorkItem).toHaveBeenCalledWith('a', { status: 'backlog', columnId: null })
    expect(hook.result.current.error).toBeNull()

    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(queuePlanningWorkItem).toHaveBeenCalledWith('p1', 'a'))
    expect(updatePlanningWorkItem).toHaveBeenLastCalledWith('a', { status: 'ready' })
  })

  it('moving it to Someday does the same, and Undo queues it again', async () => {
    const { hook, item, updatePlanningWorkItem, queuePlanningWorkItem } = await queuedWorkspace()
    await act(() => hook.result.current.setSomeday([item], true))
    expect(updatePlanningWorkItem).toHaveBeenCalledWith('a', { someday: true })
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(queuePlanningWorkItem).toHaveBeenCalledWith('p1', 'a'))
  })

  it('the drawer’s status does the same, and Undo queues it again', async () => {
    const { hook, item, updatePlanningWorkItem, queuePlanningWorkItem } = await queuedWorkspace()
    act(() => hook.result.current.openWorkItem(item))
    act(() => hook.result.current.setEditStatus('backlog'))
    await waitFor(() =>
      expect(updatePlanningWorkItem).toHaveBeenCalledWith('a', {
        status: 'backlog',
        columnId: null
      })
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(queuePlanningWorkItem).toHaveBeenCalledWith('p1', 'a'))
    expect(updatePlanningWorkItem).toHaveBeenCalledWith('a', { status: 'ready' })
  })

  it('a running task is not moved: it says so', async () => {
    const { hook, item, updatePlanningWorkItem } = await queuedWorkspace('claimed')
    await act(() => hook.result.current.moveWorkItem(item, 'backlog'))
    expect(updatePlanningWorkItem).not.toHaveBeenCalled()
    expect(hook.result.current.error).toMatch(/agent is working/)
  })
})
