import { describe, expect, it } from 'vitest'
import {
  HEALTH_TONE,
  milestoneHealth,
  milestoneOverdue,
  projectHealth
} from '../../src/shared/planning/health'
import { formatDays, overviewStats, throughputWeekStart } from '../../src/shared/planning/stats'
import { aggregateMetrics } from '../../electron/services/planning-metrics'
import type { PlanningWorkItem } from '../../src/shared/ostler-api'

const item = (overrides: Partial<PlanningWorkItem>): PlanningWorkItem => ({
  id: 'w1',
  projectId: 'p1',
  milestoneId: null,
  title: 'Task',
  description: '',
  status: 'ready',
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
  updatedAt: 0,
  ...overrides
})

describe('milestone and project health', () => {
  it('uses success for on track, warning for at risk and danger for blocked', () => {
    expect(HEALTH_TONE['on-track']).toBe('success')
    expect(HEALTH_TONE['at-risk']).toBe('warning')
    expect(HEALTH_TONE.blocked).toBe('danger')
  })

  it('puts blocked work ahead of a missed date, and an empty milestone apart', () => {
    expect(milestoneHealth({ linkedCount: 2, blockedCount: 1, overdue: true }).health).toBe(
      'blocked'
    )
    expect(milestoneHealth({ linkedCount: 2, blockedCount: 0, overdue: true }).health).toBe(
      'at-risk'
    )
    expect(milestoneHealth({ linkedCount: 0, blockedCount: 0, overdue: false }).health).toBe(
      'no-work'
    )
    expect(milestoneHealth({ linkedCount: 2, blockedCount: 0, overdue: false }).health).toBe(
      'on-track'
    )
  })

  it('asks to close an open milestone whose linked work is all done, even past its date', () => {
    const done = { linkedCount: 2, blockedCount: 0, overdue: true, doneCount: 2 }
    expect(milestoneHealth({ ...done, open: true }).health).toBe('ready-to-close')
    expect(milestoneHealth({ ...done, open: false }).health).toBe('at-risk')
    expect(milestoneHealth({ ...done, doneCount: 1, open: true }).health).toBe('at-risk')
  })

  it('counts only open milestones as overdue', () => {
    const due = { targetDate: '2026-01-01' }
    expect(milestoneOverdue({ ...due, status: 'active' }, '2026-02-01')).toBe(true)
    expect(milestoneOverdue({ ...due, status: 'complete' }, '2026-02-01')).toBe(false)
    expect(milestoneOverdue({ targetDate: null, status: 'active' }, '2026-02-01')).toBe(false)
  })

  it('rates a project from its blocked tasks and risk flags', () => {
    expect(projectHealth({ blockedCount: 0, risks: [] }).health).toBe('on-track')
    expect(projectHealth({ blockedCount: 0, risks: [{ label: 'Overdue' }] }).health).toBe('at-risk')
    expect(projectHealth({ blockedCount: 2, risks: [] }).health).toBe('blocked')
  })
})

describe('overview stats', () => {
  it('reads done this week from the same weekly bucket the metrics count', () => {
    const now = Date.parse('2026-10-08T12:00:00Z') // a Thursday
    const DAY = 86_400_000
    const items = [
      item({ id: 'a', status: 'done' }),
      item({ id: 'b', status: 'done' }),
      item({ id: 'c', status: 'ready', targetDate: '2026-10-01' }),
      item({ id: 'd', status: 'active', targetDate: '2026-12-01' })
    ]
    const metrics = aggregateMetrics(
      items,
      [
        { workItemId: 'a', from: 'active', to: 'done', at: now - DAY },
        { workItemId: 'b', from: 'active', to: 'done', at: now - 10 * DAY }
      ] as never,
      now
    )
    expect(throughputWeekStart(now)).toBe(Date.parse('2026-10-04T00:00:00Z'))
    expect(overviewStats(items, metrics, now, '2026-10-08')).toEqual({
      open: 2,
      doneThisWeek: 1,
      overdue: 1,
      averageCycleTimeMs: null
    })
  })

  it('writes durations with their unit', () => {
    expect(formatDays(null)).toBe('—')
    expect(formatDays(3 * 3_600_000)).toBe('< 1 day')
    expect(formatDays(86_400_000)).toBe('1 day')
    expect(formatDays(3 * 86_400_000)).toBe('3 days')
  })
})
