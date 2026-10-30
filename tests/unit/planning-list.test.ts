import { describe, expect, it } from 'vitest'
import type { PlanningWorkItem } from '../../src/shared/ostler-api'
import {
  dueBucket,
  dueBucketStart,
  groupTasks,
  nestSubtasks,
  type ListGroupContext
} from '../../src/shared/planning/list'

function item(id: string, overrides: Partial<PlanningWorkItem> = {}): PlanningWorkItem {
  return {
    id,
    projectId: 'p1',
    milestoneId: null,
    title: id,
    description: '',
    status: 'backlog',
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
    updatedAt: 1,
    ...overrides
  }
}

// Local dates: "today" is a day on the computer's calendar, not a UTC instant.
const WEDNESDAY = new Date(2026, 9, 7, 23, 30)
const SUNDAY = new Date(2026, 9, 11, 0, 15)

const context: ListGroupContext = {
  projectedStatus: (task) => task.status,
  milestones: [{ id: 'm1', name: 'Launch' }],
  people: [
    { id: 'me', name: 'Jordan', isMe: true },
    { id: 'ada', name: 'Ada', isMe: false },
    { id: 'bob', name: 'Bob', isMe: false }
  ],
  today: WEDNESDAY
}

describe('due buckets', () => {
  it('puts a date in its bucket, with weeks running Monday to Sunday', () => {
    expect(dueBucket(null, WEDNESDAY)).toBe('none')
    expect(dueBucket('2026-10-06', WEDNESDAY)).toBe('overdue')
    expect(dueBucket('2026-10-07', WEDNESDAY)).toBe('today')
    expect(dueBucket('2026-10-08', WEDNESDAY)).toBe('this-week')
    expect(dueBucket('2026-10-11', WEDNESDAY)).toBe('this-week')
    expect(dueBucket('2026-10-12', WEDNESDAY)).toBe('next-week')
    expect(dueBucket('2026-10-18', WEDNESDAY)).toBe('next-week')
    expect(dueBucket('2026-10-19', WEDNESDAY)).toBe('later')
    expect(dueBucket('not a date', WEDNESDAY)).toBe('none')
  })

  it('has no "this week" left on a Sunday: Monday is next week', () => {
    expect(dueBucket('2026-10-11', SUNDAY)).toBe('today')
    expect(dueBucket('2026-10-12', SUNDAY)).toBe('next-week')
    expect(dueBucket('2026-10-18', SUNDAY)).toBe('next-week')
    expect(dueBucket('2026-10-19', SUNDAY)).toBe('later')
  })

  it('gives a task added to a bucket the first day of the bucket', () => {
    expect(dueBucketStart('today', WEDNESDAY)).toBe('2026-10-07')
    expect(dueBucketStart('this-week', WEDNESDAY)).toBe('2026-10-08')
    expect(dueBucketStart('next-week', WEDNESDAY)).toBe('2026-10-12')
    expect(dueBucketStart('later', WEDNESDAY)).toBe('2026-10-19')
    expect(dueBucketStart('none', WEDNESDAY)).toBeNull()
    expect(dueBucketStart('overdue', WEDNESDAY)).toBeUndefined()
    expect(dueBucketStart('this-week', SUNDAY)).toBeUndefined()
  })
})

describe('groupTasks', () => {
  it('groups by due date with what a quick add fills in', () => {
    const groups = groupTasks(
      [item('a', { targetDate: '2026-10-01' }), item('b', { targetDate: '2026-10-07' })],
      'due',
      context
    )
    expect(groups.map((group) => [group.label, group.items.map((task) => task.id)])).toEqual([
      ['Overdue', ['a']],
      ['Today', ['b']],
      ['This week', []],
      ['Next week', []],
      ['Later', []],
      ['No date', []]
    ])
    expect(groups.map((group) => group.quickAdd)).toEqual([
      null,
      { targetDate: '2026-10-07' },
      { targetDate: '2026-10-08' },
      { targetDate: '2026-10-12' },
      { targetDate: '2026-10-19' },
      { targetDate: null }
    ])
  })

  it('shows Me and people with work, then Unassigned; an unknown person counts as unassigned', () => {
    const groups = groupTasks(
      [item('a', { assigneeId: 'ada' }), item('b'), item('c', { assigneeId: 'ghost' })],
      'assignee',
      context
    )
    expect(groups.map((group) => [group.label, group.items.map((task) => task.id)])).toEqual([
      ['Jordan (you)', []],
      ['Ada', ['a']],
      ['Unassigned', ['b', 'c']]
    ])
    expect(groups[1].quickAdd).toEqual({ assigneeId: 'ada' })
  })

  it('groups by first label, then No label', () => {
    const groups = groupTasks(
      [item('a', { labels: ['web', 'urgent'] }), item('b', { labels: ['design'] }), item('c')],
      'label',
      context
    )
    expect(groups.map((group) => [group.label, group.items.map((task) => task.id)])).toEqual([
      ['design', ['b']],
      ['web', ['a']],
      ['No label', ['c']]
    ])
    expect(groups[0].quickAdd).toEqual({ labels: ['design'] })
  })

  it('shows every status, priority and milestone, so an empty one can be added to', () => {
    expect(groupTasks([], 'status', context).map((group) => group.label)).toEqual([
      'Backlog',
      'Ready',
      'In progress',
      'Blocked',
      'In review',
      'Done'
    ])
    expect(groupTasks([], 'priority', context).map((group) => group.quickAdd)).toEqual([
      { priority: 'critical' },
      { priority: 'high' },
      { priority: 'medium' },
      { priority: 'low' }
    ])
    expect(groupTasks([], 'milestone', context).map((group) => group.quickAdd)).toEqual([
      { milestoneId: 'm1' },
      { milestoneId: null }
    ])
  })
})

describe('nestSubtasks', () => {
  const byTitle = (tasks: PlanningWorkItem[]) =>
    [...tasks].sort((a, b) => a.title.localeCompare(b.title))

  it('puts subtasks under their parent, each level sorted', () => {
    const rows = nestSubtasks(
      [
        item('p', { title: 'B parent' }),
        item('c2', { title: 'Z child', parentWorkItemId: 'p' }),
        item('c1', { title: 'A child', parentWorkItemId: 'p' }),
        item('g', { title: 'Grandchild', parentWorkItemId: 'c1' }),
        item('q', { title: 'A other' })
      ],
      byTitle
    )
    expect(rows.map((row) => [row.item.id, row.depth, row.childCount])).toEqual([
      ['q', 0, 0],
      ['p', 0, 2],
      ['c1', 1, 1],
      ['g', 2, 0],
      ['c2', 1, 0]
    ])
  })

  it('shows an orphaned subtask at the top level and hides the subtasks of a collapsed parent', () => {
    const rows = nestSubtasks(
      [
        item('p'),
        item('c', { parentWorkItemId: 'p' }),
        item('o', { parentWorkItemId: 'elsewhere' })
      ],
      byTitle,
      new Set(['p'])
    )
    expect(rows.map((row) => [row.item.id, row.depth, row.childCount])).toEqual([
      ['o', 0, 0],
      ['p', 0, 1]
    ])
  })

  it('survives a parent loop', () => {
    const rows = nestSubtasks(
      [item('a', { parentWorkItemId: 'b' }), item('b', { parentWorkItemId: 'a' })],
      byTitle
    )
    expect(rows.map((row) => row.item.id).sort()).toEqual(['a', 'b'])
  })
})
