import { describe, expect, it } from 'vitest'
import {
  AgentEventStream,
  EventQueryError,
  EventWaitLimitError,
  MAX_CONCURRENT_EVENT_WAITS,
  parseEventQuery
} from '../../electron/services/agent-events'
import { harnessStateEvents } from '../../electron/services/harness/state-events'
import { emptyState, type StoredHarnessState } from '../../electron/services/harness/types'

const all = () => true
const never = new AbortController().signal

describe('AgentEventStream (D41)', () => {
  it('keeps events in order, with cursors that go up by one from when the stream started', () => {
    const stream = new AgentEventStream(500, () => 1_000)
    expect(stream.cursor).toBe(1_000)
    const first = stream.publish('p', { type: 'task.queued', taskId: 't1' })
    const second = stream.publish('p', { type: 'task.claimed', taskId: 't1', sessionId: 's1' })
    expect([first.cursor, second.cursor]).toEqual([1_001, 1_002])
    expect(first).toMatchObject({ projectId: 'p', at: new Date(1_000).toISOString() })

    expect(stream.read('p', 1_000, all).events.map((event) => event.type)).toEqual([
      'task.queued',
      'task.claimed'
    ])
    expect(stream.read('p', 1_001, all)).toEqual({ events: [second], cursor: 1_002 })
    expect(stream.read('p', 1_002, all)).toEqual({ events: [], cursor: 1_002 })
  })

  it('reads from now without a cursor, and keeps projects apart', () => {
    const stream = new AgentEventStream()
    stream.publish('a', { type: 'task.queued', taskId: 't1' })
    expect(stream.read('a', null, all)).toEqual({ events: [], cursor: stream.cursor })

    const start = stream.cursor
    stream.publish('b', { type: 'task.queued', taskId: 't2' })
    expect(stream.read('a', start, all).events).toEqual([])
    expect(stream.read('b', start, all).events).toHaveLength(1)
  })

  it('bounds each project and answers resync for a cursor older than what it keeps', () => {
    const stream = new AgentEventStream(3, () => 0)
    for (let index = 0; index < 5; index += 1) {
      stream.publish('p', { type: 'task.queued', taskId: `t${index}` })
    }
    // Cursors 1 and 2 were dropped; 3, 4 and 5 are kept.
    expect(stream.read('p', 1, all)).toEqual({ events: [], cursor: 5, resync: true })
    expect(stream.read('p', 2, all).events.map((event) => event.taskId)).toEqual(['t2', 't3', 't4'])
    // Another project's buffer is its own.
    expect(stream.read('q', 1, all).resync).toBeUndefined()
  })

  it('answers resync for a cursor from before a restart or from the future', () => {
    const earlier = new AgentEventStream(500, () => 1_000)
    earlier.publish('p', { type: 'task.queued', taskId: 't1' })
    const later = new AgentEventStream(500, () => 5_000)
    expect(later.read('p', earlier.cursor, all).resync).toBe(true)
    expect(later.read('p', later.cursor + 1, all).resync).toBe(true)
  })

  it('filters what a caller may see, and its cursor still moves on', () => {
    const stream = new AgentEventStream(500, () => 0)
    stream.publish('p', { type: 'guidance.sent', sessionId: 'other', guidanceId: 'g1' })
    stream.publish('p', { type: 'task.queued', taskId: 't1' })
    const page = stream.read('p', 0, (event) => event.sessionId !== 'other')
    expect(page.events.map((event) => event.type)).toEqual(['task.queued'])
    expect(page.cursor).toBe(2)
  })

  it('waits for the next event the caller may see', async () => {
    const stream = new AgentEventStream()
    const start = stream.cursor
    const waiting = stream.wait(
      'p',
      start,
      30,
      (event) => event.type === 'task.claimed',
      'tok',
      never
    )
    stream.publish('p', { type: 'task.queued', taskId: 't1' })
    stream.publish('q', { type: 'task.claimed', taskId: 't9' })
    stream.publish('p', { type: 'task.claimed', taskId: 't1' })
    const page = await waiting
    expect(page.events.map((event) => [event.type, event.taskId])).toEqual([['task.claimed', 't1']])
  })

  it('returns empty after the wait, and at once when aborted', async () => {
    const stream = new AgentEventStream()
    const empty = await stream.wait('p', null, 0.05, all, 'tok', never)
    expect(empty).toEqual({ events: [], cursor: stream.cursor })

    const stop = new AbortController()
    const waiting = stream.wait('p', null, 60, all, 'tok', stop.signal)
    stop.abort()
    await expect(waiting).resolves.toEqual({ events: [], cursor: stream.cursor })
  })

  it('caps concurrent waits per token and frees a slot when a wait ends', async () => {
    const stream = new AgentEventStream()
    const stop = new AbortController()
    const waits = Array.from({ length: MAX_CONCURRENT_EVENT_WAITS }, () =>
      stream.wait('p', null, 60, all, 'tok', stop.signal)
    )
    await expect(stream.wait('p', null, 60, all, 'tok', stop.signal)).rejects.toBeInstanceOf(
      EventWaitLimitError
    )
    // Another token is not affected, and a read that returns at once needs no slot.
    const other = stream.wait('p', null, 60, all, 'other', stop.signal)
    expect(stream.read('p', null, all).events).toEqual([])
    stop.abort()
    await Promise.all([...waits, other])
    await expect(stream.wait('p', null, 0.01, all, 'tok', never)).resolves.toMatchObject({
      events: []
    })
  })

  it('validates since and wait', () => {
    expect(parseEventQuery(new URLSearchParams(''))).toEqual({ since: null, wait: 0 })
    expect(parseEventQuery(new URLSearchParams('since=12&wait=60'))).toEqual({
      since: 12,
      wait: 60
    })
    for (const query of ['since=abc', 'since=-1', 'wait=61', 'wait=-1', 'wait=x']) {
      expect(() => parseEventQuery(new URLSearchParams(query))).toThrow(EventQueryError)
    }
  })
})

describe('harnessStateEvents', () => {
  const session = (id: string, status: 'active' | 'done' | 'blocked', note = '') => ({
    id,
    title: id,
    startedAt: '',
    lastUpdate: '',
    statusNote: note,
    status,
    overview: '',
    assignedTaskId: null,
    workspace: null,
    token: 'x',
    lastSeenAt: null,
    taskId: 'task-1',
    provenance: 'external' as const
  })
  const state = (changes: Partial<StoredHarnessState>): StoredHarnessState => ({
    ...emptyState(),
    ...changes
  })

  it('names what one write changed: runs, questions, the queue and guidance', () => {
    const before = state({
      sessions: [session('s1', 'active'), session('s2', 'active', 'working')],
      tasks: [
        {
          id: 'task-1',
          title: 'T',
          details: '',
          status: 'pending',
          claimedBy: null,
          priority: 'medium',
          planningWorkItemId: 'w1',
          autoContinue: false,
          hold: false
        }
      ],
      questions: [
        {
          id: 'q1',
          sessionId: 's2',
          sessionTitle: 's2',
          question: '?',
          answer: null,
          askedAt: '',
          answeredAt: null,
          status: 'pending'
        }
      ],
      guidance: [
        {
          id: 'g1',
          sessionId: 's2',
          text: 'Old',
          from: 'Me',
          via: 'app',
          sentAt: '',
          deliveredAt: null
        }
      ]
    })
    const after = structuredClone(before)
    after.sessions[0].status = 'done'
    after.sessions[1].statusNote = 'still working'
    after.sessions.push(session('s3', 'active'))
    after.tasks[0].status = 'claimed'
    after.tasks[0].claimedBy = 's3'
    after.questions[0].status = 'answered'
    after.guidance[0].deliveredAt = 'now'
    after.guidance.push({ ...after.guidance[0], id: 'g2', text: 'New', deliveredAt: null })

    expect(harnessStateEvents(before, after)).toEqual([
      { type: 'run.ended', sessionId: 's1', taskId: 'task-1' },
      { type: 'run.updated', sessionId: 's2', taskId: 'task-1' },
      { type: 'run.started', sessionId: 's3', taskId: 'task-1' },
      { type: 'question.answered', sessionId: 's2', questionId: 'q1' },
      { type: 'task.claimed', taskId: 'task-1', workItemId: 'w1', sessionId: 's3' },
      { type: 'guidance.delivered', sessionId: 's2', guidanceId: 'g1' },
      { type: 'guidance.sent', sessionId: 's2', guidanceId: 'g2', text: 'New' }
    ])
  })

  it('reads a run that finished with its workspace waiting as entering review, then ending', () => {
    const running = state({
      sessions: [
        {
          ...session('s1', 'active'),
          workspace: {
            worktreePath: '',
            branchName: 'b',
            baseBranch: 'main',
            baseCommit: 'c'
          }
        }
      ]
    })
    const inReview = structuredClone(running)
    inReview.sessions[0].status = 'done'
    expect(harnessStateEvents(running, inReview)).toEqual([
      { type: 'run.review', sessionId: 's1', taskId: 'task-1' }
    ])

    const accepted = structuredClone(inReview)
    accepted.sessions[0].workspace!.closed = true
    expect(harnessStateEvents(inReview, accepted)).toEqual([
      { type: 'run.ended', sessionId: 's1', taskId: 'task-1' }
    ])
  })

  it('says nothing for a write that changes nothing it reports, such as a connection time', () => {
    const before = state({ sessions: [session('s1', 'active')] })
    const after = structuredClone(before)
    after.sessions[0].lastSeenAt = 'now'
    expect(harnessStateEvents(before, after)).toEqual([])
  })
})
