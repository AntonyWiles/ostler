import { describe, expect, it } from 'vitest'
import { aggregateMetrics, metricsForItem } from '../../electron/services/planning-metrics'
import type { PlanningStatusTransition, PlanningWorkItem } from '@shared/ostler-api'

const item: PlanningWorkItem = {
  id: 'a',
  projectId: 'p',
  milestoneId: null,
  title: 'A',
  description: '',
  status: 'done',
  priority: 'medium',
  labels: [],
  acceptanceCriteria: [],
  dependencyIds: [],
  targetDate: null,
  startDate: null,
  assigneeId: null,
  estimate: null,
  checkedCriteria: [],
  origin: 'human',
  linkedHarnessTaskId: null,
  autoQueue: false,
  parentWorkItemId: null,
  taskCode: '',
  phaseCode: '',
  phaseName: '',
  subtaskPhaseNumber: null,
  subtaskPhaseName: '',
  verificationStatus: 'unverified',
  verifiedBy: null,
  verifiedAt: null,
  verificationNotes: '',
  createdAt: 0,
  updatedAt: 20_000
}
const history: PlanningStatusTransition[] = [
  { workItemId: 'a', from: null, to: 'backlog', at: 0 },
  { workItemId: 'a', from: 'backlog', to: 'ready', at: 5_000 },
  { workItemId: 'a', from: 'ready', to: 'blocked', at: 7_000 },
  { workItemId: 'a', from: 'blocked', to: 'active', at: 10_000 },
  { workItemId: 'a', from: 'active', to: 'done', at: 20_000 }
]

describe('planning metrics', () => {
  it('computes lead, cycle, queue and blocked time exactly', () => {
    expect(metricsForItem(item, history, 30_000)).toEqual({
      leadTimeMs: 20_000,
      cycleTimeMs: 10_000,
      queueAgeMs: 0,
      blockedTimeMs: 3_000,
      completedAt: 20_000
    })
  })
  it('counts throughput in weekly buckets and averages completed items', () => {
    const open = { ...item, id: 'b', status: 'active' as const, createdAt: 10_000 }
    const result = aggregateMetrics([item, open], [...history], 30_000)
    expect(result.completedCount).toBe(1)
    expect(result.averageLeadTimeMs).toBe(20_000)
    expect(result.averageCycleTimeMs).toBe(10_000)
    expect(result.averageQueueAgeMs).toBe(10_000)
    expect(result.totalBlockedTimeMs).toBe(3_000)
    expect(result.throughput[0].count).toBe(1)
  })

  it('falls back to first ready when never active; sums repeated blocked visits', () => {
    const repeated = { ...item, id: 'c', createdAt: 1_000 }
    const repeatedHistory: PlanningStatusTransition[] = [
      { workItemId: 'c', from: null, to: 'backlog', at: 1_000 },
      { workItemId: 'c', from: 'backlog', to: 'blocked', at: 2_000 },
      { workItemId: 'c', from: 'blocked', to: 'ready', at: 4_000 },
      { workItemId: 'c', from: 'ready', to: 'blocked', at: 6_000 },
      { workItemId: 'c', from: 'blocked', to: 'done', at: 9_000 }
    ]
    expect(metricsForItem(repeated, repeatedHistory, 10_000)).toEqual({
      leadTimeMs: 8_000,
      cycleTimeMs: 5_000,
      queueAgeMs: 0,
      blockedTimeMs: 5_000,
      completedAt: 9_000
    })
  })
})
