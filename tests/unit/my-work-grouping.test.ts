import { describe, expect, it } from 'vitest'
import type { AssignedTask } from '../../src/shared/ostler-api'
import { MY_WORK_COMPARERS, groupMyWork } from '../../src/shared/planning/my-work'
import { sortRows } from '../../src/renderer/ui/data-table-sort'

function task(id: string, extra: Partial<AssignedTask> = {}): AssignedTask {
  return {
    id,
    projectId: 'p1',
    projectName: 'Website',
    projectColor: '#000001',
    estimateUnit: 'points',
    title: id,
    status: 'ready',
    priority: 'medium',
    targetDate: null,
    startDate: null,
    assigneeId: 'me',
    milestoneId: null,
    milestoneName: null,
    estimate: null,
    labels: [],
    linked: false,
    createdAt: 0,
    updatedAt: 0,
    ...extra
  }
}

/** Each group's key and the ids in it. */
const shape = (groups: ReturnType<typeof groupMyWork>) =>
  groups.map((group) => [group.key, group.tasks.map((entry) => entry.id)])

describe('My work grouping (R3.1)', () => {
  const dated = [
    task('last-week', { targetDate: '2026-10-11' }),
    task('yesterday', { targetDate: '2026-10-13' }),
    task('today', { targetDate: '2026-10-14' }),
    task('sunday', { targetDate: '2026-10-18' }),
    task('monday', { targetDate: '2026-10-19' }),
    task('next-sunday', { targetDate: '2026-10-25' }),
    task('far', { targetDate: '2026-10-26' }),
    task('undated')
  ]

  it('groups by due date across a week boundary, in local time (weeks run Monday to Sunday)', () => {
    // Wednesday 14 October 2026, late in the evening: still the 14th locally.
    const wednesday = new Date(2026, 9, 14, 23, 30)
    expect(shape(groupMyWork(dated, 'due', wednesday))).toEqual([
      ['due:overdue', ['last-week', 'yesterday']],
      ['due:today', ['today']],
      ['due:this-week', ['sunday']],
      ['due:next-week', ['monday', 'next-sunday']],
      ['due:later', ['far']],
      ['due:none', ['undated']]
    ])
  })

  it('on a Sunday, this week has nothing left after today: Monday is next week', () => {
    const sunday = new Date(2026, 9, 18, 0, 5)
    expect(shape(groupMyWork(dated, 'due', sunday))).toEqual([
      ['due:overdue', ['last-week', 'yesterday', 'today']],
      ['due:today', ['sunday']],
      ['due:next-week', ['monday', 'next-sunday']],
      ['due:later', ['far']],
      ['due:none', ['undated']]
    ])
  })

  it('groups by project by name with its colour, and by status and priority in the app’s order', () => {
    const tasks = [
      task('a', { projectId: 'p2', projectName: 'Zoo', projectColor: '#000002' }),
      task('b', { status: 'done', priority: 'critical' }),
      task('c', { status: 'active', priority: 'low' })
    ]
    const byProject = groupMyWork(tasks, 'project')
    expect(shape(byProject)).toEqual([
      ['project:p1', ['b', 'c']],
      ['project:p2', ['a']]
    ])
    expect(byProject[1]).toMatchObject({ label: 'Zoo', color: '#000002' })
    expect(shape(groupMyWork(tasks, 'status'))).toEqual([
      ['status:ready', ['a']],
      ['status:active', ['c']],
      ['status:done', ['b']]
    ])
    expect(shape(groupMyWork(tasks, 'priority'))).toEqual([
      ['priority:critical', ['b']],
      ['priority:medium', ['a']],
      ['priority:low', ['c']]
    ])
    expect(shape(groupMyWork(tasks, 'none'))).toEqual([['all', ['a', 'b', 'c']]])
  })

  it('sorts by a column with empty values last', () => {
    const tasks = [
      task('none'),
      task('late', { targetDate: '2026-11-01' }),
      task('soon', { targetDate: '2026-10-15' })
    ]
    const ids = (direction: 'asc' | 'desc') =>
      sortRows(tasks, [{ columnId: 'due', direction }], MY_WORK_COMPARERS).map((entry) => entry.id)
    expect(ids('asc')).toEqual(['soon', 'late', 'none'])
    expect(ids('desc')).toEqual(['late', 'soon', 'none'])
  })
})
