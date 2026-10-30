import { describe, expect, it } from 'vitest'
import type { HarnessSession, HarnessTask } from '../../src/shared/ostler-api'
import {
  agentRunState,
  agentRunStateLabel,
  sessionRunState
} from '../../src/shared/agent-run-state'

const task = (overrides: Partial<HarnessTask> = {}): HarnessTask => ({
  id: 'task-1',
  title: 'Add a timer',
  status: 'pending',
  claimedBy: null,
  details: '',
  priority: 'medium',
  planningWorkItemId: 'item-1',
  autoContinue: false,
  ...overrides
})

const session = (overrides: Partial<HarnessSession> = {}): HarnessSession => ({
  id: 'session-1',
  title: 'Agent one',
  startedAt: '2026-10-10T10:00:00.000Z',
  lastUpdate: '2026-10-10T10:00:00.000Z',
  statusNote: '',
  status: 'active',
  blocked: false,
  workspace: null,
  token: 'secret',
  lastSeenAt: null,
  taskId: 'task-1',
  provenance: 'embedded',
  ...overrides
})

const none = { activeSessions: [], reviewSessions: [] }

describe('agentRunState', () => {
  it('reads a queued task as Queued, and a held one as On hold', () => {
    expect(agentRunState(task(), none)).toBe('queued')
    expect(agentRunState(task({ hold: true }), none)).toBe('onHold')
  })

  it('reads a reserved task as Starting', () => {
    expect(
      agentRunState(
        task({
          copy: {
            state: 'preparing',
            preparedAt: '2026-01-01T00:00:00.000Z',
            hasWork: false,
            branchName: 'ostler/t',
            worktreePath: '/copies/t',
            baseBranch: 'main',
            baseCommit: 'abc'
          }
        }),
        none
      )
    ).toBe('starting')
  })

  it('reads a claimed task as Running, or Waiting for you while its agent asks', () => {
    const claimed = task({ status: 'claimed', claimedBy: 'session-1' })
    expect(agentRunState(claimed, { activeSessions: [session()], reviewSessions: [] })).toBe(
      'running'
    )
    expect(
      agentRunState(claimed, {
        activeSessions: [session({ blocked: true, status: 'blocked' })],
        reviewSessions: []
      })
    ).toBe('waitingForYou')
    expect(agentRunState(claimed, none)).toBe('running')
  })

  it('reads a complete task whose work waits for review as In review, never Complete', () => {
    const complete = task({ status: 'complete', claimedBy: 'session-1' })
    const review = { activeSessions: [], reviewSessions: [session({ status: 'done' })] }
    expect(agentRunState(complete, review)).toBe('inReview')
  })

  it('reads a failed run that is still in review as In review, though its task is queued again', () => {
    const released = task({ status: 'pending', claimedBy: null })
    const review = { activeSessions: [], reviewSessions: [session({ status: 'done' })] }
    expect(agentRunState(released, review)).toBe('inReview')
  })

  it('reads a task taken again by a new agent as Running, not the old run in review', () => {
    const retaken = task({ status: 'claimed', claimedBy: 'session-2' })
    const harness = {
      activeSessions: [session({ id: 'session-2' })],
      reviewSessions: [session({ status: 'done' })]
    }
    expect(agentRunState(retaken, harness)).toBe('running')
  })

  it('reads accepted and cancelled tasks', () => {
    expect(agentRunState(task({ status: 'complete' }), none)).toBe('accepted')
    expect(agentRunState(task({ status: 'cancelled' }), none)).toBe('cancelled')
  })
})

describe('sessionRunState', () => {
  it('reads a session in review as In review', () => {
    const done = session({ status: 'done' })
    expect(sessionRunState(done, { reviewSessions: [done], taskQueue: [] })).toBe('inReview')
  })

  it('reads a running session from its task, and a bare one from itself', () => {
    const running = session()
    expect(
      sessionRunState(running, {
        reviewSessions: [],
        activeSessions: [running],
        taskQueue: [task({ status: 'claimed', claimedBy: 'session-1' })]
      })
    ).toBe('running')
    expect(
      sessionRunState(session({ taskId: null, blocked: true }), {
        reviewSessions: [],
        taskQueue: []
      })
    ).toBe('waitingForYou')
  })
})

describe('agentRunStateLabel', () => {
  it('names each state in the shared words, and a queued run by its place', () => {
    expect(agentRunStateLabel('inReview')).toBe('In review')
    expect(agentRunStateLabel('accepted')).toBe('Accepted')
    expect(agentRunStateLabel('queued', 0)).toBe('Next to start')
    expect(agentRunStateLabel('queued', 2)).toBe('Queued #3')
  })
})
