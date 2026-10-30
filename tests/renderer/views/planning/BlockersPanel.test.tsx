// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BlockersPanel } from '@renderer/views/planning/BlockersPanel'
import type { PlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import type { PlanningBlockerWithWorkItem, ProjectStateUpdate } from '@shared/ostler-api'
import { installOstlerApi } from '../../fixtures/ostler-api'

const blocker: PlanningBlockerWithWorkItem = {
  id: 'b1',
  workItemId: 'w1',
  workItemTitle: 'Add a timer',
  workItemCode: 'PD-1',
  description: 'Which sound should the timer play?',
  reportedBy: 'agent',
  reportedAt: Date.now(),
  status: 'open',
  resolutionOptions: [],
  resolutionChoice: null,
  resolutionNote: '',
  resolvedAt: null,
  resolvedBy: null
}

const ws = { workItems: [], openWorkItem: vi.fn() } as unknown as PlanningWorkspace

describe('BlockersPanel', () => {
  afterEach(() => vi.useRealTimers())

  it('updates when a change event arrives, and sets no interval', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    let open: PlanningBlockerWithWorkItem[] = []
    const listeners: Array<(update: ProjectStateUpdate) => void> = []
    const listOpenBlockers = vi.fn(async () => ({ ok: true as const, value: open }))
    installOstlerApi({
      listOpenBlockers,
      onProjectStateChange: (callback) => {
        listeners.push(callback)
        return () => listeners.splice(listeners.indexOf(callback), 1)
      }
    })

    render(<BlockersPanel ws={ws} projectId="p1" />)
    // Mounting (its effects run inside render) starts no timer of its own.
    expect(setIntervalSpy).not.toHaveBeenCalled()
    await waitFor(() => expect(listOpenBlockers).toHaveBeenCalledTimes(1))
    expect(screen.queryByText(blocker.description)).toBeNull()

    // An agent reports a blocker: main sends a planning change for the project.
    open = [blocker]
    act(() =>
      listeners.forEach((listener) =>
        listener({ projectId: 'p1', field: 'planning', data: { blockers: true } })
      )
    )
    expect(await screen.findByText(blocker.description)).toBeTruthy()

    // A change for another project, or another field, does not reload.
    act(() =>
      listeners.forEach((listener) => listener({ projectId: 'p2', field: 'planning', data: null }))
    )
    act(() =>
      listeners.forEach((listener) => listener({ projectId: 'p1', field: 'git', data: null }))
    )
    expect(listOpenBlockers).toHaveBeenCalledTimes(2)

    // Time passing alone loads nothing: there is no poll.
    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })
    expect(listOpenBlockers).toHaveBeenCalledTimes(2)
  })
})
