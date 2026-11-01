// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { usePlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import { renderPlanningWorkspace } from '../fixtures/planning-workspace'
import { installOstlerApi } from '../fixtures/ostler-api'
import { planningScenario, SCENARIO_EXPECTED } from '../fixtures/planning-records'
import { fakeSavedViews } from '../fixtures/saved-views'
import type { TaskFilterField } from '@shared/task-filter'
import { PLANNING_WORKSPACE_KEYS } from '../fixtures/planning-workspace-keys'

/**
 * Characterisation tests: what the planning workspace derives from one fixed
 * board, pinned through the hook's public shape. Written before the hook was
 * split, so the split had to keep every one of these answers.
 */
async function scenarioWorkspace() {
  const { items, harness } = planningScenario()
  return renderPlanningWorkspace({
    api: {
      getPlanningWorkItems: async () => ({ ok: true, value: items }),
      getHarnessState: async () => ({ ok: true, value: harness })
    }
  })
}

const ids = (items: { id: string }[]) => items.map((item) => item.id)

describe('planning workspace rules', () => {
  it('projects every item into its board column', async () => {
    const ws = await scenarioWorkspace()
    const projected = Object.fromEntries(
      ws.workItems.map((item) => [item.id, ws.projectedStatus(item)])
    )
    expect(projected).toEqual(SCENARIO_EXPECTED.projectedStatus)
  })

  it('labels linked work by what the harness is doing with it', async () => {
    const ws = await scenarioWorkspace()
    for (const [id, label] of Object.entries(SCENARIO_EXPECTED.executionLabel)) {
      expect([id, ws.executionLabel(ws.workItemsById.get(id)!)]).toEqual([id, label])
    }
  })

  it('names unmet dependencies and agrees with dependenciesComplete', async () => {
    const ws = await scenarioWorkspace()
    for (const [id, unmet] of Object.entries(SCENARIO_EXPECTED.unmetDependencies)) {
      const item = ws.workItemsById.get(id)!
      expect([id, ids(ws.unmetDependencies(item))]).toEqual([id, unmet])
      expect([id, ws.dependenciesComplete(item)]).toEqual([id, unmet.length === 0])
    }
  })

  it('lists unmet dependencies sitting in review and the work waiting on an item', async () => {
    const ws = await scenarioWorkspace()
    expect(ids(ws.unmetDependenciesInReview(ws.workItemsById.get('o')!))).toEqual(['i'])
    expect(ids(ws.unmetDependenciesInReview(ws.workItemsById.get('b')!))).toEqual([])
    expect(ids(ws.dependentsWaitingOn(ws.workItemsById.get('a')!))).toEqual(['b'])
    expect(ids(ws.dependentsWaitingOn(ws.workItemsById.get('c')!))).toEqual([])
  })

  it('reports queue position and dependency wait', async () => {
    const ws = await scenarioWorkspace()
    for (const [id, position] of Object.entries(SCENARIO_EXPECTED.queuePosition)) {
      expect([id, ws.queuePositionOf(ws.workItemsById.get(id)!)]).toEqual([id, position])
    }
    for (const [id, wait] of Object.entries(SCENARIO_EXPECTED.queueWait)) {
      expect([id, ws.queueWaitOf(ws.workItemsById.get(id)!)]).toEqual([id, wait])
    }
    expect(ids(ws.runnableHarnessTasks)).toEqual(SCENARIO_EXPECTED.runnableTasks)
    expect(ws.queueSummary).toEqual({
      running: 1,
      starting: 1,
      queued: 2,
      waiting: 1,
      review: 1,
      sessions: 1
    })
  })

  it('offers Queue only for unlinked Ready work whose dependencies are met', async () => {
    const ws = await scenarioWorkspace()
    const queueable = ws.workItems.filter((item) => ws.isQueueable(item))
    expect(ids(queueable)).toEqual(['d', 'n', 'r'])
  })

  it('builds the ready, active and blocked lists', async () => {
    const ws = await scenarioWorkspace()
    expect(ids(ws.readyNow)).toEqual(SCENARIO_EXPECTED.readyNow)
    expect(ids(ws.activeNow)).toEqual(SCENARIO_EXPECTED.activeNow)
    expect(ids(ws.blockedNow)).toEqual(SCENARIO_EXPECTED.blockedNow)
  })

  it('fills each column with its projected items in board order', async () => {
    const ws = await scenarioWorkspace()
    const columns = Object.fromEntries(
      [...ws.itemsByStatus.entries()].map(([status, items]) => [status, ids(items)])
    )
    expect(columns).toEqual({
      backlog: ['a'],
      ready: ['b', 'd', 'e', 'f', 'k', 'l', 'm', 'n', 'o', 'q', 'r'],
      active: ['h'],
      blocked: ['g', 'p'],
      review: ['i'],
      done: ['c', 'j']
    })
  })
})

describe('planning workspace filtering and sorting', () => {
  function renderScenario() {
    const { items, harness } = planningScenario()
    installOstlerApi({
      getPlanningGoals: async () => ({ ok: true, value: [] }),
      getPlanningMilestones: async () => ({
        ok: true,
        value: [
          {
            id: 'm1',
            projectId: 'p1',
            goalId: 'g1',
            name: 'Milestone one',
            successCriteria: [],
            outcome: '',
            status: 'active',
            targetDate: null,
            createdAt: 1,
            updatedAt: 1
          }
        ]
      }),
      getPlanningWorkItems: async () => ({ ok: true, value: items }),
      getPlanningDecisions: async () => ({ ok: true, value: [] }),
      getPlanningWipLimits: async () => ({ ok: true, value: {} }),
      getPlanningLatestStatusChanges: async () => ({ ok: true, value: {} }),
      listOpenBlockers: async () => ({ ok: true, value: [] }),
      getAIProjectBrief: async () => ({ ok: true, value: null }),
      listWorkItemsWithChangedSources: async () => ({ ok: true, value: [] }),
      countWorkItemAttachments: async () => ({ ok: true, value: {} }),
      getHarnessState: async () => ({ ok: true, value: harness }),
      ...fakeSavedViews().api
    })
    return renderHook(() => usePlanningWorkspace('p1', () => {}))
  }

  async function loaded() {
    const view = renderScenario()
    await waitFor(() => expect(view.result.current.workItems).toHaveLength(18))
    return view
  }

  it('keeps manual order by default', async () => {
    const { result } = await loaded()
    expect(ids(result.current.filteredWorkItems)).toEqual(ids(result.current.workItems))
  })

  it('matches the query against title, description and labels', async () => {
    const { result } = await loaded()
    act(() => result.current.boardView.setQuery('ui'))
    await waitFor(() => expect(ids(result.current.filteredWorkItems)).toEqual(['a', 'p']))
  })

  it('filters by priority, milestone and goal', async () => {
    const { result } = await loaded()
    const only = (field: TaskFilterField, value: string[]) =>
      act(() =>
        result.current.boardView.setFilter({
          match: 'all',
          conditions: [{ field, op: 'is', value }]
        })
      )
    only('priority', ['high'])
    await waitFor(() => expect(ids(result.current.filteredWorkItems)).toEqual(['b']))
    only('milestone', ['m1'])
    await waitFor(() => expect(ids(result.current.filteredWorkItems)).toEqual(['d', 'o']))
    only('goal', ['g1'])
    await waitFor(() => expect(ids(result.current.filteredWorkItems)).toEqual(['d', 'o']))
    only('goal', ['none'])
    await waitFor(() => expect(result.current.filteredWorkItems).toHaveLength(16))
  })

  it('hides projected-done work when asked', async () => {
    const { result } = await loaded()
    act(() => result.current.setBoardHideDone(true))
    await waitFor(() => expect(result.current.filteredWorkItems).toHaveLength(16))
    expect(ids(result.current.filteredWorkItems)).not.toContain('j')
  })

  it('sorts by priority, target date, title and creation, both ways', async () => {
    const { result } = await loaded()
    act(() => result.current.setBoardSortBy('priority'))
    await waitFor(() =>
      expect(ids(result.current.filteredWorkItems).slice(0, 2)).toEqual(['h', 'b'])
    )
    expect(ids(result.current.filteredWorkItems).at(-1)).toBe('a')

    act(() => result.current.setBoardSortBy('targetDate'))
    await waitFor(() =>
      expect(ids(result.current.filteredWorkItems).slice(0, 2)).toEqual(['d', 'b'])
    )

    act(() => result.current.setBoardSortDir('desc'))
    await waitFor(() =>
      expect(ids(result.current.filteredWorkItems).slice(0, 2)).toEqual(['b', 'd'])
    )

    act(() => result.current.setBoardSortBy('title'))
    await waitFor(() => expect(ids(result.current.filteredWorkItems)[0]).toBe('r'))

    act(() => result.current.setBoardSortBy('created'))
    act(() => result.current.setBoardSortDir('asc'))
    await waitFor(() => expect(ids(result.current.filteredWorkItems)[0]).toBe('d'))
  })
})

describe('planning workspace shape', () => {
  it('exposes exactly the members views were written against', async () => {
    const ws = await renderPlanningWorkspace()
    expect(Object.keys(ws).sort()).toEqual([...PLANNING_WORKSPACE_KEYS])
  })
})
