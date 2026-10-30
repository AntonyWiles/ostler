import { describe, expect, it } from 'vitest'
import type { PlanningWorkItem } from '../../src/shared/ostler-api'
import { projectWorkItemStatus } from '../../src/shared/work-item-status'
import { dependencyCandidates, unmetDependencyIds } from '../../src/shared/planning/dependencies'
import {
  columnPlacement,
  dropIndex,
  dropPlacement,
  inManualOrder,
  predictOrderKey,
  stepPlacement,
  groupByProjectedStatus,
  matchesBoardFilter,
  sortWorkItems,
  todayLists,
  type BoardFilter
} from '../../src/shared/planning/board'
import {
  agentPill,
  executionLabel,
  queuePosition,
  queueSummary,
  queueWait,
  runnableHarnessTasks,
  waitingHarnessTasks
} from '../../src/shared/planning/queue'
import {
  storedTaskWorkComplete,
  type StoredHarnessState,
  type StoredSession
} from '../../electron/services/harness/types'
import {
  makeHarnessState,
  makeSession,
  makeTask,
  makeWorkItem,
  planningScenario,
  SCENARIO_EXPECTED
} from '../renderer/fixtures/planning-records'

const ids = (items: { id: string }[]) => items.map((item) => item.id)

function scenario() {
  const { items, harness } = planningScenario()
  const byId = new Map(items.map((item) => [item.id, item]))
  const projected = (item: PlanningWorkItem) => projectWorkItemStatus(item, harness)
  return { items, harness, byId, projected }
}

describe('unmetDependencyIds', () => {
  it('matches the Board for every scenario item when done means the projected column', () => {
    const { byId, projected } = scenario()
    for (const [id, unmet] of Object.entries(SCENARIO_EXPECTED.unmetDependencies)) {
      const result = unmetDependencyIds(
        byId.get(id)!,
        (dependencyId) => byId.get(dependencyId),
        (dependency) => projected(dependency) === 'done'
      )
      expect([id, result]).toEqual([id, unmet])
    }
  })

  it('ignores missing dependencies and a subtask parent, and keeps listed order', () => {
    const items = new Map(
      [
        makeWorkItem('x', { status: 'ready' }),
        makeWorkItem('y', { status: 'backlog' }),
        makeWorkItem('parent', { status: 'backlog' })
      ].map((item) => [item.id, item])
    )
    const item = makeWorkItem('child', {
      parentWorkItemId: 'parent',
      dependencyIds: ['y', 'gone', 'parent', 'x']
    })
    expect(
      unmetDependencyIds(
        item,
        (id) => items.get(id),
        (dependency) => dependency.status === 'done'
      )
    ).toEqual(['y', 'x'])
  })
})

describe('dependency picker', () => {
  const items = [
    makeWorkItem('parent'),
    makeWorkItem('child-1', { parentWorkItemId: 'parent', subtaskPhaseNumber: 1 }),
    makeWorkItem('child-2', { parentWorkItemId: 'parent', subtaskPhaseNumber: 1 }),
    makeWorkItem('child-3', { parentWorkItemId: 'parent', subtaskPhaseNumber: 2 }),
    makeWorkItem('grandchild', { parentWorkItemId: 'child-1', subtaskPhaseNumber: 1 }),
    makeWorkItem('other')
  ]
  const candidates = (id: string) =>
    ids(
      dependencyCandidates(
        items.find((item) => item.id === id)!,
        items
      )
    )

  it('never offers the task itself or its own subtasks', () => {
    expect(candidates('parent')).toEqual(['other'])
    expect(candidates('other')).toEqual(['parent', 'child-1', 'child-2', 'child-3', 'grandchild'])
  })

  it('offers a subtask only its siblings in the same phase', () => {
    expect(candidates('child-1')).toEqual(['child-2'])
    expect(candidates('child-3')).toEqual([])
  })
})

describe('queue rules', () => {
  it('labels linked work', () => {
    const { byId, harness } = scenario()
    for (const [id, label] of Object.entries(SCENARIO_EXPECTED.executionLabel)) {
      expect([id, executionLabel(byId.get(id)!, harness)]).toEqual([id, label])
    }
    expect(executionLabel(byId.get('e')!, null)).toBe('Preparing queue')
  })

  it('maps linked work onto the three agent pills', () => {
    const { byId, harness } = scenario()
    const pills = Object.fromEntries(
      Object.keys(SCENARIO_EXPECTED.executionLabel).map((id) => [
        id,
        agentPill(byId.get(id)!, harness)
      ])
    )
    expect(pills).toEqual({
      a: null,
      e: 'queued',
      f: 'running',
      g: 'queued',
      h: 'running',
      i: 'review',
      j: null,
      k: null,
      l: 'queued',
      m: 'queued',
      q: 'queued'
    })
  })

  it('separates runnable from dependency-waiting tasks and places items in the queue', () => {
    const { byId, harness } = scenario()
    const runnable = runnableHarnessTasks(harness)
    const waiting = waitingHarnessTasks(harness)
    expect(ids(runnable)).toEqual(SCENARIO_EXPECTED.runnableTasks)
    expect(ids(waiting)).toEqual(SCENARIO_EXPECTED.waitingTasks)
    for (const [id, position] of Object.entries(SCENARIO_EXPECTED.queuePosition)) {
      expect([id, queuePosition(byId.get(id)!, runnable)]).toEqual([id, position])
    }
    for (const [id, wait] of Object.entries(SCENARIO_EXPECTED.queueWait)) {
      expect([id, queueWait(byId.get(id)!, waiting)]).toEqual([id, wait])
    }
  })

  it('summarises the queue, and an absent harness as empty', () => {
    expect(queueSummary(scenario().harness)).toEqual({
      running: 1,
      starting: 1,
      queued: 2,
      waiting: 1,
      review: 1,
      sessions: 1
    })
    expect(queueSummary(null)).toEqual({
      running: 0,
      starting: 0,
      queued: 0,
      waiting: 0,
      review: 0,
      sessions: 0
    })
  })
})

describe('board rules', () => {
  const everything: BoardFilter = {
    query: '',
    priority: 'all',
    milestoneId: 'all',
    goalId: 'all',
    hideDone: false
  }

  it('filters on query, priority, milestone, goal and projected done', () => {
    const { items, projected } = scenario()
    const goalOf = (item: PlanningWorkItem) => (item.milestoneId === 'm1' ? 'g1' : null)
    const run = (filter: Partial<BoardFilter>) =>
      ids(
        items.filter((item) =>
          matchesBoardFilter(item, { ...everything, ...filter }, projected, goalOf)
        )
      )
    expect(run({})).toHaveLength(18)
    expect(run({ query: '  UI ' })).toEqual(['a', 'p'])
    expect(run({ priority: 'high' })).toEqual(['b'])
    expect(run({ milestoneId: 'm1' })).toEqual(['d', 'o'])
    expect(run({ milestoneId: 'none' })).toHaveLength(16)
    expect(run({ goalId: 'g1' })).toEqual(['d', 'o'])
    expect(run({ hideDone: true })).not.toContain('j')
    expect(run({ hideDone: true })).toHaveLength(16)
  })

  it('sorts without touching manual order', () => {
    const { items } = scenario()
    expect(sortWorkItems(items, 'manual', 'desc')).toBe(items)
    expect(ids(sortWorkItems(items, 'priority', 'asc')).slice(0, 2)).toEqual(['h', 'b'])
    expect(ids(sortWorkItems(items, 'targetDate', 'asc')).slice(0, 2)).toEqual(['d', 'b'])
    expect(ids(sortWorkItems(items, 'targetDate', 'desc')).slice(0, 2)).toEqual(['b', 'd'])
    expect(ids(sortWorkItems(items, 'title', 'desc'))[0]).toBe('r')
    expect(ids(sortWorkItems(items, 'created', 'asc'))[0]).toBe('d')
  })

  it('places a dragged card where the column will show it', () => {
    const column = [
      makeWorkItem('x', { priority: 'critical', title: 'Alpha' }),
      makeWorkItem('y', { priority: 'medium', title: 'Gamma' }),
      makeWorkItem('z', { priority: 'low', title: 'Delta' })
    ]
    const dragged = makeWorkItem('d', { priority: 'medium', title: 'Beta' })
    // Manual: where the pointer is, here the top.
    expect(dropIndex(column, dragged, 'manual', 'asc')).toBe(0)
    // Among equals it is placed first.
    expect(dropIndex(column, dragged, 'priority', 'asc')).toBe(1)
    expect(dropIndex(column, dragged, 'title', 'asc')).toBe(1)
    expect(dropIndex(column, dragged, 'title', 'desc')).toBe(2)
    expect(dropIndex(column, column[1], 'title', 'asc')).toBeNull()
  })

  it('places a card by hand under Manual order (D31)', () => {
    const column = ['a', 'b', 'c'].map((id) => makeWorkItem(id, { orderKey: id }))
    const own = column[0]
    // Between b and c, or at the end; a drop beside the card itself is no move.
    expect(dropIndex(column, own, 'manual', 'asc', 2)).toBe(2)
    expect(dropIndex(column, own, 'manual', 'asc', 0)).toBeNull()
    expect(dropIndex(column, own, 'manual', 'asc', 1)).toBeNull()
    expect(dropIndex(column, own, 'manual', 'asc', 9)).toBe(3)
    expect(dropPlacement(column, own, 2, 'ready')).toEqual({ beforeId: 'c', status: 'ready' })
    expect(dropPlacement(column, own, 3, 'ready')).toEqual({ afterId: 'c', status: 'ready' })
    const other = makeWorkItem('x', { orderKey: 'x' })
    expect(dropPlacement(column, other, 0, 'done')).toEqual({ beforeId: 'a', status: 'done' })
    expect(dropPlacement([], other, 0, 'done')).toEqual({ position: 'end', status: 'done' })
    // Under any other sort a card is not moved within its own column.
    expect(dropIndex(column, own, 'priority', 'asc', 2)).toBeNull()

    expect(stepPlacement(column, column[1], -1)).toEqual({ beforeId: 'a' })
    expect(stepPlacement(column, column[1], 1)).toEqual({ afterId: 'c' })
    expect(stepPlacement(column, column[0], -1)).toBeNull()
    expect(columnPlacement(column, 1, 'review')).toEqual({ beforeId: 'b', status: 'review' })
    expect(columnPlacement(column, 5, 'review')).toEqual({ position: 'end', status: 'review' })

    const shuffled = [column[2], column[0], column[1]]
    expect(ids(inManualOrder(shuffled))).toEqual(['a', 'b', 'c'])
    const key = predictOrderKey(column, 'c', { beforeId: 'b' })!
    expect(key > 'a' && key < 'b').toBe(true)
    expect(predictOrderKey(column, 'c', { position: 'end' })).toBeUndefined()
  })

  it('groups by projected column and builds the Today lists', () => {
    const { items, projected } = scenario()
    const columns = groupByProjectedStatus(items, ['review', 'done'], projected)
    expect([...columns.keys()]).toEqual(['review', 'done'])
    expect(ids(columns.get('done')!)).toEqual(['c', 'j'])
    const lists = todayLists(items, projected)
    expect(ids(lists.readyNow)).toEqual(SCENARIO_EXPECTED.readyNow)
    expect(ids(lists.activeNow)).toEqual(SCENARIO_EXPECTED.activeNow)
    expect(ids(lists.blockedNow)).toEqual(SCENARIO_EXPECTED.blockedNow)
  })
})

/**
 * "Is this linked work finished?" has two implementations, because main reads
 * the harness's stored state (and knows which session is asking) while the
 * renderer only has the projected queue. One table drives both.
 */
describe('task work completion: main and renderer agree', () => {
  const cases: {
    name: string
    status: 'pending' | 'claimed' | 'complete' | 'cancelled'
    claimedBy: string | null
    inReview: boolean
    complete: boolean
  }[] = [
    { name: 'pending', status: 'pending', claimedBy: null, inReview: false, complete: false },
    { name: 'claimed', status: 'claimed', claimedBy: 's1', inReview: false, complete: false },
    { name: 'cancelled', status: 'cancelled', claimedBy: null, inReview: false, complete: false },
    {
      name: 'complete, awaiting review',
      status: 'complete',
      claimedBy: 's1',
      inReview: true,
      complete: false
    },
    {
      name: 'complete and decided',
      status: 'complete',
      claimedBy: 's1',
      inReview: false,
      complete: true
    }
  ]

  for (const row of cases) {
    it(row.name, () => {
      const storedSession = {
        id: 's1',
        status: 'done',
        taskId: 't1',
        // A finished session waits for a decision until its copy is closed.
        workspace: { worktreePath: '', closed: !row.inReview }
      } as unknown as StoredSession
      const stored = {
        tasks: [
          {
            id: 't1',
            status: row.status,
            claimedBy: row.claimedBy,
            hold: false
          }
        ],
        sessions: [storedSession]
      } as unknown as StoredHarnessState
      const harness = makeHarnessState({
        taskQueue: [makeTask('t1', { status: row.status, claimedBy: row.claimedBy })],
        reviewSessions: row.inReview ? [makeSession('s1', { status: 'done', taskId: 't1' })] : []
      })
      const item = makeWorkItem('w1', { status: 'active', linkedHarnessTaskId: 't1' })

      expect(storedTaskWorkComplete(stored, 't1')).toBe(row.complete)
      expect(projectWorkItemStatus(item, harness) === 'done').toBe(row.complete)
    })
  }

  it('main alone lets a session chain on its own unreviewed work', () => {
    const stored = {
      tasks: [{ id: 't1', status: 'complete', claimedBy: 's1', reservedBy: null, hold: false }],
      sessions: [{ id: 's1', status: 'done', workspace: { slotId: 'slot-1' } }],
      workspaceSlots: [{ slotId: 'slot-1', worktreePath: '', sessionId: 's1' }]
    } as unknown as StoredHarnessState
    expect(storedTaskWorkComplete(stored, 't1')).toBe(false)
    expect(storedTaskWorkComplete(stored, 't1', 's1')).toBe(true)
  })
})
