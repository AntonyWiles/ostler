import type { ProjectReport } from '@shared/ostler-api'

/**
 * A project report as main sends it (electron/services/report-builder.ts):
 * one open, overdue task created 20 days ago and nothing finished.
 */
export function overdueOnlyReport(task: { id: string; title: string }): ProjectReport {
  const days = ['2026-10-06', '2026-10-07', '2026-10-08']
  const counts = { backlog: 0, ready: 1, active: 0, blocked: 0, review: 0, done: 0 }
  return {
    projectId: 'p1',
    range: '30d',
    rangeLabel: 'Last 30 days',
    from: '2026-09-09',
    to: '2026-10-08',
    generatedAt: Date.now(),
    estimateUnit: 'points',
    keyNumbers: {
      open: 1,
      doneInRange: 0,
      overdueNow: 1,
      dueNext7Days: 0,
      cycleTimeMedianMs: null,
      cycleTimeP85Ms: null,
      cycleTimeSampleSize: 0,
      leadTimeMedianMs: null,
      leadTimeSampleSize: 0
    },
    burnUp: [],
    cumulativeFlow: {
      points: days.map((date) => ({ date, counts })),
      summary: 'Work in progress held at 0 tasks in the last 30 days, while done rose by 0.'
    },
    throughput: {
      weeks: [],
      summary: 'Nothing has been finished yet, so there is no throughput to show.'
    },
    cycleTime: {
      buckets: [],
      sampleSize: 0,
      summary: 'No task was finished in the last 30 days, so there is no cycle time to show.'
    },
    workload: {
      rows: [
        {
          personId: null,
          name: 'Unassigned',
          openCount: 1,
          estimateSum: 0,
          unestimatedCount: 1,
          overdueCount: 1
        }
      ],
      summary: 'The one open task is unassigned.'
    },
    atRisk: {
      overdue: [
        {
          id: task.id,
          title: task.title,
          status: 'ready',
          targetDate: '2000-01-01',
          assigneeId: null
        }
      ],
      blocked: [],
      conflicts: [],
      lateMilestones: [],
      unforecastMilestones: [],
      summary: 'At risk: 1 overdue task.'
    }
  }
}
