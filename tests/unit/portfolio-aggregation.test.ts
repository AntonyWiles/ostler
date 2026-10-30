import { describe, expect, it } from 'vitest'
import {
  aggregatePortfolio,
  derivePortfolioRisks
} from '../../src/renderer/views/planning/portfolio-aggregation'
import type { PortfolioProjectInput } from '../../src/renderer/views/planning/portfolio-aggregation'

const base = (overrides: Partial<PortfolioProjectInput> = {}): PortfolioProjectInput => ({
  projectId: 'p1',
  projectName: 'Alpha',
  workItems: [],
  milestones: [],
  metrics: {
    itemCount: 0,
    completedCount: 0,
    averageLeadTimeMs: null,
    averageCycleTimeMs: null,
    averageQueueAgeMs: 0,
    totalBlockedTimeMs: 0,
    throughput: []
  },
  readiness: [],
  harness: null,
  now: Date.parse('2026-08-25'),
  ...overrides
})

describe('portfolio aggregation', () => {
  it('derives deterministic cross-project risk flags from project evidence', () => {
    const risks = derivePortfolioRisks(
      base({
        workItems: [
          {
            id: 'w1',
            projectId: 'p1',
            milestoneId: 'm1',
            title: 'review',
            description: '',
            status: 'review',
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
            createdAt: 1,
            updatedAt: Date.parse('2026-08-10')
          },
          {
            id: 'w2',
            projectId: 'p1',
            milestoneId: null,
            title: 'backlog',
            description: '',
            status: 'backlog',
            priority: 'low',
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
            createdAt: 1,
            updatedAt: 1
          }
        ],
        milestones: [
          {
            id: 'm1',
            projectId: 'p1',
            goalId: null,
            name: 'Release',
            outcome: '',
            targetDate: '2026-08-01',
            successCriteria: [],
            status: 'active',
            createdAt: 1,
            updatedAt: 1
          }
        ]
      })
    )
    expect(risks.map((risk) => risk.code)).toEqual([
      'no-active-work',
      'overdue-milestones',
      'stale-review-backlog'
    ])
  })

  it('judges a milestone overdue by the local date, as the Milestones view does', () => {
    const zone = process.env.TZ
    process.env.TZ = 'Pacific/Tongatapu'
    try {
      // 20:00 UTC on 25 Aug is already 26 Aug in Tonga, so a milestone due on
      // the 25th is overdue there.
      const risks = derivePortfolioRisks(
        base({
          now: Date.parse('2026-08-25T20:00:00Z'),
          milestones: [
            {
              id: 'm1',
              projectId: 'p1',
              goalId: null,
              name: 'Release',
              outcome: '',
              targetDate: '2026-08-25',
              successCriteria: [],
              status: 'active',
              createdAt: 1,
              updatedAt: 1
            }
          ]
        })
      )
      expect(risks.map((risk) => risk.code)).toContain('overdue-milestones')
    } finally {
      process.env.TZ = zone
    }
  })

  it('sums active sessions without mutating project data', () => {
    const summary = aggregatePortfolio([
      base({
        harness: {
          projectId: 'p1',
          hasHarness: true,
          activeSessions: [{} as never],
          reviewSessions: [],
          taskQueue: [],
          questions: [],
          watcherRunning: true
        }
      }),
      base({
        projectId: 'p2',
        projectName: 'Beta',
        harness: {
          projectId: 'p2',
          hasHarness: true,
          activeSessions: [],
          reviewSessions: [{} as never],
          taskQueue: [],
          questions: [],
          watcherRunning: true
        }
      })
    ])
    expect(summary.activeSessions).toBe(1)
    expect(summary.projects[1].reviewSessions).toBe(1)
  })
})
