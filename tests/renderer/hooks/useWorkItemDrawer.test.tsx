// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { usePlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import { TYPING_PAUSE_MS } from '@renderer/hooks/planning/drawer-saves'
import type { PlanningWorkItem, Result, UpdatePlanningWorkItemInput } from '@shared/ostler-api'
import { installOstlerApi } from '../fixtures/ostler-api'
import { makeWorkItem } from '../fixtures/planning-records'

type SaveAnswer = (
  id: string,
  patch: UpdatePlanningWorkItemInput,
  saved: PlanningWorkItem
) => Promise<Result<PlanningWorkItem>>

/**
 * A workspace with one open task. Each save is answered by `saveAnswer`; by
 * default it is saved as sent, and the answer is the task as it now reads.
 */
async function workspaceWith(saveAnswer?: SaveAnswer) {
  const item = makeWorkItem('a', { labels: ['x'], acceptanceCriteria: ['One'], title: 'Task A' })
  const answer: SaveAnswer =
    saveAnswer ??
    (async (id, patch, saved) => ({
      ok: true,
      value: { ...saved, id, ...patch } as PlanningWorkItem
    }))
  const updatePlanningWorkItem = vi.fn((id: string, patch: UpdatePlanningWorkItemInput) =>
    answer(id, patch, item)
  )
  installOstlerApi({
    getPlanningGoals: async () => ({ ok: true, value: [] }),
    getPlanningMilestones: async () => ({ ok: true, value: [] }),
    getPlanningWorkItems: async () => ({ ok: true, value: [item] }),
    getPlanningDecisions: async () => ({ ok: true, value: [] }),
    getPlanningWipLimits: async () => ({ ok: true, value: {} }),
    getPlanningLatestStatusChanges: async () => ({ ok: true, value: {} }),
    listOpenBlockers: async () => ({ ok: true, value: [] }),
    getAIProjectBrief: async () => ({ ok: true, value: null }),
    listWorkItemsWithChangedSources: async () => ({ ok: true, value: [] }),
    countWorkItemAttachments: async () => ({ ok: true, value: {} }),
    updatePlanningWorkItem
  })
  const hook = renderHook(() => usePlanningWorkspace('p1', () => {}))
  await waitFor(() => expect(hook.result.current.loading).toBe(false))
  act(() => hook.result.current.openWorkItem(item))
  return { hook, item, updatePlanningWorkItem }
}

const wait = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)))

describe('task drawer saves as you go (D30)', () => {
  it('saves nothing when a task is opened', async () => {
    const { updatePlanningWorkItem } = await workspaceWith()
    await wait(TYPING_PAUSE_MS + 50)
    expect(updatePlanningWorkItem).not.toHaveBeenCalled()
  })

  it('saves a picker or a finished list edit once, at once', async () => {
    const { hook, updatePlanningWorkItem } = await workspaceWith()
    act(() => hook.result.current.setEditLabels(['x', 'y']))
    await waitFor(() => expect(updatePlanningWorkItem).toHaveBeenCalledTimes(1))
    expect(updatePlanningWorkItem).toHaveBeenCalledWith('a', { labels: ['x', 'y'] })
  })

  it('saves typed text once, after the pause, with the last value typed', async () => {
    const { hook, updatePlanningWorkItem } = await workspaceWith()
    act(() => hook.result.current.setEditTitle('Renamed'))
    act(() => hook.result.current.setEditTitle('Renamed again'))
    act(() => hook.result.current.setEditTitle('Renamed again, now'))
    expect(updatePlanningWorkItem).not.toHaveBeenCalled()
    await waitFor(() => expect(updatePlanningWorkItem).toHaveBeenCalledTimes(1), {
      timeout: TYPING_PAUSE_MS + 1000
    })
    expect(updatePlanningWorkItem).toHaveBeenCalledWith('a', { title: 'Renamed again, now' })
  })

  it('saves nothing for a change that leaves the saved text as it was', async () => {
    const { hook, updatePlanningWorkItem } = await workspaceWith()
    act(() => hook.result.current.setEditCriteria(['One ', '']))
    act(() => hook.result.current.setEditTitle('Renamed'))
    act(() => hook.result.current.setEditTitle('Task A'))
    await wait(TYPING_PAUSE_MS + 50)
    expect(updatePlanningWorkItem).not.toHaveBeenCalled()
  })

  it('keeps a failed value and holds it until it is retried', async () => {
    let failing = true
    const { hook, updatePlanningWorkItem } = await workspaceWith(async (id, patch, saved) =>
      failing
        ? { ok: false, error: "Tasks can't wait on each other in a loop" }
        : { ok: true, value: { ...saved, id, ...patch } as PlanningWorkItem }
    )
    act(() => hook.result.current.setEditDependencyIds(['b']))
    await waitFor(() => expect(hook.result.current.saveFailures).toHaveLength(1))
    expect(hook.result.current.saveFailures[0]).toEqual({
      field: 'dependencyIds',
      message: "Tasks can't wait on each other in a loop"
    })
    expect(hook.result.current.editDependencyIds).toEqual(['b'])
    expect(hook.result.current.saveStatus).toBe('failed')

    failing = false
    act(() => hook.result.current.retrySaves())
    await waitFor(() => expect(hook.result.current.saveFailures).toHaveLength(0))
    expect(updatePlanningWorkItem).toHaveBeenCalledTimes(2)
    expect(updatePlanningWorkItem).toHaveBeenLastCalledWith('a', { dependencyIds: ['b'] })
  })

  it('undoes the last saved change, one step at a time', async () => {
    const { hook, updatePlanningWorkItem } = await workspaceWith()
    act(() => hook.result.current.setEditPriority('high'))
    await waitFor(() => expect(updatePlanningWorkItem).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(hook.result.current.saveStatus).toBe('saved'))

    act(() => {
      expect(hook.result.current.undoLastSave()).toBe(true)
    })
    await waitFor(() => expect(updatePlanningWorkItem).toHaveBeenCalledTimes(2))
    expect(updatePlanningWorkItem).toHaveBeenLastCalledWith('a', { priority: 'medium' })
    expect(hook.result.current.editPriority).toBe('medium')
    // The undo itself is not undone: nothing is left to undo.
    act(() => {
      expect(hook.result.current.undoLastSave()).toBe(false)
    })
  })

  it('keeps a save from a closed drawer out of the undo steps of the task opened again', async () => {
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => (release = resolve))
    const { hook, item, updatePlanningWorkItem } = await workspaceWith(async (id, patch, saved) => {
      await held
      return { ok: true, value: { ...saved, id, ...patch } as PlanningWorkItem }
    })
    act(() => hook.result.current.setEditPriority('high'))
    await waitFor(() => expect(updatePlanningWorkItem).toHaveBeenCalledTimes(1))
    act(() => hook.result.current.closeWorkItem())
    act(() => hook.result.current.openWorkItem(item))
    await act(async () => {
      release()
      await held
    })
    await waitFor(() => expect(hook.result.current.saveStatus).not.toBe('saving'))
    act(() => {
      expect(hook.result.current.undoLastSave()).toBe(false)
    })
  })

  it('undoes what rules did because of a change, with the change (R6.2)', async () => {
    const { hook, updatePlanningWorkItem } = await workspaceWith(async (id, patch, saved) => ({
      ok: true,
      value: {
        ...saved,
        id,
        ...patch,
        ...(patch.undoRuleRun ? {} : { ruleRun: { id: 'run-1', ruleNames: ['Escalate'] } })
      } as PlanningWorkItem
    }))
    act(() => hook.result.current.setEditPriority('high'))
    await waitFor(() => expect(hook.result.current.saveStatus).toBe('saved'))
    act(() => {
      expect(hook.result.current.undoLastSave()).toBe(true)
    })
    await waitFor(() => expect(updatePlanningWorkItem).toHaveBeenCalledTimes(2))
    expect(updatePlanningWorkItem).toHaveBeenLastCalledWith('a', {
      priority: 'medium',
      undoRuleRun: 'run-1'
    })
  })

  it('undoes a sitting of typing as one step', async () => {
    const { hook, updatePlanningWorkItem } = await workspaceWith()
    act(() => hook.result.current.setEditDescription('First'))
    act(() => hook.result.current.setEditDescription('First, and more'))
    await waitFor(() => expect(updatePlanningWorkItem).toHaveBeenCalledTimes(1), {
      timeout: TYPING_PAUSE_MS + 1000
    })
    act(() => hook.result.current.setEditDescription('First, and more, again'))
    await waitFor(() => expect(updatePlanningWorkItem).toHaveBeenCalledTimes(2), {
      timeout: TYPING_PAUSE_MS + 1000
    })
    act(() => {
      hook.result.current.undoLastSave()
    })
    await waitFor(() => expect(updatePlanningWorkItem).toHaveBeenCalledTimes(3))
    // The sitting began from the empty description, so one undo goes back to it.
    expect(updatePlanningWorkItem).toHaveBeenLastCalledWith('a', { description: '' })
  })
})

describe('task drawer checklist renames (N2.2)', () => {
  it('saves an edit to one item’s text as a rename, and its undo renames back', async () => {
    const { hook, item, updatePlanningWorkItem } = await workspaceWith()
    const renamePlanningChecklistItem = vi.fn(async (id: string, _from: string, to: string) => ({
      ok: true as const,
      value: { ...item, id, acceptanceCriteria: [to] }
    }))
    window.ostlerAPI.renamePlanningChecklistItem = renamePlanningChecklistItem
    act(() => hook.result.current.setEditCriteria(['One more'], true))
    await waitFor(() => expect(renamePlanningChecklistItem).toHaveBeenCalledTimes(1), {
      timeout: TYPING_PAUSE_MS + 1000
    })
    expect(renamePlanningChecklistItem).toHaveBeenCalledWith('a', 'One', 'One more')
    act(() => {
      hook.result.current.undoLastSave()
    })
    await waitFor(() => expect(renamePlanningChecklistItem).toHaveBeenCalledTimes(2))
    expect(renamePlanningChecklistItem).toHaveBeenLastCalledWith('a', 'One more', 'One')
    // Adding an item replaces the list, as before.
    act(() => hook.result.current.setEditCriteria(['One', 'Two']))
    await waitFor(() =>
      expect(updatePlanningWorkItem).toHaveBeenCalledWith('a', {
        acceptanceCriteria: ['One', 'Two']
      })
    )
  })

  it('retries a failed rename as a rename, so the item keeps its date and person', async () => {
    const { hook, item, updatePlanningWorkItem } = await workspaceWith()
    let failing = true
    const renamePlanningChecklistItem = vi.fn(async (id: string, _from: string, to: string) =>
      failing
        ? { ok: false as const, error: 'The database is busy' }
        : { ok: true as const, value: { ...item, id, acceptanceCriteria: [to] } }
    )
    window.ostlerAPI.renamePlanningChecklistItem = renamePlanningChecklistItem
    act(() => hook.result.current.setEditCriteria(['One more'], true))
    await waitFor(() => expect(hook.result.current.saveFailures).toHaveLength(1), {
      timeout: TYPING_PAUSE_MS + 1000
    })
    failing = false
    act(() => hook.result.current.retrySaves())
    await waitFor(() => expect(renamePlanningChecklistItem).toHaveBeenCalledTimes(2))
    expect(renamePlanningChecklistItem).toHaveBeenLastCalledWith('a', 'One', 'One more')
    await waitFor(() => expect(hook.result.current.saveFailures).toHaveLength(0))
    expect(updatePlanningWorkItem).not.toHaveBeenCalled()
  })
})
