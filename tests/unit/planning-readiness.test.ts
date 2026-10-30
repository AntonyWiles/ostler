import { describe, expect, it } from 'vitest'
import { buildReadinessReport, type ReadinessEvidence } from '../../src/shared/planning-readiness'
import type { PlanningWorkItem } from '@shared/ostler-api'

const item = (
  id: string,
  acceptanceCriteria: string[],
  status: PlanningWorkItem['status'] = 'ready'
): PlanningWorkItem => ({
  id,
  projectId: 'p',
  milestoneId: 'm',
  title: id,
  description: '',
  status,
  priority: 'medium',
  labels: [],
  acceptanceCriteria,
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
  updatedAt: 0
})
const base = (items: PlanningWorkItem[]): ReadinessEvidence => ({
  items,
  metrics: new Map(),
  reviewCount: 0,
  pendingQuestionCount: 0,
  gitDirty: false,
  gitConflicted: 0
})

describe('milestone readiness', () => {
  it('passes a clean milestone only once its linked work is done', () => {
    const finished = buildReadinessReport('m', base([item('a', ['done'], 'done')]))
    expect(finished.checks.every((check) => check.state === 'pass')).toBe(true)
    expect(finished.verdict).toBe('ready')
    // The same milestone with its work not started used to pass identically.
    const unstarted = buildReadinessReport('m', base([item('a', ['done'])]))
    expect(unstarted.checks.find((check) => check.id === 'linked-work')?.state).toBe('fail')
    expect(unstarted.verdict).toBe('not-ready')
  })
  it('fails incomplete criteria and blocked work', () => {
    const report = buildReadinessReport('m', base([item('a', [], 'blocked'), item('b', ['done'])]))
    expect(report.checks.find((check) => check.id === 'acceptance-criteria')?.state).toBe('fail')
    expect(report.checks.find((check) => check.id === 'blocked-or-stale')?.state).toBe('fail')
  })
  it('warns for review, questions, sign-off, and fails dirty git', () => {
    const report = buildReadinessReport('m', {
      ...base([]),
      reviewCount: 1,
      pendingQuestionCount: 2,
      gitDirty: true,
      signOffs: [{ id: 's', label: 'Approve', completed: false }]
    })
    expect(report.checks.map((check) => check.state)).toEqual([
      'warning',
      'pass',
      'pass',
      'warning',
      'warning',
      'fail',
      'warning'
    ])
  })
  it('detects stale queue age from D2 metrics', () => {
    const evidence = base([item('a', ['done'])])
    evidence.metrics.set('a', {
      leadTimeMs: null,
      cycleTimeMs: null,
      queueAgeMs: 7 * 86_400_000,
      blockedTimeMs: 0,
      completedAt: null
    })
    expect(
      buildReadinessReport('m', evidence).checks.find((check) => check.id === 'blocked-or-stale')
        ?.state
    ).toBe('fail')
  })
})
