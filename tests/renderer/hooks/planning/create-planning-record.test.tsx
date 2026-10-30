// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { OstlerAPI } from '@shared/ostler-api'
import { usePlanningWorkspace } from '@renderer/hooks/usePlanningWorkspace'
import { installOstlerApi } from '../../fixtures/ostler-api'
import { emptyPlanningReads } from '../../fixtures/planning-workspace'
import { makeWorkItem } from '../../fixtures/planning-records'

const submit = { preventDefault: () => {} } as unknown as React.FormEvent

/** The live workspace hook over a fake API, after its first load. */
async function renderWorkspace(api: Partial<OstlerAPI>) {
  installOstlerApi({ ...emptyPlanningReads(), ...api })
  const hook = renderHook(() => usePlanningWorkspace('p1', () => {}))
  await waitFor(() => {
    if (hook.result.current.loading) throw new Error('still loading')
  })
  return hook.result
}

describe('createPlanningRecord', () => {
  it('creates a task with every New task field in one create call', async () => {
    const createPlanningWorkItem = vi.fn(async () => ({
      ok: true as const,
      value: makeWorkItem('new', { title: 'Write the guide' })
    }))
    const updatePlanningWorkItem = vi.fn()
    const ws = await renderWorkspace({
      getPlanningWorkItems: async () => ({ ok: true, value: [makeWorkItem('w1')] }),
      createPlanningWorkItem: createPlanningWorkItem as never,
      updatePlanningWorkItem: updatePlanningWorkItem as never
    })

    act(() => {
      ws.current.setCreateMode('work-item')
      ws.current.setItemTitle('Write the guide')
      ws.current.setItemDescription('All of it')
      ws.current.setItemStatus('ready')
      ws.current.setItemPriority('high')
      ws.current.setItemLabels('docs, release')
      ws.current.setItemCriteria('Covers grid\nCovers paste')
      ws.current.setItemAssigneeId('person-1')
      ws.current.setItemStartDate('2026-10-12')
      ws.current.setItemTargetDate('2026-10-16')
      ws.current.setItemEstimate(3)
      ws.current.setItemDependencyIds(['w1'])
    })
    await act(() => ws.current.createPlanningRecord(submit))

    expect(createPlanningWorkItem).toHaveBeenCalledTimes(1)
    expect(createPlanningWorkItem).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({
        title: 'Write the guide',
        description: 'All of it',
        status: 'ready',
        priority: 'high',
        labels: ['docs', 'release'],
        acceptanceCriteria: ['Covers grid', 'Covers paste'],
        assigneeId: 'person-1',
        startDate: '2026-10-12',
        targetDate: '2026-10-16',
        estimate: 3,
        dependencyIds: ['w1']
      })
    )
    expect(updatePlanningWorkItem).not.toHaveBeenCalled()
  })

  it('creates a milestone with its success criteria', async () => {
    const createPlanningMilestone = vi.fn(async () => ({
      ok: true as const,
      value: { id: 'm1' }
    }))
    const ws = await renderWorkspace({ createPlanningMilestone: createPlanningMilestone as never })

    act(() => {
      ws.current.setCreateMode('milestone')
      ws.current.setMilestoneName('Beta')
      ws.current.setMilestoneCriteria(['  Installer signed ', '', 'Guide published'])
    })
    await act(() => ws.current.createPlanningRecord(submit))

    expect(createPlanningMilestone).toHaveBeenCalledTimes(1)
    expect(createPlanningMilestone).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({
        name: 'Beta',
        successCriteria: ['Installer signed', 'Guide published']
      })
    )
  })
})
