// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { StrictMode, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { OstlerAPI, ProjectStateUpdate } from '@shared/ostler-api'
import {
  harnessOutpacesBoard,
  PLANNING_POLL_MS,
  REFRESH_COALESCE_MS,
  usePlanningRecords
} from '@renderer/hooks/planning/usePlanningRecords'
import { installOstlerApi } from '../fixtures/ostler-api'
import { makeHarnessState, makeTask, makeWorkItem } from '../fixtures/planning-records'

/** A fake API whose pushes the test sends, with every planning read counted. */
function setup() {
  const listeners = new Set<(update: ProjectStateUpdate) => void>()
  const reads = {
    getPlanningGoals: vi.fn(async () => ({ ok: true as const, value: [] })),
    getPlanningMilestones: vi.fn(async () => ({ ok: true as const, value: [] })),
    getPlanningWorkItems: vi.fn(async () => ({
      ok: true as const,
      value: [makeWorkItem('w1', { linkedHarnessTaskId: 't1' })]
    })),
    getPlanningDecisions: vi.fn(async () => ({ ok: true as const, value: [] })),
    getPlanningWipLimits: vi.fn(async () => ({ ok: true as const, value: {} })),
    getPlanningLatestStatusChanges: vi.fn(async () => ({ ok: true as const, value: {} })),
    listOpenBlockers: vi.fn(async () => ({ ok: true as const, value: [] })),
    getHarnessState: vi.fn(async () => ({ ok: true as const, value: makeHarnessState() })),
    listWorkItemsWithChangedSources: vi.fn(async () => ({ ok: true as const, value: [] })),
    countWorkItemAttachments: vi.fn(async () => ({ ok: true as const, value: {} }))
  }
  const api: Partial<OstlerAPI> = {
    ...reads,
    onProjectStateChange: (callback) => {
      listeners.add(callback)
      return () => listeners.delete(callback)
    }
  }
  installOstlerApi(api)
  const push = (update: ProjectStateUpdate) =>
    act(() => {
      for (const listener of [...listeners]) listener(update)
    })
  return { reads, push, listeners }
}

async function renderRecords(
  projectId = 'p1',
  wrapper?: (props: { children: ReactNode }) => ReactNode
) {
  const env = setup()
  const view = renderHook(() => usePlanningRecords(projectId, () => {}), { wrapper })
  await waitFor(() => expect(view.result.current.workItems).toHaveLength(1))
  await waitFor(() => expect(view.result.current.loading).toBe(false))
  vi.clearAllMocks()
  return { ...env, view }
}

/** Long enough for any coalesced reload to have fired and finished. */
const settle = () =>
  act(() => new Promise((resolve) => setTimeout(resolve, REFRESH_COALESCE_MS * 3)))

describe('usePlanningRecords refresh routing', () => {
  it('ignores a harness push for another project', async () => {
    const { reads, push, view } = await renderRecords()
    const before = view.result.current.harnessState
    push({ projectId: 'other', field: 'harness', data: makeHarnessState({ projectId: 'other' }) })
    push({ projectId: 'other', field: 'planning', data: null })
    await settle()
    expect(reads.getPlanningWorkItems).not.toHaveBeenCalled()
    expect(reads.getHarnessState).not.toHaveBeenCalled()
    expect(view.result.current.harnessState).toBe(before)
  })

  it('takes a harness push for this project as it is, without reloading', async () => {
    const { reads, push, view } = await renderRecords()
    const state = makeHarnessState({
      taskQueue: [makeTask('t1', { planningWorkItemId: 'w1' })]
    })
    push({ projectId: 'p1', field: 'harness', data: state })
    await settle()
    expect(view.result.current.harnessState).toBe(state)
    expect(reads.getPlanningWorkItems).not.toHaveBeenCalled()
    expect(reads.getHarnessState).not.toHaveBeenCalled()
  })

  it('reloads work items once for three planning pushes arriving together', async () => {
    const { reads, push } = await renderRecords()
    push({ projectId: 'p1', field: 'planning', data: null })
    push({ projectId: 'p1', field: 'planning', data: null })
    push({ projectId: 'p1', field: 'taskReview', data: null })
    await settle()
    expect(reads.getPlanningWorkItems).toHaveBeenCalledTimes(1)
    // A planning push says nothing about the harness, so its state is not re-read.
    expect(reads.getHarnessState).not.toHaveBeenCalled()
    expect(reads.listWorkItemsWithChangedSources).not.toHaveBeenCalled()
  })

  it('keeps the loaded records on screen while a reload is in flight', async () => {
    const { reads, push, view } = await renderRecords()
    let release: () => void = () => {}
    reads.getPlanningWorkItems.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true, value: [makeWorkItem('w2')] })
        })
    )
    push({ projectId: 'p1', field: 'planning', data: null })
    await settle()
    expect(view.result.current.workItems.map((item) => item.id)).toEqual(['w1'])
    expect(view.result.current.loading).toBe(false)
    await act(async () => release())
    await waitFor(() =>
      expect(view.result.current.workItems.map((item) => item.id)).toEqual(['w2'])
    )
  })

  it('reloads only the library markers for a library push', async () => {
    const { reads, push } = await renderRecords()
    push({ projectId: 'p1', field: 'library', data: null })
    push({ projectId: 'p1', field: 'library', data: null })
    await settle()
    expect(reads.listWorkItemsWithChangedSources).toHaveBeenCalledTimes(1)
    expect(reads.countWorkItemAttachments).toHaveBeenCalledTimes(1)
    expect(reads.getPlanningWorkItems).not.toHaveBeenCalled()
  })

  it('reloads records when the harness queues work the board has not loaded', async () => {
    const { reads, push } = await renderRecords()
    push({
      projectId: 'p1',
      field: 'harness',
      data: makeHarnessState({ taskQueue: [makeTask('t9', { planningWorkItemId: 'w9' })] })
    })
    await settle()
    expect(reads.getPlanningWorkItems).toHaveBeenCalledTimes(1)
  })

  it('subscribes exactly once under StrictMode and unsubscribes on unmount', async () => {
    const { listeners, view } = await renderRecords('p1', StrictMode)
    expect(listeners.size).toBe(1)
    view.unmount()
    expect(listeners.size).toBe(0)
  })
})

describe('usePlanningRecords going back to a project', () => {
  it('shows what a project showed last at once, and refreshes it behind', async () => {
    const env = setup()
    const view = renderHook(({ projectId }) => usePlanningRecords(projectId, () => {}), {
      initialProps: { projectId: 'p1' }
    })
    await waitFor(() => expect(view.result.current.loaded).toBe(true))
    view.rerender({ projectId: 'p2' })
    // Never shown before: loading, with nothing kept for it.
    expect(view.result.current.loaded).toBe(false)
    await waitFor(() => expect(view.result.current.loaded).toBe(true))

    // Back to p1: loaded on the very first render, before any read lands.
    env.reads.getPlanningWorkItems.mockClear()
    view.rerender({ projectId: 'p1' })
    expect(view.result.current.loaded).toBe(true)
    expect(view.result.current.loading).toBe(false)
    expect(view.result.current.workItems.map((item) => item.id)).toEqual(['w1'])
    await waitFor(() => expect(env.reads.getPlanningWorkItems).toHaveBeenCalledWith('p1'))
    expect(view.result.current.loading).toBe(false)
  })

  it('keeps it for a newly mounted workspace too, as when coming back from Home', async () => {
    setup()
    const first = renderHook(() => usePlanningRecords('p1', () => {}))
    await waitFor(() => expect(first.result.current.loaded).toBe(true))
    first.unmount()
    const second = renderHook(() => usePlanningRecords('p1', () => {}))
    expect(second.result.current.loaded).toBe(true)
    expect(second.result.current.workItems).toHaveLength(1)
  })
})

describe('harnessOutpacesBoard', () => {
  const links = new Map<string, string | null>([
    ['w1', 't1'],
    ['w2', null]
  ])
  it('is false when every queued item is loaded and linked to its task', () => {
    const state = makeHarnessState({
      taskQueue: [
        makeTask('t1', { planningWorkItemId: 'w1' }),
        makeTask('t0', { planningWorkItemId: null }),
        makeTask('t5', { planningWorkItemId: 'w5', status: 'complete' })
      ]
    })
    expect(harnessOutpacesBoard(state, links)).toBe(false)
  })
  it('is true for an unloaded item or a link the board has not seen', () => {
    expect(
      harnessOutpacesBoard(
        makeHarnessState({ taskQueue: [makeTask('t9', { planningWorkItemId: 'w9' })] }),
        links
      )
    ).toBe(true)
    expect(
      harnessOutpacesBoard(
        makeHarnessState({
          taskQueue: [makeTask('t2', { planningWorkItemId: 'w2', status: 'claimed' })]
        }),
        links
      )
    ).toBe(true)
  })
})

describe('usePlanningRecords safety poll (P9.1)', () => {
  /** Starts the hook under fake timers and returns how often the records were read. */
  async function pollReads(safetyPoll: boolean | undefined): Promise<number> {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const { reads } = setup()
      renderHook(() =>
        usePlanningRecords('p1', () => {}, safetyPoll === undefined ? undefined : { safetyPoll })
      )
      await waitFor(() => expect(reads.getPlanningWorkItems).toHaveBeenCalledTimes(1))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(PLANNING_POLL_MS * 3 + 10)
      })
      return reads.getPlanningWorkItems.mock.calls.length
    } finally {
      vi.useRealTimers()
    }
  }

  it('does not poll when told not to (agents off): idle means no calls', async () => {
    expect(await pollReads(false)).toBe(1)
  })

  it('polls once a minute when on, and by default', async () => {
    expect(await pollReads(true)).toBe(4)
    expect(await pollReads(undefined)).toBe(4)
  })
})
