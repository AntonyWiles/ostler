import { describe, expect, it } from 'vitest'
import type { HarnessSession } from '../../src/shared/ostler-api'
import { recentAgentRuns } from '../../electron/services/harness/recent-runs'

function session(
  id: string,
  status: HarnessSession['status'],
  statusNote: string,
  startedAt: string,
  lastUpdate: string
) {
  return {
    id,
    title: `Run ${id}`,
    status,
    statusNote,
    startedAt,
    lastUpdate,
    provenance: 'embedded' as const,
    taskId: `task-${id}`
  }
}

describe('recentAgentRuns', () => {
  it('lists finished runs newest first, with how long they ran and how they ended', () => {
    const runs = recentAgentRuns(
      [
        session('a', 'done', 'Merged into main', '2026-10-09T10:00:00Z', '2026-10-09T10:30:00Z'),
        session(
          'b',
          'done',
          'Rejected: wrong file',
          '2026-10-09T11:00:00Z',
          '2026-10-09T11:05:00Z'
        ),
        session('c', 'done', 'Discarded', '2026-10-09T09:00:00Z', '2026-10-09T09:01:00Z'),
        session('d', 'active', '', '2026-10-09T12:00:00Z', '2026-10-09T12:00:00Z')
      ],
      new Set()
    )
    expect(runs.map((run) => [run.sessionId, run.outcome])).toEqual([
      ['b', 'rejected'],
      ['a', 'accepted'],
      ['c', 'discarded']
    ])
    expect(runs[1].endedAt - runs[1].startedAt).toBe(30 * 60 * 1000)
    expect(runs[1]).toMatchObject({ taskId: 'task-a', provenance: 'embedded' })
  })

  it('leaves out runs waiting for review, and keeps to the limit', () => {
    const sessions = [
      session('e', 'done', 'Session finished', '2026-10-09T10:00:00Z', '2026-10-09T10:10:00Z'),
      session('f', 'done', 'Stopped', '2026-10-09T10:00:00Z', '2026-10-09T10:20:00Z')
    ]
    expect(recentAgentRuns(sessions, new Set(['e'])).map((run) => run.outcome)).toEqual(['ended'])
    expect(recentAgentRuns(sessions, new Set(), 1)).toHaveLength(1)
  })
})
